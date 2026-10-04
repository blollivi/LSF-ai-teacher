"""Persistent theme builder. State lives in the DB (Theme.status + Candidate rows),
so an interrupted build resumes where it stopped after a restart."""

import asyncio
import logging
import math

from sqlmodel import col, func, select

from .agent.generator import generate_candidates
from .agent.validator import Outcome, ThemeContext, validate_candidate
from .config import Settings
from .db import session
from .elix import ElixClient
from .llm import LLM
from .media import MediaResult, MediaStore
from .models import Candidate, Item, Theme, ThemeItem

log = logging.getLogger(__name__)


class ThemeBuilder:
    def __init__(self, settings: Settings, engine, llm: LLM, elix: ElixClient, media: MediaStore):
        self.settings = settings
        self.engine = engine
        self.llm = llm
        self.elix = elix
        self.media = media
        self.queue: asyncio.Queue[int] = asyncio.Queue()
        self._queued: set[int] = set()
        self._worker: asyncio.Task | None = None

    # ---- lifecycle -------------------------------------------------------

    def start(self) -> None:
        with session(self.engine) as s:
            for c in s.exec(select(Candidate).where(Candidate.status == "processing")):
                c.status = "pending"
                s.add(c)
            s.commit()
            unfinished = s.exec(select(Theme.id).where(col(Theme.status).in_(["generating", "validating"]))).all()
        for theme_id in unfinished:
            self.enqueue(theme_id)
        self._worker = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        if self._worker:
            self._worker.cancel()

    def enqueue(self, theme_id: int) -> None:
        if theme_id not in self._queued:
            self._queued.add(theme_id)
            self.queue.put_nowait(theme_id)

    async def _loop(self) -> None:
        while True:
            theme_id = await self.queue.get()
            self._queued.discard(theme_id)
            try:
                await self.build(theme_id)
            except Exception as e:
                log.exception("build of theme %s failed", theme_id)
                with session(self.engine) as s:
                    theme = s.get(Theme, theme_id)
                    if theme:
                        theme.status, theme.error = "failed", f"{e.__class__.__name__}: {e}"
                        s.add(theme)
                        s.commit()

    # ---- counts ------------------------------------------------------------

    def counts(self, theme_id: int) -> dict[str, int]:
        with session(self.engine) as s:
            roles = dict(
                s.exec(
                    select(ThemeItem.role, func.count()).where(ThemeItem.theme_id == theme_id).group_by(ThemeItem.role)
                ).all()
            )
            statuses = dict(
                s.exec(
                    select(Candidate.status, func.count())
                    .where(Candidate.theme_id == theme_id)
                    .group_by(Candidate.status)
                ).all()
            )
        return {
            "active": roles.get("active", 0),
            "reserve": roles.get("reserve", 0),
            "pending": statuses.get("pending", 0) + statuses.get("processing", 0),
            "rejected": statuses.get("rejected", 0),
        }

    def missing(self, theme: Theme) -> int:
        c = self.counts(theme.id)  # type: ignore[arg-type]
        return max(0, theme.target_active - c["active"]) + max(0, self.settings.reserve_target - c["reserve"])

    # ---- build -------------------------------------------------------------

    async def build(self, theme_id: int) -> None:
        while True:
            with session(self.engine) as s:
                theme = s.get(Theme, theme_id)
            if theme is None:
                return
            missing = self.missing(theme)
            if missing == 0:
                self._finish(theme_id)
                return
            if self.counts(theme_id)["pending"] == 0:
                if theme.rounds >= self.settings.max_generation_rounds:
                    self._finish(theme_id)
                    return
                await self._generate(theme, missing)
                if self.counts(theme_id)["pending"] == 0:  # generator gave nothing new
                    self._finish(theme_id)
                    return
            await self._validate_pending(theme_id)

    def _finish(self, theme_id: int) -> None:
        with session(self.engine) as s:
            theme = s.get(Theme, theme_id)
            if theme is None:
                return
            ready = self.counts(theme_id)["active"]
            theme.status = "ready" if ready else "failed"
            if not ready:
                theme.error = "aucun mot n'a pu être validé avec une vidéo"
            s.add(theme)
            s.commit()
        log.info("theme %s finished: %s", theme_id, self.counts(theme_id))

    async def _generate(self, theme: Theme, missing: int) -> None:
        with session(self.engine) as s:
            tried = s.exec(select(Candidate.word).where(Candidate.theme_id == theme.id)).all()
        # Roughly half the candidates survive validation; ask for more than we need.
        n = min(40, max(10, math.ceil(missing * 2.5)))
        gen = await generate_candidates(self.llm, theme.name, n, list(tried))
        with session(self.engine) as s:
            t = s.get(Theme, theme.id)
            t.rounds += 1
            t.status = "validating"
            if t.emoji == "📚" and gen.emoji:
                t.emoji = gen.emoji
            s.add(t)
            for word, hint in gen.candidates:
                s.add(Candidate(theme_id=theme.id, word=word, hint=hint))
            s.commit()
        log.info("theme %s round %s: %s candidates", theme.id, theme.rounds + 1, len(gen.candidates))

    async def _validate_pending(self, theme_id: int) -> None:
        with session(self.engine) as s:
            pending = s.exec(
                select(Candidate).where(Candidate.theme_id == theme_id, Candidate.status == "pending").order_by(Candidate.id)
            ).all()
        sem = asyncio.Semaphore(self.settings.validation_concurrency)

        async def one(c: Candidate) -> None:
            async with sem:
                # Stop early once the theme is full; leftover candidates stay pending for a later extend.
                with session(self.engine) as s:
                    theme = s.get(Theme, theme_id)
                if self.missing(theme) == 0:
                    return
                await self.validate_one(theme_id, c)

        await asyncio.gather(*(one(c) for c in pending))

    def _theme_context(self, theme_id: int, name: str) -> ThemeContext:
        with session(self.engine) as s:
            rows = s.exec(
                select(Item.meaning_id, Item.video_sha, Item.word)
                .join(ThemeItem, col(ThemeItem.meaning_id) == col(Item.meaning_id))
                .where(ThemeItem.theme_id == theme_id)
            ).all()
        return ThemeContext(name=name, shas={sha: w for _, sha, w in rows}, meaning_ids={m for m, _, _ in rows})

    def _known_videos(self) -> dict[int, MediaResult]:
        with session(self.engine) as s:
            items = s.exec(select(Item)).all()
        return {
            i.meaning_id: MediaResult(True, sha=i.video_sha, has_poster=i.has_poster, duration_s=i.duration_s)
            for i in items
            if self.media.video_path(i.video_sha).exists()
        }

    async def validate_one(self, theme_id: int, cand: Candidate) -> Outcome:
        with session(self.engine) as s:
            c = s.get(Candidate, cand.id)
            c.status = "processing"
            s.add(c)
            s.commit()
            theme = s.get(Theme, theme_id)
        try:
            outcome = await validate_candidate(
                self.llm, self.elix, self.media, self._theme_context(theme_id, theme.name),
                cand.word, cand.hint, self._known_videos(),
            )
        except Exception as e:
            log.exception("validation of %r failed", cand.word)
            outcome = Outcome(False, reason=f"erreur : {e.__class__.__name__}")
        self._persist(theme_id, cand.id, outcome)  # type: ignore[arg-type]
        return outcome

    def _persist(self, theme_id: int, cand_id: int, outcome: Outcome) -> None:
        with session(self.engine) as s:
            c = s.get(Candidate, cand_id)
            theme = s.get(Theme, theme_id)
            if outcome.accepted:
                m, media = outcome.meaning, outcome.media
                assert m is not None and media is not None and media.ok
                # Re-check under the (single-threaded) commit: concurrent validations may have raced.
                ctx = self._theme_context(theme_id, theme.name)
                if m.meaning_id in ctx.meaning_ids:
                    outcome = Outcome(False, reason="sens déjà présent dans le thème")
                elif media.sha in ctx.shas:
                    outcome = Outcome(False, reason=f"vidéo identique à « {ctx.shas[media.sha]} »")
            if outcome.accepted:
                m, media = outcome.meaning, outcome.media
                s.merge(
                    Item(
                        meaning_id=m.meaning_id, word=m.word, typology=m.typology, definition=m.definition,
                        video_sha=media.sha, has_poster=media.has_poster, duration_s=media.duration_s,
                        author=m.signs[0].author if m.signs else "", source_video_uri=m.signs[0].uri if m.signs else "",
                    )
                )
                s.flush()  # the Item row must exist before the ThemeItem foreign key
                counts = self.counts(theme_id)
                role = "active" if counts["active"] < theme.target_active else "reserve"
                s.add(
                    ThemeItem(
                        theme_id=theme_id, meaning_id=m.meaning_id, role=role,
                        position=counts["active"] + counts["reserve"], justification=outcome.justification,
                    )
                )
                c.status, c.meaning_id, c.reason = "accepted", m.meaning_id, outcome.justification
            else:
                c.status, c.reason = "rejected", outcome.reason
            s.add(c)
            s.commit()
        log.info("theme %s: %s %s (%s)", theme_id, c.word, c.status, c.reason)

    # ---- user actions --------------------------------------------------------

    def extend(self, theme_id: int, count: int) -> None:
        with session(self.engine) as s:
            theme = s.get(Theme, theme_id)
            theme.target_active += count
            reserve = s.exec(
                select(ThemeItem)
                .where(ThemeItem.theme_id == theme_id, ThemeItem.role == "reserve")
                .order_by(ThemeItem.position)
                .limit(count)
            ).all()
            for ti in reserve:
                ti.role = "active"
                s.add(ti)
            theme.rounds = 0
            theme.status = "validating"
            s.add(theme)
            s.commit()
        self.enqueue(theme_id)

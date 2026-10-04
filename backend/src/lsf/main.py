import logging
import secrets
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlmodel import col, func, select

from .agent.generator import suggest_themes
from .config import Settings
from .db import make_engine, session
from .elix import ElixClient
from .jobs import ThemeBuilder
from .llm import LLM, OpenAILLM
from .media import MediaStore
from .models import Candidate, Item, Theme, ThemeItem

log = logging.getLogger(__name__)


class CreateTheme(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    size: int = Field(default=12, ge=4, le=40)


class Extend(BaseModel):
    count: int = Field(default=10, ge=1, le=30)


class SuggestRequest(BaseModel):
    known_themes: list[str] = []
    acquired_words: list[str] = []


def create_app(settings: Settings | None = None, llm: LLM | None = None, http: httpx.AsyncClient | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = make_engine(settings)
    if not settings.app_token:
        log.warning("APP_TOKEN is empty: the API is open to anyone who can reach it")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        client = http or httpx.AsyncClient(headers={"User-Agent": "lsf-ai-teacher/0.1"})
        the_llm = llm or OpenAILLM(settings.openai_api_key, settings.openai_model)
        elix = ElixClient(client, engine, settings.elix_base, settings.elix_concurrency)
        media = MediaStore(client, settings.media_dir)
        app.state.builder = ThemeBuilder(settings, engine, the_llm, elix, media)
        app.state.llm = the_llm
        app.state.builder.start()
        yield
        await app.state.builder.stop()
        if http is None:
            await client.aclose()

    app = FastAPI(title="LSF AI Teacher", lifespan=lifespan)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    def auth(authorization: str = Header(default="")) -> None:
        if settings.app_token and not secrets.compare_digest(authorization, f"Bearer {settings.app_token}"):
            raise HTTPException(401, "token invalide")

    def builder() -> ThemeBuilder:
        return app.state.builder

    def summary(theme: Theme, b: ThemeBuilder) -> dict:
        c = b.counts(theme.id)  # type: ignore[arg-type]
        return {
            "id": theme.id,
            "name": theme.name,
            "emoji": theme.emoji,
            "status": theme.status,
            "error": theme.error,
            "target_active": theme.target_active,
            "active_count": c["active"],
            "reserve_count": c["reserve"],
            "pending_count": c["pending"],
            "rejected_count": c["rejected"],
            "playable": c["active"] >= settings.playable_min,
        }

    @app.get("/health")
    def health():
        return {"ok": True}

    @app.get("/themes", dependencies=[Depends(auth)])
    def list_themes(b: ThemeBuilder = Depends(builder)):
        with session(engine) as s:
            themes = s.exec(select(Theme).order_by(Theme.id)).all()
        return [summary(t, b) for t in themes]

    @app.post("/themes", status_code=201, dependencies=[Depends(auth)])
    def create_theme(body: CreateTheme, b: ThemeBuilder = Depends(builder)):
        name = body.name.strip()
        with session(engine) as s:
            existing = s.exec(select(Theme).where(func.lower(Theme.name) == name.lower())).first()
            if existing and existing.status != "failed":
                return summary(existing, b)
            if existing:  # retry a failed build (e.g. the OpenAI key was wrong)
                existing.status, existing.error, existing.rounds = "generating", None, 0
                s.add(existing)
                # Candidates that crashed (not judged) get another chance instead of being excluded forever.
                for c in s.exec(
                    select(Candidate).where(
                        Candidate.theme_id == existing.id,
                        Candidate.status == "rejected",
                        col(Candidate.reason).startswith("erreur"),
                    )
                ):
                    c.status, c.reason = "pending", ""
                    s.add(c)
                s.commit()
                b.enqueue(existing.id)  # type: ignore[arg-type]
                return summary(existing, b)
            theme = Theme(name=name, target_active=body.size)
            s.add(theme)
            s.commit()
            s.refresh(theme)
        b.enqueue(theme.id)  # type: ignore[arg-type]
        return summary(theme, b)

    @app.get("/themes/{theme_id}", dependencies=[Depends(auth)])
    def get_theme(theme_id: int, b: ThemeBuilder = Depends(builder)):
        with session(engine) as s:
            theme = s.get(Theme, theme_id)
            if theme is None:
                raise HTTPException(404, "thème inconnu")
            # Items only exist once fully validated (sense matched + video downloaded and checked).
            rows = s.exec(
                select(Item, ThemeItem)
                .join(ThemeItem, col(ThemeItem.meaning_id) == col(Item.meaning_id))
                .where(ThemeItem.theme_id == theme_id)
                .order_by(ThemeItem.position)
            ).all()
        items = [
            {
                "meaning_id": i.meaning_id,
                "word": i.word,
                "typology": i.typology,
                "definition": i.definition,
                "video_url": f"/media/{i.video_sha}.mp4",
                "poster_url": f"/media/{i.video_sha}.jpg" if i.has_poster else None,
                "video_sha": i.video_sha,
                "author": i.author,
                "role": ti.role,
                "position": ti.position,
            }
            for i, ti in rows
            if b.media.video_path(i.video_sha).exists()
        ]
        return {**summary(theme, b), "items": items}

    @app.get("/themes/{theme_id}/report", dependencies=[Depends(auth)])
    def report(theme_id: int):
        with session(engine) as s:
            cands = s.exec(select(Candidate).where(Candidate.theme_id == theme_id).order_by(Candidate.id)).all()
        return [{"word": c.word, "hint": c.hint, "status": c.status, "reason": c.reason, "meaning_id": c.meaning_id} for c in cands]

    @app.post("/themes/{theme_id}/extend", dependencies=[Depends(auth)])
    def extend(theme_id: int, body: Extend, b: ThemeBuilder = Depends(builder)):
        with session(engine) as s:
            if s.get(Theme, theme_id) is None:
                raise HTTPException(404, "thème inconnu")
        b.extend(theme_id, body.count)
        with session(engine) as s:
            return summary(s.get(Theme, theme_id), b)

    @app.post("/themes/suggest", dependencies=[Depends(auth)])
    async def suggest(body: SuggestRequest):
        with session(engine) as s:
            known = list(s.exec(select(Theme.name)).all())
        return {"themes": await suggest_themes(app.state.llm, sorted(set(known + body.known_themes)), body.acquired_words)}

    app.mount("/media", StaticFiles(directory=settings.media_dir), name="media")
    return app

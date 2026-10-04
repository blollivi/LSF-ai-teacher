import asyncio
import json
from dataclasses import asdict, dataclass, field
from datetime import timedelta

import httpx

from .db import session
from .models import ElixCache, now

CACHE_TTL = timedelta(days=30)


@dataclass
class Sign:
    uri: str
    image: str | None = None
    author: str = ""


@dataclass
class Meaning:
    meaning_id: int
    word: str
    typology: str
    definition: str
    signs: list[Sign] = field(default_factory=list)

    @property
    def signed(self) -> bool:
        return bool(self.signs)


class ElixClient:
    def __init__(self, http: httpx.AsyncClient, engine, base: str, concurrency: int = 3):
        self.http = http
        self.engine = engine
        self.base = base.rstrip("/")
        self.sem = asyncio.Semaphore(concurrency)

    async def _get_json(self, path: str, params: dict) -> object:
        key = path + "?" + json.dumps(params, sort_keys=True, ensure_ascii=False)
        with session(self.engine) as s:
            cached = s.get(ElixCache, key)
            if cached and now() - cached.fetched_at.replace(tzinfo=now().tzinfo) < CACHE_TTL:
                return json.loads(cached.payload)
        async with self.sem:
            r = await self.http.get(f"{self.base}{path}", params=params, timeout=30)
        if r.status_code == 404:
            payload: object = {"data": []}
        else:
            r.raise_for_status()
            payload = r.json()
        with session(self.engine) as s:
            s.merge(ElixCache(key=key, payload=json.dumps(payload, ensure_ascii=False)))
            s.commit()
        return payload

    async def lookup(self, word: str) -> list[Meaning]:
        """All meanings for the exact word (Elix returns one entry per grammatical category)."""
        payload = await self._get_json("/words", {"q": word})
        out: list[Meaning] = []
        for entry in payload.get("data") or []:  # type: ignore[union-attr]
            for m in entry.get("meanings") or []:
                if m.get("id") is None:  # happens in the wild; such meanings can't be referenced
                    continue
                signs = [
                    Sign(uri=s["uri"], image=s.get("image"), author=s.get("author") or "")
                    for s in m.get("wordSigns") or []
                    if s.get("uri")
                ]
                out.append(
                    Meaning(
                        meaning_id=m["id"],
                        word=entry.get("name") or word,
                        typology=entry.get("typology") or "",
                        definition=(m.get("definition") or "").strip(),
                        signs=signs,
                    )
                )
        return out

    async def suggest(self, prefix: str, fuzzy: bool = False, limit: int = 15) -> list[str]:
        if not prefix.strip():
            return []
        payload = await self._get_json(
            "/suggests",
            {"q": prefix, "limit": limit, "offset": 0, "fuzzy": int(fuzzy), "thematic": ""},
        )
        return list(payload.get("data") or [])  # type: ignore[union-attr]


def meaning_to_dict(m: Meaning) -> dict:
    d = asdict(m)
    d["signs"] = len(m.signs)
    return d

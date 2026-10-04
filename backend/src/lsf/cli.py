"""Debug entry point: build a theme synchronously and print the validation report.

    uv run python -m lsf.cli build-theme "Cuisine" --size 12
"""

import argparse
import asyncio
import logging

import httpx
from sqlmodel import func, select

from .config import Settings
from .db import make_engine, session
from .elix import ElixClient
from .jobs import ThemeBuilder
from .llm import OpenAILLM
from .media import MediaStore
from .models import Candidate, Theme


async def build_theme(name: str, size: int) -> None:
    settings = Settings()
    if not settings.openai_api_key:
        raise SystemExit("OPENAI_API_KEY manquant")
    engine = make_engine(settings)
    async with httpx.AsyncClient(headers={"User-Agent": "lsf-ai-teacher/0.1"}) as http:
        builder = ThemeBuilder(
            settings, engine, OpenAILLM(settings.openai_api_key, settings.openai_model),
            ElixClient(http, engine, settings.elix_base, settings.elix_concurrency), MediaStore(http, settings.media_dir),
        )
        with session(engine) as s:
            theme = s.exec(select(Theme).where(func.lower(Theme.name) == name.lower())).first()
            if theme is None:
                theme = Theme(name=name, target_active=size)
                s.add(theme)
                s.commit()
                s.refresh(theme)
        await builder.build(theme.id)
        with session(engine) as s:
            theme = s.get(Theme, theme.id)
            cands = s.exec(select(Candidate).where(Candidate.theme_id == theme.id).order_by(Candidate.id)).all()
        print(f"\n{theme.emoji} {theme.name} — {theme.status} — {builder.counts(theme.id)}\n")
        for c in cands:
            mark = {"accepted": "✅", "rejected": "❌"}.get(c.status, "⏳")
            print(f"{mark} {c.word:<22} {c.reason[:110]}")


def main() -> None:
    logging.basicConfig(level=logging.WARNING)
    p = argparse.ArgumentParser(prog="lsf")
    sub = p.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build-theme")
    b.add_argument("name")
    b.add_argument("--size", type=int, default=12)
    args = p.parse_args()
    if args.cmd == "build-theme":
        asyncio.run(build_theme(args.name, args.size))


if __name__ == "__main__":
    main()

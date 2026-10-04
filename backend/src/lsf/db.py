from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from .config import Settings


def make_engine(settings: Settings):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    settings.media_dir.mkdir(parents=True, exist_ok=True)
    engine = create_engine(settings.db_url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _pragmas(conn, _):
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")

    SQLModel.metadata.create_all(engine)
    return engine


def session(engine) -> Session:
    return Session(engine, expire_on_commit=False)

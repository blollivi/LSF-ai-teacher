from datetime import datetime, timezone

from sqlmodel import Field, SQLModel


def now() -> datetime:
    return datetime.now(timezone.utc)


class Theme(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    emoji: str = "📚"
    # generating -> validating -> ready | failed
    status: str = "generating"
    target_active: int = 12
    rounds: int = 0
    error: str | None = None
    created_at: datetime = Field(default_factory=now)


class Item(SQLModel, table=True):
    """A word meaning fully validated: signed, sense matched, video downloaded and checked."""

    meaning_id: int = Field(primary_key=True)
    word: str
    typology: str = ""
    definition: str = ""
    video_sha: str = Field(index=True)
    has_poster: bool = False
    author: str = ""
    source_video_uri: str = ""
    duration_s: float = 0.0
    created_at: datetime = Field(default_factory=now)


class ThemeItem(SQLModel, table=True):
    theme_id: int = Field(foreign_key="theme.id", primary_key=True)
    meaning_id: int = Field(foreign_key="item.meaning_id", primary_key=True)
    role: str = "active"  # active | reserve
    position: int = 0
    justification: str = ""
    added_at: datetime = Field(default_factory=now)


class Candidate(SQLModel, table=True):
    """A word proposed by the generator; doubles as the persistent validation queue."""

    id: int | None = Field(default=None, primary_key=True)
    theme_id: int = Field(foreign_key="theme.id", index=True)
    word: str
    hint: str = ""
    # pending -> processing -> accepted | rejected
    status: str = Field(default="pending", index=True)
    reason: str = ""
    meaning_id: int | None = None
    created_at: datetime = Field(default_factory=now)


class ElixCache(SQLModel, table=True):
    key: str = Field(primary_key=True)
    payload: str
    fetched_at: datetime = Field(default_factory=now)

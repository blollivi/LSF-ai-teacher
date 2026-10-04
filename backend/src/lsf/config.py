from dataclasses import dataclass, field
from pathlib import Path
import os


@dataclass
class Settings:
    openai_api_key: str = field(default_factory=lambda: os.getenv("OPENAI_API_KEY", ""))
    openai_model: str = field(default_factory=lambda: os.getenv("OPENAI_MODEL", "gpt-5.4-mini"))
    app_token: str = field(default_factory=lambda: os.getenv("APP_TOKEN", ""))
    data_dir: Path = field(default_factory=lambda: Path(os.getenv("DATA_DIR", "./data")))
    elix_base: str = field(default_factory=lambda: os.getenv("ELIX_BASE", "https://api.elix-lsf.fr"))
    elix_concurrency: int = field(default_factory=lambda: int(os.getenv("ELIX_CONCURRENCY", "3")))
    validation_concurrency: int = field(default_factory=lambda: int(os.getenv("VALIDATION_CONCURRENCY", "3")))
    cors_origins: list[str] = field(
        default_factory=lambda: [o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip()]
    )
    reserve_target: int = 8
    playable_min: int = 4
    max_generation_rounds: int = 3

    @property
    def media_dir(self) -> Path:
        return self.data_dir / "media"

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'lsf.db'}"

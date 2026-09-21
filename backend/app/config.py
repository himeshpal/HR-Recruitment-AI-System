from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
ROOT_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env", env_file_encoding="utf-8", extra="ignore"
    )

    # LLM_API_KEY (used for Ollama) wins over GROQ_API_KEY when both are set.
    llm_api_key: str = Field(
        default="", validation_alias=AliasChoices("LLM_API_KEY", "GROQ_API_KEY")
    )
    llm_base_url: str = "https://api.groq.com/openai/v1"
    llm_model_large: str = "openai/gpt-oss-120b"
    llm_model_small: str = "openai/gpt-oss-20b"
    llm_max_attempts: int = 8  # free tiers rate-limit hard; waiting is cheaper than failing
    llm_timeout_seconds: float = 60.0

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'hr.db').as_posix()}"
    llm_cache_dir: Path = BACKEND_DIR / "data" / "llm_cache"
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

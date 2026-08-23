"""Application configuration using pydantic-settings."""

from __future__ import annotations

from pathlib import Path

import platformdirs
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings with environment variable override support."""

    api_host: str = "127.0.0.1"
    api_port: int = 8001
    api_reload: bool = True

    cors_origins: list[str] = [
        "http://localhost:5273",
        "http://127.0.0.1:5273",
        "http://localhost:8001",
        "http://127.0.0.1:8001",
    ]
    cors_allow_credentials: bool = True
    cors_allow_methods: list[str] = ["*"]
    cors_allow_headers: list[str] = ["*"]

    data_dir: Path = Path(platformdirs.user_data_dir("sqlcipherui", "sqlcipherui"))

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="SQLCIPHERUI_",
        case_sensitive=False,
    )

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.data_dir.mkdir(parents=True, exist_ok=True)


__all__ = ["Settings"]

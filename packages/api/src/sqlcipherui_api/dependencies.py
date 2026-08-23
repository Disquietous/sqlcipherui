"""Dependency injection for FastAPI routes."""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends

from sqlcipherui_api.config import Settings
from sqlcipherui_core.services.app_db import AppDatabase
from sqlcipherui_core.services.connection_manager import ConnectionManager


_conn_manager: ConnectionManager | None = None
_app_db: AppDatabase | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()


async def get_conn_manager() -> ConnectionManager:
    global _conn_manager
    if _conn_manager is None:
        _conn_manager = ConnectionManager()
    return _conn_manager


async def get_app_db() -> AppDatabase:
    global _app_db
    if _app_db is None:
        settings = get_settings()
        _app_db = AppDatabase(settings.data_dir)
    return _app_db


async def cleanup_dependencies():
    global _conn_manager, _app_db
    if _conn_manager is not None:
        await _conn_manager.close_all()
        _conn_manager = None
    if _app_db is not None:
        _app_db.close()
        _app_db = None


SettingsDep = Annotated[Settings, Depends(get_settings)]
ConnManagerDep = Annotated[ConnectionManager, Depends(get_conn_manager)]
AppDbDep = Annotated[AppDatabase, Depends(get_app_db)]

__all__ = [
    "get_settings",
    "get_conn_manager",
    "get_app_db",
    "cleanup_dependencies",
    "SettingsDep",
    "ConnManagerDep",
    "AppDbDep",
]

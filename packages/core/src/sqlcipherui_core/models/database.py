"""Database connection and info models."""

from __future__ import annotations

from pydantic import BaseModel, computed_field


class DatabaseInfo(BaseModel):
    """Information about an open database."""

    path: str | None = None
    name: str | None = None
    encrypted: bool = False
    unlocked: bool = False
    size_bytes: int | None = None
    journal_mode: str | None = None
    page_size: int | None = None
    page_count: int | None = None
    freelist_count: int | None = None
    table_count: int | None = None

    @computed_field
    @property
    def size_display(self) -> str:
        if self.size_bytes is None:
            return "—"
        if self.size_bytes < 1024:
            return f"{self.size_bytes} B"
        if self.size_bytes < 1024 * 1024:
            return f"{self.size_bytes / 1024:.1f} KB"
        return f"{self.size_bytes / (1024 * 1024):.1f} MB"


class CreateRequest(BaseModel):
    """Request to create a new database file."""

    path: str
    encrypt: bool = False
    passphrase: str | None = None


class OpenRequest(BaseModel):
    """Request to open a database file."""

    path: str


class CloseRequest(BaseModel):
    """Request to close a database connection."""

    id: str


class UnlockRequest(BaseModel):
    """Request to unlock an encrypted database."""

    id: str
    passphrase: str

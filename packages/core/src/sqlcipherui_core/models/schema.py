"""Schema introspection models."""

from __future__ import annotations

from pydantic import BaseModel


class TableInfo(BaseModel):
    """Summary information about a database table."""

    name: str
    row_count: int | None = None
    column_count: int | None = None
    icon: str = "table"


class ColumnInfo(BaseModel):
    """Column metadata from PRAGMA table_info."""

    name: str
    type: str
    pk: bool = False
    notnull: bool = False
    unique: bool = False
    default_value: str | None = None


class IndexInfo(BaseModel):
    """Index metadata."""

    name: str
    table_name: str
    columns: list[str]
    unique: bool = False


class TriggerInfo(BaseModel):
    """Trigger metadata."""

    name: str
    table_name: str
    event: str
    sql: str


class ViewInfo(BaseModel):
    """View metadata."""

    name: str
    sql: str


class ForeignKey(BaseModel):
    """Foreign key relationship."""

    from_table: str
    from_column: str
    to_table: str
    to_column: str


class TableDetail(BaseModel):
    """Full detail for a single table."""

    name: str
    columns: list[ColumnInfo]
    indexes: list[IndexInfo]
    triggers: list[TriggerInfo]
    foreign_keys: list[ForeignKey]
    create_sql: str | None = None
    row_count: int | None = None

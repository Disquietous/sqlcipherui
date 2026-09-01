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
    sql: str | None = None
    sql_formatted: str | None = None


class TriggerInfo(BaseModel):
    """Trigger metadata."""

    name: str
    table_name: str
    event: str
    sql: str
    sql_formatted: str | None = None


class ViewInfo(BaseModel):
    """View metadata."""

    name: str
    sql: str
    sql_formatted: str | None = None


class ForeignKey(BaseModel):
    """Foreign key relationship."""

    from_table: str
    from_column: str
    to_table: str
    to_column: str


class SnapshotColumn(BaseModel):
    """Compact column record for the completion snapshot."""

    name: str
    type: str = ""
    pk: bool = False
    notnull: bool = False
    hidden: int = 0  # PRAGMA table_xinfo: 0 normal, 1 hidden, 2 virtual gen, 3 stored gen


class SnapshotTable(BaseModel):
    """Table or view with its columns, for the completion snapshot."""

    name: str
    schema_name: str = "main"
    kind: str = "table"  # "table" | "view"
    columns: list[SnapshotColumn]
    without_rowid: bool = False
    strict: bool = False


class SnapshotObject(BaseModel):
    """Index or trigger name with owning table."""

    name: str
    schema_name: str = "main"
    table: str


class SchemaSnapshot(BaseModel):
    """Everything the SQL editor needs for local completion, in one payload."""

    schema_version: int
    schemas: list[str]
    tables: list[SnapshotTable]
    indexes: list[SnapshotObject]
    triggers: list[SnapshotObject]
    foreign_keys: list[ForeignKey]


class TableDetail(BaseModel):
    """Full detail for a single table."""

    name: str
    columns: list[ColumnInfo]
    indexes: list[IndexInfo]
    triggers: list[TriggerInfo]
    foreign_keys: list[ForeignKey]
    create_sql: str | None = None
    create_sql_formatted: str | None = None
    row_count: int | None = None

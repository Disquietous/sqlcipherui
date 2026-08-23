"""Query execution models."""

from __future__ import annotations

from pydantic import BaseModel


class QueryRequest(BaseModel):
    """Request to execute a SQL statement."""

    sql: str


class ColumnMeta(BaseModel):
    """Column metadata for a query result."""

    name: str
    type: str = ""


class QueryResult(BaseModel):
    """Result of a SQL query execution."""

    columns: list[ColumnMeta]
    rows: list[list]
    row_count: int
    elapsed_ms: float
    error: str | None = None

"""Data operations service for reading and modifying table rows."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from sqlcipherui_core.services.db_manager import DatabaseManager

logger = logging.getLogger(__name__)


@dataclass
class ColumnInfo:
    """Column metadata from PRAGMA table_info."""

    cid: int
    name: str
    type: str
    notnull: bool
    default_value: str | None
    pk: int


class DataService:
    """High-level data operations on a single database table."""

    def __init__(self, db: DatabaseManager) -> None:
        self._db = db

    async def _get_table_columns(self, table: str) -> list[ColumnInfo]:
        """Fetch and validate column metadata for a table.

        Raises ValueError if the table does not exist.
        """
        await self._validate_table(table)
        rows = await self._db.execute(f'PRAGMA table_info("{table}")')
        return [
            ColumnInfo(
                cid=r[0],
                name=r[1],
                type=r[2],
                notnull=bool(r[3]),
                default_value=r[4],
                pk=r[5],
            )
            for r in rows
        ]

    async def _validate_table(self, table: str) -> None:
        """Ensure *table* exists in the database schema (table or view)."""
        rows = await self._db.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
            (table,),
        )
        if not rows:
            raise ValueError(f"Table or view not found: {table}")

    async def _validate_columns(
        self, table: str, names: list[str], columns: list[ColumnInfo] | None = None
    ) -> None:
        """Ensure every name in *names* is a real column in *table*."""
        if columns is None:
            columns = await self._get_table_columns(table)
        valid = {c.name for c in columns}
        for name in names:
            if name not in valid:
                raise ValueError(f"Column not found in table {table}: {name}")

    # ------------------------------------------------------------------
    # Read
    # ------------------------------------------------------------------

    async def get_rows(
        self,
        table: str,
        offset: int = 0,
        limit: int = 100,
        sort: str | None = None,
        dir: str = "asc",
        search: str | None = None,
    ) -> dict:
        """Return paginated rows from *table*.

        Returns a dict with keys:
            columns – list of ColumnInfo dicts
            rows    – list of row value lists
            total   – total row count (respecting search filter)
        """
        columns = await self._get_table_columns(table)
        col_names = [c.name for c in columns]

        # --- Build WHERE clause for search ---
        where_clause = ""
        where_params: list = []
        if search:
            conditions = [f'CAST("{c}" AS TEXT) LIKE ?' for c in col_names]
            where_clause = "WHERE " + " OR ".join(conditions)
            pattern = f"%{search}%"
            where_params = [pattern] * len(col_names)

        # --- Build ORDER BY clause ---
        order_clause = ""
        if sort is not None:
            await self._validate_columns(table, [sort], columns)
            direction = "DESC" if dir.lower() == "desc" else "ASC"
            order_clause = f'ORDER BY "{sort}" {direction}'

        # --- Row cache ---
        cache_key = f"{table}|{sort or ''}|{dir}|{search or ''}"
        cached = self._db.get_row_cache(cache_key)
        if cached is not None:
            return {
                "columns": cached["columns"],
                "rows": cached["rows"][offset:offset + limit],
                "total": cached["total"],
            }

        # --- Cache miss: fetch ALL matching rows ---
        select_sql = f'SELECT * FROM "{table}" {where_clause} {order_clause}'
        params = tuple(where_params) or None
        all_rows = await self._db.execute(select_sql, params)

        cache_data = {
            "columns": [
                {
                    "cid": c.cid,
                    "name": c.name,
                    "type": c.type,
                    "notnull": c.notnull,
                    "default_value": c.default_value,
                    "pk": c.pk,
                }
                for c in columns
            ],
            "rows": [list(r) for r in all_rows],
            "total": len(all_rows),
        }
        self._db.set_row_cache(cache_key, cache_data)

        return {
            "columns": cache_data["columns"],
            "rows": cache_data["rows"][offset:offset + limit],
            "total": cache_data["total"],
        }

    # ------------------------------------------------------------------
    # Insert
    # ------------------------------------------------------------------

    async def insert_row(self, table: str, values: dict) -> dict:
        """Insert a new row and return its rowid."""
        await self._validate_table(table)
        columns = await self._get_table_columns(table)
        await self._validate_columns(table, list(values.keys()), columns)

        col_names = list(values.keys())
        placeholders = ", ".join("?" for _ in col_names)
        quoted_cols = ", ".join(f'"{c}"' for c in col_names)
        sql = f'INSERT INTO "{table}" ({quoted_cols}) VALUES ({placeholders})'
        params = tuple(values[c] for c in col_names)

        await self._db.execute_modify(sql, params)
        self._db.invalidate_row_cache(table)

        # Retrieve the last inserted rowid
        rows = await self._db.execute("SELECT last_insert_rowid()")
        rowid = rows[0][0] if rows else None
        return {"rowid": rowid}

    # ------------------------------------------------------------------
    # Update
    # ------------------------------------------------------------------

    async def update_row(self, table: str, pk: dict, changes: dict) -> bool:
        """Update a single row identified by *pk* column(s)."""
        await self._validate_table(table)
        columns = await self._get_table_columns(table)
        await self._validate_columns(table, list(pk.keys()), columns)
        await self._validate_columns(table, list(changes.keys()), columns)

        set_clause = ", ".join(f'"{c}" = ?' for c in changes)
        where_clause = " AND ".join(f'"{c}" = ?' for c in pk)
        sql = f'UPDATE "{table}" SET {set_clause} WHERE {where_clause}'
        params = tuple(changes.values()) + tuple(pk.values())

        rowcount = await self._db.execute_modify(sql, params)
        if rowcount > 0:
            self._db.invalidate_row_cache(table)
        return rowcount > 0

    # ------------------------------------------------------------------
    # Delete
    # ------------------------------------------------------------------

    async def delete_row(self, table: str, pk: dict) -> bool:
        """Delete a single row identified by *pk* column(s)."""
        await self._validate_table(table)
        columns = await self._get_table_columns(table)
        await self._validate_columns(table, list(pk.keys()), columns)

        where_clause = " AND ".join(f'"{c}" = ?' for c in pk)
        sql = f'DELETE FROM "{table}" WHERE {where_clause}'
        params = tuple(pk.values())

        rowcount = await self._db.execute_modify(sql, params)
        if rowcount > 0:
            self._db.invalidate_row_cache(table)
        return rowcount > 0

"""Schema introspection service for SQLite/SQLCipher databases."""

from __future__ import annotations

import logging

from sqlcipherui_core.models.schema import (
    ColumnInfo,
    ForeignKey,
    IndexInfo,
    TableDetail,
    TableInfo,
    TriggerInfo,
    ViewInfo,
)
from sqlcipherui_core.services.db_manager import DatabaseManager

logger = logging.getLogger(__name__)


class SchemaService:
    """Provides schema introspection queries against an open database."""

    def __init__(self, db: DatabaseManager):
        self._db = db

    async def get_tables(self) -> list[TableInfo]:
        """Return summary info for every user table."""
        rows = await self._db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        tables: list[TableInfo] = []
        for (name,) in rows:
            row_count: int | None = None
            column_count: int | None = None
            try:
                count_rows = await self._db.execute(
                    f'SELECT count(*) FROM "{name}"'
                )
                row_count = count_rows[0][0]
            except Exception:
                logger.warning("Failed to count rows for table %s", name)

            try:
                col_rows = await self._db.execute(
                    f'PRAGMA table_info("{name}")'
                )
                column_count = len(col_rows)
            except Exception:
                logger.warning("Failed to get column count for table %s", name)

            tables.append(
                TableInfo(
                    name=name,
                    row_count=row_count,
                    column_count=column_count,
                )
            )
        return tables

    async def get_table_detail(self, name: str) -> TableDetail:
        """Return full detail for a single table."""
        # Columns via PRAGMA table_info
        col_rows = await self._db.execute(f'PRAGMA table_info("{name}")')
        # Determine which columns are marked unique via indexes
        unique_columns: set[str] = set()
        idx_list = await self._db.execute(f'PRAGMA index_list("{name}")')
        for idx_row in idx_list:
            idx_name = idx_row[1]
            idx_unique = bool(idx_row[2])
            if idx_unique:
                idx_info_rows = await self._db.execute(
                    f'PRAGMA index_info("{idx_name}")'
                )
                if len(idx_info_rows) == 1:
                    unique_columns.add(idx_info_rows[0][2])

        columns = [
            ColumnInfo(
                name=row[1],
                type=row[2] or "",
                pk=bool(row[5]),
                notnull=bool(row[3]),
                unique=row[1] in unique_columns,
                default_value=str(row[4]) if row[4] is not None else None,
            )
            for row in col_rows
        ]

        # Indexes
        indexes: list[IndexInfo] = []
        for idx_row in idx_list:
            idx_name = idx_row[1]
            idx_unique = bool(idx_row[2])
            idx_info_rows = await self._db.execute(
                f'PRAGMA index_info("{idx_name}")'
            )
            idx_columns = [r[2] for r in idx_info_rows]
            indexes.append(
                IndexInfo(
                    name=idx_name,
                    table_name=name,
                    columns=idx_columns,
                    unique=idx_unique,
                )
            )

        # Triggers
        trigger_rows = await self._db.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name",
            (name,),
        )
        triggers = [
            TriggerInfo(
                name=row[0],
                table_name=name,
                event=_parse_trigger_event(row[1] or ""),
                sql=row[1] or "",
            )
            for row in trigger_rows
        ]

        # Foreign keys
        fk_rows = await self._db.execute(f'PRAGMA foreign_key_list("{name}")')
        foreign_keys = [
            ForeignKey(
                from_table=name,
                from_column=row[3],
                to_table=row[2],
                to_column=row[4],
            )
            for row in fk_rows
        ]

        # CREATE SQL
        create_rows = await self._db.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
            (name,),
        )
        create_sql = create_rows[0][0] if create_rows else None

        # Row count
        row_count: int | None = None
        try:
            count_rows = await self._db.execute(
                f'SELECT count(*) FROM "{name}"'
            )
            row_count = count_rows[0][0]
        except Exception:
            logger.warning("Failed to count rows for table %s", name)

        return TableDetail(
            name=name,
            columns=columns,
            indexes=indexes,
            triggers=triggers,
            foreign_keys=foreign_keys,
            create_sql=create_sql,
            row_count=row_count,
        )

    async def get_views(self) -> list[ViewInfo]:
        """Return all views in the database."""
        rows = await self._db.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name"
        )
        return [ViewInfo(name=row[0], sql=row[1] or "") for row in rows]

    async def get_indexes(self) -> list[IndexInfo]:
        """Return all indexes across every table."""
        table_rows = await self._db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        indexes: list[IndexInfo] = []
        for (table_name,) in table_rows:
            idx_list = await self._db.execute(
                f'PRAGMA index_list("{table_name}")'
            )
            for idx_row in idx_list:
                idx_name = idx_row[1]
                idx_unique = bool(idx_row[2])
                idx_info_rows = await self._db.execute(
                    f'PRAGMA index_info("{idx_name}")'
                )
                idx_columns = [r[2] for r in idx_info_rows]
                indexes.append(
                    IndexInfo(
                        name=idx_name,
                        table_name=table_name,
                        columns=idx_columns,
                        unique=idx_unique,
                    )
                )
        return indexes

    async def get_triggers(self) -> list[TriggerInfo]:
        """Return all triggers in the database."""
        rows = await self._db.execute(
            "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name"
        )
        return [
            TriggerInfo(
                name=row[0],
                table_name=row[1],
                event=_parse_trigger_event(row[2] or ""),
                sql=row[2] or "",
            )
            for row in rows
        ]


def _parse_trigger_event(sql: str) -> str:
    """Extract the trigger event (e.g. 'INSERT', 'UPDATE', 'DELETE') from CREATE TRIGGER SQL."""
    upper = sql.upper()
    for event in ("INSERT", "UPDATE", "DELETE"):
        if event in upper:
            return event
    return "UNKNOWN"

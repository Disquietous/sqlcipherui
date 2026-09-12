"""Schema introspection service for SQLite/SQLCipher databases."""

from __future__ import annotations

import logging
import re

from sqlcipherui_core.models.schema import (
    ColumnInfo,
    ForeignKey,
    IndexInfo,
    SchemaSnapshot,
    SnapshotColumn,
    SnapshotObject,
    SnapshotTable,
    TableDetail,
    TableInfo,
    TriggerInfo,
    ViewInfo,
)
from sqlcipherui_core.services.db_manager import DatabaseManager
from sqlcipherui_core.services.sql_format import format_sql

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
                count_rows = await self._db.execute(f'SELECT count(*) FROM "{name}"')
                row_count = count_rows[0][0]
            except Exception:
                logger.warning("Failed to count rows for table %s", name)

            try:
                col_rows = await self._db.execute(f'PRAGMA table_info("{name}")')
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
                idx_info_rows = await self._db.execute(f'PRAGMA index_info("{idx_name}")')
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
        index_sql = await self._index_sql_map()
        indexes: list[IndexInfo] = []
        for idx_row in idx_list:
            idx_name = idx_row[1]
            idx_unique = bool(idx_row[2])
            idx_info_rows = await self._db.execute(f'PRAGMA index_info("{idx_name}")')
            idx_columns = [r[2] for r in idx_info_rows]
            sql = index_sql.get(idx_name)
            indexes.append(
                IndexInfo(
                    name=idx_name,
                    table_name=name,
                    columns=idx_columns,
                    unique=idx_unique,
                    sql=sql,
                    sql_formatted=format_sql(sql),
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
                sql_formatted=format_sql(row[1]),
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
            "SELECT sql FROM sqlite_master WHERE type IN ('table', 'view') AND name=?",
            (name,),
        )
        create_sql = create_rows[0][0] if create_rows else None

        # Row count
        row_count: int | None = None
        try:
            count_rows = await self._db.execute(f'SELECT count(*) FROM "{name}"')
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
            create_sql_formatted=format_sql(create_sql),
            row_count=row_count,
        )

    async def get_views(self) -> list[ViewInfo]:
        """Return all views in the database."""
        rows = await self._db.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name"
        )
        return [
            ViewInfo(name=row[0], sql=row[1] or "", sql_formatted=format_sql(row[1]))
            for row in rows
        ]

    async def get_indexes(self) -> list[IndexInfo]:
        """Return all indexes across every table."""
        table_rows = await self._db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        index_sql = await self._index_sql_map()
        indexes: list[IndexInfo] = []
        for (table_name,) in table_rows:
            idx_list = await self._db.execute(f'PRAGMA index_list("{table_name}")')
            for idx_row in idx_list:
                idx_name = idx_row[1]
                idx_unique = bool(idx_row[2])
                idx_info_rows = await self._db.execute(f'PRAGMA index_info("{idx_name}")')
                idx_columns = [r[2] for r in idx_info_rows]
                sql = index_sql.get(idx_name)
                indexes.append(
                    IndexInfo(
                        name=idx_name,
                        table_name=table_name,
                        columns=idx_columns,
                        unique=idx_unique,
                        sql=sql,
                        sql_formatted=format_sql(sql),
                    )
                )
        return indexes

    async def get_schema_version(self) -> int:
        """Return SQLite's schema_version counter (changes on any DDL)."""
        rows = await self._db.execute("PRAGMA schema_version")
        return int(rows[0][0]) if rows else 0

    async def get_completion_snapshot(self) -> SchemaSnapshot:
        """Return every table/view/column/FK across all attached schemas in one round trip.

        Runs entirely inside a single worker-thread call so a large schema costs
        one lock acquisition and no per-statement event-loop hops.
        """
        return await self._db.run_sync(_build_snapshot_sync)

    async def _index_sql_map(self) -> dict[str, str | None]:
        """Map index name -> CREATE INDEX sql (None for auto-indexes)."""
        rows = await self._db.execute("SELECT name, sql FROM sqlite_master WHERE type='index'")
        return {row[0]: row[1] for row in rows}

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
                sql_formatted=format_sql(row[2]),
            )
            for row in rows
        ]


def _q(ident: str) -> str:
    """Double-quote an identifier for use in PRAGMA / FROM clauses."""
    return '"' + ident.replace('"', '""') + '"'


_TABLE_OPTIONS_RE = re.compile(
    r"\)\s*((?:(?:WITHOUT\s+ROWID|STRICT)\s*,?\s*)+)\s*;?\s*$", re.IGNORECASE
)


def _table_options(create_sql: str | None) -> tuple[bool, bool]:
    """Detect WITHOUT ROWID / STRICT from the tail of a CREATE TABLE statement."""
    if not create_sql:
        return False, False
    m = _TABLE_OPTIONS_RE.search(create_sql)
    if not m:
        return False, False
    tail = m.group(1).upper()
    return "WITHOUT" in tail, "STRICT" in tail


def _build_snapshot_sync(conn) -> SchemaSnapshot:
    schema_version = int(conn.execute("PRAGMA schema_version").fetchone()[0])
    schemas = [row[1] for row in conn.execute("PRAGMA database_list").fetchall()]

    tables: list[SnapshotTable] = []
    indexes: list[SnapshotObject] = []
    triggers: list[SnapshotObject] = []
    fks: list[ForeignKey] = []

    for schema in schemas:
        if schema == "temp":
            master = "sqlite_temp_master"
        else:
            master = f"{_q(schema)}.sqlite_master"
        rows = conn.execute(
            f"SELECT type, name, tbl_name, sql FROM {master} "
            "WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
        ).fetchall()

        for obj_type, name, tbl_name, sql in rows:
            if obj_type in ("table", "view"):
                col_rows = conn.execute(f"PRAGMA {_q(schema)}.table_xinfo({_q(name)})").fetchall()
                columns = [
                    SnapshotColumn(
                        name=r[1],
                        type=r[2] or "",
                        notnull=bool(r[3]),
                        pk=bool(r[5]),
                        hidden=int(r[6]) if len(r) > 6 and r[6] is not None else 0,
                    )
                    for r in col_rows
                ]
                without_rowid, strict = (
                    _table_options(sql) if obj_type == "table" else (False, False)
                )
                tables.append(
                    SnapshotTable(
                        name=name,
                        schema_name=schema,
                        kind=obj_type,
                        columns=columns,
                        without_rowid=without_rowid,
                        strict=strict,
                    )
                )
                if obj_type == "table":
                    for fk in conn.execute(
                        f"PRAGMA {_q(schema)}.foreign_key_list({_q(name)})"
                    ).fetchall():
                        fks.append(
                            ForeignKey(
                                from_table=name,
                                from_column=fk[3],
                                to_table=fk[2],
                                to_column=fk[4] or "",
                            )
                        )
            elif obj_type == "index":
                indexes.append(SnapshotObject(name=name, schema_name=schema, table=tbl_name))
            elif obj_type == "trigger":
                triggers.append(SnapshotObject(name=name, schema_name=schema, table=tbl_name))

    return SchemaSnapshot(
        schema_version=schema_version,
        schemas=schemas,
        tables=tables,
        indexes=indexes,
        triggers=triggers,
        foreign_keys=fks,
    )


def _parse_trigger_event(sql: str) -> str:
    """Extract the trigger event (e.g. 'INSERT', 'UPDATE', 'DELETE') from CREATE TRIGGER SQL."""
    upper = sql.upper()
    for event in ("INSERT", "UPDATE", "DELETE"):
        if event in upper:
            return event
    return "UNKNOWN"

"""Query execution service."""

from __future__ import annotations

import asyncio
import logging
import re
import time

from sqlcipherui_core.models.query import ColumnMeta, QueryResult
from sqlcipherui_core.services.db_manager import DatabaseManager

logger = logging.getLogger(__name__)

_ROW_RETURNING_PREFIXES = ("SELECT", "EXPLAIN", "PRAGMA")

_TABLE_RE = re.compile(
    r'(?:FROM|JOIN)\s+'
    r'(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\w+))',
    re.IGNORECASE,
)


class QueryService:
    """Executes arbitrary SQL against a DatabaseManager and returns structured results."""

    def __init__(self, db: DatabaseManager) -> None:
        self._db = db

    async def execute(self, sql: str) -> QueryResult:
        """Execute a SQL statement and return a structured result."""
        try:
            return await asyncio.to_thread(self._execute_sync, sql)
        except Exception as exc:
            logger.exception("Unhandled error executing SQL")
            return QueryResult(
                columns=[],
                rows=[],
                row_count=0,
                elapsed_ms=0.0,
                error=str(exc),
            )

    async def explain(self, sql: str) -> QueryResult:
        """Run EXPLAIN QUERY PLAN on a SQL statement."""
        return await self.execute(f"EXPLAIN QUERY PLAN {sql}")

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_tables(sql: str) -> list[str]:
        """Extract table names from FROM and JOIN clauses."""
        tables = []
        for m in _TABLE_RE.finditer(sql):
            name = m.group(1) or m.group(2) or m.group(3) or m.group(4)
            if name and name.upper() not in (
                "SELECT", "WHERE", "ORDER", "GROUP", "HAVING", "LIMIT", "UNION",
            ):
                tables.append(name)
        return tables

    def _resolve_column_types(
        self, conn, col_names: list[str], sql: str
    ) -> list[ColumnMeta]:
        """Look up column types from PRAGMA table_info for tables in the query."""
        tables = self._extract_tables(sql)
        # col_name -> type, first match wins (handles ambiguous names reasonably)
        type_map: dict[str, str] = {}
        for table in tables:
            try:
                info = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
                for row in info:
                    cname, ctype = row[1], row[2]
                    if cname not in type_map:
                        type_map[cname] = ctype
            except Exception:
                pass

        result = []
        for name in col_names:
            # Handle "table.column" aliases from joins
            bare = name.rsplit(".", 1)[-1] if "." in name else name
            col_type = type_map.get(bare, "")
            result.append(ColumnMeta(name=name, type=col_type))
        return result

    @staticmethod
    def _split_statements(sql: str) -> list[str]:
        """Split SQL text into individual statements, respecting string literals."""
        stmts = []
        current = []
        in_single = False
        in_double = False
        i = 0
        while i < len(sql):
            ch = sql[i]
            if ch == "'" and not in_double:
                in_single = not in_single
            elif ch == '"' and not in_single:
                in_double = not in_double
            elif ch == ';' and not in_single and not in_double:
                s = ''.join(current).strip()
                if s:
                    stmts.append(s)
                current = []
                i += 1
                continue
            elif ch == '-' and not in_single and not in_double and i + 1 < len(sql) and sql[i + 1] == '-':
                while i < len(sql) and sql[i] != '\n':
                    i += 1
                continue
            current.append(ch)
            i += 1
        s = ''.join(current).strip()
        if s:
            stmts.append(s)
        return stmts

    def _execute_sync(self, sql: str) -> QueryResult:
        start = time.perf_counter()
        try:
            stmts = self._split_statements(sql)
            if not stmts:
                return QueryResult(columns=[], rows=[], row_count=0, elapsed_ms=0.0)

            with self._db._lock:
                conn = self._db._get_conn()
                last_select_result = None
                total_affected = 0
                did_modify = False

                for stmt in stmts:
                    cursor = conn.execute(stmt)

                    if cursor.description:
                        rows = cursor.fetchall()
                        col_names = [desc[0] for desc in cursor.description]
                        columns = self._resolve_column_types(conn, col_names, stmt)
                        last_select_result = QueryResult(
                            columns=columns,
                            rows=[list(r) for r in rows],
                            row_count=len(rows),
                            elapsed_ms=0,
                        )
                    else:
                        conn.commit()
                        did_modify = True
                        total_affected += max(cursor.rowcount, 0)

                if did_modify:
                    self._db.invalidate_row_cache()

                elapsed = (time.perf_counter() - start) * 1000

                if last_select_result is not None:
                    last_select_result.elapsed_ms = round(elapsed, 2)
                    return last_select_result

                return QueryResult(
                    columns=[],
                    rows=[],
                    row_count=total_affected,
                    elapsed_ms=round(elapsed, 2),
                )
        except Exception as exc:
            elapsed = (time.perf_counter() - start) * 1000
            return QueryResult(
                columns=[],
                rows=[],
                row_count=0,
                elapsed_ms=round(elapsed, 2),
                error=str(exc),
            )

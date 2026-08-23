"""Execution engine for visual ETL/data pipelines.

Topologically sorts a DAG of nodes and executes each in order, routing
data (list[dict]) between them.  Three run modes are supported:

- **preview** -- uses sample data with LIMIT, no writes
- **dry**     -- validates sinks but skips actual writes
- **full**    -- real execution with writes
"""

from __future__ import annotations

import asyncio
import csv
import glob
import hashlib
import json
import logging
import sqlite3
import time
from abc import ABC, abstractmethod
from collections import defaultdict, deque
from io import StringIO
from datetime import date, datetime, time as dt_time
from decimal import Decimal
from pathlib import Path

from sqlcipherui_core.services.app_db import AppDatabase
from sqlcipherui_core.services.connection_manager import ConnectionManager

logger = logging.getLogger(__name__)


def _json_default(obj):
    if isinstance(obj, (datetime, date, dt_time)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, bytes):
        return obj.hex()
    if isinstance(obj, memoryview):
        return obj.tobytes().hex()
    return str(obj)


# ------------------------------------------------------------------ #
# Execution context                                                    #
# ------------------------------------------------------------------ #


class ExecutionContext:
    """Holds references and state needed during a pipeline run."""

    __slots__ = (
        "conn_manager", "app_db", "run_id", "mode", "sample_size",
        "on_event", "on_progress",
    )

    def __init__(
        self,
        conn_manager: ConnectionManager,
        app_db: AppDatabase,
        run_id: int,
        mode: str = "full",
        sample_size: int = 5,
        on_event=None,
        on_progress=None,
    ):
        self.conn_manager = conn_manager
        self.app_db = app_db
        self.run_id = run_id
        self.mode = mode
        self.sample_size = sample_size
        self.on_event = on_event
        self.on_progress = on_progress

    # convenience helpers -------------------------------------------------

    def emit(self, level: str, node_id: str | None, message: str):
        """Log an event and persist it to the run log."""
        try:
            self.app_db.add_run_event(self.run_id, level, node_id, message)
        except Exception:
            logger.debug("Failed to persist run event", exc_info=True)
        if self.on_event:
            try:
                self.on_event({
                    "run_id": self.run_id,
                    "level": level,
                    "node_id": node_id,
                    "message": message,
                })
            except Exception:
                pass

    def progress(self, node_id: str, in_rows: int, out_rows: int):
        if self.on_progress:
            try:
                self.on_progress(node_id, in_rows, out_rows)
            except Exception:
                pass


# ------------------------------------------------------------------ #
# In-memory SQLite helper                                              #
# ------------------------------------------------------------------ #


def _run_in_memory(rows: list[dict], sql: str, table: str = "_input") -> list[dict]:
    """Load *rows* into an in-memory SQLite table and execute *sql*.

    Returns the result set as ``list[dict]``.
    """
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    try:
        if rows:
            cols = list(rows[0].keys())
            col_defs = ", ".join(f'"{c}" TEXT' for c in cols)
            conn.execute(f'CREATE TABLE "{table}" ({col_defs})')
            placeholders = ", ".join("?" for _ in cols)
            conn.executemany(
                f'INSERT INTO "{table}" ({", ".join(f"{c!r}" for c in cols)}) VALUES ({placeholders})',
                [tuple(r.get(c) for c in cols) for r in rows],
            )
        else:
            # create an empty table so the query can still run
            conn.execute(f'CREATE TABLE "{table}" (_empty TEXT)')

        cursor = conn.execute(sql)
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


def _run_in_memory_multi(
    left: list[dict], right: list[dict], sql: str,
) -> list[dict]:
    """Load two row sets into ``_left`` and ``_right`` and run *sql*."""
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    try:
        for tbl, data in [("_left", left), ("_right", right)]:
            if data:
                cols = list(data[0].keys())
                col_defs = ", ".join(f'"{c}" TEXT' for c in cols)
                conn.execute(f'CREATE TABLE "{tbl}" ({col_defs})')
                placeholders = ", ".join("?" for _ in cols)
                conn.executemany(
                    f'INSERT INTO "{tbl}" ({", ".join(f"{c!r}" for c in cols)}) VALUES ({placeholders})',
                    [tuple(r.get(c) for c in cols) for r in data],
                )
            else:
                conn.execute(f'CREATE TABLE "{tbl}" (_empty TEXT)')

        cursor = conn.execute(sql)
        return [dict(r) for r in cursor.fetchall()]
    finally:
        conn.close()


# ------------------------------------------------------------------ #
# Node executor base                                                   #
# ------------------------------------------------------------------ #


class NodeExecutor(ABC):
    """Base class for individual node executors."""

    @abstractmethod
    async def execute(
        self,
        ctx: ExecutionContext,
        node: dict,
        inputs: list[list[dict]],
    ) -> list[dict]:
        ...

    def validate(self, node: dict) -> list[str]:  # noqa: ARG002
        """Return a list of warning / error messages for this node."""
        return []


# ------------------------------------------------------------------ #
# Executor registry                                                    #
# ------------------------------------------------------------------ #

EXECUTORS: dict[str, NodeExecutor] = {}


def _register(kind: str, cls: type[NodeExecutor]):
    EXECUTORS[kind] = cls()


# ------------------------------------------------------------------ #
# Helper: resolve a database connection from config                    #
# ------------------------------------------------------------------ #


async def _resolve_conn(ctx: ExecutionContext, conn_ref: str):
    """Try to look up *conn_ref* in the connection manager.

    Falls back to opening a temporary read-only SQLite connection when
    the identifier is not found (treats it as a path).
    """
    try:
        return ctx.conn_manager.get(conn_ref)
    except KeyError:
        pass

    # Look up from DataFlow connections registry
    try:
        df_conns = ctx.app_db.get_df_connections()
        for dc in df_conns:
            if str(dc.get("id")) == str(conn_ref) or dc.get("name") == conn_ref:
                path = dc["path"]
                _, _ = await ctx.conn_manager.open(path)
                resolved = str(Path(path).expanduser().resolve())
                return ctx.conn_manager.get(resolved)
    except Exception:
        pass

    # Last resort: treat as a filesystem path
    p = Path(conn_ref).expanduser().resolve()
    if p.exists():
        _, _ = await ctx.conn_manager.open(str(p))
        return ctx.conn_manager.get(str(p))

    raise RuntimeError(f"Cannot resolve connection: {conn_ref}")


def _rows_to_dicts(rows) -> list[dict]:
    """Convert sqlite3.Row list to list[dict]."""
    return [dict(r) for r in rows]


# ================================================================== #
#  SOURCE EXECUTORS                                                    #
# ================================================================== #


class SrcTableExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        table = cfg.get("table", "")
        conn_ref = cfg.get("conn", "")
        if not table:
            raise ValueError("src-table: missing config.table")
        if not conn_ref:
            raise ValueError("src-table: missing config.conn")

        db = await _resolve_conn(ctx, conn_ref)
        sql = f'SELECT * FROM "{table}"'
        if ctx.mode == "preview":
            sql += f" LIMIT {ctx.sample_size}"
        return await db.execute_dicts(sql)

    def validate(self, node):
        issues = []
        cfg = node.get("config", {})
        if not cfg.get("table"):
            issues.append("src-table: table name is required")
        if not cfg.get("conn"):
            issues.append("src-table: connection is required")
        return issues


class SrcViewExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        view = cfg.get("table", cfg.get("view", ""))
        conn_ref = cfg.get("conn", "")
        if not view or not conn_ref:
            raise ValueError("src-view: missing table/view or conn")

        db = await _resolve_conn(ctx, conn_ref)
        sql = f'SELECT * FROM "{view}"'
        if ctx.mode == "preview":
            sql += f" LIMIT {ctx.sample_size}"
        return await db.execute_dicts(sql)


class SrcSqlExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        sql = cfg.get("sql", "")
        conn_ref = cfg.get("conn", "")
        if not sql:
            raise ValueError("src-sql: missing config.sql")
        if not conn_ref:
            raise ValueError("src-sql: missing config.conn")

        db = await _resolve_conn(ctx, conn_ref)
        return await db.execute_dicts(sql)


class SrcCsvExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        path = cfg.get("path", "")
        if not path:
            raise ValueError("src-csv: missing config.path")

        def _read():
            p = Path(path).expanduser().resolve()
            with open(p, newline="", encoding="utf-8-sig") as f:
                reader = csv.DictReader(f)
                rows = list(reader)
            if ctx.mode == "preview":
                return rows[: ctx.sample_size]
            return rows

        return await asyncio.to_thread(_read)

    def validate(self, node):
        cfg = node.get("config", {})
        if not cfg.get("path"):
            return ["src-csv: path is required"]
        return []


class SrcJsonExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        path = cfg.get("path", "")
        fmt = cfg.get("format", "array")
        if not path:
            raise ValueError("src-json: missing config.path")

        def _read():
            p = Path(path).expanduser().resolve()
            text = p.read_text(encoding="utf-8")
            if fmt == "jsonl":
                rows = [json.loads(line) for line in text.strip().splitlines() if line.strip()]
            else:
                rows = json.loads(text)
                if not isinstance(rows, list):
                    rows = [rows]
            if ctx.mode == "preview":
                return rows[: ctx.sample_size]
            return rows

        return await asyncio.to_thread(_read)


class SrcParquetExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        ctx.emit("warn", node["id"], "Parquet source is not yet supported")
        return []


class SrcExtDbExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        path = cfg.get("path", "")
        table = cfg.get("table", "")
        if not path or not table:
            raise ValueError("src-ext-db: missing config.path or config.table")

        def _read():
            p = Path(path).expanduser().resolve()
            conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row
            try:
                sql = f'SELECT * FROM "{table}"'
                if ctx.mode == "preview":
                    sql += f" LIMIT {ctx.sample_size}"
                return [dict(r) for r in conn.execute(sql).fetchall()]
            finally:
                conn.close()

        return await asyncio.to_thread(_read)


class SrcFolderExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        folder = cfg.get("path", "")
        pattern = cfg.get("glob", "*")
        fmt = cfg.get("format", "csv")
        if not folder:
            raise ValueError("src-folder: missing config.path")

        def _read():
            base = Path(folder).expanduser().resolve()
            files = sorted(glob.glob(str(base / pattern)))
            all_rows: list[dict] = []
            for fp in files:
                p = Path(fp)
                if fmt == "json":
                    text = p.read_text(encoding="utf-8")
                    data = json.loads(text)
                    if isinstance(data, list):
                        all_rows.extend(data)
                    else:
                        all_rows.append(data)
                else:
                    with open(p, newline="", encoding="utf-8-sig") as f:
                        reader = csv.DictReader(f)
                        all_rows.extend(reader)
            if ctx.mode == "preview":
                return all_rows[: ctx.sample_size]
            return all_rows

        return await asyncio.to_thread(_read)


# ================================================================== #
#  TRANSFORM EXECUTORS                                                 #
# ================================================================== #


class TfFilterExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        expr = cfg.get("expr", "1=1")
        data = inputs[0] if inputs else []
        sql = f"SELECT * FROM _input WHERE {expr}"
        return await asyncio.to_thread(_run_in_memory, data, sql)


class TfProjectExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        columns = cfg.get("columns", "*")
        mode = cfg.get("mode", "keep")
        data = inputs[0] if inputs else []
        if not data:
            return []

        if mode == "drop" and data:
            drop_cols = {c.strip() for c in columns.split(",")}
            keep = [c for c in data[0].keys() if c not in drop_cols]
            cols_str = ", ".join(f'"{c}"' for c in keep) if keep else "*"
        else:
            cols_str = columns

        sql = f"SELECT {cols_str} FROM _input"
        return await asyncio.to_thread(_run_in_memory, data, sql)


class TfRenameExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        from_col = cfg.get("from_col", "")
        to_col = cfg.get("to_col", "")
        data = inputs[0] if inputs else []
        if not data or not from_col or not to_col:
            return data

        # Rebuild rows with the rename applied
        def _rename():
            out = []
            for row in data:
                new = {}
                for k, v in row.items():
                    new[to_col if k == from_col else k] = v
                out.append(new)
            return out

        return await asyncio.to_thread(_rename)


class TfCastExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        column = cfg.get("column", "")
        target_type = cfg.get("target_type", "TEXT")
        data = inputs[0] if inputs else []
        if not data or not column:
            return data

        cols = list(data[0].keys())
        selects = []
        for c in cols:
            if c == column:
                selects.append(f'CAST("{c}" AS {target_type}) AS "{c}"')
            else:
                selects.append(f'"{c}"')
        sql = f"SELECT {', '.join(selects)} FROM _input"
        return await asyncio.to_thread(_run_in_memory, data, sql)


class TfDeriveExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        expr = cfg.get("expr", "NULL")
        name = cfg.get("name", "derived")
        data = inputs[0] if inputs else []
        sql = f'SELECT *, ({expr}) AS "{name}" FROM _input'
        return await asyncio.to_thread(_run_in_memory, data, sql)


class TfJoinExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        join_type = cfg.get("join_type", "INNER")
        left_key = cfg.get("left_key", "id")
        right_key = cfg.get("right_key", "id")
        left = inputs[0] if len(inputs) > 0 else []
        right = inputs[1] if len(inputs) > 1 else []

        sql = (
            f"SELECT * FROM _left {join_type} JOIN _right "
            f'ON _left."{left_key}" = _right."{right_key}"'
        )
        return await asyncio.to_thread(_run_in_memory_multi, left, right, sql)

    def validate(self, node):
        cfg = node.get("config", {})
        issues = []
        if not cfg.get("left_key"):
            issues.append("tf-join: left key is required")
        if not cfg.get("right_key"):
            issues.append("tf-join: right key is required")
        return issues


class TfUnionExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        result: list[dict] = []
        for inp in inputs:
            result.extend(inp)
        return result


class TfGroupExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        group_by = cfg.get("group_by", "")
        aggregates = cfg.get("aggregates", "")
        data = inputs[0] if inputs else []
        if not group_by:
            return data

        select_parts = group_by
        if aggregates:
            select_parts += f", {aggregates}"
        sql = f"SELECT {select_parts} FROM _input GROUP BY {group_by}"
        return await asyncio.to_thread(_run_in_memory, data, sql)


class TfSortExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        order_by = cfg.get("order_by", "rowid")
        data = inputs[0] if inputs else []
        sql = f"SELECT * FROM _input ORDER BY {order_by}"
        return await asyncio.to_thread(_run_in_memory, data, sql)


class TfLimitExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        limit = cfg.get("limit", 100)
        offset = cfg.get("offset", 0)
        data = inputs[0] if inputs else []
        sql = f"SELECT * FROM _input LIMIT {limit} OFFSET {offset}"
        return await asyncio.to_thread(_run_in_memory, data, sql)


class TfMapExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        # Mapping tab not wired yet -- pass-through
        return inputs[0] if inputs else []


# ================================================================== #
#  CLEANING EXECUTORS                                                  #
# ================================================================== #


class ClDedupeExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        by = cfg.get("by", "")
        keep = cfg.get("keep", "first")
        data = inputs[0] if inputs else []
        if not data or not by:
            return data

        # Using GROUP BY with MIN(rowid) to keep first occurrence
        if keep == "last":
            sql = (
                f"SELECT * FROM _input WHERE rowid IN "
                f"(SELECT MAX(rowid) FROM _input GROUP BY {by})"
            )
        else:
            sql = (
                f"SELECT * FROM _input WHERE rowid IN "
                f"(SELECT MIN(rowid) FROM _input GROUP BY {by})"
            )
        return await asyncio.to_thread(_run_in_memory, data, sql)


class ClFillNullExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        column = cfg.get("column", "")
        fill_value = cfg.get("value", "")
        data = inputs[0] if inputs else []
        if not data or not column:
            return data

        cols = list(data[0].keys())
        selects = []
        for c in cols:
            if c == column:
                safe = str(fill_value).replace("'", "''")
                selects.append(f"COALESCE(\"{c}\", '{safe}') AS \"{c}\"")
            else:
                selects.append(f'"{c}"')
        sql = f"SELECT {', '.join(selects)} FROM _input"
        return await asyncio.to_thread(_run_in_memory, data, sql)


class ClTrimExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        columns = cfg.get("columns", "")
        data = inputs[0] if inputs else []
        if not data:
            return data

        trim_cols = {c.strip() for c in columns.split(",")} if columns else set(data[0].keys())
        all_cols = list(data[0].keys())
        selects = []
        for c in all_cols:
            if c in trim_cols:
                selects.append(f'TRIM("{c}") AS "{c}"')
            else:
                selects.append(f'"{c}"')
        sql = f"SELECT {', '.join(selects)} FROM _input"
        return await asyncio.to_thread(_run_in_memory, data, sql)


class ClCaseExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        columns = cfg.get("columns", "")
        case_mode = cfg.get("mode", "lower")  # lower | upper | title
        data = inputs[0] if inputs else []
        if not data:
            return data

        target_cols = {c.strip() for c in columns.split(",")} if columns else set()
        all_cols = list(data[0].keys())

        if case_mode == "title":
            # SQLite has no INITCAP; do it in Python
            def _title():
                out = []
                for row in data:
                    new = dict(row)
                    for col in target_cols:
                        if col in new and isinstance(new[col], str):
                            new[col] = new[col].title()
                    out.append(new)
                return out
            return await asyncio.to_thread(_title)

        func = "LOWER" if case_mode == "lower" else "UPPER"
        selects = []
        for c in all_cols:
            if c in target_cols:
                selects.append(f'{func}("{c}") AS "{c}"')
            else:
                selects.append(f'"{c}"')
        sql = f"SELECT {', '.join(selects)} FROM _input"
        return await asyncio.to_thread(_run_in_memory, data, sql)


class ClAnonExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        columns = cfg.get("columns", "")
        method = cfg.get("method", "hash")  # hash | redact
        data = inputs[0] if inputs else []
        if not data or not columns:
            return data

        target_cols = {c.strip() for c in columns.split(",")}

        def _anon():
            out = []
            for row in data:
                new = dict(row)
                for col in target_cols:
                    if col in new and new[col] is not None:
                        val = str(new[col])
                        if method == "redact":
                            new[col] = "***"
                        else:
                            new[col] = hashlib.sha256(val.encode()).hexdigest()[:16]
                out.append(new)
            return out

        return await asyncio.to_thread(_anon)


class ClValidateExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        rules = cfg.get("rules", [])
        data = inputs[0] if inputs else []
        if not data or not rules:
            return data

        # Each rule: {"column": "age", "check": "NOT NULL"} or {"expr": "age > 0"}
        accepted = []
        rejected_count = 0
        for row in data:
            ok = True
            for rule in rules:
                expr = rule.get("expr", "")
                if expr:
                    try:
                        result = _run_in_memory([row], f"SELECT ({expr}) AS _ok FROM _input")
                        if not result or not result[0].get("_ok"):
                            ok = False
                            break
                    except Exception:
                        ok = False
                        break
            if ok:
                accepted.append(row)
            else:
                rejected_count += 1

        if rejected_count:
            ctx.emit("warn", node["id"], f"cl-validate: {rejected_count} rows rejected")
        return accepted


# ================================================================== #
#  SCHEMA OPS EXECUTORS                                                #
# ================================================================== #

class _SchemaOpExecutor(NodeExecutor):
    """Base for schema operations that run DDL on a target connection
    and pass through input data unchanged.
    """

    async def _run_ddl(self, ctx, node, sql: str):
        cfg = node.get("config", {})
        conn_ref = cfg.get("conn", "")
        if not conn_ref:
            ctx.emit("warn", node["id"], "No target connection configured; skipping DDL")
            return
        if ctx.mode in ("preview", "dry"):
            ctx.emit("info", node["id"], f"[{ctx.mode}] Would execute: {sql}")
            return
        db = await _resolve_conn(ctx, conn_ref)
        await db.execute_modify(sql)

    async def execute(self, ctx, node, inputs):
        data = inputs[0] if inputs else []
        await self._do(ctx, node)
        return data

    @abstractmethod
    async def _do(self, ctx, node):
        ...


class ScAddColExecutor(_SchemaOpExecutor):
    async def _do(self, ctx, node):
        cfg = node.get("config", {})
        table = cfg.get("table", "")
        column = cfg.get("column", "")
        col_type = cfg.get("type", "TEXT")
        default = cfg.get("default", "")
        if not table or not column:
            raise ValueError("sc-add-col: table and column required")
        sql = f'ALTER TABLE "{table}" ADD COLUMN "{column}" {col_type}'
        if default:
            safe = str(default).replace("'", "''")
            sql += f" DEFAULT '{safe}'"
        await self._run_ddl(ctx, node, sql)


class ScDropColExecutor(_SchemaOpExecutor):
    async def _do(self, ctx, node):
        cfg = node.get("config", {})
        table = cfg.get("table", "")
        column = cfg.get("column", "")
        if not table or not column:
            raise ValueError("sc-drop-col: table and column required")
        sql = f'ALTER TABLE "{table}" DROP COLUMN "{column}"'
        await self._run_ddl(ctx, node, sql)


class ScRenameColExecutor(_SchemaOpExecutor):
    async def _do(self, ctx, node):
        cfg = node.get("config", {})
        table = cfg.get("table", "")
        from_col = cfg.get("from_col", "")
        to_col = cfg.get("to_col", "")
        if not table or not from_col or not to_col:
            raise ValueError("sc-rename-col: table, from_col, and to_col required")
        sql = f'ALTER TABLE "{table}" RENAME COLUMN "{from_col}" TO "{to_col}"'
        await self._run_ddl(ctx, node, sql)


class ScCastColExecutor(_SchemaOpExecutor):
    async def _do(self, ctx, node):
        # SQLite doesn't natively support ALTER COLUMN TYPE;
        # log a warning and skip for now.
        ctx.emit(
            "warn", node["id"],
            "sc-cast-col: SQLite does not support ALTER COLUMN TYPE; "
            "use a transform + sink to rewrite the table",
        )


class ScAddIndexExecutor(_SchemaOpExecutor):
    async def _do(self, ctx, node):
        cfg = node.get("config", {})
        table = cfg.get("table", "")
        columns = cfg.get("columns", "")
        unique = cfg.get("unique", False)
        if not table or not columns:
            raise ValueError("sc-add-index: table and columns required")
        idx_name = f"idx_{'_'.join(c.strip() for c in columns.split(','))}"
        u = "UNIQUE " if unique else ""
        sql = f'CREATE {u}INDEX IF NOT EXISTS "{idx_name}" ON "{table}" ({columns})'
        await self._run_ddl(ctx, node, sql)


# ================================================================== #
#  CODE EXECUTORS                                                      #
# ================================================================== #


class CoSqlExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        sql = cfg.get("sql", "")
        data = inputs[0] if inputs else []
        if not sql:
            ctx.emit("warn", node["id"], "co-sql: no SQL provided")
            return data
        return await asyncio.to_thread(_run_in_memory, data, sql)


class CoPyExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        ctx.emit("warn", node["id"], "co-py: Python execution is not yet supported (sandboxing not implemented)")
        return inputs[0] if inputs else []


class CoJsExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        ctx.emit("warn", node["id"], "co-js: JavaScript execution is not yet supported")
        return inputs[0] if inputs else []



# ================================================================== #
#  SINK EXECUTORS                                                      #
# ================================================================== #


class SnkTableExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        table = cfg.get("table", "")
        conn_ref = cfg.get("conn", "")
        write_mode = cfg.get("write_mode", "append")  # append | replace | upsert
        data = inputs[0] if inputs else []

        if not table or not conn_ref:
            raise ValueError("snk-table: missing config.table or config.conn")

        if ctx.mode == "preview":
            ctx.emit("info", node["id"], f"[preview] Would write {len(data)} rows to {table}")
            return data
        if ctx.mode == "dry":
            ctx.emit("info", node["id"], f"[dry] Validated sink -- {len(data)} rows for {table}")
            return data

        db = await _resolve_conn(ctx, conn_ref)

        if not data:
            ctx.emit("info", node["id"], f"No rows to write to {table}")
            return data

        cols = list(data[0].keys())
        placeholders = ", ".join("?" for _ in cols)
        col_names = ", ".join(f'"{c}"' for c in cols)

        # Create the table if it doesn't exist
        col_defs = ", ".join(f'"{c}" TEXT' for c in cols)
        await db.execute_modify(f'CREATE TABLE IF NOT EXISTS "{table}" ({col_defs})')

        if write_mode == "replace":
            await db.execute_modify(f'DELETE FROM "{table}"')

        if write_mode == "upsert":
            insert_sql = f'INSERT OR REPLACE INTO "{table}" ({col_names}) VALUES ({placeholders})'
        else:
            insert_sql = f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders})'

        for row in data:
            vals = tuple(row.get(c) for c in cols)
            await db.execute_modify(insert_sql, vals)

        ctx.emit("info", node["id"], f"Wrote {len(data)} rows to {table} ({write_mode})")
        return data

    def validate(self, node):
        issues = []
        cfg = node.get("config", {})
        if not cfg.get("table"):
            issues.append("snk-table: table name is required")
        if not cfg.get("conn"):
            issues.append("snk-table: connection is required")
        return issues


class SnkExtDbExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        path = cfg.get("path", "")
        table = cfg.get("table", "")
        data = inputs[0] if inputs else []

        if not path or not table:
            raise ValueError("snk-ext-db: missing config.path or config.table")

        if ctx.mode in ("preview", "dry"):
            ctx.emit("info", node["id"], f"[{ctx.mode}] Would write {len(data)} rows to {path}:{table}")
            return data

        def _write():
            if not data:
                return
            p = Path(path).expanduser().resolve()
            conn = sqlite3.connect(str(p))
            try:
                cols = list(data[0].keys())
                col_defs = ", ".join(f'"{c}" TEXT' for c in cols)
                conn.execute(f'CREATE TABLE IF NOT EXISTS "{table}" ({col_defs})')
                placeholders = ", ".join("?" for _ in cols)
                col_names = ", ".join(f'"{c}"' for c in cols)
                conn.executemany(
                    f'INSERT INTO "{table}" ({col_names}) VALUES ({placeholders})',
                    [tuple(r.get(c) for c in cols) for r in data],
                )
                conn.commit()
            finally:
                conn.close()

        await asyncio.to_thread(_write)
        ctx.emit("info", node["id"], f"Wrote {len(data)} rows to {path}:{table}")
        return data


class SnkCsvExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        path = cfg.get("path", "")
        data = inputs[0] if inputs else []

        if not path:
            raise ValueError("snk-csv: missing config.path")

        if ctx.mode in ("preview", "dry"):
            ctx.emit("info", node["id"], f"[{ctx.mode}] Would write {len(data)} rows to {path}")
            return data

        def _write():
            if not data:
                return
            p = Path(path).expanduser().resolve()
            p.parent.mkdir(parents=True, exist_ok=True)
            with open(p, "w", newline="", encoding="utf-8") as f:
                writer = csv.DictWriter(f, fieldnames=list(data[0].keys()))
                writer.writeheader()
                writer.writerows(data)

        await asyncio.to_thread(_write)
        ctx.emit("info", node["id"], f"Wrote {len(data)} rows to {path}")
        return data


class SnkJsonExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        cfg = node.get("config", {})
        path = cfg.get("path", "")
        data = inputs[0] if inputs else []

        if not path:
            raise ValueError("snk-json: missing config.path")

        if ctx.mode in ("preview", "dry"):
            ctx.emit("info", node["id"], f"[{ctx.mode}] Would write {len(data)} rows to {path}")
            return data

        def _write():
            p = Path(path).expanduser().resolve()
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps(data, indent=2, default=_json_default) + "\n", encoding="utf-8")

        await asyncio.to_thread(_write)
        ctx.emit("info", node["id"], f"Wrote {len(data)} rows to {path}")
        return data


class SnkParquetExecutor(NodeExecutor):
    async def execute(self, ctx, node, inputs):
        ctx.emit("warn", node["id"], "Parquet sink is not yet supported")
        return inputs[0] if inputs else []


# ================================================================== #
#  Register all executors                                              #
# ================================================================== #

# Sources
_register("src-table", SrcTableExecutor)
_register("src-view", SrcViewExecutor)
_register("src-sql", SrcSqlExecutor)
_register("src-csv", SrcCsvExecutor)
_register("src-json", SrcJsonExecutor)
_register("src-parquet", SrcParquetExecutor)
_register("src-ext-db", SrcExtDbExecutor)
_register("src-folder", SrcFolderExecutor)

# Transforms
_register("tf-filter", TfFilterExecutor)
_register("tf-project", TfProjectExecutor)
_register("tf-rename", TfRenameExecutor)
_register("tf-cast", TfCastExecutor)
_register("tf-derive", TfDeriveExecutor)
_register("tf-join", TfJoinExecutor)
_register("tf-union", TfUnionExecutor)
_register("tf-group", TfGroupExecutor)
_register("tf-sort", TfSortExecutor)
_register("tf-limit", TfLimitExecutor)
_register("tf-map", TfMapExecutor)

# Cleaning
_register("cl-dedupe", ClDedupeExecutor)
_register("cl-fill-null", ClFillNullExecutor)
_register("cl-trim", ClTrimExecutor)
_register("cl-case", ClCaseExecutor)
_register("cl-anon", ClAnonExecutor)
_register("cl-validate", ClValidateExecutor)

# Schema ops
_register("sc-add-col", ScAddColExecutor)
_register("sc-drop-col", ScDropColExecutor)
_register("sc-rename-col", ScRenameColExecutor)
_register("sc-cast-col", ScCastColExecutor)
_register("sc-add-index", ScAddIndexExecutor)

# Code
_register("co-sql", CoSqlExecutor)
_register("co-py", CoPyExecutor)
_register("co-js", CoJsExecutor)

# Sinks
_register("snk-table", SnkTableExecutor)
_register("snk-ext-db", SnkExtDbExecutor)
_register("snk-csv", SnkCsvExecutor)
_register("snk-json", SnkJsonExecutor)
_register("snk-parquet", SnkParquetExecutor)


# ================================================================== #
#  DAG utilities                                                       #
# ================================================================== #


def _topo_sort(nodes: list[dict], edges: list[dict]) -> list[str]:
    """Kahn's algorithm for topological sort.  Returns ordered node IDs."""
    node_ids = {n["id"] for n in nodes}
    in_degree: dict[str, int] = {nid: 0 for nid in node_ids}
    adjacency: dict[str, list[str]] = defaultdict(list)

    for edge in edges:
        src, dst = edge["from"], edge["to"]
        if src in node_ids and dst in node_ids:
            adjacency[src].append(dst)
            in_degree[dst] = in_degree.get(dst, 0) + 1

    queue: deque[str] = deque(nid for nid, deg in in_degree.items() if deg == 0)
    order: list[str] = []

    while queue:
        nid = queue.popleft()
        order.append(nid)
        for neighbor in adjacency[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(order) != len(node_ids):
        raise ValueError(
            "Pipeline contains a cycle -- topological sort is impossible"
        )
    return order


def _predecessors(node_id: str, edges: list[dict]) -> list[str]:
    """Return all node IDs that feed into *node_id*, in edge order."""
    return [e["from"] for e in edges if e["to"] == node_id]


# ================================================================== #
#  Pipeline executor                                                   #
# ================================================================== #


class PipelineExecutor:
    """Orchestrates full pipeline runs, single-node previews, and validation."""

    def __init__(self, conn_manager: ConnectionManager, app_db: AppDatabase):
        self._conn_manager = conn_manager
        self._app_db = app_db

    # ------------------------------------------------------------------ #
    #  Full / dry / preview run                                            #
    # ------------------------------------------------------------------ #

    async def run(
        self,
        pipeline_id: int,
        definition: dict,
        mode: str = "full",
        on_event=None,
        on_progress=None,
        sample_size: int = 5,
    ) -> dict:
        """Execute the pipeline and return a run summary dict."""
        nodes = definition.get("nodes", [])
        edges = definition.get("edges", [])

        # 1. Create a run record
        run_id = self._app_db.create_run(pipeline_id, mode)
        start = time.monotonic()

        ctx = ExecutionContext(
            conn_manager=self._conn_manager,
            app_db=self._app_db,
            run_id=run_id,
            mode=mode,
            sample_size=sample_size,
            on_event=on_event,
            on_progress=on_progress,
        )
        ctx.emit("info", None, f"Pipeline run started (mode={mode})")

        node_map: dict[str, dict] = {n["id"]: n for n in nodes}
        outputs: dict[str, list[dict]] = {}
        total_rows = 0
        error_msg: str | None = None

        try:
            # 2. Topological sort
            order = _topo_sort(nodes, edges)

            # 3. Execute each node
            for nid in order:
                node = node_map[nid]
                kind = node.get("kind", "")
                executor = EXECUTORS.get(kind)

                if executor is None:
                    ctx.emit("warn", nid, f"No executor for node kind '{kind}'; skipping")
                    outputs[nid] = []
                    continue

                # Collect inputs from predecessors
                preds = _predecessors(nid, edges)
                input_data = [outputs.get(pid, []) for pid in preds]

                ctx.emit("info", nid, f"Executing {kind}")
                try:
                    result = await executor.execute(ctx, node, input_data)
                    outputs[nid] = result
                    total_rows += len(result)
                    ctx.progress(nid, sum(len(i) for i in input_data), len(result))
                    ctx.emit("info", nid, f"Produced {len(result)} rows")
                except Exception as exc:
                    error_msg = f"Node {nid} ({kind}): {exc}"
                    ctx.emit("error", nid, str(exc))
                    logger.exception("Node %s failed", nid)
                    break

        except Exception as exc:
            error_msg = str(exc)
            ctx.emit("error", None, error_msg)
            logger.exception("Pipeline run failed")

        # 4. Finalize
        elapsed = (time.monotonic() - start) * 1000
        status = "failed" if error_msg else "ok"
        self._app_db.update_run(
            run_id,
            status=status,
            finished_at=time.strftime("%Y-%m-%d %H:%M:%S"),
            duration_ms=round(elapsed, 2),
            total_rows=total_rows,
            error=error_msg,
        )
        ctx.emit("info", None, f"Pipeline run {status} in {elapsed:.0f}ms")

        return {
            "run_id": run_id,
            "status": status,
            "mode": mode,
            "duration_ms": round(elapsed, 2),
            "total_rows": total_rows,
            "error": error_msg,
        }

    # ------------------------------------------------------------------ #
    #  Single-node preview                                                 #
    # ------------------------------------------------------------------ #

    async def preview_node(
        self,
        definition: dict,
        node_id: str,
        sample_size: int = 5,
        pipeline_id: int = 0,
    ) -> list[dict]:
        """Execute just enough of the pipeline to produce output for *node_id*."""
        nodes = definition.get("nodes", [])
        edges = definition.get("edges", [])
        node_map = {n["id"]: n for n in nodes}

        if node_id not in node_map:
            raise ValueError(f"Node {node_id} not found in pipeline definition")

        # Determine the subgraph needed to reach node_id
        needed: set[str] = set()
        queue: deque[str] = deque([node_id])
        while queue:
            nid = queue.popleft()
            if nid in needed:
                continue
            needed.add(nid)
            for pred in _predecessors(nid, edges):
                queue.append(pred)

        sub_nodes = [n for n in nodes if n["id"] in needed]
        sub_edges = [e for e in edges if e["from"] in needed and e["to"] in needed]

        run_id = self._app_db.create_run(pipeline_id, "preview")
        ctx = ExecutionContext(
            conn_manager=self._conn_manager,
            app_db=self._app_db,
            run_id=run_id,
            mode="preview",
            sample_size=sample_size,
        )

        order = _topo_sort(sub_nodes, sub_edges)
        outputs: dict[str, list[dict]] = {}

        for nid in order:
            node = node_map[nid]
            kind = node.get("kind", "")
            executor = EXECUTORS.get(kind)
            if executor is None:
                outputs[nid] = []
                continue

            preds = _predecessors(nid, sub_edges)
            input_data = [outputs.get(pid, []) for pid in preds]

            try:
                outputs[nid] = await executor.execute(ctx, node, input_data)
            except Exception as exc:
                logger.warning("preview_node: %s failed: %s", nid, exc)
                outputs[nid] = []

        return outputs.get(node_id, [])

    # ------------------------------------------------------------------ #
    #  Validation                                                          #
    # ------------------------------------------------------------------ #

    async def validate(self, definition: dict) -> list[dict]:
        """Validate all nodes and return a list of issue dicts."""
        nodes = definition.get("nodes", [])
        edges = definition.get("edges", [])
        issues: list[dict] = []

        # Check for cycles
        try:
            _topo_sort(nodes, edges)
        except ValueError as exc:
            issues.append({"node_id": None, "level": "error", "message": str(exc)})

        # Per-node validation
        for node in nodes:
            kind = node.get("kind", "")
            executor = EXECUTORS.get(kind)
            if executor is None:
                issues.append({
                    "node_id": node["id"],
                    "level": "error",
                    "message": f"Unknown node kind: {kind}",
                })
                continue

            for msg in executor.validate(node):
                issues.append({
                    "node_id": node["id"],
                    "level": "warn",
                    "message": msg,
                })

        # Check for disconnected source/sink nodes (informational)
        node_ids = {n["id"] for n in nodes}
        targets = {e["to"] for e in edges}
        sources = {e["from"] for e in edges}

        for node in nodes:
            kind = node.get("kind", "")
            nid = node["id"]
            if kind.startswith("snk-") and nid not in targets:
                issues.append({
                    "node_id": nid,
                    "level": "warn",
                    "message": "Sink node has no incoming edge",
                })
            if kind.startswith("src-") and nid not in sources:
                issues.append({
                    "node_id": nid,
                    "level": "warn",
                    "message": "Source node has no outgoing edge",
                })

        return issues

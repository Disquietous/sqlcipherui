"""Node executors for Data Flows pipelines.

Each node kind has a :class:`NodeExecutor` registered in :data:`EXECUTORS`.
Executors receive an :class:`ExecutionContext`, the node dict and a
:class:`NodeInputs` list (one ``list[dict]`` per incoming edge, with the
edge's target port name available via ``inputs.ports``).  They return either
``list[dict]`` (the ``out`` port) or ``dict[str, list[dict]]`` keyed by
output port.
"""

from __future__ import annotations

import asyncio
import csv
import glob
import hashlib
import json
import logging
import os
import random
import re
import sqlite3
import threading
from abc import ABC, abstractmethod
from datetime import UTC, datetime
from itertools import islice
from pathlib import Path

import sqlcipher3

from sqlcipherui_core.services.app_db import AppDatabase
from sqlcipherui_core.services.connection_manager import ConnectionManager
from sqlcipherui_core.services.db_manager import DatabaseManager
from sqlcipherui_core.services.pipeline_sql import (
    adapt_value,
    assert_read_only_sql,
    check_type_name,
    coerce_to_type,
    column_defs,
    column_names,
    ddl_type,
    fetch_dicts,
    ident_or_expr,
    infer_column_types,
    is_numeric,
    json_default,
    load_pyarrow,
    order_clause,
    quote_ident,
    quote_list,
    run_in_memory,
    run_in_memory_multi,
    split_list,
    sql_literal,
)

logger = logging.getLogger(__name__)

SCRIPTLET_ERRORS = {
    "co-py": "Python scriptlets are not available yet",
    "co-js": "JavaScript scriptlets are not available yet",
}
JOIN_TYPES = ("INNER", "LEFT", "RIGHT", "FULL")
WRITE_MODES = ("append", "replace", "upsert")
DEFAULT_BATCH_SIZE = 500

_FIRST_NAMES = (
    "Alex", "Sam", "Jordan", "Taylor", "Morgan", "Casey",
    "Riley", "Jamie", "Avery", "Quinn", "Drew", "Reese",
)  # fmt: skip
_LAST_NAMES = (
    "Smith", "Johnson", "Lee", "Brown", "Garcia", "Miller",
    "Davis", "Wilson", "Moore", "Clark", "Hall", "Young",
)  # fmt: skip


def utc_now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds")


def utc_now_sql() -> str:
    """UTC timestamp compatible with SQLite ``datetime('now')``."""
    return datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")


class RunCancelled(Exception):
    """Raised when a run observes its cancel flag."""


# ------------------------------------------------------------------ #
# Small config helpers                                                 #
# ------------------------------------------------------------------ #


def cfg(node: dict) -> dict:
    return node.get("config") or {}


def is_missing(value) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, dict)):
        return len(value) == 0
    return False


def require(config: dict, kind: str, *keys: str) -> None:
    for key in keys:
        if is_missing(config.get(key)):
            raise ValueError(f"{kind}: '{key}' is required")


def as_bool(value, default: bool = False) -> bool:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    return str(value).strip().lower() in ("1", "true", "yes", "on", "y")


def as_int(value, default, label: str = "value"):
    if value is None or (isinstance(value, str) and not value.strip()):
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    try:
        return int(str(value).strip())
    except ValueError:
        raise ValueError(f"{label} must be an integer, got {value!r}") from None


def as_list(value) -> list:
    """Accept a list, or a JSON-encoded list stored as a string."""
    if value is None or value == "":
        return []
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            raise ValueError(f"Expected a JSON list, got {value!r}") from None
        return parsed if isinstance(parsed, list) else [parsed]
    if isinstance(value, dict):
        return [value]
    return list(value)


def parse_mappings(value) -> dict[str, str]:
    """``[{from, to}, ...]`` (or JSON string) -> ``{from: to}``, skipping incomplete entries."""
    mapping: dict[str, str] = {}
    for entry in as_list(value):
        if not isinstance(entry, dict):
            continue
        src = str(entry.get("from") or "").strip()
        dst = str(entry.get("to") or "").strip()
        if src and dst:
            mapping[src] = dst
    return mapping


def delimiter_of(value) -> str:
    text = str(value) if value is not None else ""
    return {"\\t": "\t", "tab": "\t", "TAB": "\t"}.get(text, text) or ","


def where_clause(where) -> str:
    text = str(where or "").strip()
    return f" WHERE ({text})" if text else ""


def resolve_path(path) -> Path:
    return Path(str(path)).expanduser().resolve()


def rename_columns(rows: list[dict], mapping: dict[str, str], drop_unmapped=False) -> list[dict]:
    out = []
    for row in rows:
        new = {}
        for key, value in row.items():
            if key in mapping:
                new[mapping[key]] = value
            elif not drop_unmapped:
                new[key] = value
        out.append(new)
    return out


def hashable(value):
    try:
        hash(value)
        return value
    except TypeError:
        return json.dumps(value, sort_keys=True, default=json_default)


# ------------------------------------------------------------------ #
# Inputs                                                               #
# ------------------------------------------------------------------ #


class NodeInputs(list):
    """List of input row sets, one per incoming edge, with the edge's target port."""

    def __init__(self, items=(), ports=()):
        super().__init__(items)
        self.ports: list[str | None] = list(ports)

    def add(self, rows: list[dict], port: str | None = None) -> None:
        self.append(rows)
        self.ports.append(port)

    def by_port(self, name: str) -> list[dict] | None:
        for rows, port in zip(self, self.ports, strict=False):
            if port == name:
                return rows
        return None

    @property
    def first(self) -> list[dict]:
        return self[0] if self else []


# ------------------------------------------------------------------ #
# Execution context                                                    #
# ------------------------------------------------------------------ #


class ExecutionContext:
    """State shared by all nodes during one run, preview or schema inference."""

    def __init__(
        self,
        conn_manager: ConnectionManager,
        app_db: AppDatabase,
        run_id: int | None,
        mode: str = "full",
        sample_size: int = 5,
        on_event=None,
        transactional: bool = True,
        cancel_event: threading.Event | None = None,
    ):
        self.conn_manager = conn_manager
        self.app_db = app_db
        self.run_id = run_id
        self.mode = mode
        self.sample_size = max(int(sample_size or 0), 0) or 5
        self.on_event = on_event
        self.transactional = transactional
        self.cancel_event = cancel_event or threading.Event()
        self.events: list[dict] = []
        self.has_warn = False
        self.skipped = False
        self.sink_rows = 0
        self._opened: list[str] = []
        self._txn: dict[str, DatabaseManager] = {}

    # ---- events ---------------------------------------------------------

    @property
    def writes_enabled(self) -> bool:
        return self.mode == "full"

    def _emit(self, event: dict) -> None:
        event.setdefault("timestamp", utc_now_iso())
        if self.on_event is None:
            return
        try:
            self.on_event(event)
        except Exception:
            logger.debug("on_event callback failed", exc_info=True)

    async def log(self, level: str, node_id: str | None, message: str) -> None:
        if level == "warn":
            self.has_warn = True
        record = {
            "type": "log",
            "run_id": self.run_id,
            "level": level,
            "node_id": node_id,
            "message": message,
            "timestamp": utc_now_iso(),
        }
        if self.run_id is not None:
            try:
                await asyncio.to_thread(
                    self.app_db.add_run_event, self.run_id, level, node_id, message
                )
            except Exception:
                logger.debug("Failed to persist run event", exc_info=True)
        else:
            self.events.append(record)
        self._emit(record)

    def status(self, status: str) -> None:
        self._emit({"type": "status", "run_id": self.run_id, "status": status})

    def progress(self, node_id: str, in_rows: int, out_rows: int) -> None:
        self._emit(
            {
                "type": "progress",
                "run_id": self.run_id,
                "node_id": node_id,
                "in_rows": in_rows,
                "out_rows": out_rows,
            }
        )

    def edge_progress(self, src: str, dst: str, from_port: str, rows: int) -> None:
        self._emit(
            {
                "type": "edge_progress",
                "run_id": self.run_id,
                "from": src,
                "to": dst,
                "from_port": from_port,
                "rows": rows,
            }
        )

    # ---- cancellation ---------------------------------------------------

    def is_cancelled(self) -> bool:
        return self.cancel_event.is_set()

    def check_cancelled(self) -> None:
        if self.cancel_event.is_set():
            raise RunCancelled("Run cancelled")

    # ---- connections ----------------------------------------------------

    def _lookup_open(self, ref: str) -> DatabaseManager | None:
        candidates = [ref]
        try:
            candidates.append(str(Path(ref).expanduser().resolve()))
        except (OSError, RuntimeError, ValueError):
            pass
        for candidate in candidates:
            try:
                return self.conn_manager.get(candidate)
            except KeyError:
                continue
        return None

    async def _path_for_ref(self, ref: str) -> str | None:
        try:
            df_conns = await asyncio.to_thread(self.app_db.get_df_connections)
        except Exception:
            df_conns = []
        for dc in df_conns:
            if str(dc.get("id")) == ref or dc.get("name") == ref:
                return str(dc.get("path") or "")
        try:
            if Path(ref).expanduser().exists():
                return ref
        except (OSError, RuntimeError, ValueError):
            pass
        return None

    async def resolve_conn(self, conn_ref, key: str | None = None) -> DatabaseManager:
        """Resolve a connection id, DataFlow connection name/id, or path.

        Connections opened here are tracked and closed by :meth:`close_opened`
        so nothing leaks into the shared :class:`ConnectionManager`.
        """
        ref = str(conn_ref or "").strip()
        if not ref:
            raise ValueError("connection is required")
        db = self._lookup_open(ref)
        if db is None:
            path = await self._path_for_ref(ref)
            if not path:
                raise RuntimeError(f"Cannot resolve connection: {ref}")
            conn_id = str(resolve_path(path))
            db = self._lookup_open(conn_id)
            if db is None:
                conn_id, _ = await self.conn_manager.open(path)
                self._opened.append(conn_id)
                db = self.conn_manager.get(conn_id)
        if db.is_encrypted and not db.is_unlocked:
            if not key or not await db.unlock(key):
                raise RuntimeError(
                    f"Connection {ref} is encrypted and locked; a valid key is needed"
                )
        return db

    async def close_opened(self) -> None:
        for conn_id in self._opened:
            try:
                await self.conn_manager.close(conn_id)
            except Exception:
                logger.debug("Failed to close ad-hoc connection %s", conn_id, exc_info=True)
        self._opened.clear()

    # ---- transactions ---------------------------------------------------

    @staticmethod
    def _txn_key(db: DatabaseManager) -> str:
        return str(db.db_path) if db.db_path else str(id(db))

    def in_txn(self, db: DatabaseManager) -> bool:
        return self._txn_key(db) in self._txn

    async def begin_txn(self, db: DatabaseManager) -> None:
        """Start the run-wide transaction on *db* if transactional and not yet started."""
        if not self.transactional or self.in_txn(db):
            return
        await db.run_sync(lambda conn: conn.execute("BEGIN"))
        self._txn[self._txn_key(db)] = db

    async def commit_all(self) -> None:
        for db in list(self._txn.values()):
            await db.run_sync(lambda conn: conn.execute("COMMIT"))
            db.invalidate_row_cache()
        self._txn.clear()

    async def rollback_all(self) -> None:
        for db in list(self._txn.values()):
            try:
                await db.run_sync(lambda conn: conn.execute("ROLLBACK"))
            except Exception:
                logger.debug("Rollback failed", exc_info=True)
        self._txn.clear()


# ------------------------------------------------------------------ #
# Executor base and registry                                           #
# ------------------------------------------------------------------ #


class NodeExecutor(ABC):
    kind: str = ""
    required: tuple[str, ...] = ()

    @abstractmethod
    async def execute(self, ctx: ExecutionContext, node: dict, inputs: NodeInputs): ...

    def validate(self, node: dict) -> list[tuple[str, str]]:
        """Return ``[(level, message)]`` for this node's configuration."""
        config = cfg(node)
        return [
            ("error", f"{self.kind}: '{key}' is required")
            for key in self.required
            if is_missing(config.get(key))
        ]

    def _preview(self, ctx: ExecutionContext, rows: list) -> list:
        return rows[: ctx.sample_size] if ctx.mode == "preview" else rows


EXECUTORS: dict[str, NodeExecutor] = {}


def register(cls: type[NodeExecutor]) -> type[NodeExecutor]:
    EXECUTORS[cls.kind] = cls()
    return cls


# ------------------------------------------------------------------ #
# File readers shared by sources                                       #
# ------------------------------------------------------------------ #


def read_csv_rows(path: Path, delimiter=",", header=True, limit: int | None = None) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as fh:
        if header:
            iterator = iter(csv.DictReader(fh, delimiter=delimiter, restkey="_extra"))
        else:
            raw = csv.reader(fh, delimiter=delimiter)
            iterator = ({f"c{i + 1}": v for i, v in enumerate(rec)} for rec in raw)
        if limit is not None:
            iterator = islice(iterator, limit)
        return list(iterator)


def read_json_rows(path: Path, fmt="array", limit: int | None = None) -> list[dict]:
    if fmt == "jsonl":
        with open(path, encoding="utf-8") as fh:
            lines = (line for line in fh if line.strip())
            if limit is not None:
                lines = islice(lines, limit)
            rows = [json.loads(line) for line in lines]
    else:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        rows = data if isinstance(data, list) else [data]
        if limit is not None:
            rows = rows[:limit]
    return [r if isinstance(r, dict) else {"value": r} for r in rows]


def read_parquet_rows(path: Path, limit: int | None = None) -> list[dict]:
    _pa, pq = load_pyarrow()
    table = pq.read_table(str(path))
    if limit is not None:
        table = table.slice(0, limit)
    return table.to_pylist()


def open_external(path, key: str | None = None, readonly=False, must_exist=True):
    """Open an external SQLite/SQLCipher file outside the ConnectionManager."""
    p = resolve_path(path)
    if must_exist and not p.exists():
        raise FileNotFoundError(f"Database file not found: {p}")
    if not must_exist:
        p.parent.mkdir(parents=True, exist_ok=True)
    if key:
        if readonly:
            conn = sqlcipher3.connect(f"file:{p}?mode=ro", uri=True)
        else:
            conn = sqlcipher3.connect(str(p))
        conn.execute(DatabaseManager._key_pragma("PRAGMA key", key))
        try:
            conn.execute("SELECT count(*) FROM sqlite_master")
        except sqlcipher3.DatabaseError as exc:
            conn.close()
            raise RuntimeError(f"Cannot open {p}: invalid key or not a database") from exc
        return conn
    if readonly:
        return sqlite3.connect(f"file:{p}?mode=ro", uri=True)
    return sqlite3.connect(str(p))


def sqlcipher_export(conn, out_path: Path, key_literal: str) -> None:
    """Export the main database of *conn* into *out_path* with the given KEY literal."""
    path_lit = str(out_path).replace("'", "''")
    conn.execute(f"ATTACH DATABASE '{path_lit}' AS df_export KEY {key_literal}")
    try:
        conn.execute("SELECT sqlcipher_export('df_export')")
    finally:
        conn.execute("DETACH DATABASE df_export")


# ================================================================== #
#  SOURCES                                                             #
# ================================================================== #


def _limit_clause(ctx: ExecutionContext) -> str:
    return f" LIMIT {int(ctx.sample_size)}" if ctx.mode == "preview" else ""


def _sample_limit(ctx: ExecutionContext) -> int | None:
    return ctx.sample_size if ctx.mode == "preview" else None


@register
class SrcTableExecutor(NodeExecutor):
    kind = "src-table"
    required = ("conn", "table")

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        db = await ctx.resolve_conn(c["conn"], c.get("key"))
        sql = (
            f"SELECT * FROM {quote_ident(c['table'])}"
            f"{where_clause(c.get('where'))}{_limit_clause(ctx)}"
        )
        return await db.execute_dicts(sql)


@register
class SrcViewExecutor(NodeExecutor):
    kind = "src-view"
    required = ("conn",)

    @staticmethod
    def _view(c: dict):
        return c.get("table") or c.get("view")

    def validate(self, node):
        issues = super().validate(node)
        if is_missing(self._view(cfg(node))):
            issues.append(("error", "src-view: 'table' is required"))
        return issues

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, "conn")
        view = self._view(c)
        if is_missing(view):
            raise ValueError("src-view: 'table' is required")
        db = await ctx.resolve_conn(c["conn"], c.get("key"))
        sql = f"SELECT * FROM {quote_ident(view)}{where_clause(c.get('where'))}{_limit_clause(ctx)}"
        return await db.execute_dicts(sql)


@register
class SrcSqlExecutor(NodeExecutor):
    kind = "src-sql"
    required = ("conn", "sql")

    def validate(self, node):
        issues = super().validate(node)
        sql = cfg(node).get("sql")
        if not is_missing(sql):
            try:
                assert_read_only_sql(sql, self.kind)
            except ValueError as exc:
                issues.append(("error", str(exc)))
        return issues

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        sql = assert_read_only_sql(c["sql"], self.kind)
        db = await ctx.resolve_conn(c["conn"], c.get("key"))
        if ctx.mode == "preview":
            sql = f"SELECT * FROM ({sql}) AS _q{_limit_clause(ctx)}"
        return await db.execute_dicts(sql)


@register
class SrcCsvExecutor(NodeExecutor):
    kind = "src-csv"
    required = ("path",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        return await asyncio.to_thread(
            read_csv_rows,
            resolve_path(c["path"]),
            delimiter_of(c.get("delimiter")),
            as_bool(c.get("header"), True),
            _sample_limit(ctx),
        )


@register
class SrcJsonExecutor(NodeExecutor):
    kind = "src-json"
    required = ("path",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        return await asyncio.to_thread(
            read_json_rows, resolve_path(c["path"]), c.get("format") or "array", _sample_limit(ctx)
        )


@register
class SrcParquetExecutor(NodeExecutor):
    kind = "src-parquet"
    required = ("path",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        return await asyncio.to_thread(
            read_parquet_rows, resolve_path(c["path"]), _sample_limit(ctx)
        )


@register
class SrcExtDbExecutor(NodeExecutor):
    kind = "src-ext-db"
    required = ("path", "table")

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        sql = (
            f"SELECT * FROM {quote_ident(c['table'])}"
            f"{where_clause(c.get('where'))}{_limit_clause(ctx)}"
        )

        def _read():
            conn = open_external(c["path"], c.get("key") or None, readonly=True)
            try:
                return fetch_dicts(conn.execute(sql))
            finally:
                conn.close()

        return await asyncio.to_thread(_read)


@register
class SrcFolderExecutor(NodeExecutor):
    kind = "src-folder"
    required = ("path",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        fmt = (c.get("format") or "csv").lower()
        pattern = c.get("glob") or "*"
        add_source = as_bool(c.get("add_source_column"), False)
        delimiter = delimiter_of(c.get("delimiter"))
        header = as_bool(c.get("header"), True)
        limit = _sample_limit(ctx)

        def _read():
            base = resolve_path(c["path"])
            files = sorted(p for p in glob.glob(str(base / pattern)) if Path(p).is_file())
            rows: list[dict] = []
            for fp in files:
                remaining = None if limit is None else limit - len(rows)
                if remaining is not None and remaining <= 0:
                    break
                p = Path(fp)
                if fmt == "json":
                    chunk = read_json_rows(
                        p, "jsonl" if p.suffix == ".jsonl" else "array", remaining
                    )
                elif fmt == "parquet":
                    chunk = read_parquet_rows(p, remaining)
                else:
                    chunk = read_csv_rows(p, delimiter, header, remaining)
                if add_source:
                    for row in chunk:
                        row["_source_file"] = p.name
                rows.extend(chunk)
            return rows

        return await asyncio.to_thread(_read)


# ================================================================== #
#  TRANSFORMS                                                          #
# ================================================================== #


def _in_memory(rows, sql, columns=None):
    return asyncio.to_thread(run_in_memory, rows, sql, "_input", columns)


@register
class TfFilterExecutor(NodeExecutor):
    kind = "tf-filter"
    required = ("expr",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        if not data:
            return []
        return await _in_memory(data, f"SELECT * FROM _input WHERE ({c['expr']})")


@register
class TfProjectExecutor(NodeExecutor):
    kind = "tf-project"
    required = ("columns",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        if not data:
            return []
        cols = split_list(c["columns"])
        names = column_names(data)
        if (c.get("mode") or "keep") == "drop":
            drop = set(cols)
            keep = [n for n in names if n not in drop]
        else:
            unknown = [col for col in cols if col not in names]
            if unknown:
                raise ValueError(f"tf-project: unknown column(s): {', '.join(unknown)}")
            keep = cols
        return await asyncio.to_thread(lambda: [{k: r.get(k) for k in keep} for r in data])


@register
class TfRenameExecutor(NodeExecutor):
    kind = "tf-rename"
    required = ("from_col", "to_col")

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        return await asyncio.to_thread(rename_columns, inputs.first, {c["from_col"]: c["to_col"]})


@register
class TfCastExecutor(NodeExecutor):
    kind = "tf-cast"
    required = ("column", "target_type")

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        if not data:
            return []
        target = check_type_name(c["target_type"])
        column = c["column"]
        selects = [
            f"CAST({quote_ident(n)} AS {target}) AS {quote_ident(n)}"
            if n == column
            else quote_ident(n)
            for n in column_names(data)
        ]
        return await _in_memory(data, f"SELECT {', '.join(selects)} FROM _input")


@register
class TfDeriveExecutor(NodeExecutor):
    kind = "tf-derive"
    required = ("name", "expr")

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        if not data:
            return []
        sql = f"SELECT *, ({c['expr']}) AS {quote_ident(c['name'])} FROM _input"
        return await _in_memory(data, sql)


@register
class TfJoinExecutor(NodeExecutor):
    kind = "tf-join"
    required = ("left_key", "right_key")

    def validate(self, node):
        issues = super().validate(node)
        join_type = str(cfg(node).get("join_type") or "INNER").upper()
        if join_type not in JOIN_TYPES:
            issues.append(("error", f"tf-join: join_type must be one of {', '.join(JOIN_TYPES)}"))
        return issues

    @staticmethod
    def _sides(inputs: NodeInputs) -> tuple[list[dict], list[dict]]:
        left = inputs.by_port("L")
        right = inputs.by_port("R")
        spare = [
            rows for rows, port in zip(inputs, inputs.ports, strict=False) if port not in ("L", "R")
        ]
        if left is None and spare:
            left = spare.pop(0)
        if right is None and spare:
            right = spare.pop(0)
        if left is None or right is None:
            raise ValueError("tf-join: requires two inputs (ports L and R)")
        return left, right

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        join_type = str(c.get("join_type") or "INNER").upper()
        if join_type not in JOIN_TYPES:
            raise ValueError(f"tf-join: join_type must be one of {', '.join(JOIN_TYPES)}")
        left_key, right_key = c["left_key"], c["right_key"]
        left, right = self._sides(inputs)
        if not left and join_type in ("INNER", "LEFT"):
            return []
        if not right and join_type in ("INNER", "RIGHT"):
            return []

        left_cols = infer_column_types(left) or [{"name": left_key, "type": "NULL"}]
        right_cols = infer_column_types(right) or [{"name": right_key, "type": "NULL"}]
        used = {col["name"] for col in left_cols}
        selects = [
            f"_left.{quote_ident(col['name'])} AS {quote_ident(col['name'])}" for col in left_cols
        ]
        for col in right_cols:
            name = col["name"]
            if name == right_key and name in used:
                continue
            alias = name
            while alias in used:
                alias += "_r"
            used.add(alias)
            selects.append(f"_right.{quote_ident(name)} AS {quote_ident(alias)}")
        sql = (
            f"SELECT {', '.join(selects)} FROM _left {join_type} JOIN _right "
            f"ON _left.{quote_ident(left_key)} = _right.{quote_ident(right_key)}"
        )
        return await asyncio.to_thread(
            run_in_memory_multi, {"_left": (left, left_cols), "_right": (right, right_cols)}, sql
        )


@register
class TfUnionExecutor(NodeExecutor):
    kind = "tf-union"

    async def execute(self, ctx, node, inputs):
        distinct = (cfg(node).get("mode") or "all") == "distinct"

        def _union():
            names: dict[str, None] = {}
            for rows in inputs:
                for n in column_names(rows):
                    names.setdefault(n, None)
            cols = list(names)
            out, seen = [], set()
            for rows in inputs:
                for row in rows:
                    aligned = {col: row.get(col) for col in cols}
                    if distinct:
                        key = tuple(hashable(v) for v in aligned.values())
                        if key in seen:
                            continue
                        seen.add(key)
                    out.append(aligned)
            return out

        return await asyncio.to_thread(_union)


@register
class TfGroupExecutor(NodeExecutor):
    kind = "tf-group"
    required = ("group_by",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        if not data:
            return []
        group_cols = ", ".join(ident_or_expr(g) for g in split_list(c["group_by"]))
        aggregates = str(c.get("aggregates") or "").strip().rstrip(",").strip()
        select = f"{group_cols}, {aggregates}" if aggregates else group_cols
        return await _in_memory(data, f"SELECT {select} FROM _input GROUP BY {group_cols}")


@register
class TfSortExecutor(NodeExecutor):
    kind = "tf-sort"
    required = ("order_by",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        if not data:
            return []
        return await _in_memory(
            data, f"SELECT * FROM _input ORDER BY {order_clause(c['order_by'])}"
        )


@register
class TfLimitExecutor(NodeExecutor):
    kind = "tf-limit"

    def validate(self, node):
        issues = super().validate(node)
        c = cfg(node)
        for key in ("limit", "offset"):
            try:
                as_int(c.get(key), None, f"tf-limit: {key}")
            except ValueError as exc:
                issues.append(("error", str(exc)))
        return issues

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        limit = as_int(c.get("limit"), None, "tf-limit: limit")
        offset = as_int(c.get("offset"), 0, "tf-limit: offset") or 0
        data = inputs.first
        end = None if limit is None else offset + max(limit, 0)
        return data[offset:end]


@register
class TfMapExecutor(NodeExecutor):
    kind = "tf-map"
    required = ("mappings",)

    def validate(self, node):
        issues = super().validate(node)
        try:
            parse_mappings(cfg(node).get("mappings"))
        except ValueError as exc:
            issues.append(("error", f"tf-map: {exc}"))
        return issues

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        mapping = parse_mappings(c["mappings"])
        drop_unmapped = as_bool(c.get("drop_unmapped"), False)
        return await asyncio.to_thread(rename_columns, inputs.first, mapping, drop_unmapped)


# ================================================================== #
#  CLEANING                                                            #
# ================================================================== #


@register
class ClDedupeExecutor(NodeExecutor):
    kind = "cl-dedupe"

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        data = inputs.first
        if not data:
            return []
        by_cols = split_list(c.get("by"))
        keep = (c.get("keep") or "first").lower()
        if not by_cols:

            def _full_row():
                seen, out = set(), []
                ordered = data if keep != "last" else list(reversed(data))
                for row in ordered:
                    key = tuple((k, hashable(v)) for k, v in row.items())
                    if key not in seen:
                        seen.add(key)
                        out.append(row)
                return out if keep != "last" else list(reversed(out))

            return await asyncio.to_thread(_full_row)

        partition = quote_list(by_cols)
        order = order_clause(c.get("order_by")) or "rowid"
        pick = "_rn = _cnt" if keep == "last" else "_rn = 1"
        cols = quote_list(column_names(data))
        sql = (
            f"SELECT {cols} FROM (SELECT *, rowid AS _rid, "
            f"ROW_NUMBER() OVER (PARTITION BY {partition} ORDER BY {order}) AS _rn, "
            f"COUNT(*) OVER (PARTITION BY {partition}) AS _cnt FROM _input) "
            f"WHERE {pick} ORDER BY _rid"
        )
        return await _in_memory(data, sql)


@register
class ClFillNullExecutor(NodeExecutor):
    kind = "cl-fill-null"
    required = ("column",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        if not data:
            return []
        column = c["column"]
        value = c.get("value", "")
        col_type = next(
            (x["type"] for x in infer_column_types(data) if x["name"] == column), "TEXT"
        )
        fill = coerce_to_type(value, col_type)
        return await asyncio.to_thread(
            lambda: [{**r, column: fill} if r.get(column) is None else r for r in data]
        )


def _target_columns(data: list[dict], columns) -> set[str]:
    cols = split_list(columns)
    if cols:
        return set(cols)
    return {col["name"] for col in infer_column_types(data) if col["type"] == "TEXT"} or {
        n for n in column_names(data) if any(isinstance(r.get(n), str) for r in data)
    }


def _apply_to_strings(data: list[dict], columns: set[str], fn) -> list[dict]:
    out = []
    for row in data:
        new = dict(row)
        for col in columns:
            val = new.get(col)
            if isinstance(val, str):
                new[col] = fn(val)
        out.append(new)
    return out


@register
class ClTrimExecutor(NodeExecutor):
    kind = "cl-trim"

    async def execute(self, ctx, node, inputs):
        data = inputs.first
        if not data:
            return []
        cols = _target_columns(data, cfg(node).get("columns"))
        return await asyncio.to_thread(_apply_to_strings, data, cols, str.strip)


@register
class ClCaseExecutor(NodeExecutor):
    kind = "cl-case"

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        data = inputs.first
        if not data:
            return []
        mode = (c.get("mode") or "lower").lower()
        fn = {"lower": str.lower, "upper": str.upper, "title": str.title}.get(mode)
        if fn is None:
            raise ValueError("cl-case: mode must be lower, upper or title")
        cols = _target_columns(data, c.get("columns"))
        return await asyncio.to_thread(_apply_to_strings, data, cols, fn)


def resolve_salt(salt) -> str:
    text = str(salt or "")
    if text.startswith("env:"):
        return os.environ.get(text[4:].strip(), "")
    return text


def fake_value(column: str, digest: str) -> str:
    """Deterministic fake value chosen by a column-name heuristic."""
    h6 = digest[:6]
    seed = int(digest[:16], 16)
    rnd = random.Random(seed)
    col = column.lower()
    if "email" in col or "mail" in col:
        return f"user{h6}@example.com"
    if "name" in col:
        first, last = rnd.choice(_FIRST_NAMES), rnd.choice(_LAST_NAMES)
        if "first" in col or "given" in col:
            return first
        if "last" in col or "surname" in col or "family" in col:
            return last
        return f"{first} {last}"
    if "phone" in col or "mobile" in col or "tel" in col:
        return f"555-01{seed % 100:02d}-{(seed // 100) % 10000:04d}"
    return f"val_{h6}"


def anonymize(value, column: str, method: str, salt: str):
    if value is None:
        return None
    if method == "redact":
        return "***"
    digest = hashlib.sha256((salt + str(value)).encode("utf-8")).hexdigest()
    if method == "hash":
        return digest[:16]
    if method == "tokenize":
        return "tok_" + digest[:8]
    if method == "fake":
        return fake_value(column, digest)
    raise ValueError("cl-anon: method must be hash, redact, fake or tokenize")


@register
class ClAnonExecutor(NodeExecutor):
    kind = "cl-anon"
    required = ("columns",)

    def validate(self, node):
        issues = super().validate(node)
        method = (cfg(node).get("method") or "hash").lower()
        if method not in ("hash", "redact", "fake", "tokenize"):
            issues.append(("error", "cl-anon: method must be hash, redact, fake or tokenize"))
        return issues

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        if not data:
            return []
        cols = split_list(c["columns"])
        method = (c.get("method") or "hash").lower()
        salt = resolve_salt(c.get("salt"))
        if method not in ("hash", "redact", "fake", "tokenize"):
            raise ValueError("cl-anon: method must be hash, redact, fake or tokenize")

        def _anon():
            out = []
            for row in data:
                new = dict(row)
                for col in cols:
                    if col in new:
                        new[col] = anonymize(new[col], col, method, salt)
                out.append(new)
            return out

        return await asyncio.to_thread(_anon)


def _check_column(data: list[dict], column: str, check: str, failures: dict[int, str]) -> None:
    label = f"{check} on '{column}'"
    if check == "unique":
        seen: set = set()
        for i, row in enumerate(data):
            key = hashable(row.get(column))
            if key in seen:
                failures.setdefault(i, label)
            seen.add(key)
        return
    if check.startswith("regex:"):
        pattern = re.compile(check[len("regex:") :])

        def bad(v):
            return v is None or not pattern.fullmatch(str(v))
    elif check == "not_null":

        def bad(v):
            return v is None
    elif check == "non_empty":

        def bad(v):
            return v is None or str(v).strip() == ""
    elif check == "numeric":

        def bad(v):
            return not is_numeric(v)
    else:
        raise ValueError(f"cl-validate: unknown check '{check}'")
    for i, row in enumerate(data):
        if bad(row.get(column)):
            failures.setdefault(i, label)


@register
class ClValidateExecutor(NodeExecutor):
    kind = "cl-validate"
    required = ("rules",)

    def validate(self, node):
        issues = super().validate(node)
        c = cfg(node)
        on_fail = c.get("on_fail") or "drop"
        if on_fail not in ("drop", "fail", "route"):
            issues.append(("error", "cl-validate: on_fail must be drop, fail or route"))
        try:
            for rule in as_list(c.get("rules")):
                if not isinstance(rule, dict) or not (
                    rule.get("expr") or (rule.get("column") and rule.get("check"))
                ):
                    issues.append(
                        ("error", "cl-validate: each rule needs 'expr' or 'column' + 'check'")
                    )
                    break
        except ValueError as exc:
            issues.append(("error", f"cl-validate: {exc}"))
        return issues

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        rules = as_list(c["rules"])
        on_fail = c.get("on_fail") or "drop"
        if on_fail not in ("drop", "fail", "route"):
            raise ValueError("cl-validate: on_fail must be drop, fail or route")
        data = inputs.first
        if not data:
            return {"out": [], "rejected": []} if on_fail == "route" else []

        def _evaluate() -> dict[int, str]:
            failures: dict[int, str] = {}
            for rule in rules:
                if not isinstance(rule, dict):
                    raise ValueError("cl-validate: each rule must be an object")
                expr = str(rule.get("expr") or "").strip()
                if expr:
                    result = run_in_memory(
                        data, f"SELECT rowid - 1 AS _i, ({expr}) AS _ok FROM _input"
                    )
                    for r in result:
                        if not r["_ok"]:
                            failures.setdefault(r["_i"], f"expr {expr}")
                    continue
                column = rule.get("column")
                check = str(rule.get("check") or "").strip()
                if not column or not check:
                    raise ValueError("cl-validate: each rule needs 'expr' or 'column' + 'check'")
                _check_column(data, column, check, failures)
            return failures

        failures = await asyncio.to_thread(_evaluate)
        if not failures:
            return {"out": data, "rejected": []} if on_fail == "route" else data
        if on_fail == "fail":
            first = min(failures)
            raise ValueError(f"cl-validate: row {first + 1} failed {failures[first]}")
        accepted = [r for i, r in enumerate(data) if i not in failures]
        rejected = [data[i] for i in sorted(failures)]
        if on_fail == "route":
            await ctx.log(
                "info", node["id"], f"cl-validate: routed {len(rejected)} rows to 'rejected'"
            )
            return {"out": accepted, "rejected": rejected}
        await ctx.log("warn", node["id"], f"cl-validate: dropped {len(rejected)} invalid rows")
        return accepted


# ================================================================== #
#  SCHEMA OPERATIONS                                                   #
# ================================================================== #


class _SchemaOpExecutor(NodeExecutor):
    """DDL against a target connection; input rows pass through unchanged."""

    required = ("conn", "table")

    @abstractmethod
    def statements(self, c: dict) -> list[str]: ...

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        stmts = self.statements(c)
        if not ctx.writes_enabled:
            for s in stmts:
                await ctx.log("info", node["id"], f"[{ctx.mode}] Would execute: {s}")
            return inputs.first
        db = await ctx.resolve_conn(c["conn"], c.get("key"))
        own_txn = not ctx.in_txn(db)

        def _apply(conn):
            if own_txn:
                conn.execute("BEGIN")
            try:
                for s in stmts:
                    conn.execute(s)
                if own_txn:
                    conn.execute("COMMIT")
            except Exception:
                if own_txn:
                    try:
                        conn.execute("ROLLBACK")
                    except Exception:
                        pass
                raise

        await db.run_sync(_apply)
        db.invalidate_row_cache()
        for s in stmts:
            await ctx.log("info", node["id"], f"Executed: {s}")
        return inputs.first


@register
class ScAddColExecutor(_SchemaOpExecutor):
    kind = "sc-add-col"
    required = ("conn", "table", "column")

    def statements(self, c):
        col_type = check_type_name(c.get("type") or "TEXT")
        sql = (
            f"ALTER TABLE {quote_ident(c['table'])} "
            f"ADD COLUMN {quote_ident(c['column'])} {col_type}"
        )
        default = c.get("default")
        if not is_missing(default):
            sql += f" DEFAULT {sql_literal(default)}"
        return [sql]


@register
class ScDropColExecutor(_SchemaOpExecutor):
    kind = "sc-drop-col"
    required = ("conn", "table", "column")

    def statements(self, c):
        return [f"ALTER TABLE {quote_ident(c['table'])} DROP COLUMN {quote_ident(c['column'])}"]


@register
class ScRenameColExecutor(_SchemaOpExecutor):
    kind = "sc-rename-col"
    required = ("conn", "table", "from_col", "to_col")

    def statements(self, c):
        return [
            f"ALTER TABLE {quote_ident(c['table'])} RENAME COLUMN "
            f"{quote_ident(c['from_col'])} TO {quote_ident(c['to_col'])}"
        ]


@register
class ScCastColExecutor(_SchemaOpExecutor):
    kind = "sc-cast-col"
    required = ("conn", "table", "column", "target_type")

    def statements(self, c):
        table = quote_ident(c["table"])
        col = quote_ident(c["column"])
        tmp = quote_ident(f"{c['column']}__tmp")
        target = check_type_name(c["target_type"])
        return [
            f"ALTER TABLE {table} ADD COLUMN {tmp} {target}",
            f"UPDATE {table} SET {tmp} = CAST({col} AS {target})",
            f"ALTER TABLE {table} DROP COLUMN {col}",
            f"ALTER TABLE {table} RENAME COLUMN {tmp} TO {col}",
        ]


@register
class ScAddIndexExecutor(_SchemaOpExecutor):
    kind = "sc-add-index"
    required = ("conn", "table", "columns")

    def statements(self, c):
        cols = split_list(c["columns"])
        name = f"idx_{c['table']}_{'_'.join(cols)}"
        unique = "UNIQUE " if as_bool(c.get("unique"), False) else ""
        return [
            f"CREATE {unique}INDEX IF NOT EXISTS {quote_ident(name)} "
            f"ON {quote_ident(c['table'])} ({quote_list(cols)})"
        ]


# ================================================================== #
#  CODE                                                                #
# ================================================================== #


@register
class CoSqlExecutor(NodeExecutor):
    kind = "co-sql"
    required = ("sql",)

    def validate(self, node):
        issues = super().validate(node)
        sql = cfg(node).get("sql")
        if not is_missing(sql):
            try:
                assert_read_only_sql(sql, self.kind)
            except ValueError as exc:
                issues.append(("error", str(exc)))
        return issues

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        sql = assert_read_only_sql(c["sql"], self.kind)
        tables = {f"_input{i}": (rows, None) for i, rows in enumerate(inputs, 1)}
        views = {"_input": "_input1"} if inputs else None
        return await asyncio.to_thread(run_in_memory_multi, tables, sql, views)


class _ScriptletExecutor(NodeExecutor):
    required = ("script",)

    def validate(self, node):
        return [("error", SCRIPTLET_ERRORS[self.kind])]

    async def execute(self, ctx, node, inputs):
        raise ValueError(SCRIPTLET_ERRORS[self.kind])


@register
class CoPyExecutor(_ScriptletExecutor):
    kind = "co-py"


@register
class CoJsExecutor(_ScriptletExecutor):
    kind = "co-js"


# ================================================================== #
#  ENCRYPTION                                                          #
# ================================================================== #


@register
class EnEncryptExecutor(NodeExecutor):
    kind = "en-encrypt"
    required = ("conn", "out_path", "key")

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        out = resolve_path(c["out_path"])
        if not ctx.writes_enabled:
            await ctx.log("info", node["id"], f"[{ctx.mode}] Would encrypt {c['conn']} into {out}")
            return inputs.first
        db = await ctx.resolve_conn(c["conn"], c.get("source_key"))
        if out.exists():
            raise FileExistsError(f"en-encrypt: output already exists: {out}")
        out.parent.mkdir(parents=True, exist_ok=True)
        key_lit = DatabaseManager._format_key(str(c["key"]))
        await db.run_sync(lambda conn: sqlcipher_export(conn, out, key_lit))
        await ctx.log("info", node["id"], f"Encrypted copy written to {out}")
        return inputs.first


@register
class EnDecryptExecutor(NodeExecutor):
    kind = "en-decrypt"
    required = ("conn", "out_path")

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        out = resolve_path(c["out_path"])
        if not ctx.writes_enabled:
            await ctx.log("info", node["id"], f"[{ctx.mode}] Would decrypt {c['conn']} into {out}")
            return inputs.first
        db = await ctx.resolve_conn(c["conn"], c.get("key"))
        if out.exists():
            raise FileExistsError(f"en-decrypt: output already exists: {out}")
        out.parent.mkdir(parents=True, exist_ok=True)
        await db.run_sync(lambda conn: sqlcipher_export(conn, out, "''"))
        await ctx.log("info", node["id"], f"Plaintext copy written to {out}")
        return inputs.first


@register
class EnRekeyExecutor(NodeExecutor):
    kind = "en-rekey"
    required = ("conn", "new_key")

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        if not ctx.writes_enabled:
            await ctx.log("info", node["id"], f"[{ctx.mode}] Would rekey {c['conn']}")
            return inputs.first
        db = await ctx.resolve_conn(c["conn"], c.get("key"))
        if not db.is_encrypted:
            raise ValueError("en-rekey: connection is not encrypted; use en-encrypt instead")
        if not await db.rekey(str(c["new_key"])):
            raise RuntimeError("en-rekey: PRAGMA rekey failed")
        await ctx.log("info", node["id"], f"Rekeyed {c['conn']}")
        return inputs.first


# ================================================================== #
#  SINKS                                                               #
# ================================================================== #


def _table_exists(conn, table: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name = ?", (table,)
    ).fetchone()
    return row is not None


def ensure_table(conn, table: str, columns: list[dict]) -> None:
    """CREATE the table if missing, else ADD any columns the rows need."""
    qt = quote_ident(table)
    existing = {r[1].lower() for r in conn.execute(f"PRAGMA table_info({qt})").fetchall()}
    if not existing:
        conn.execute(f"CREATE TABLE IF NOT EXISTS {qt} ({column_defs(columns)})")
        return
    for col in columns:
        if col["name"].lower() not in existing:
            conn.execute(
                f"ALTER TABLE {qt} ADD COLUMN {quote_ident(col['name'])} {ddl_type(col['type'])}"
            )


def ensure_unique_index(conn, table: str, keys: list[str]) -> None:
    qt = quote_ident(table)
    wanted = {k.lower() for k in keys}
    info = conn.execute(f"PRAGMA table_info({qt})").fetchall()
    pk = {r[1].lower() for r in info if r[5] > 0}
    if pk and pk == wanted:
        return
    for idx in conn.execute(f"PRAGMA index_list({qt})").fetchall():
        if not idx[2]:
            continue
        cols = {
            r[2].lower()
            for r in conn.execute(f"PRAGMA index_info({quote_ident(idx[1])})").fetchall()
            if r[2]
        }
        if cols == wanted:
            return
    name = f"uq_{table}_{'_'.join(keys)}"
    conn.execute(
        f"CREATE UNIQUE INDEX IF NOT EXISTS {quote_ident(name)} ON {qt} ({quote_list(keys)})"
    )


def insert_sql(table: str, names: list[str], keys: list[str] | None = None) -> str:
    qt = quote_ident(table)
    placeholders = ", ".join("?" for _ in names)
    sql = f"INSERT INTO {qt} ({quote_list(names)}) VALUES ({placeholders})"
    if keys:
        non_key = [n for n in names if n not in keys]
        if non_key:
            sets = ", ".join(f"{quote_ident(n)} = excluded.{quote_ident(n)}" for n in non_key)
            sql += f" ON CONFLICT({quote_list(keys)}) DO UPDATE SET {sets}"
        else:
            sql += f" ON CONFLICT({quote_list(keys)}) DO NOTHING"
    return sql


def write_rows(
    conn,
    table: str,
    data: list[dict],
    columns: list[dict],
    write_mode: str,
    keys: list[str],
    batch_size: int,
    ctx: ExecutionContext,
    own_txn: bool,
) -> int:
    """Write *data* into *table* on a raw connection; the caller owns threading."""
    names = [c["name"] for c in columns]
    if own_txn:
        conn.execute("BEGIN")
    try:
        ensure_table(conn, table, columns)
        if write_mode == "replace":
            conn.execute(f"DELETE FROM {quote_ident(table)}")
        if write_mode == "upsert":
            missing = [k for k in keys if k not in names]
            if missing:
                raise ValueError(
                    f"snk-table: upsert key column(s) not in data: {', '.join(missing)}"
                )
            ensure_unique_index(conn, table, keys)
            sql = insert_sql(table, names, keys)
        else:
            sql = insert_sql(table, names)
        written = 0
        for start in range(0, len(data), batch_size):
            if ctx.is_cancelled():
                raise RunCancelled("Run cancelled")
            chunk = data[start : start + batch_size]
            conn.executemany(sql, [[adapt_value(r.get(n)) for n in names] for r in chunk])
            written += len(chunk)
        if own_txn:
            conn.execute("COMMIT")
        return written
    except BaseException:
        if own_txn:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
        raise


def _validate_write_mode(kind: str, mode: str, allowed=WRITE_MODES) -> str:
    mode = (mode or "append").lower()
    if mode not in allowed:
        raise ValueError(f"{kind}: write_mode must be one of {', '.join(allowed)}")
    return mode


@register
class SnkTableExecutor(NodeExecutor):
    kind = "snk-table"
    required = ("conn", "table")

    def validate(self, node):
        issues = super().validate(node)
        c = cfg(node)
        mode = (c.get("write_mode") or "append").lower()
        if mode not in WRITE_MODES:
            issues.append(
                ("error", f"snk-table: write_mode must be one of {', '.join(WRITE_MODES)}")
            )
        elif mode == "upsert" and not split_list(c.get("key")):
            issues.append(("error", "snk-table: 'key' is required for upsert"))
        try:
            as_int(c.get("batch_size"), None, "snk-table: batch_size")
        except ValueError as exc:
            issues.append(("error", str(exc)))
        return issues

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        table = c["table"]
        mode = _validate_write_mode(self.kind, c.get("write_mode"))
        keys = split_list(c.get("key"))
        batch = as_int(c.get("batch_size"), DEFAULT_BATCH_SIZE, "snk-table: batch_size") or 1
        if mode == "upsert" and not keys:
            raise ValueError("snk-table: 'key' is required for upsert")
        data = inputs.first
        mapping = parse_mappings(c.get("mappings"))
        if mapping:
            data = await asyncio.to_thread(rename_columns, data, mapping)

        if ctx.mode == "preview":
            await ctx.log(
                "info", node["id"], f"[preview] Would {mode} {len(data)} rows into {table}"
            )
            return data
        db = await ctx.resolve_conn(c["conn"])
        if ctx.mode == "dry":
            exists = await db.run_sync(lambda conn: _table_exists(conn, table))
            state = "existing" if exists else "new"
            await ctx.log(
                "info",
                node["id"],
                f"[dry] Would {mode} {len(data)} rows into {state} table {table}",
            )
            return data

        columns = infer_column_types(data)
        if not columns:
            await ctx.log("info", node["id"], f"No rows to write to {table}")
            return data
        await ctx.begin_txn(db)
        own_txn = not ctx.in_txn(db)
        written = await db.run_sync(
            lambda conn: write_rows(conn, table, data, columns, mode, keys, batch, ctx, own_txn)
        )
        if own_txn:
            db.invalidate_row_cache()
        await ctx.log("info", node["id"], f"Wrote {written} rows to {table} ({mode})")
        return data


@register
class SnkExtDbExecutor(NodeExecutor):
    kind = "snk-ext-db"
    required = ("path", "table")

    def validate(self, node):
        issues = super().validate(node)
        mode = (cfg(node).get("write_mode") or "append").lower()
        if mode not in ("append", "replace"):
            issues.append(("error", "snk-ext-db: write_mode must be append or replace"))
        return issues

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        table = c["table"]
        mode = _validate_write_mode(self.kind, c.get("write_mode"), ("append", "replace"))
        data = inputs.first
        target = f"{c['path']}:{table}"
        if not ctx.writes_enabled:
            await ctx.log(
                "info", node["id"], f"[{ctx.mode}] Would {mode} {len(data)} rows into {target}"
            )
            return data
        columns = infer_column_types(data)
        if not columns:
            await ctx.log("info", node["id"], f"No rows to write to {target}")
            return data

        def _write():
            conn = open_external(c["path"], c.get("key") or None, must_exist=False)
            try:
                return write_rows(
                    conn, table, data, columns, mode, [], DEFAULT_BATCH_SIZE, ctx, own_txn=True
                )
            finally:
                conn.close()

        written = await asyncio.to_thread(_write)
        await ctx.log("info", node["id"], f"Wrote {written} rows to {target} ({mode})")
        return data


def _csv_cell(value):
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, default=json_default)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return json_default(value)
    return value


@register
class SnkCsvExecutor(NodeExecutor):
    kind = "snk-csv"
    required = ("path",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        path = resolve_path(c["path"])
        if not ctx.writes_enabled:
            await ctx.log(
                "info", node["id"], f"[{ctx.mode}] Would write {len(data)} rows to {path}"
            )
            return data
        delimiter = delimiter_of(c.get("delimiter"))
        header = as_bool(c.get("header"), True)

        def _write():
            path.parent.mkdir(parents=True, exist_ok=True)
            names = column_names(data)
            with open(path, "w", newline="", encoding="utf-8") as fh:
                writer = csv.DictWriter(
                    fh, fieldnames=names, delimiter=delimiter, extrasaction="ignore", restval=""
                )
                if header and names:
                    writer.writeheader()
                for row in data:
                    writer.writerow({k: _csv_cell(v) for k, v in row.items()})

        await asyncio.to_thread(_write)
        await ctx.log("info", node["id"], f"Wrote {len(data)} rows to {path}")
        return data


@register
class SnkJsonExecutor(NodeExecutor):
    kind = "snk-json"
    required = ("path",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        path = resolve_path(c["path"])
        fmt = c.get("format") or "array"
        if not ctx.writes_enabled:
            await ctx.log(
                "info", node["id"], f"[{ctx.mode}] Would write {len(data)} rows to {path}"
            )
            return data

        def _write():
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "w", encoding="utf-8") as fh:
                if fmt == "jsonl":
                    for row in data:
                        fh.write(json.dumps(row, default=json_default) + "\n")
                else:
                    json.dump(data, fh, indent=2, default=json_default)
                    fh.write("\n")

        await asyncio.to_thread(_write)
        await ctx.log("info", node["id"], f"Wrote {len(data)} rows to {path}")
        return data


@register
class SnkParquetExecutor(NodeExecutor):
    kind = "snk-parquet"
    required = ("path",)

    async def execute(self, ctx, node, inputs):
        c = cfg(node)
        require(c, self.kind, *self.required)
        data = inputs.first
        path = resolve_path(c["path"])
        if not ctx.writes_enabled:
            await ctx.log(
                "info", node["id"], f"[{ctx.mode}] Would write {len(data)} rows to {path}"
            )
            return data
        pa, pq = load_pyarrow()
        if not data:
            await ctx.log("info", node["id"], f"No rows to write to {path}")
            return data

        def _write():
            path.parent.mkdir(parents=True, exist_ok=True)
            names = column_names(data)
            aligned = [{n: r.get(n) for n in names} for r in data]
            pq.write_table(pa.Table.from_pylist(aligned), str(path))

        await asyncio.to_thread(_write)
        await ctx.log("info", node["id"], f"Wrote {len(data)} rows to {path}")
        return data

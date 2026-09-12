"""SQL and value helpers shared by the Data Flows node executors.

Everything here is synchronous and side-effect free apart from the
in-memory SQLite helpers, which open and close their own ``:memory:``
connection per call.
"""

from __future__ import annotations

import json
import re
import sqlite3
from datetime import date, datetime
from datetime import time as dt_time
from decimal import Decimal

COLUMN_TYPES = ("INTEGER", "REAL", "TEXT", "BLOB", "NULL")
TYPE_SAMPLE_SIZE = 200

PARQUET_ERROR = (
    "Parquet support requires the 'parquet' extra: pip install sqlcipherui-core[parquet]"
)

_SIMPLE_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_TYPE_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_ ]*(\(\s*\d+\s*(,\s*\d+\s*)?\))?$")
_INT_RE = re.compile(r"^[+-]?\d+$")
_FLOAT_RE = re.compile(r"^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$")
_ORDER_PART_RE = re.compile(r"^(.*?)(?:\s+(asc|desc))?$", re.IGNORECASE)
_READ_ONLY_RE = re.compile(r"^(select|with)\b", re.IGNORECASE)


# ------------------------------------------------------------------ #
# Identifiers and literals                                             #
# ------------------------------------------------------------------ #


def quote_ident(name) -> str:
    """Quote *name* as a SQL identifier, doubling embedded double quotes."""
    return '"' + str(name).replace('"', '""') + '"'


def quote_list(names) -> str:
    return ", ".join(quote_ident(n) for n in names)


def ident_or_expr(text) -> str:
    """Quote *text* when it is a bare identifier, else return it as an expression."""
    text = str(text).strip()
    return quote_ident(text) if _SIMPLE_IDENT_RE.match(text) else text


def order_clause(order_by) -> str:
    """Build an ORDER BY body from ``"col DESC, other"``, quoting bare identifiers."""
    parts = []
    for part in split_list(order_by):
        m = _ORDER_PART_RE.match(part)
        col, direction = m.group(1), m.group(2)
        clause = ident_or_expr(col)
        if direction:
            clause += " " + direction.upper()
        parts.append(clause)
    return ", ".join(parts)


def split_list(value) -> list[str]:
    """Parse a comma-separated string (or a list) of names into a clean list."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        items = [str(v) for v in value]
    else:
        items = str(value).split(",")
    return [s.strip() for s in items if s is not None and s.strip()]


def check_type_name(type_name) -> str:
    """Validate a SQL type name such as ``INTEGER`` or ``VARCHAR(20)``."""
    text = str(type_name or "").strip()
    if not text or not _TYPE_NAME_RE.match(text):
        raise ValueError(f"Invalid SQL type name: {type_name!r}")
    return text


def sql_literal(value) -> str:
    """Render *value* as a SQL literal (numbers bare, everything else quoted)."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if _INT_RE.match(text) or _FLOAT_RE.match(text):
        return text
    return "'" + text.replace("'", "''") + "'"


# ------------------------------------------------------------------ #
# Values and types                                                     #
# ------------------------------------------------------------------ #


def json_default(obj):
    if isinstance(obj, (datetime, date, dt_time)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (bytes, bytearray)):
        return bytes(obj).hex()
    if isinstance(obj, memoryview):
        return obj.tobytes().hex()
    return str(obj)


def adapt_value(value):
    """Coerce a Python value into something sqlite3 can bind."""
    if value is None or isinstance(value, (int, float, str, bytes)):
        return value
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (dict, list, tuple)):
        return json.dumps(value, default=json_default)
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date, dt_time)):
        return value.isoformat()
    if isinstance(value, (bytearray, memoryview)):
        return bytes(value)
    return str(value)


def json_safe(value):
    """Return a JSON-serialisable version of *value* (for API responses)."""
    if value is None or isinstance(value, (int, float, str, bool)):
        return value
    return json_default(value)


def column_names(rows: list[dict]) -> list[str]:
    """Union of all keys across *rows*, in first-seen order."""
    names: dict[str, None] = {}
    for row in rows:
        for key in row:
            if key not in names:
                names[key] = None
    return list(names)


def scalar_type(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool | int):
        return "INTEGER"
    if isinstance(value, float):
        return "REAL"
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "BLOB"
    if isinstance(value, str):
        text = value.strip()
        if _INT_RE.match(text):
            return "INTEGER"
        if _FLOAT_RE.match(text):
            return "REAL"
    return "TEXT"


def _merge_type(current: str | None, new: str) -> str:
    if current is None or current == new:
        return new
    if {current, new} == {"INTEGER", "REAL"}:
        return "REAL"
    return "TEXT"


def infer_column_types(rows: list[dict], sample: int = TYPE_SAMPLE_SIZE) -> list[dict]:
    """Infer ``[{name, type}]`` by scanning up to *sample* non-null values per column."""
    cols = column_names(rows)
    if not cols:
        return []
    seen = dict.fromkeys(cols, 0)
    types: dict[str, str] = {}
    pending = set(cols)
    for row in rows:
        if not pending:
            break
        for col in list(pending):
            value = row.get(col)
            if value is None:
                continue
            seen[col] += 1
            types[col] = _merge_type(types.get(col), scalar_type(value))
            if seen[col] >= sample:
                pending.discard(col)
    return [{"name": c, "type": types.get(c, "NULL")} for c in cols]


def ddl_type(type_name: str) -> str:
    """Map an inferred type to a CREATE TABLE column type (NULL becomes TEXT)."""
    return "TEXT" if type_name in ("NULL", "", None) else type_name


def column_defs(columns: list[dict]) -> str:
    return ", ".join(f"{quote_ident(c['name'])} {ddl_type(c['type'])}" for c in columns)


def is_numeric(value) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)):
        return True
    if isinstance(value, str):
        text = value.strip()
        return bool(_INT_RE.match(text) or _FLOAT_RE.match(text))
    return False


def coerce_to_type(value, type_name: str):
    """Best-effort conversion of a config string to a column's inferred type."""
    if value is None or not isinstance(value, str):
        return value
    try:
        if type_name == "INTEGER":
            return int(value.strip())
        if type_name == "REAL":
            return float(value.strip())
    except ValueError:
        return value
    return value


# ------------------------------------------------------------------ #
# In-memory SQLite                                                     #
# ------------------------------------------------------------------ #


def fetch_dicts(cursor) -> list[dict]:
    cols = [d[0] for d in cursor.description] if cursor.description else []
    return [dict(zip(cols, row, strict=False)) for row in cursor.fetchall()]


def load_table(conn, table: str, rows: list[dict], columns: list[dict] | None = None) -> list[str]:
    """Create *table* in *conn* with typed columns and insert *rows*.

    Returns the column names.  When *columns* is omitted the types are
    inferred from *rows*.  An empty row set with no known columns creates
    nothing and returns ``[]``.
    """
    if columns is None:
        columns = infer_column_types(rows)
    if not columns:
        return []
    names = [c["name"] for c in columns]
    defs = ", ".join(
        f"{quote_ident(c['name'])} {c['type']}".rstrip()
        if c["type"] not in ("NULL", "", None)
        else quote_ident(c["name"])
        for c in columns
    )
    conn.execute(f"CREATE TABLE {quote_ident(table)} ({defs})")
    if rows:
        placeholders = ", ".join("?" for _ in names)
        conn.executemany(
            f"INSERT INTO {quote_ident(table)} ({quote_list(names)}) VALUES ({placeholders})",
            ([adapt_value(r.get(n)) for n in names] for r in rows),
        )
    return names


def run_in_memory(
    rows: list[dict],
    sql: str,
    table: str = "_input",
    columns: list[dict] | None = None,
) -> list[dict]:
    """Load *rows* into an in-memory table named *table* and run *sql*."""
    return run_in_memory_multi({table: (rows, columns)}, sql)


def run_in_memory_multi(
    tables: dict[str, tuple[list[dict], list[dict] | None]],
    sql: str,
    views: dict[str, str] | None = None,
) -> list[dict]:
    """Load several row sets into named tables and run *sql*.

    *tables* maps table name to ``(rows, columns)``.  If any table has no
    rows and no known columns the query cannot reference it meaningfully,
    so ``[]`` is returned without executing.
    """
    for rows, columns in tables.values():
        if not rows and not columns:
            return []
    conn = sqlite3.connect(":memory:")
    try:
        for name, (rows, columns) in tables.items():
            load_table(conn, name, rows, columns)
        for view, target in (views or {}).items():
            conn.execute(f"CREATE VIEW {quote_ident(view)} AS SELECT * FROM {quote_ident(target)}")
        return fetch_dicts(conn.execute(sql))
    finally:
        conn.close()


# ------------------------------------------------------------------ #
# Read-only SQL guard                                                  #
# ------------------------------------------------------------------ #


def strip_leading_comments(sql: str) -> str:
    text = sql
    while True:
        stripped = text.lstrip()
        if stripped.startswith("--"):
            newline = stripped.find("\n")
            text = "" if newline < 0 else stripped[newline + 1 :]
        elif stripped.startswith("/*"):
            end = stripped.find("*/")
            text = "" if end < 0 else stripped[end + 2 :]
        else:
            return stripped


def assert_read_only_sql(sql: str, label: str) -> str:
    """Return *sql* trimmed if it is a single SELECT/WITH statement, else raise."""
    text = strip_leading_comments(sql or "").strip()
    while text.endswith(";"):
        text = text[:-1].rstrip()
        text = strip_leading_comments(text).strip()
    if not text:
        raise ValueError(f"{label}: SQL is empty")
    if not _READ_ONLY_RE.match(text):
        raise ValueError(f"{label}: only SELECT or WITH statements are allowed")
    for idx, ch in enumerate(text):
        if ch != ";":
            continue
        if sqlite3.complete_statement(text[: idx + 1]) and text[idx + 1 :].strip():
            raise ValueError(f"{label}: only a single statement is allowed")
    return text


# ------------------------------------------------------------------ #
# Optional dependencies                                                #
# ------------------------------------------------------------------ #


def load_pyarrow():
    """Import pyarrow lazily; raise the contract's ValueError when missing."""
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq
    except ImportError as exc:
        raise ValueError(PARQUET_ERROR) from exc
    return pa, pq

"""Built-in pipeline templates for the Data Flows feature.

Each template carries a full ``definition`` (nodes with realistic config,
canvas positions spaced ~220px apart, and edges with ``port``/``fromPort``)
so it can be instantiated as-is and then edited.
"""

from __future__ import annotations

_X_STEP = 220
_X0 = 40
_Y = 120


def _node(index: int, node_id: str, kind: str, summary: str, config: dict, y: int = _Y) -> dict:
    return {
        "id": node_id,
        "kind": kind,
        "x": _X0 + index * _X_STEP,
        "y": y,
        "summary": summary,
        "config": config,
    }


def _edge(src: str, dst: str, port: str | None = "in", from_port: str = "out") -> dict:
    return {"from": src, "to": dst, "port": port, "fromPort": from_port, "crossDb": False}


def _chain(nodes: list[dict]) -> list[dict]:
    return [_edge(a["id"], b["id"]) for a, b in zip(nodes, nodes[1:], strict=False)]


def _definition(nodes: list[dict], edges: list[dict] | None = None) -> dict:
    return {"nodes": nodes, "edges": _chain(nodes) if edges is None else edges}


_PROD_DEV_NODES = [
    _node(0, "n1", "src-table", "prod.users", {"conn": "prod", "table": "users", "where": ""}),
    _node(
        1, "n2", "cl-anon", "hash email, phone",
        {"columns": "email, phone", "method": "hash", "salt": "env:DF_ANON_SALT"},
    ),
    _node(2, "n3", "cl-dedupe", "by id, keep last", {"by": "id", "keep": "last", "order_by": ""}),
    _node(
        3, "n4", "tf-map", "rename for dev",
        {"mappings": [{"from": "id", "to": "user_id"}], "drop_unmapped": False},
    ),
    _node(
        4, "n5", "snk-ext-db", "dev.db users",
        {"path": "~/dev.db", "table": "users", "key": "", "write_mode": "replace"},
    ),
]  # fmt: skip

_ENCRYPT_NODES = [
    _node(
        0, "n1", "en-encrypt", "encrypt copy",
        {"conn": "~/plain.db", "out_path": "~/encrypted.db", "key": ""},
    ),
]  # fmt: skip

_ANON_CLONE_NODES = [
    _node(
        0, "n1", "src-table", "prod.customers",
        {"conn": "prod", "table": "customers", "where": ""},
    ),
    _node(
        1, "n2", "cl-anon", "fake name/email",
        {"columns": "name, email", "method": "fake", "salt": "env:DF_ANON_SALT"},
    ),
    _node(
        2, "n3", "snk-table", "dev.customers",
        {
            "conn": "dev", "table": "customers", "write_mode": "replace",
            "key": "", "batch_size": 500,
        },
    ),
]  # fmt: skip

_CSV_IMPORT_NODES = [
    _node(
        0, "n1", "src-folder", "*.csv",
        {"path": "~/imports", "glob": "*.csv", "format": "csv", "add_source_column": True},
    ),
    _node(1, "n2", "tf-rename", "Email -> email", {"from_col": "Email", "to_col": "email"}),
    _node(2, "n3", "cl-trim", "trim text", {"columns": ""}),
    _node(3, "n4", "cl-dedupe", "by email", {"by": "email", "keep": "first", "order_by": ""}),
    _node(
        4, "n5", "snk-table", "upsert contacts",
        {
            "conn": "dev", "table": "contacts", "write_mode": "upsert",
            "key": "email", "batch_size": 500,
        },
    ),
]  # fmt: skip

_SCHEMA_NODES = [
    _node(0, "n1", "src-table", "orders", {"conn": "dev", "table": "orders", "where": ""}),
    _node(
        1, "n2", "sc-add-col", "add status",
        {"conn": "dev", "table": "orders", "column": "status", "type": "TEXT", "default": "new"},
    ),
    _node(
        2, "n3", "sc-cast-col", "amount -> REAL",
        {"conn": "dev", "table": "orders", "column": "amount", "target_type": "REAL"},
    ),
    _node(3, "n4", "tf-derive", "backfill status", {"name": "status", "expr": "'new'"}),
    _node(
        4, "n5", "snk-table", "upsert orders",
        {"conn": "dev", "table": "orders", "write_mode": "upsert", "key": "id", "batch_size": 500},
    ),
]  # fmt: skip

_EXPORT_NODES = [
    _node(0, "n1", "src-table", "events", {"conn": "dev", "table": "events", "where": ""}),
    _node(1, "n2", "tf-project", "keep columns", {"columns": "id, ts, kind", "mode": "keep"}),
    _node(2, "n3", "snk-parquet", "events.parquet", {"path": "~/exports/events.parquet"}),
]  # fmt: skip


def _template(tid, name, icon, accent, desc, nodes) -> dict:
    return {
        "id": tid,
        "name": name,
        "icon": icon,
        "accent": accent,
        "desc": desc,
        "node_kinds": [n["kind"] for n in nodes],
        "definition": _definition(nodes),
    }


PIPELINE_TEMPLATES = [
    _template(
        "t-prod-dev", "Dev → Prod migration", "database", "transform",
        "Two-DB copy with PII anonymization, dedupe, and column mapping.", _PROD_DEV_NODES,
    ),
    _template(
        "t-encrypt", "Encrypt plaintext DB", "lock", "encrypt",
        "Wrap a plain .db file in SQLCipher with a chosen passphrase.", _ENCRYPT_NODES,
    ),
    _template(
        "t-anonclone", "Anonymized clone", "shield", "clean",
        "Full table clone with PII faked; ideal for prod → dev refresh.", _ANON_CLONE_NODES,
    ),
    _template(
        "t-csv-import", "CSV folder import", "file-csv", "source",
        "Glob a folder, normalize, dedupe by key, upsert into a table.", _CSV_IMPORT_NODES,
    ),
    _template(
        "t-schema", "Schema migration", "columns", "schema",
        "Add and cast columns, then backfill with an upsert.", _SCHEMA_NODES,
    ),
    _template(
        "t-export", "Export to Parquet", "file-pq", "sink",
        "Stream a table to columnar Parquet for downstream tools.", _EXPORT_NODES,
    ),
]  # fmt: skip

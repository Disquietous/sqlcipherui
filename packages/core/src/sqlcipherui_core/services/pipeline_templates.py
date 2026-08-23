"""Built-in pipeline templates for the Data Flows feature."""

from __future__ import annotations

PIPELINE_TEMPLATES = [
    {
        "id": "t-prod-dev",
        "name": "Dev → Prod migration",
        "icon": "database",
        "accent": "transform",
        "desc": "Two-DB copy with PII anonymization, dedupe, and upsert.",
        "node_kinds": ["src-table", "cl-anon", "cl-dedupe", "tf-map", "snk-ext-db"],
    },
    {
        "id": "t-encrypt",
        "name": "Encrypt plaintext DB",
        "icon": "lock",
        "accent": "encrypt",
        "desc": "Wrap a plain .db file in SQLCipher with a chosen passphrase.",
        "node_kinds": ["src-ext-db", "en-encrypt", "snk-ext-db"],
    },
    {
        "id": "t-anonclone",
        "name": "Anonymized clone",
        "icon": "shield",
        "accent": "clean",
        "desc": "Full DB clone with PII hashed; ideal for prod → dev refresh.",
        "node_kinds": ["src-table", "cl-anon", "snk-table"],
    },
    {
        "id": "t-csv-import",
        "name": "CSV folder import",
        "icon": "file-csv",
        "accent": "source",
        "desc": "Glob a folder, normalize, dedupe by key, upsert into a table.",
        "node_kinds": ["src-folder", "tf-rename", "cl-trim", "cl-dedupe", "snk-table"],
    },
    {
        "id": "t-schema",
        "name": "Schema migration",
        "icon": "columns",
        "accent": "schema",
        "desc": "Add/drop/rename columns with data preservation backfill.",
        "node_kinds": ["src-table", "sc-add-col", "sc-cast-col", "snk-table"],
    },
    {
        "id": "t-export",
        "name": "Export to Parquet",
        "icon": "file-pq",
        "accent": "sink",
        "desc": "Stream a table to columnar Parquet for downstream tools.",
        "node_kinds": ["src-table", "tf-project", "snk-parquet"],
    },
]

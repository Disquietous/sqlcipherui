"""Internal application database for persisting settings, history, and saved queries."""

from __future__ import annotations

import logging
import sqlite3
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sql_text TEXT NOT NULL,
    row_count INTEGER DEFAULT 0,
    elapsed_ms REAL DEFAULT 0,
    error TEXT,
    db_path TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_queries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sql_text TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS databases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    last_opened TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS df_pipelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    starred INTEGER DEFAULT 0,
    tags TEXT DEFAULT '[]',
    definition TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS df_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'sqlite',
    encrypted INTEGER DEFAULT 0,
    path TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS df_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'preview',
    status TEXT NOT NULL DEFAULT 'pending',
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT,
    duration_ms REAL DEFAULT 0,
    total_rows INTEGER DEFAULT 0,
    error TEXT,
    initiated_by TEXT DEFAULT 'user',
    FOREIGN KEY (pipeline_id) REFERENCES df_pipelines(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS df_run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id INTEGER NOT NULL,
    timestamp TEXT DEFAULT (datetime('now','subsec')),
    level TEXT DEFAULT 'info',
    node_id TEXT,
    message TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES df_runs(id) ON DELETE CASCADE
);
"""


class AppDatabase:
    """Manages the internal application SQLite database at ~/.sqlcipherui/app.db."""

    def __init__(self, data_dir: Path) -> None:
        self._path = data_dir / "app.db"
        self._lock = threading.Lock()
        self._conn: sqlite3.Connection | None = None
        data_dir.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _get_conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(str(self._path), check_same_thread=False)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
        return self._conn

    def _init_db(self) -> None:
        with self._lock:
            conn = self._get_conn()
            conn.executescript(_SCHEMA)
            conn.commit()
        logger.info("App database initialized at %s", self._path)

    def close(self) -> None:
        with self._lock:
            if self._conn:
                try:
                    self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                except Exception:
                    pass
                self._conn.close()
                self._conn = None

    # ------------------------------------------------------------------
    # History
    # ------------------------------------------------------------------

    def add_history(self, sql_text: str, row_count: int = 0,
                    elapsed_ms: float = 0, error: str | None = None,
                    db_path: str | None = None) -> int:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute(
                "INSERT INTO history (sql_text, row_count, elapsed_ms, error, db_path) VALUES (?, ?, ?, ?, ?)",
                (sql_text, row_count, elapsed_ms, error, db_path),
            )
            conn.commit()
            return cur.lastrowid

    def get_history(self, limit: int = 200, offset: int = 0,
                    search: str | None = None) -> list[dict]:
        with self._lock:
            conn = self._get_conn()
            if search:
                rows = conn.execute(
                    "SELECT * FROM history WHERE sql_text LIKE ? ORDER BY id DESC LIMIT ? OFFSET ?",
                    (f"%{search}%", limit, offset),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM history ORDER BY id DESC LIMIT ? OFFSET ?",
                    (limit, offset),
                ).fetchall()
            return [dict(r) for r in rows]

    def remove_history(self, history_id: int) -> bool:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute("DELETE FROM history WHERE id = ?", (history_id,))
            conn.commit()
            return cur.rowcount > 0

    def clear_history(self) -> None:
        with self._lock:
            conn = self._get_conn()
            conn.execute("DELETE FROM history")
            conn.commit()

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    def get_setting(self, key: str) -> str | None:
        with self._lock:
            conn = self._get_conn()
            row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
            return row["value"] if row else None

    def get_all_settings(self) -> dict[str, str]:
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute("SELECT key, value FROM settings").fetchall()
            return {r["key"]: r["value"] for r in rows}

    def set_setting(self, key: str, value: str) -> None:
        with self._lock:
            conn = self._get_conn()
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
            conn.commit()

    def delete_setting(self, key: str) -> bool:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute("DELETE FROM settings WHERE key = ?", (key,))
            conn.commit()
            return cur.rowcount > 0

    # ------------------------------------------------------------------
    # Saved queries
    # ------------------------------------------------------------------

    def save_query(self, name: str, sql_text: str, description: str = "") -> int:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute(
                "INSERT INTO saved_queries (name, sql_text, description) VALUES (?, ?, ?)",
                (name, sql_text, description),
            )
            conn.commit()
            return cur.lastrowid

    def get_saved_queries(self) -> list[dict]:
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute("SELECT * FROM saved_queries ORDER BY updated_at DESC").fetchall()
            return [dict(r) for r in rows]

    def update_saved_query(self, query_id: int, name: str | None = None,
                           sql_text: str | None = None,
                           description: str | None = None) -> bool:
        updates = []
        params = []
        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if sql_text is not None:
            updates.append("sql_text = ?")
            params.append(sql_text)
        if description is not None:
            updates.append("description = ?")
            params.append(description)
        if not updates:
            return False
        updates.append("updated_at = datetime('now')")
        params.append(query_id)
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute(
                f"UPDATE saved_queries SET {', '.join(updates)} WHERE id = ?",
                tuple(params),
            )
            conn.commit()
            return cur.rowcount > 0

    def delete_saved_query(self, query_id: int) -> bool:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute("DELETE FROM saved_queries WHERE id = ?", (query_id,))
            conn.commit()
            return cur.rowcount > 0

    # ------------------------------------------------------------------
    # Databases
    # ------------------------------------------------------------------

    def add_database(self, path: str, name: str) -> None:
        with self._lock:
            conn = self._get_conn()
            conn.execute(
                "INSERT INTO databases (path, name, last_opened) VALUES (?, ?, datetime('now')) "
                "ON CONFLICT(path) DO UPDATE SET name = excluded.name, last_opened = datetime('now')",
                (path, name),
            )
            conn.commit()

    def get_databases(self, limit: int = 20) -> list[dict]:
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute(
                "SELECT * FROM databases ORDER BY last_opened DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]

    def remove_database(self, db_id: int) -> bool:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute("DELETE FROM databases WHERE id = ?", (db_id,))
            conn.commit()
            return cur.rowcount > 0

    # ------------------------------------------------------------------
    # Pipelines
    # ------------------------------------------------------------------

    def save_pipeline(self, name: str, description: str = "",
                      tags: str = "[]", definition: str = "{}") -> int:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute(
                "INSERT INTO df_pipelines (name, description, tags, definition) VALUES (?, ?, ?, ?)",
                (name, description, tags, definition),
            )
            conn.commit()
            return cur.lastrowid

    def get_pipelines(self) -> list[dict]:
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute(
                "SELECT * FROM df_pipelines ORDER BY updated_at DESC"
            ).fetchall()
            return [dict(r) for r in rows]

    def get_pipeline(self, pipeline_id: int) -> dict | None:
        with self._lock:
            conn = self._get_conn()
            row = conn.execute(
                "SELECT * FROM df_pipelines WHERE id = ?", (pipeline_id,)
            ).fetchone()
            return dict(row) if row else None

    def update_pipeline(self, pipeline_id: int, **kwargs) -> bool:
        allowed = {"name", "description", "starred", "tags", "definition"}
        updates = []
        params = []
        for key, value in kwargs.items():
            if key in allowed and value is not None:
                updates.append(f"{key} = ?")
                params.append(value)
        if not updates:
            return False
        updates.append("updated_at = datetime('now')")
        params.append(pipeline_id)
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute(
                f"UPDATE df_pipelines SET {', '.join(updates)} WHERE id = ?",
                tuple(params),
            )
            conn.commit()
            return cur.rowcount > 0

    def delete_pipeline(self, pipeline_id: int) -> bool:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute("DELETE FROM df_pipelines WHERE id = ?", (pipeline_id,))
            conn.commit()
            return cur.rowcount > 0

    # ------------------------------------------------------------------
    # DataFlow Connections
    # ------------------------------------------------------------------

    def add_df_connection(self, name: str, kind: str, encrypted: bool,
                          path: str) -> int:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute(
                "INSERT INTO df_connections (name, kind, encrypted, path) VALUES (?, ?, ?, ?)",
                (name, kind, int(encrypted), path),
            )
            conn.commit()
            return cur.lastrowid

    def get_df_connections(self) -> list[dict]:
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute(
                "SELECT * FROM df_connections ORDER BY name"
            ).fetchall()
            return [dict(r) for r in rows]

    def delete_df_connection(self, conn_id: int) -> bool:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute("DELETE FROM df_connections WHERE id = ?", (conn_id,))
            conn.commit()
            return cur.rowcount > 0

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------

    def create_run(self, pipeline_id: int, mode: str = "preview",
                   initiated_by: str = "user") -> int:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute(
                "INSERT INTO df_runs (pipeline_id, mode, initiated_by) VALUES (?, ?, ?)",
                (pipeline_id, mode, initiated_by),
            )
            conn.commit()
            return cur.lastrowid

    def update_run(self, run_id: int, **kwargs) -> bool:
        allowed = {"status", "finished_at", "duration_ms", "total_rows", "error"}
        updates = []
        params = []
        for key, value in kwargs.items():
            if key in allowed and value is not None:
                updates.append(f"{key} = ?")
                params.append(value)
        if not updates:
            return False
        params.append(run_id)
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute(
                f"UPDATE df_runs SET {', '.join(updates)} WHERE id = ?",
                tuple(params),
            )
            conn.commit()
            return cur.rowcount > 0

    def get_runs(self, pipeline_id: int, limit: int = 50) -> list[dict]:
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute(
                "SELECT * FROM df_runs WHERE pipeline_id = ? ORDER BY started_at DESC LIMIT ?",
                (pipeline_id, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def add_run_event(self, run_id: int, level: str, node_id: str | None,
                      message: str) -> int:
        with self._lock:
            conn = self._get_conn()
            cur = conn.execute(
                "INSERT INTO df_run_events (run_id, level, node_id, message) VALUES (?, ?, ?, ?)",
                (run_id, level, node_id, message),
            )
            conn.commit()
            return cur.lastrowid

    def get_run_events(self, run_id: int) -> list[dict]:
        with self._lock:
            conn = self._get_conn()
            rows = conn.execute(
                "SELECT * FROM df_run_events WHERE run_id = ? ORDER BY id",
                (run_id,),
            ).fetchall()
            return [dict(r) for r in rows]

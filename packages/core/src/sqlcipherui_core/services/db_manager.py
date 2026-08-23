"""Database connection manager for SQLite/SQLCipher databases."""

from __future__ import annotations

import asyncio
import logging
import os
import threading
from pathlib import Path

import sqlcipher3

from sqlcipherui_core.models.database import DatabaseInfo

logger = logging.getLogger(__name__)


class DatabaseManager:
    """Manages a single SQLite/SQLCipher database connection.

    All database operations run via asyncio.to_thread() to avoid
    blocking the event loop. A threading lock serializes access
    since sqlcipher3 connections are not thread-safe.
    """

    def __init__(self):
        self._conn: sqlcipher3.Connection | None = None
        self._db_path: Path | None = None
        self._is_encrypted: bool = False
        self._is_unlocked: bool = False
        self._lock = threading.Lock()
        self._row_cache: dict[str, dict] = {}

    @property
    def is_open(self) -> bool:
        return self._conn is not None

    @property
    def is_encrypted(self) -> bool:
        return self._is_encrypted

    @property
    def is_unlocked(self) -> bool:
        return self._is_unlocked

    @property
    def db_path(self) -> Path | None:
        return self._db_path

    def _get_conn(self) -> sqlcipher3.Connection:
        if self._conn is None:
            raise RuntimeError("No database connection open")
        return self._conn

    async def create(self, path: str, passphrase: str | None = None) -> DatabaseInfo:
        return await asyncio.to_thread(self._create_sync, path, passphrase)

    def _create_sync(self, path: str, passphrase: str | None = None) -> DatabaseInfo:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

            db_path = Path(path).expanduser().resolve()
            if db_path.exists():
                raise FileExistsError(f"File already exists: {db_path}")
            db_path.parent.mkdir(parents=True, exist_ok=True)

            self._db_path = db_path
            self._conn = sqlcipher3.connect(str(db_path), check_same_thread=False, isolation_level=None)

            if passphrase:
                self._conn.execute(self._key_pragma("PRAGMA key", passphrase))
                self._is_encrypted = True
            else:
                self._is_encrypted = False

            self._conn.execute("SELECT count(*) FROM sqlite_master")
            self._is_unlocked = True
            return self._build_info()

    async def open(self, path: str) -> DatabaseInfo:
        return await asyncio.to_thread(self._open_sync, path)

    def _open_sync(self, path: str) -> DatabaseInfo:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
                self._conn = None

            db_path = Path(path).expanduser().resolve()
            if not db_path.exists():
                raise FileNotFoundError(f"Database file not found: {db_path}")

            self._db_path = db_path
            self._conn = sqlcipher3.connect(str(db_path), check_same_thread=False, isolation_level=None)

            # Test if encrypted by trying to read sqlite_master
            try:
                self._conn.execute("SELECT count(*) FROM sqlite_master")
                self._is_encrypted = False
                self._is_unlocked = True
            except sqlcipher3.DatabaseError:
                self._is_encrypted = True
                self._is_unlocked = False

            return self._build_info()

    async def unlock(self, passphrase: str) -> bool:
        return await asyncio.to_thread(self._unlock_sync, passphrase)

    @staticmethod
    def _is_raw_hex_key(s: str) -> bool:
        stripped = s.strip()
        if stripped.startswith("x'") and stripped.endswith("'"):
            hex_part = stripped[2:-1]
            return len(hex_part) == 64 and all(c in '0123456789abcdefABCDEF' for c in hex_part)
        return False

    @staticmethod
    def _format_key(passphrase: str) -> str:
        """Return the key literal: either "x'hex'" for raw keys or 'passphrase'."""
        stripped = passphrase.strip()
        if DatabaseManager._is_raw_hex_key(stripped):
            hex_part = stripped[2:-1]
            return f"\"x'{hex_part}'\""
        safe = passphrase.replace("'", "''")
        return f"'{safe}'"

    @staticmethod
    def _key_pragma(prefix: str, passphrase: str) -> str:
        return f"{prefix} = {DatabaseManager._format_key(passphrase)}"

    def _unlock_sync(self, passphrase: str) -> bool:
        with self._lock:
            if self._conn is not None:
                self._conn.close()
            self._conn = sqlcipher3.connect(str(self._db_path), check_same_thread=False, isolation_level=None)
            conn = self._conn
            conn.execute(self._key_pragma("PRAGMA key", passphrase))
            try:
                conn.execute("SELECT count(*) FROM sqlite_master")
                self._is_unlocked = True
                return True
            except sqlcipher3.DatabaseError:
                self._is_unlocked = False
                return False

    async def rekey(self, new_passphrase: str) -> bool:
        return await asyncio.to_thread(self._rekey_sync, new_passphrase)

    def _rekey_sync(self, new_passphrase: str) -> bool:
        with self._lock:
            conn = self._get_conn()
            conn.execute(self._key_pragma("PRAGMA rekey", new_passphrase))
            try:
                conn.execute("SELECT count(*) FROM sqlite_master")
                return True
            except sqlcipher3.DatabaseError:
                return False

    async def verify_passphrase(self, passphrase: str) -> bool:
        return await asyncio.to_thread(self._verify_sync, passphrase)

    def _verify_sync(self, passphrase: str) -> bool:
        with self._lock:
            if not self._is_encrypted or not self._is_unlocked:
                return False
            try:
                test_conn = sqlcipher3.connect(str(self._db_path), check_same_thread=False, isolation_level=None)
                test_conn.execute(self._key_pragma("PRAGMA key", passphrase))
                test_conn.execute("SELECT count(*) FROM sqlite_master")
                test_conn.close()
                return True
            except sqlcipher3.DatabaseError:
                return False

    async def encrypt(self, passphrase: str) -> bool:
        """Encrypt a plain SQLite database using sqlcipher_export."""
        return await asyncio.to_thread(self._encrypt_sync, passphrase)

    def _encrypt_sync(self, passphrase: str) -> bool:
        import shutil
        import tempfile
        with self._lock:
            if self._is_encrypted:
                raise RuntimeError("Database is already encrypted")
            conn = self._get_conn()
            try:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except Exception:
                pass

            db_str = str(self._db_path)
            fd, tmp_path = tempfile.mkstemp(suffix=".db", dir=str(self._db_path.parent))
            os.close(fd)
            try:
                key_lit = self._format_key(passphrase)
                conn.execute(f"ATTACH DATABASE '{tmp_path}' AS encrypted KEY {key_lit}")
                conn.execute("SELECT sqlcipher_export('encrypted')")
                conn.execute("DETACH DATABASE encrypted")
                conn.close()
                self._conn = None

                backup = db_str + ".bak"
                shutil.copy2(db_str, backup)
                shutil.move(tmp_path, db_str)

                self._conn = sqlcipher3.connect(db_str, check_same_thread=False, isolation_level=None)
                self._conn.execute(self._key_pragma("PRAGMA key", passphrase))
                self._conn.execute("SELECT count(*) FROM sqlite_master")
                self._is_encrypted = True
                self._is_unlocked = True

                try:
                    os.remove(backup)
                except OSError:
                    pass
                return True
            except Exception:
                conn_new = sqlcipher3.connect(db_str, check_same_thread=False, isolation_level=None)
                self._conn = conn_new
                self._is_encrypted = False
                self._is_unlocked = True
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
                raise

    async def decrypt(self, passphrase: str) -> bool:
        """Decrypt a SQLCipher database to plain SQLite."""
        return await asyncio.to_thread(self._decrypt_sync, passphrase)

    def _decrypt_sync(self, passphrase: str) -> bool:
        import shutil
        import tempfile
        with self._lock:
            if not self._is_encrypted or not self._is_unlocked:
                raise RuntimeError("Database must be encrypted and unlocked to decrypt")
            conn = self._get_conn()
            try:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except Exception:
                pass

            db_str = str(self._db_path)
            fd, tmp_path = tempfile.mkstemp(suffix=".db", dir=str(self._db_path.parent))
            os.close(fd)
            try:
                conn.execute(f"ATTACH DATABASE '{tmp_path}' AS plaintext KEY ''")
                conn.execute("SELECT sqlcipher_export('plaintext')")
                conn.execute("DETACH DATABASE plaintext")
                conn.close()
                self._conn = None

                backup = db_str + ".bak"
                shutil.copy2(db_str, backup)
                shutil.move(tmp_path, db_str)

                self._conn = sqlcipher3.connect(db_str, check_same_thread=False, isolation_level=None)
                self._conn.execute("SELECT count(*) FROM sqlite_master")
                self._is_encrypted = False
                self._is_unlocked = True

                try:
                    os.remove(backup)
                except OSError:
                    pass
                return True
            except Exception:
                if self._conn is None or self._conn is conn:
                    self._conn = sqlcipher3.connect(db_str, check_same_thread=False, isolation_level=None)
                    self._conn.execute(self._key_pragma("PRAGMA key", passphrase))
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass
                raise

    async def close(self) -> None:
        await asyncio.to_thread(self._close_sync)

    def _close_sync(self) -> None:
        with self._lock:
            if self._conn is not None:
                try:
                    self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                except Exception:
                    pass
                self._conn.close()
                self._conn = None
            self._db_path = None
            self._is_encrypted = False
            self._is_unlocked = False

    async def execute(self, sql: str, params: tuple | None = None) -> list:
        return await asyncio.to_thread(self._execute_sync, sql, params)

    def _execute_sync(self, sql: str, params: tuple | None = None) -> list:
        with self._lock:
            conn = self._get_conn()
            cursor = conn.execute(sql, params or ())
            return cursor.fetchall()

    async def execute_dicts(self, sql: str, params: tuple | None = None) -> list[dict]:
        return await asyncio.to_thread(self._execute_dicts_sync, sql, params)

    def _execute_dicts_sync(self, sql: str, params: tuple | None = None) -> list[dict]:
        with self._lock:
            conn = self._get_conn()
            cursor = conn.execute(sql, params or ())
            cols = [d[0] for d in cursor.description] if cursor.description else []
            return [dict(zip(cols, row)) for row in cursor.fetchall()]

    async def execute_modify(self, sql: str, params: tuple | None = None) -> int:
        return await asyncio.to_thread(self._execute_modify_sync, sql, params)

    def _execute_modify_sync(self, sql: str, params: tuple | None = None) -> int:
        with self._lock:
            conn = self._get_conn()
            cursor = conn.execute(sql, params or ())
            conn.commit()
            self._row_cache.clear()
            return cursor.rowcount

    def get_row_cache(self, key: str) -> dict | None:
        return self._row_cache.get(key)

    def set_row_cache(self, key: str, data: dict) -> None:
        self._row_cache[key] = data

    def invalidate_row_cache(self, table: str | None = None) -> None:
        """Clear cached rows. If table given, only entries whose key starts with that table name."""
        if table is None:
            self._row_cache.clear()
        else:
            self._row_cache = {k: v for k, v in self._row_cache.items() if not k.startswith(table + "|")}

    async def get_info(self) -> DatabaseInfo:
        return await asyncio.to_thread(self._build_info)

    def _build_info(self) -> DatabaseInfo:
        info = DatabaseInfo(
            path=str(self._db_path) if self._db_path else None,
            name=self._db_path.name if self._db_path else None,
            encrypted=self._is_encrypted,
            unlocked=self._is_unlocked,
        )

        if self._conn and self._is_unlocked:
            try:
                size = os.path.getsize(str(self._db_path))
                info.size_bytes = size

                row = self._conn.execute("PRAGMA journal_mode").fetchone()
                if row:
                    info.journal_mode = row[0]

                row = self._conn.execute("PRAGMA page_size").fetchone()
                if row:
                    info.page_size = row[0]

                row = self._conn.execute("PRAGMA page_count").fetchone()
                if row:
                    info.page_count = row[0]

                row = self._conn.execute("PRAGMA freelist_count").fetchone()
                if row:
                    info.freelist_count = row[0]

                tables = self._conn.execute(
                    "SELECT count(*) FROM sqlite_master WHERE type='table'"
                ).fetchone()
                if tables:
                    info.table_count = tables[0]

            except Exception as e:
                logger.warning(f"Failed to gather database info: {e}")

        return info

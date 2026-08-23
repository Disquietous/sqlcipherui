"""Multi-connection manager wrapping multiple DatabaseManager instances."""

from __future__ import annotations

import logging
from pathlib import Path

from sqlcipherui_core.models.database import DatabaseInfo
from sqlcipherui_core.services.db_manager import DatabaseManager

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages multiple simultaneous database connections.

    Each connection is identified by its resolved absolute path string.
    """

    def __init__(self):
        self._connections: dict[str, DatabaseManager] = {}

    async def create(self, path: str, passphrase: str | None = None) -> tuple[str, DatabaseInfo]:
        """Create a new database, returning (conn_id, info)."""
        conn_id = str(Path(path).expanduser().resolve())

        if conn_id in self._connections:
            raise FileExistsError(f"Database already open: {conn_id}")

        mgr = DatabaseManager()
        info = await mgr.create(path, passphrase)
        self._connections[conn_id] = mgr
        return conn_id, info

    async def open(self, path: str) -> tuple[str, DatabaseInfo]:
        """Open a database, returning (conn_id, info).

        If the resolved path is already open, returns the existing connection info.
        """
        conn_id = str(Path(path).expanduser().resolve())

        if conn_id in self._connections:
            info = await self._connections[conn_id].get_info()
            return conn_id, info

        mgr = DatabaseManager()
        info = await mgr.open(path)
        self._connections[conn_id] = mgr
        return conn_id, info

    async def close(self, conn_id: str) -> None:
        """Close and remove a connection by its ID."""
        mgr = self._connections.pop(conn_id, None)
        if mgr is not None:
            await mgr.close()

    def get(self, conn_id: str) -> DatabaseManager:
        """Return the DatabaseManager for a connection ID, or raise."""
        mgr = self._connections.get(conn_id)
        if mgr is None:
            raise KeyError(f"No open connection with id: {conn_id}")
        return mgr

    async def unlock(self, conn_id: str, passphrase: str) -> bool:
        """Unlock a specific connection."""
        mgr = self.get(conn_id)
        return await mgr.unlock(passphrase)

    async def list_connections(self) -> list[DatabaseInfo]:
        """Return DatabaseInfo for every open connection."""
        results = []
        for mgr in self._connections.values():
            info = await mgr.get_info()
            results.append(info)
        return results

    async def close_all(self) -> None:
        """Close every open connection (for shutdown)."""
        for mgr in list(self._connections.values()):
            try:
                await mgr.close()
            except Exception as e:
                logger.warning(f"Error closing connection: {e}")
        self._connections.clear()

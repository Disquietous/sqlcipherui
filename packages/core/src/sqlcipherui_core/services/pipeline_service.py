"""Pipeline management service for data flows."""

from __future__ import annotations

import asyncio
import json
import logging

from sqlcipherui_core.services.app_db import AppDatabase

logger = logging.getLogger(__name__)


class PipelineService:
    """Async wrapper around AppDatabase pipeline, connection, and run methods."""

    def __init__(self, app_db: AppDatabase) -> None:
        self._app_db = app_db

    # ------------------------------------------------------------------
    # Pipelines
    # ------------------------------------------------------------------

    async def list_pipelines(self) -> list[dict]:
        return await asyncio.to_thread(self._app_db.get_pipelines)

    async def get_pipeline(self, pipeline_id: int) -> dict | None:
        return await asyncio.to_thread(self._app_db.get_pipeline, pipeline_id)

    async def create_pipeline(self, name: str, description: str = "",
                              tags: list | None = None,
                              definition: dict | None = None) -> dict:
        tags_json = json.dumps(tags if tags is not None else [])
        def_json = json.dumps(definition if definition is not None else {})
        row_id = await asyncio.to_thread(
            self._app_db.save_pipeline, name, description, tags_json, def_json,
        )
        return await asyncio.to_thread(self._app_db.get_pipeline, row_id)

    async def update_pipeline(self, pipeline_id: int, **kwargs) -> bool:
        if "tags" in kwargs and kwargs["tags"] is not None:
            kwargs["tags"] = json.dumps(kwargs["tags"])
        if "definition" in kwargs and kwargs["definition"] is not None:
            kwargs["definition"] = json.dumps(kwargs["definition"])
        return await asyncio.to_thread(
            self._app_db.update_pipeline, pipeline_id, **kwargs,
        )

    async def delete_pipeline(self, pipeline_id: int) -> bool:
        return await asyncio.to_thread(self._app_db.delete_pipeline, pipeline_id)

    async def duplicate_pipeline(self, pipeline_id: int, new_name: str) -> dict:
        original = await asyncio.to_thread(self._app_db.get_pipeline, pipeline_id)
        if original is None:
            raise ValueError(f"Pipeline {pipeline_id} not found")
        row_id = await asyncio.to_thread(
            self._app_db.save_pipeline,
            new_name,
            original.get("description", ""),
            original.get("tags", "[]"),
            original.get("definition", "{}"),
        )
        return await asyncio.to_thread(self._app_db.get_pipeline, row_id)

    # ------------------------------------------------------------------
    # Connections
    # ------------------------------------------------------------------

    async def list_connections(self) -> list[dict]:
        return await asyncio.to_thread(self._app_db.get_df_connections)

    async def create_connection(self, name: str, kind: str,
                                encrypted: bool = False,
                                path: str = "") -> dict:
        row_id = await asyncio.to_thread(
            self._app_db.add_df_connection, name, kind, encrypted, path,
        )
        conns = await asyncio.to_thread(self._app_db.get_df_connections)
        return next((c for c in conns if c["id"] == row_id), {"id": row_id})

    async def delete_connection(self, conn_id: int) -> bool:
        return await asyncio.to_thread(self._app_db.delete_df_connection, conn_id)

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------

    async def get_run_history(self, pipeline_id: int, limit: int = 50) -> list[dict]:
        return await asyncio.to_thread(self._app_db.get_runs, pipeline_id, limit)

    async def get_run_events(self, run_id: int) -> list[dict]:
        return await asyncio.to_thread(self._app_db.get_run_events, run_id)

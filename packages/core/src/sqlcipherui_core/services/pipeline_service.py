"""Pipeline management service for data flows."""

from __future__ import annotations

import asyncio
import json
import logging

from sqlcipherui_core.services.app_db import AppDatabase

logger = logging.getLogger(__name__)

_LAST_RUN_FIELDS = ("status", "started_at", "duration_ms", "total_rows")


def _parse_json(raw, default):
    """Parse a JSON column value; tolerate already-parsed objects and bad data."""
    if raw is None:
        return default
    if not isinstance(raw, str):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def parse_pipeline_row(row: dict | None) -> dict | None:
    """Return a copy of a df_pipelines row with `definition`/`tags` parsed."""
    if row is None:
        return None
    out = dict(row)
    out["tags"] = _parse_json(out.get("tags"), [])
    out["definition"] = _parse_json(out.get("definition"), {})
    if not isinstance(out["definition"], dict):
        out["definition"] = {}
    out["starred"] = bool(out.get("starred", 0))
    out["schedule"] = out.get("schedule") or ""
    out["schedule_enabled"] = bool(out.get("schedule_enabled", 0))
    out.setdefault("last_scheduled_at", None)
    return out


class PipelineService:
    """Async wrapper around AppDatabase pipeline, connection, and run methods."""

    def __init__(self, app_db: AppDatabase) -> None:
        self._app_db = app_db

    # ------------------------------------------------------------------
    # Pipelines
    # ------------------------------------------------------------------

    async def list_pipelines(self) -> list[dict]:
        rows, latest = await asyncio.gather(
            asyncio.to_thread(self._app_db.get_pipelines),
            asyncio.to_thread(self._app_db.get_latest_runs),
        )
        result = []
        for row in rows:
            item = parse_pipeline_row(row)
            item["node_count"] = len(item["definition"].get("nodes") or [])
            run = latest.get(item["id"])
            item["last_run"] = {k: run.get(k) for k in _LAST_RUN_FIELDS} if run else None
            result.append(item)
        return result

    async def get_pipeline(self, pipeline_id: int) -> dict | None:
        row = await asyncio.to_thread(self._app_db.get_pipeline, pipeline_id)
        return parse_pipeline_row(row)

    async def create_pipeline(
        self,
        name: str,
        description: str = "",
        tags: list | None = None,
        definition: dict | None = None,
    ) -> dict:
        tags_json = json.dumps(tags if tags is not None else [])
        def_json = json.dumps(definition if definition is not None else {})
        row_id = await asyncio.to_thread(
            self._app_db.save_pipeline, name, description, tags_json, def_json
        )
        return await self.get_pipeline(row_id)

    async def update_pipeline(self, pipeline_id: int, **kwargs) -> bool:
        if "tags" in kwargs and kwargs["tags"] is not None:
            kwargs["tags"] = json.dumps(kwargs["tags"])
        if "definition" in kwargs and kwargs["definition"] is not None:
            kwargs["definition"] = json.dumps(kwargs["definition"])
        return await asyncio.to_thread(self._app_db.update_pipeline, pipeline_id, **kwargs)

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
        return await self.get_pipeline(row_id)

    async def get_scheduled_pipelines(self) -> list[dict]:
        rows = await asyncio.to_thread(self._app_db.get_scheduled_pipelines)
        return [parse_pipeline_row(r) for r in rows]

    # ------------------------------------------------------------------
    # Connections
    # ------------------------------------------------------------------

    async def list_connections(self) -> list[dict]:
        return await asyncio.to_thread(self._app_db.get_df_connections)

    async def get_connection(self, conn_id: int) -> dict | None:
        return await asyncio.to_thread(self._app_db.get_df_connection, conn_id)

    async def create_connection(
        self, name: str, kind: str, encrypted: bool = False, path: str = ""
    ) -> dict:
        row_id = await asyncio.to_thread(
            self._app_db.add_df_connection, name, kind, encrypted, path
        )
        row = await asyncio.to_thread(self._app_db.get_df_connection, row_id)
        return row or {"id": row_id}

    async def update_connection(self, conn_id: int, **kwargs) -> bool:
        return await asyncio.to_thread(self._app_db.update_df_connection, conn_id, **kwargs)

    async def delete_connection(self, conn_id: int) -> bool:
        return await asyncio.to_thread(self._app_db.delete_df_connection, conn_id)

    # ------------------------------------------------------------------
    # Runs
    # ------------------------------------------------------------------

    async def get_run_history(self, pipeline_id: int, limit: int = 50) -> list[dict]:
        return await asyncio.to_thread(self._app_db.get_runs, pipeline_id, limit)

    async def get_run(self, run_id: int) -> dict | None:
        return await asyncio.to_thread(self._app_db.get_run, run_id)

    async def get_run_events(self, run_id: int) -> list[dict]:
        return await asyncio.to_thread(self._app_db.get_run_events, run_id)

    async def prune_runs(self, pipeline_id: int, keep: int = 200) -> int:
        return await asyncio.to_thread(self._app_db.prune_runs, pipeline_id, keep)

    async def get_stats(self, days: int = 7) -> dict:
        return await asyncio.to_thread(self._app_db.get_df_stats, days)

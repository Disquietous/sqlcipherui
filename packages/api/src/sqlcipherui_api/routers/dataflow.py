"""Endpoints for the Data Flows feature: pipelines, connections, templates, runs."""

from __future__ import annotations

import asyncio
import json
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from sqlcipherui_api.dependencies import AppDbDep, ConnManagerDep
from sqlcipherui_core.models.dataflow import (
    PipelineCreate,
    PipelineUpdate,
    RunRequest,
    NodePreviewRequest,
)
from sqlcipherui_core.services.pipeline_service import PipelineService
from sqlcipherui_core.services.pipeline_templates import PIPELINE_TEMPLATES
from sqlcipherui_core.services.pipeline_executor import PipelineExecutor

router = APIRouter()


# ------------------------------------------------------------------
# Pipeline CRUD
# ------------------------------------------------------------------

@router.get("/pipelines")
async def list_pipelines(app_db: AppDbDep):
    svc = PipelineService(app_db)
    return await svc.list_pipelines()


@router.get("/pipelines/{pipeline_id}")
async def get_pipeline(pipeline_id: int, app_db: AppDbDep):
    svc = PipelineService(app_db)
    result = await svc.get_pipeline(pipeline_id)
    if not result:
        raise HTTPException(404, "Pipeline not found")
    return result


@router.post("/pipelines")
async def create_pipeline(body: PipelineCreate, app_db: AppDbDep):
    svc = PipelineService(app_db)
    return await svc.create_pipeline(
        name=body.name,
        description=body.description,
        tags=body.tags,
        definition=body.definition.model_dump() if body.definition else None,
    )


@router.put("/pipelines/{pipeline_id}")
async def update_pipeline(pipeline_id: int, body: PipelineUpdate, app_db: AppDbDep):
    svc = PipelineService(app_db)
    kwargs = body.model_dump(exclude_none=True)
    if "definition" in kwargs:
        kwargs["definition"] = body.definition.model_dump()
    ok = await svc.update_pipeline(pipeline_id, **kwargs)
    if not ok:
        raise HTTPException(404, "Pipeline not found")
    return await svc.get_pipeline(pipeline_id)


@router.delete("/pipelines/{pipeline_id}")
async def delete_pipeline(pipeline_id: int, app_db: AppDbDep):
    svc = PipelineService(app_db)
    ok = await svc.delete_pipeline(pipeline_id)
    if not ok:
        raise HTTPException(404, "Pipeline not found")
    return {"ok": True}


@router.post("/pipelines/{pipeline_id}/duplicate")
async def duplicate_pipeline(pipeline_id: int, body: dict, app_db: AppDbDep):
    svc = PipelineService(app_db)
    try:
        return await svc.duplicate_pipeline(pipeline_id, body.get("name", "Copy"))
    except ValueError:
        raise HTTPException(404, "Pipeline not found")


# ------------------------------------------------------------------
# Connections
# ------------------------------------------------------------------

@router.get("/connections")
async def list_connections(app_db: AppDbDep):
    svc = PipelineService(app_db)
    return await svc.list_connections()


@router.post("/connections")
async def create_connection(body: dict, app_db: AppDbDep):
    svc = PipelineService(app_db)
    return await svc.create_connection(**body)


@router.delete("/connections/{conn_id}")
async def delete_connection(conn_id: int, app_db: AppDbDep):
    svc = PipelineService(app_db)
    ok = await svc.delete_connection(conn_id)
    if not ok:
        raise HTTPException(404)
    return {"ok": True}


# ------------------------------------------------------------------
# Templates
# ------------------------------------------------------------------

@router.get("/templates")
async def list_templates():
    return PIPELINE_TEMPLATES


# ------------------------------------------------------------------
# Pipeline execution
# ------------------------------------------------------------------

def _parse_definition(raw) -> dict:
    """Parse pipeline definition from DB (may be JSON string or dict)."""
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


@router.post("/pipelines/{pipeline_id}/run")
async def run_pipeline(pipeline_id: int, body: RunRequest, app_db: AppDbDep, conn_mgr: ConnManagerDep):
    svc = PipelineService(app_db)
    pipeline = await svc.get_pipeline(pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")

    definition = _parse_definition(pipeline["definition"])
    executor = PipelineExecutor(conn_mgr, app_db)

    result = await executor.run(
        pipeline_id=pipeline_id,
        definition=definition,
        mode=body.mode.value,
        sample_size=5,
    )
    return result


@router.post("/pipelines/{pipeline_id}/run-stream")
async def run_pipeline_stream(pipeline_id: int, body: RunRequest, app_db: AppDbDep, conn_mgr: ConnManagerDep):
    svc = PipelineService(app_db)
    pipeline = await svc.get_pipeline(pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")

    definition = _parse_definition(pipeline["definition"])

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

        def on_event(event):
            queue.put_nowait(event)

        def on_progress(node_id, in_rows, out_rows):
            queue.put_nowait({
                "type": "progress",
                "node_id": node_id,
                "in_rows": in_rows,
                "out_rows": out_rows,
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
            })

        executor = PipelineExecutor(conn_mgr, app_db)

        async def do_run():
            try:
                result = await executor.run(
                    pipeline_id=pipeline_id,
                    definition=definition,
                    mode=body.mode.value,
                    on_event=on_event,
                    on_progress=on_progress,
                    sample_size=5,
                )
                queue.put_nowait({"type": "done", "result": result})
            except Exception as exc:
                queue.put_nowait({"type": "error", "message": str(exc)})
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(do_run())

        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            if not task.done():
                task.cancel()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/pipelines/{pipeline_id}/preview-node")
async def preview_node(pipeline_id: int, body: NodePreviewRequest, app_db: AppDbDep, conn_mgr: ConnManagerDep):
    svc = PipelineService(app_db)
    pipeline = await svc.get_pipeline(pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")

    definition = _parse_definition(pipeline["definition"])
    executor = PipelineExecutor(conn_mgr, app_db)

    try:
        rows = await executor.preview_node(
            definition=definition,
            node_id=body.node_id,
            sample_size=body.sample_size,
            pipeline_id=pipeline_id,
        )
        columns = list(rows[0].keys()) if rows else []
        return {"columns": columns, "rows": rows}
    except Exception as exc:
        return {"columns": [], "rows": [], "error": str(exc)}


@router.post("/pipelines/{pipeline_id}/validate")
async def validate_pipeline(pipeline_id: int, app_db: AppDbDep, conn_mgr: ConnManagerDep):
    svc = PipelineService(app_db)
    pipeline = await svc.get_pipeline(pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")

    definition = _parse_definition(pipeline["definition"])
    executor = PipelineExecutor(conn_mgr, app_db)

    try:
        issues = await executor.validate(definition)
        return {"issues": issues}
    except Exception as exc:
        return {"issues": [{"level": "error", "message": str(exc)}]}


# ------------------------------------------------------------------
# Run history
# ------------------------------------------------------------------

@router.get("/pipelines/{pipeline_id}/runs")
async def get_runs(pipeline_id: int, app_db: AppDbDep):
    svc = PipelineService(app_db)
    return await svc.get_run_history(pipeline_id)


@router.get("/runs/{run_id}/events")
async def get_run_events(run_id: int, app_db: AppDbDep):
    svc = PipelineService(app_db)
    return await svc.get_run_events(run_id)

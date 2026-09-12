"""Endpoints for the Data Flows feature: pipelines, connections, templates, runs."""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from sqlcipherui_api.dependencies import AppDbDep, ConnManagerDep
from sqlcipherui_core.models.dataflow import PipelineCreate
from sqlcipherui_core.services import pipeline_executor
from sqlcipherui_core.services.pipeline_executor import PipelineExecutor
from sqlcipherui_core.services.pipeline_service import PipelineService
from sqlcipherui_core.services.pipeline_templates import PIPELINE_TEMPLATES

logger = logging.getLogger(__name__)

router = APIRouter()

RUN_HISTORY_KEEP = 200

# Strong references to in-flight streaming run tasks so they are not garbage collected
# when a client disconnects before the executor has finished cancelling.
_background_tasks: set[asyncio.Task] = set()


# ------------------------------------------------------------------
# Request bodies (kept local so this router does not depend on model changes)
# ------------------------------------------------------------------


class PipelineUpdateBody(BaseModel):
    name: str | None = None
    description: str | None = None
    starred: bool | None = None
    tags: list[str] | None = None
    definition: dict | None = None
    schedule: str | None = None
    schedule_enabled: bool | None = None


class DuplicateBody(BaseModel):
    name: str = "Copy"


class DataFlowConnectionCreate(BaseModel):
    name: str
    kind: str = "sqlite"
    encrypted: bool = False
    path: str


class DataFlowConnectionUpdate(BaseModel):
    name: str | None = None
    kind: str | None = None
    encrypted: bool | None = None
    path: str | None = None


class RunRequestBody(BaseModel):
    mode: str = "preview"
    transactional: bool = True
    streaming_counters: bool = True


class NodePreviewBody(BaseModel):
    node_id: str
    sample_size: int = Field(default=5, ge=1, le=1000)


class SchemaRequest(BaseModel):
    sample_size: int = Field(default=20, ge=1, le=1000)


_VALID_MODES = {"preview", "dry", "full"}


def _check_mode(mode: str) -> str:
    if mode not in _VALID_MODES:
        raise HTTPException(422, f"mode must be one of {sorted(_VALID_MODES)}")
    return mode


async def _load_pipeline(svc: PipelineService, pipeline_id: int) -> dict:
    pipeline = await svc.get_pipeline(pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")
    return pipeline


# ------------------------------------------------------------------
# Pipeline CRUD
# ------------------------------------------------------------------


@router.get("/pipelines")
async def list_pipelines(app_db: AppDbDep):
    return await PipelineService(app_db).list_pipelines()


@router.get("/pipelines/{pipeline_id}")
async def get_pipeline(pipeline_id: int, app_db: AppDbDep):
    return await _load_pipeline(PipelineService(app_db), pipeline_id)


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
async def update_pipeline(pipeline_id: int, body: PipelineUpdateBody, app_db: AppDbDep):
    svc = PipelineService(app_db)
    await _load_pipeline(svc, pipeline_id)
    kwargs = body.model_dump(exclude_none=True)
    if kwargs:
        await svc.update_pipeline(pipeline_id, **kwargs)
    return await _load_pipeline(svc, pipeline_id)


@router.delete("/pipelines/{pipeline_id}")
async def delete_pipeline(pipeline_id: int, app_db: AppDbDep):
    ok = await PipelineService(app_db).delete_pipeline(pipeline_id)
    if not ok:
        raise HTTPException(404, "Pipeline not found")
    return {"ok": True}


@router.post("/pipelines/{pipeline_id}/duplicate")
async def duplicate_pipeline(pipeline_id: int, body: DuplicateBody, app_db: AppDbDep):
    try:
        return await PipelineService(app_db).duplicate_pipeline(pipeline_id, body.name)
    except ValueError:
        raise HTTPException(404, "Pipeline not found") from None


# ------------------------------------------------------------------
# Connections
# ------------------------------------------------------------------


@router.get("/connections")
async def list_connections(app_db: AppDbDep):
    return await PipelineService(app_db).list_connections()


@router.post("/connections")
async def create_connection(body: DataFlowConnectionCreate, app_db: AppDbDep):
    return await PipelineService(app_db).create_connection(**body.model_dump())


@router.put("/connections/{conn_id}")
async def update_connection(conn_id: int, body: DataFlowConnectionUpdate, app_db: AppDbDep):
    svc = PipelineService(app_db)
    current = await svc.get_connection(conn_id)
    if current is None:
        raise HTTPException(404, "Connection not found")
    kwargs = body.model_dump(exclude_none=True)
    if kwargs:
        await svc.update_connection(conn_id, **kwargs)
    return await svc.get_connection(conn_id)


@router.delete("/connections/{conn_id}")
async def delete_connection(conn_id: int, app_db: AppDbDep):
    ok = await PipelineService(app_db).delete_connection(conn_id)
    if not ok:
        raise HTTPException(404, "Connection not found")
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


@router.post("/pipelines/{pipeline_id}/run")
async def run_pipeline(
    pipeline_id: int, body: RunRequestBody, app_db: AppDbDep, conn_mgr: ConnManagerDep
):
    svc = PipelineService(app_db)
    pipeline = await _load_pipeline(svc, pipeline_id)
    mode = _check_mode(body.mode)
    executor = PipelineExecutor(conn_mgr, app_db)
    result = await executor.run(
        pipeline_id,
        pipeline["definition"],
        mode,
        sample_size=5,
        transactional=body.transactional,
        initiated_by="user",
    )
    if mode == "full":
        await svc.prune_runs(pipeline_id, keep=RUN_HISTORY_KEEP)
    return result


@router.post("/pipelines/{pipeline_id}/run-stream")
async def run_pipeline_stream(
    pipeline_id: int, body: RunRequestBody, app_db: AppDbDep, conn_mgr: ConnManagerDep
):
    svc = PipelineService(app_db)
    pipeline = await _load_pipeline(svc, pipeline_id)
    mode = _check_mode(body.mode)
    definition = pipeline["definition"]
    loop = asyncio.get_running_loop()

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        run_id: int | None = None

        def on_event(event: dict):
            # Executor callbacks may fire from worker threads; hop back onto the loop.
            loop.call_soon_threadsafe(queue.put_nowait, event)

        executor = PipelineExecutor(conn_mgr, app_db)

        async def do_run():
            try:
                result = await executor.run(
                    pipeline_id,
                    definition,
                    mode,
                    on_event=on_event,
                    sample_size=5,
                    transactional=body.transactional,
                    initiated_by="user",
                )
                if mode == "full":
                    await svc.prune_runs(pipeline_id, keep=RUN_HISTORY_KEEP)
                queue.put_nowait({"type": "done", "result": result})
            except asyncio.CancelledError:
                queue.put_nowait({"type": "error", "message": "Run cancelled"})
                raise
            except Exception as exc:
                logger.exception("Streaming run of pipeline %s failed", pipeline_id)
                queue.put_nowait({"type": "error", "message": str(exc)})
            finally:
                queue.put_nowait(None)

        task = asyncio.create_task(do_run())
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

        try:
            while True:
                event = await queue.get()
                if event is None:
                    break
                if run_id is None and isinstance(event, dict) and "run_id" in event:
                    run_id = event["run_id"]
                yield f"data: {json.dumps(event, default=str)}\n\n"
        finally:
            if not task.done():
                # Client went away: ask the executor to stop, then let it wind down.
                if run_id is not None:
                    pipeline_executor.cancel_run(run_id)
                else:
                    task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: int):
    return {"ok": bool(pipeline_executor.cancel_run(run_id))}


@router.post("/pipelines/{pipeline_id}/preview-node")
async def preview_node(
    pipeline_id: int, body: NodePreviewBody, app_db: AppDbDep, conn_mgr: ConnManagerDep
):
    pipeline = await _load_pipeline(PipelineService(app_db), pipeline_id)
    executor = PipelineExecutor(conn_mgr, app_db)
    try:
        return await executor.preview_node(
            pipeline_id, pipeline["definition"], body.node_id, body.sample_size
        )
    except Exception as exc:
        return {"columns": [], "rows": [], "error": str(exc)}


@router.post("/pipelines/{pipeline_id}/schema")
async def infer_schema(
    pipeline_id: int,
    app_db: AppDbDep,
    conn_mgr: ConnManagerDep,
    body: SchemaRequest | None = None,
):
    pipeline = await _load_pipeline(PipelineService(app_db), pipeline_id)
    sample_size = body.sample_size if body else 20
    executor = PipelineExecutor(conn_mgr, app_db)
    return await executor.infer_schema(pipeline_id, pipeline["definition"], sample_size)


@router.post("/pipelines/{pipeline_id}/validate")
async def validate_pipeline(pipeline_id: int, app_db: AppDbDep, conn_mgr: ConnManagerDep):
    pipeline = await _load_pipeline(PipelineService(app_db), pipeline_id)
    executor = PipelineExecutor(conn_mgr, app_db)
    try:
        return {"issues": await executor.validate(pipeline["definition"])}
    except Exception as exc:
        return {"issues": [{"node_id": None, "level": "error", "message": str(exc)}]}


# ------------------------------------------------------------------
# Run history and stats
# ------------------------------------------------------------------


@router.get("/pipelines/{pipeline_id}/runs")
async def get_runs(pipeline_id: int, app_db: AppDbDep, limit: int = Query(50, ge=1, le=1000)):
    return await PipelineService(app_db).get_run_history(pipeline_id, limit)


@router.get("/runs/{run_id}")
async def get_run(run_id: int, app_db: AppDbDep):
    run = await PipelineService(app_db).get_run(run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return run


@router.get("/runs/{run_id}/events")
async def get_run_events(run_id: int, app_db: AppDbDep):
    return await PipelineService(app_db).get_run_events(run_id)


@router.get("/stats")
async def get_stats(app_db: AppDbDep):
    return await PipelineService(app_db).get_stats(7)

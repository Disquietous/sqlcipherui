"""Background scheduler that fires cron-scheduled Data Flow pipelines."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime

from sqlcipherui_core.services.app_db import AppDatabase
from sqlcipherui_core.services.connection_manager import ConnectionManager
from sqlcipherui_core.services.cron import cron_matches
from sqlcipherui_core.services.pipeline_executor import PipelineExecutor
from sqlcipherui_core.services.pipeline_service import PipelineService

logger = logging.getLogger(__name__)

POLL_SECONDS = 30
_MINUTE_FMT = "%Y-%m-%dT%H:%M"


async def _run_scheduled(
    app_db: AppDatabase, conn_mgr: ConnectionManager, pipeline: dict, minute: str
) -> None:
    svc = PipelineService(app_db)
    # Claim the slot first so a slow run cannot be double-fired by the next tick.
    await svc.update_pipeline(pipeline["id"], last_scheduled_at=minute)
    logger.info("Scheduler firing pipeline %s (%s)", pipeline["id"], pipeline["name"])
    executor = PipelineExecutor(conn_mgr, app_db)
    result = await executor.run(
        pipeline["id"], pipeline["definition"], "full", initiated_by="schedule"
    )
    await svc.prune_runs(pipeline["id"], keep=200)
    logger.info("Scheduled pipeline %s finished: %s", pipeline["id"], result.get("status"))


async def scheduler_tick(app_db: AppDatabase, conn_mgr: ConnectionManager, now: datetime) -> int:
    """Run every pipeline due at *now*. Returns the number of pipelines fired."""
    svc = PipelineService(app_db)
    minute = now.strftime(_MINUTE_FMT)
    fired = 0
    for pipeline in await svc.get_scheduled_pipelines():
        try:
            if pipeline.get("last_scheduled_at") == minute:
                continue
            if not cron_matches(pipeline["schedule"], now):
                continue
            await _run_scheduled(app_db, conn_mgr, pipeline, minute)
            fired += 1
        except Exception:
            logger.exception("Scheduled run of pipeline %s failed", pipeline.get("id"))
    return fired


async def scheduler_loop(
    get_app_db: Callable[[], Awaitable[AppDatabase]],
    get_conn_mgr: Callable[[], Awaitable[ConnectionManager]],
    stop_event: asyncio.Event,
) -> None:
    """Poll every POLL_SECONDS until *stop_event* is set; never raises."""
    logger.info("Pipeline scheduler started")
    while not stop_event.is_set():
        try:
            app_db = await get_app_db()
            conn_mgr = await get_conn_mgr()
            await scheduler_tick(app_db, conn_mgr, datetime.now(UTC))
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Scheduler tick failed")
        try:
            await asyncio.wait_for(stop_event.wait(), timeout=POLL_SECONDS)
        except TimeoutError:
            pass
    logger.info("Pipeline scheduler stopped")


__all__ = ["POLL_SECONDS", "scheduler_loop", "scheduler_tick"]

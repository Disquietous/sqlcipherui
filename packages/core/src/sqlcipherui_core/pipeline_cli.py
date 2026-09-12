"""Command-line runner for Data Flow pipelines.

Installed as ``sqlcipherui-pipeline``. Uses the same application database as the
API server (platformdirs user data dir, overridable with ``SQLCIPHERUI_DATA_DIR``).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

import platformdirs

from sqlcipherui_core.services.app_db import AppDatabase
from sqlcipherui_core.services.connection_manager import ConnectionManager
from sqlcipherui_core.services.pipeline_executor import PipelineExecutor
from sqlcipherui_core.services.pipeline_service import PipelineService

_MODES = ("full", "dry", "preview")


def default_data_dir() -> Path:
    """Mirror the API's Settings.data_dir resolution."""
    env = os.environ.get("SQLCIPHERUI_DATA_DIR")
    if env:
        return Path(env).expanduser()
    return Path(platformdirs.user_data_dir("sqlcipherui", "sqlcipherui"))


def _resolve_pipeline(svc: PipelineService, ident: str) -> dict:
    async def _lookup():
        if ident.isdigit():
            found = await svc.get_pipeline(int(ident))
            if found:
                return found
        for p in await svc.list_pipelines():
            if p["name"] == ident:
                return p
        return None

    pipeline = asyncio.run(_lookup())
    if pipeline is None:
        raise SystemExit(f"error: pipeline '{ident}' not found")
    return pipeline


def _print_event(event: dict) -> None:
    kind = event.get("type")
    ts = event.get("timestamp", "")
    if kind == "log":
        node = f" [{event['node_id']}]" if event.get("node_id") else ""
        print(f"{ts} {event.get('level', 'info').upper():5}{node} {event.get('message', '')}")
    elif kind == "progress":
        print(
            f"{ts} PROG  [{event.get('node_id')}] in={event.get('in_rows')} "
            f"out={event.get('out_rows')}"
        )
    elif kind == "edge_progress":
        print(
            f"{ts} EDGE  {event.get('from')}:{event.get('from_port')} -> "
            f"{event.get('to')} rows={event.get('rows')}"
        )
    elif kind == "status":
        print(f"{ts} STAT  run {event.get('run_id')} {event.get('status')}")
    else:
        print(f"{ts} {json.dumps(event, default=str)}")
    sys.stdout.flush()


def cmd_list(app_db: AppDatabase, _args) -> int:
    svc = PipelineService(app_db)
    pipelines = asyncio.run(svc.list_pipelines())
    if not pipelines:
        print("No pipelines.")
        return 0
    print(f"{'ID':>4}  {'NAME':<32} {'NODES':>5}  {'SCHEDULE':<16} LAST RUN")
    for p in pipelines:
        run = p.get("last_run") or {}
        last = f"{run.get('status', '-')} {run.get('started_at') or ''}".strip() if run else "-"
        sched = p.get("schedule") or "-"
        if p.get("schedule") and not p.get("schedule_enabled"):
            sched += " (off)"
        print(f"{p['id']:>4}  {p['name'][:32]:<32} {p['node_count']:>5}  {sched:<16} {last}")
    return 0


def cmd_run(app_db: AppDatabase, args) -> int:
    svc = PipelineService(app_db)
    pipeline = _resolve_pipeline(svc, args.pipeline)
    conn_mgr = ConnectionManager()
    executor = PipelineExecutor(conn_mgr, app_db)

    async def _go():
        try:
            return await executor.run(
                pipeline["id"],
                pipeline["definition"],
                args.mode,
                on_event=_print_event,
                initiated_by="cli",
            )
        finally:
            await conn_mgr.close_all()

    result = asyncio.run(_go())
    print(json.dumps(result, indent=2, default=str))
    return 0 if result.get("status") in ("ok", "partial") else 1


def cmd_validate(app_db: AppDatabase, args) -> int:
    svc = PipelineService(app_db)
    pipeline = _resolve_pipeline(svc, args.pipeline)
    executor = PipelineExecutor(ConnectionManager(), app_db)
    issues = asyncio.run(executor.validate(pipeline["definition"]))
    if not issues:
        print(f"{pipeline['name']}: no issues")
        return 0
    for issue in issues:
        node = f" [{issue['node_id']}]" if issue.get("node_id") else ""
        print(f"{issue.get('level', 'warn').upper():5}{node} {issue.get('message', '')}")
    return 1 if any(i.get("level") == "error" for i in issues) else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="sqlcipherui-pipeline", description=__doc__)
    parser.add_argument(
        "--data-dir", type=Path, default=None, help="Override the application data directory"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("list", help="List pipelines").set_defaults(func=cmd_list)

    run_p = sub.add_parser("run", help="Run a pipeline by id or name")
    run_p.add_argument("pipeline")
    run_p.add_argument("--mode", choices=_MODES, default="full")
    run_p.set_defaults(func=cmd_run)

    val_p = sub.add_parser("validate", help="Validate a pipeline definition")
    val_p.add_argument("pipeline")
    val_p.set_defaults(func=cmd_validate)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    data_dir = args.data_dir or default_data_dir()
    app_db = AppDatabase(data_dir)
    try:
        return args.func(app_db, args)
    finally:
        app_db.close()


if __name__ == "__main__":
    sys.exit(main())

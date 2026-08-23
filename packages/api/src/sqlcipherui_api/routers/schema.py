"""Schema introspection and DDL execution endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from sqlcipherui_api.dependencies import ConnManagerDep
from sqlcipherui_core.models.schema import (
    IndexInfo,
    TableDetail,
    TableInfo,
    TriggerInfo,
    ViewInfo,
)
from sqlcipherui_core.services.schema_service import SchemaService

router = APIRouter()


class DdlRequest(BaseModel):
    sql: str


def _require_unlocked(db) -> None:
    if not db.is_open:
        raise HTTPException(status_code=400, detail="No database is open")
    if not db.is_unlocked:
        raise HTTPException(status_code=403, detail="Database is locked")


def _get_db(cm, db_id: str):
    try:
        mgr = cm.get(db_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    _require_unlocked(mgr)
    return mgr


@router.get("/tables", response_model=list[TableInfo])
async def list_tables(cm: ConnManagerDep, db: str = Query(...)) -> list[TableInfo]:
    mgr = _get_db(cm, db)
    svc = SchemaService(mgr)
    return await svc.get_tables()


@router.get("/tables/{name}", response_model=TableDetail)
async def get_table_detail(name: str, cm: ConnManagerDep, db: str = Query(...)) -> TableDetail:
    mgr = _get_db(cm, db)
    svc = SchemaService(mgr)
    try:
        return await svc.get_table_detail(name)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Table not found: {name}") from e


@router.get("/views", response_model=list[ViewInfo])
async def list_views(cm: ConnManagerDep, db: str = Query(...)) -> list[ViewInfo]:
    mgr = _get_db(cm, db)
    svc = SchemaService(mgr)
    return await svc.get_views()


@router.get("/indexes", response_model=list[IndexInfo])
async def list_indexes(cm: ConnManagerDep, db: str = Query(...)) -> list[IndexInfo]:
    mgr = _get_db(cm, db)
    svc = SchemaService(mgr)
    return await svc.get_indexes()


@router.get("/triggers", response_model=list[TriggerInfo])
async def list_triggers(cm: ConnManagerDep, db: str = Query(...)) -> list[TriggerInfo]:
    mgr = _get_db(cm, db)
    svc = SchemaService(mgr)
    return await svc.get_triggers()


@router.post("/execute")
async def execute_ddl(request: DdlRequest, cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    try:
        await mgr.execute_modify(request.sql)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

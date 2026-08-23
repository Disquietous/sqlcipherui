"""SQL query execution endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from sqlcipherui_api.dependencies import ConnManagerDep
from sqlcipherui_core.models.query import QueryRequest, QueryResult
from sqlcipherui_core.services.query_service import QueryService

router = APIRouter()


def _get_db(cm, db_id: str):
    try:
        mgr = cm.get(db_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not mgr.is_open:
        raise HTTPException(status_code=400, detail="No database is open")
    if not mgr.is_unlocked:
        raise HTTPException(status_code=403, detail="Database is locked")
    return mgr


@router.post("/execute", response_model=QueryResult)
async def execute_query(request: QueryRequest, cm: ConnManagerDep, db: str = Query(...)) -> QueryResult:
    mgr = _get_db(cm, db)
    service = QueryService(mgr)
    return await service.execute(request.sql)


@router.post("/explain", response_model=QueryResult)
async def explain_query(request: QueryRequest, cm: ConnManagerDep, db: str = Query(...)) -> QueryResult:
    mgr = _get_db(cm, db)
    service = QueryService(mgr)
    return await service.explain(request.sql)

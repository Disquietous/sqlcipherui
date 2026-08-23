"""Data CRUD endpoints for table rows."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from sqlcipherui_api.dependencies import ConnManagerDep
from sqlcipherui_core.services.data_service import DataService

router = APIRouter()


class InsertRequest(BaseModel):
    values: dict


class UpdateRequest(BaseModel):
    pk: dict
    changes: dict


class DeleteRequest(BaseModel):
    pk: dict


def _get_db(cm, db_id: str):
    try:
        return cm.get(db_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{table}/rows")
async def get_rows(
    table: str,
    cm: ConnManagerDep,
    db: str = Query(...),
    offset: int = 0,
    limit: int = 100,
    sort: str | None = None,
    dir: str = "asc",
    search: str | None = None,
):
    mgr = _get_db(cm, db)
    svc = DataService(mgr)
    try:
        return await svc.get_rows(
            table, offset=offset, limit=limit, sort=sort, dir=dir, search=search
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{table}/rows")
async def insert_row(table: str, request: InsertRequest, cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    svc = DataService(mgr)
    try:
        return await svc.insert_row(table, request.values)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{table}/rows")
async def update_row(table: str, request: UpdateRequest, cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    svc = DataService(mgr)
    try:
        success = await svc.update_row(table, request.pk, request.changes)
        if not success:
            raise HTTPException(status_code=404, detail="Row not found")
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{table}/rows")
async def delete_row(table: str, request: DeleteRequest, cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    svc = DataService(mgr)
    try:
        success = await svc.delete_row(table, request.pk)
        if not success:
            raise HTTPException(status_code=404, detail="Row not found")
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

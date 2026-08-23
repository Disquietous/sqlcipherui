"""Endpoints for the internal app database: history, settings, saved queries."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from sqlcipherui_api.dependencies import AppDbDep

router = APIRouter()


# ------------------------------------------------------------------
# History
# ------------------------------------------------------------------

class HistoryEntry(BaseModel):
    sql_text: str
    row_count: int = 0
    elapsed_ms: float = 0
    error: str | None = None
    db_path: str | None = None


@router.get("/history")
async def get_history(app_db: AppDbDep, limit: int = 200, offset: int = 0, search: str | None = None):
    return app_db.get_history(limit=limit, offset=offset, search=search)


@router.post("/history")
async def add_history(entry: HistoryEntry, app_db: AppDbDep):
    row_id = app_db.add_history(
        sql_text=entry.sql_text,
        row_count=entry.row_count,
        elapsed_ms=entry.elapsed_ms,
        error=entry.error,
        db_path=entry.db_path,
    )
    return {"id": row_id}


@router.delete("/history/{history_id}")
async def remove_history(history_id: int, app_db: AppDbDep):
    if not app_db.remove_history(history_id):
        raise HTTPException(status_code=404, detail="History entry not found")
    return {"ok": True}


@router.delete("/history")
async def clear_history(app_db: AppDbDep):
    app_db.clear_history()
    return {"ok": True}


# ------------------------------------------------------------------
# Settings
# ------------------------------------------------------------------

class SettingUpdate(BaseModel):
    key: str
    value: str


@router.get("/settings")
async def get_settings(app_db: AppDbDep):
    return app_db.get_all_settings()


@router.get("/settings/{key}")
async def get_setting(key: str, app_db: AppDbDep):
    val = app_db.get_setting(key)
    if val is None:
        raise HTTPException(status_code=404, detail="Setting not found")
    return {"key": key, "value": val}


@router.put("/settings")
async def set_setting(update: SettingUpdate, app_db: AppDbDep):
    app_db.set_setting(update.key, update.value)
    return {"ok": True}


@router.delete("/settings/{key}")
async def delete_setting(key: str, app_db: AppDbDep):
    if not app_db.delete_setting(key):
        raise HTTPException(status_code=404, detail="Setting not found")
    return {"ok": True}


# ------------------------------------------------------------------
# Saved queries
# ------------------------------------------------------------------

class SavedQueryCreate(BaseModel):
    name: str
    sql_text: str
    description: str = ""


class SavedQueryUpdate(BaseModel):
    name: str | None = None
    sql_text: str | None = None
    description: str | None = None


@router.get("/saved-queries")
async def get_saved_queries(app_db: AppDbDep):
    return app_db.get_saved_queries()


@router.post("/saved-queries")
async def save_query(query: SavedQueryCreate, app_db: AppDbDep):
    row_id = app_db.save_query(name=query.name, sql_text=query.sql_text, description=query.description)
    return {"id": row_id}


@router.put("/saved-queries/{query_id}")
async def update_saved_query(query_id: int, query: SavedQueryUpdate, app_db: AppDbDep):
    if not app_db.update_saved_query(query_id, name=query.name, sql_text=query.sql_text, description=query.description):
        raise HTTPException(status_code=404, detail="Saved query not found")
    return {"ok": True}


@router.delete("/saved-queries/{query_id}")
async def delete_saved_query(query_id: int, app_db: AppDbDep):
    if not app_db.delete_saved_query(query_id):
        raise HTTPException(status_code=404, detail="Saved query not found")
    return {"ok": True}


# ------------------------------------------------------------------
# Databases
# ------------------------------------------------------------------

class DatabaseEntry(BaseModel):
    path: str
    name: str


@router.get("/databases")
async def get_databases(app_db: AppDbDep):
    return app_db.get_databases()


@router.post("/databases")
async def add_database(entry: DatabaseEntry, app_db: AppDbDep):
    app_db.add_database(path=entry.path, name=entry.name)
    return {"ok": True}


@router.delete("/databases/{db_id}")
async def remove_database(db_id: int, app_db: AppDbDep):
    if not app_db.remove_database(db_id):
        raise HTTPException(status_code=404, detail="Database not found")
    return {"ok": True}

"""Database connection management endpoints."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from sqlcipherui_api.dependencies import ConnManagerDep
from sqlcipherui_core.models.database import (
    CloseRequest,
    CreateRequest,
    DatabaseInfo,
    OpenRequest,
    UnlockRequest,
)

router = APIRouter()

DB_EXTENSIONS = {".db", ".sqlite", ".sqlite3", ".sqlcipher", ".s3db", ".sl3"}


@router.get("/browse")
async def browse_directory(path: str = Query(default="")):
    """List contents of a directory for the file browser."""
    if not path:
        p = Path.home()
    else:
        p = Path(path).expanduser().resolve()

    if not p.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if not p.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")

    items = []
    try:
        for child in sorted(p.iterdir(), key=lambda c: (not c.is_dir(), c.name.lower())):
            if child.name.startswith("."):
                continue
            if child.is_dir():
                items.append({"name": child.name, "path": str(child), "is_dir": True})
            elif child.suffix.lower() in DB_EXTENSIONS or child.is_file():
                try:
                    size = child.stat().st_size
                except OSError:
                    size = 0
                items.append({
                    "name": child.name,
                    "path": str(child),
                    "is_dir": False,
                    "size": size,
                    "is_db": child.suffix.lower() in DB_EXTENSIONS,
                })
    except PermissionError:
        raise HTTPException(status_code=403, detail="Permission denied")

    return {"path": str(p), "parent": str(p.parent) if p != p.parent else None, "items": items}


@router.post("/create")
async def create_database(request: CreateRequest, cm: ConnManagerDep):
    try:
        conn_id, info = await cm.create(request.path, request.passphrase if request.encrypt else None)
        result = info.model_dump()
        result["id"] = conn_id
        return result
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/open")
async def open_database(request: OpenRequest, cm: ConnManagerDep):
    try:
        conn_id, info = await cm.open(request.path)
        result = info.model_dump()
        result["id"] = conn_id
        return result
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/close")
async def close_database(request: CloseRequest, cm: ConnManagerDep):
    try:
        await cm.close(request.id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"ok": True}


@router.get("/info", response_model=DatabaseInfo)
async def get_database_info(cm: ConnManagerDep, db: str = Query(...)) -> DatabaseInfo:
    try:
        mgr = cm.get(db)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not mgr.is_open:
        raise HTTPException(status_code=400, detail="No database is open")
    return await mgr.get_info()


@router.post("/unlock")
async def unlock_database(request: UnlockRequest, cm: ConnManagerDep):
    try:
        mgr = cm.get(request.id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not mgr.is_open:
        raise HTTPException(status_code=400, detail="No database is open")
    success = await cm.unlock(request.id, request.passphrase)
    if not success:
        raise HTTPException(status_code=401, detail="Invalid passphrase")
    return {"ok": True}


@router.get("/connections")
async def list_connections(cm: ConnManagerDep):
    return await cm.list_connections()

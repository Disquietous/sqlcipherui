"""Database maintenance endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from sqlcipherui_api.dependencies import ConnManagerDep

router = APIRouter()


def _require_open(db):
    if not db.is_open:
        raise HTTPException(status_code=400, detail="No database is open")
    if not db.is_unlocked:
        raise HTTPException(status_code=400, detail="Database is locked")


def _get_db(cm, db_id: str):
    try:
        mgr = cm.get(db_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    _require_open(mgr)
    return mgr


@router.post("/vacuum")
async def vacuum(cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    try:
        await mgr.execute_modify("VACUUM")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/integrity-check")
async def integrity_check(cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    try:
        rows = await mgr.execute("PRAGMA integrity_check")
        result = rows[0][0] if rows else "unknown"
        return {"ok": result == "ok", "result": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze")
async def analyze(cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    try:
        await mgr.execute_modify("ANALYZE")
        return {"ok": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def stats(cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    info = await mgr.get_info()
    return {
        "size_bytes": info.size_bytes,
        "size_display": info.size_display,
        "page_size": info.page_size,
        "page_count": info.page_count,
        "freelist_count": info.freelist_count,
        "journal_mode": info.journal_mode,
        "table_count": info.table_count,
    }


@router.get("/pragmas")
async def get_pragmas(cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    keys = [
        "journal_mode", "synchronous", "cache_size", "page_size", "auto_vacuum",
        "foreign_keys", "wal_autocheckpoint", "busy_timeout", "mmap_size",
        "temp_store", "encoding",
    ]
    results = []
    for key in keys:
        try:
            rows = await mgr.execute(f"PRAGMA {key}")
            val = str(rows[0][0]) if rows else None
            results.append({"key": key, "value": val})
        except Exception:
            results.append({"key": key, "value": None})
    return results

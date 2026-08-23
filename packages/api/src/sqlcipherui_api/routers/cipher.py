"""Cipher/encryption management endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from sqlcipherui_api.dependencies import ConnManagerDep

router = APIRouter()


class PassphraseRequest(BaseModel):
    passphrase: str


class RekeyRequest(BaseModel):
    new_passphrase: str


def _get_db(cm, db_id: str):
    try:
        mgr = cm.get(db_id)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not mgr.is_open:
        raise HTTPException(status_code=400, detail="No database is open")
    return mgr


@router.get("/status")
async def cipher_status(cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    return {
        "encrypted": mgr.is_encrypted,
        "unlocked": mgr.is_unlocked,
    }


@router.post("/rekey")
async def rekey_database(request: RekeyRequest, cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    if not mgr.is_encrypted or not mgr.is_unlocked:
        raise HTTPException(status_code=400, detail="Database must be encrypted and unlocked to rekey")
    success = await mgr.rekey(request.new_passphrase)
    if not success:
        raise HTTPException(status_code=500, detail="Rekey failed")
    return {"ok": True}


@router.post("/verify")
async def verify_passphrase(request: PassphraseRequest, cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    ok = await mgr.verify_passphrase(request.passphrase)
    return {"ok": ok}


@router.post("/encrypt")
async def encrypt_database(request: PassphraseRequest, cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    if mgr.is_encrypted:
        raise HTTPException(status_code=400, detail="Database is already encrypted")
    try:
        success = await mgr.encrypt(request.passphrase)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if not success:
        raise HTTPException(status_code=500, detail="Encryption failed")
    return {"ok": True}


@router.post("/decrypt")
async def decrypt_database(request: PassphraseRequest, cm: ConnManagerDep, db: str = Query(...)):
    mgr = _get_db(cm, db)
    if not mgr.is_encrypted or not mgr.is_unlocked:
        raise HTTPException(status_code=400, detail="Database must be encrypted and unlocked to decrypt")
    try:
        success = await mgr.decrypt(request.passphrase)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    if not success:
        raise HTTPException(status_code=500, detail="Decryption failed")
    return {"ok": True}

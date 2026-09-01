"""Tests for GET /api/schema/completion."""

import sqlite3

import pytest
from httpx import ASGITransport, AsyncClient

from sqlcipherui_api.dependencies import get_conn_manager
from sqlcipherui_api.main import create_app
from sqlcipherui_core.services.connection_manager import ConnectionManager


@pytest.fixture
async def client(tmp_path):
    path = tmp_path / "t.db"
    conn = sqlite3.connect(path)
    conn.executescript(
        "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);"
        "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id));"
    )
    conn.close()

    cm = ConnectionManager()
    conn_id, _ = await cm.open(str(path))

    app = create_app()
    app.dependency_overrides[get_conn_manager] = lambda: cm
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.db_id = conn_id
        yield c
    await cm.close_all()


async def test_completion_snapshot(client):
    res = await client.get("/api/schema/completion", params={"db": client.db_id})
    assert res.status_code == 200
    etag = res.headers["etag"]
    body = res.json()
    assert etag == f'"{body["schema_version"]}"'
    names = {t["name"]: t for t in body["tables"]}
    assert set(names) == {"users", "posts"}
    assert [c["name"] for c in names["users"]["columns"]] == ["id", "email"]
    assert body["foreign_keys"] == [
        {"from_table": "posts", "from_column": "user_id", "to_table": "users", "to_column": "id"}
    ]


async def test_completion_not_modified(client):
    first = await client.get("/api/schema/completion", params={"db": client.db_id})
    etag = first.headers["etag"]
    second = await client.get(
        "/api/schema/completion",
        params={"db": client.db_id},
        headers={"If-None-Match": etag},
    )
    assert second.status_code == 304
    assert second.headers["etag"] == etag

    await client.post(
        "/api/schema/execute", params={"db": client.db_id}, json={"sql": "CREATE TABLE z (a)"}
    )
    third = await client.get(
        "/api/schema/completion",
        params={"db": client.db_id},
        headers={"If-None-Match": etag},
    )
    assert third.status_code == 200
    assert third.headers["etag"] != etag


async def test_completion_unknown_db(client):
    res = await client.get("/api/schema/completion", params={"db": "/nope.db"})
    assert res.status_code == 404

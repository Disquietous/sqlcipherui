"""Tests for the /api/dataflow router."""

import json

import pytest
from httpx import ASGITransport, AsyncClient

from sqlcipherui_api.dependencies import get_app_db, get_conn_manager
from sqlcipherui_api.main import create_app
from sqlcipherui_core.services.app_db import AppDatabase
from sqlcipherui_core.services.connection_manager import ConnectionManager

DEFINITION = {
    "nodes": [
        {"id": "n1", "kind": "src-csv", "x": 10, "y": 20, "summary": "", "config": {"path": "a"}},
        {"id": "n2", "kind": "snk-json", "x": 30, "y": 40, "summary": "", "config": {"path": "b"}},
    ],
    "edges": [{"from": "n1", "to": "n2", "port": None, "fromPort": "out", "crossDb": False}],
}


@pytest.fixture
async def client(tmp_path):
    app_db = AppDatabase(tmp_path / "data")
    cm = ConnectionManager()
    app = create_app()
    app.dependency_overrides[get_app_db] = lambda: app_db
    app.dependency_overrides[get_conn_manager] = lambda: cm
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        c.app_db = app_db
        c.tmp_path = tmp_path
        yield c
    await cm.close_all()
    app_db.close()


async def _create(client, name="p", definition=None, **extra):
    body = {"name": name, "definition": definition or DEFINITION, **extra}
    res = await client.post("/api/dataflow/pipelines", json=body)
    assert res.status_code == 200, res.text
    return res.json()


# ------------------------------------------------------------------
# Pipelines
# ------------------------------------------------------------------


async def test_pipeline_crud_round_trip(client):
    created = await _create(client, "etl", tags=["a", "b"], description="desc")
    assert isinstance(created["definition"], dict)
    assert created["tags"] == ["a", "b"]
    node_ids = [n["id"] for n in created["definition"]["nodes"]]
    assert node_ids == ["n1", "n2"]
    assert created["definition"]["nodes"][0]["config"] == {"path": "a"}
    assert created["definition"]["edges"][0]["from"] == "n1"
    assert created["definition"]["edges"][0]["to"] == "n2"
    assert created["schedule"] == ""
    assert created["schedule_enabled"] is False

    res = await client.get("/api/dataflow/pipelines")
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    assert items[0]["node_count"] == 2
    assert items[0]["last_run"] is None
    assert isinstance(items[0]["definition"], dict)
    assert isinstance(items[0]["tags"], list)

    res = await client.get(f"/api/dataflow/pipelines/{created['id']}")
    assert res.status_code == 200
    assert res.json()["name"] == "etl"

    res = await client.put(
        f"/api/dataflow/pipelines/{created['id']}",
        json={
            "name": "etl2",
            "starred": True,
            "schedule": "*/5 * * * *",
            "schedule_enabled": True,
            "definition": {"nodes": [], "edges": []},
        },
    )
    assert res.status_code == 200
    updated = res.json()
    assert updated["name"] == "etl2"
    assert updated["starred"] is True
    assert updated["schedule"] == "*/5 * * * *"
    assert updated["schedule_enabled"] is True
    assert updated["definition"] == {"nodes": [], "edges": []}

    res = await client.post(
        f"/api/dataflow/pipelines/{created['id']}/duplicate", json={"name": "dupe"}
    )
    assert res.status_code == 200
    assert res.json()["name"] == "dupe"
    assert res.json()["id"] != created["id"]

    res = await client.delete(f"/api/dataflow/pipelines/{created['id']}")
    assert res.json() == {"ok": True}
    assert (await client.get(f"/api/dataflow/pipelines/{created['id']}")).status_code == 404
    assert (await client.delete(f"/api/dataflow/pipelines/{created['id']}")).status_code == 404
    assert (
        await client.post(f"/api/dataflow/pipelines/{created['id']}/duplicate", json={})
    ).status_code == 404


async def test_put_noop_returns_current_pipeline(client):
    created = await _create(client, "keep")
    res = await client.put(f"/api/dataflow/pipelines/{created['id']}", json={})
    assert res.status_code == 200
    assert res.json()["name"] == "keep"
    assert res.json()["definition"] == created["definition"]
    res = await client.put("/api/dataflow/pipelines/424242", json={})
    assert res.status_code == 404
    res = await client.put("/api/dataflow/pipelines/424242", json={"name": "x"})
    assert res.status_code == 404


# ------------------------------------------------------------------
# Connections
# ------------------------------------------------------------------


async def test_connections_crud(client):
    res = await client.post(
        "/api/dataflow/connections",
        json={"name": "dev", "kind": "sqlite", "encrypted": False, "path": "/tmp/dev.db"},
    )
    assert res.status_code == 200, res.text
    conn = res.json()
    assert conn["name"] == "dev"
    assert conn["encrypted"] == 0

    res = await client.post("/api/dataflow/connections", json={"name": "bad"})
    assert res.status_code == 422

    res = await client.get("/api/dataflow/connections")
    assert [c["id"] for c in res.json()] == [conn["id"]]

    res = await client.put(
        f"/api/dataflow/connections/{conn['id']}", json={"name": "prod", "encrypted": True}
    )
    assert res.status_code == 200
    assert res.json()["name"] == "prod"
    assert res.json()["encrypted"] == 1
    assert res.json()["path"] == "/tmp/dev.db"

    res = await client.put(f"/api/dataflow/connections/{conn['id']}", json={})
    assert res.status_code == 200
    assert res.json()["name"] == "prod"

    assert (
        await client.put("/api/dataflow/connections/999", json={"name": "x"})
    ).status_code == 404

    res = await client.delete(f"/api/dataflow/connections/{conn['id']}")
    assert res.json() == {"ok": True}
    assert (await client.delete(f"/api/dataflow/connections/{conn['id']}")).status_code == 404


# ------------------------------------------------------------------
# Templates, stats, runs
# ------------------------------------------------------------------


async def test_templates_have_full_definitions(client):
    res = await client.get("/api/dataflow/templates")
    assert res.status_code == 200
    templates = res.json()
    assert templates
    for tpl in templates:
        for key in ("id", "name", "icon", "accent", "desc", "node_kinds", "definition"):
            assert key in tpl, f"template {tpl.get('id')} missing {key}"
        definition = tpl["definition"]
        assert definition["nodes"], f"template {tpl['id']} has no nodes"
        for node in definition["nodes"]:
            assert {"id", "kind", "x", "y", "config"} <= set(node)
        assert "edges" in definition
        for edge in definition["edges"]:
            assert {"from", "to"} <= set(edge)


async def test_stats_shape(client):
    res = await client.get("/api/dataflow/stats")
    assert res.status_code == 200
    assert res.json() == {"runs": 0, "rows_moved": 0, "failed": 0}

    created = await _create(client)
    rid = client.app_db.create_run(created["id"], mode="full")
    client.app_db.update_run(rid, status="failed", total_rows=7)
    res = await client.get("/api/dataflow/stats")
    assert res.json() == {"runs": 1, "rows_moved": 7, "failed": 1}


async def test_run_history_endpoints(client):
    created = await _create(client)
    rid = client.app_db.create_run(created["id"], mode="full")
    client.app_db.update_run(rid, status="ok", total_rows=3)
    client.app_db.add_run_event(rid, "info", "n1", "hello")

    res = await client.get(f"/api/dataflow/pipelines/{created['id']}/runs", params={"limit": 5})
    assert res.status_code == 200
    assert [r["id"] for r in res.json()] == [rid]

    res = await client.get(f"/api/dataflow/runs/{rid}")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
    assert (await client.get("/api/dataflow/runs/999999")).status_code == 404

    res = await client.get(f"/api/dataflow/runs/{rid}/events")
    assert [e["message"] for e in res.json()] == ["hello"]

    listing = await client.get("/api/dataflow/pipelines")
    last_run = listing.json()[0]["last_run"]
    assert last_run["status"] == "ok"
    assert last_run["total_rows"] == 3


async def test_cancel_unknown_run(client):
    res = await client.post("/api/dataflow/runs/123456/cancel")
    assert res.status_code == 200
    assert res.json() == {"ok": False}


async def test_run_rejects_bad_mode(client):
    created = await _create(client)
    res = await client.post(
        f"/api/dataflow/pipelines/{created['id']}/run", json={"mode": "sideways"}
    )
    assert res.status_code == 422
    res = await client.post("/api/dataflow/pipelines/999/run", json={"mode": "preview"})
    assert res.status_code == 404


# ------------------------------------------------------------------
# Executor-backed endpoints
# ------------------------------------------------------------------


def _csv_to_json_definition(tmp_path):
    src = tmp_path / "in.csv"
    src.write_text("id,name\n1,ann\n2,bob\n3,cy\n")
    out = tmp_path / "out.json"
    return out, {
        "nodes": [
            {
                "id": "src",
                "kind": "src-csv",
                "x": 0,
                "y": 0,
                "summary": "",
                "config": {"path": str(src), "delimiter": ",", "header": True},
            },
            {
                "id": "snk",
                "kind": "snk-json",
                "x": 200,
                "y": 0,
                "summary": "",
                "config": {"path": str(out), "format": "array"},
            },
        ],
        "edges": [{"from": "src", "to": "snk", "port": None, "fromPort": "out"}],
    }


async def test_validate_endpoint(client):
    created = await _create(client, definition={"nodes": [], "edges": []})
    res = await client.post(f"/api/dataflow/pipelines/{created['id']}/validate")
    assert res.status_code == 200
    body = res.json()
    assert "issues" in body
    assert isinstance(body["issues"], list)
    for issue in body["issues"]:
        assert {"node_id", "level", "message"} <= set(issue)
    assert (await client.post("/api/dataflow/pipelines/999/validate")).status_code == 404


async def test_run_stream_sse_framing(client):
    out, definition = _csv_to_json_definition(client.tmp_path)
    created = await _create(client, "stream", definition=definition)

    events = []
    async with client.stream(
        "POST",
        f"/api/dataflow/pipelines/{created['id']}/run-stream",
        json={"mode": "full", "transactional": True, "streaming_counters": True},
    ) as res:
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/event-stream")
        buf = ""
        async for chunk in res.aiter_text():
            buf += chunk
            while "\n\n" in buf:
                frame, buf = buf.split("\n\n", 1)
                assert frame.startswith("data: "), frame
                events.append(json.loads(frame[len("data: ") :]))

    assert events, "no SSE events received"
    assert all("type" in e for e in events)
    assert events[-1]["type"] == "done", events[-1]
    result = events[-1]["result"]
    assert result["status"] == "ok", result
    assert result["total_rows"] == 3
    statuses = [e for e in events if e["type"] == "status"]
    assert statuses and statuses[0]["status"] == "running"
    assert all("timestamp" in e for e in events if e["type"] != "done")
    written = json.loads(out.read_text())
    assert len(written) == 3
    assert [str(r["name"]) for r in written] == ["ann", "bob", "cy"]

    runs = (await client.get(f"/api/dataflow/pipelines/{created['id']}/runs")).json()
    assert len(runs) == 1
    assert runs[0]["status"] == "ok"
    assert runs[0]["mode"] == "full"


async def test_run_and_schema_and_preview(client):
    out, definition = _csv_to_json_definition(client.tmp_path)
    created = await _create(client, "run", definition=definition)

    res = await client.post(
        f"/api/dataflow/pipelines/{created['id']}/run", json={"mode": "preview"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert {"run_id", "status", "mode", "duration_ms", "total_rows", "node_rows"} <= set(body)
    assert body["mode"] == "preview"
    assert not out.exists()  # preview never writes

    res = await client.post(
        f"/api/dataflow/pipelines/{created['id']}/preview-node",
        json={"node_id": "src", "sample_size": 2},
    )
    assert res.status_code == 200
    preview = res.json()
    assert {"columns", "rows"} <= set(preview)
    assert [c["name"] for c in preview["columns"]] == ["id", "name"]
    assert len(preview["rows"]) == 2

    res = await client.post(
        f"/api/dataflow/pipelines/{created['id']}/schema", json={"sample_size": 5}
    )
    assert res.status_code == 200
    schema = res.json()
    assert set(schema) == {"src", "snk"}
    assert [c["name"] for c in schema["src"]["columns"]] == ["id", "name"]
    # No runs are recorded by preview-node / schema.
    runs = (await client.get(f"/api/dataflow/pipelines/{created['id']}/runs")).json()
    assert len(runs) == 1


# ------------------------------------------------------------------
# Scheduler
# ------------------------------------------------------------------


async def test_scheduler_tick_fires_due_pipelines_once(tmp_path, monkeypatch):
    from datetime import datetime

    from sqlcipherui_api import scheduler

    calls = []

    class FakeExecutor:
        def __init__(self, conn_mgr, app_db):
            pass

        async def run(self, pipeline_id, definition, mode, **kwargs):
            calls.append((pipeline_id, mode, kwargs.get("initiated_by")))
            if pipeline_id == 99:
                raise RuntimeError("boom")
            return {"status": "ok"}

    monkeypatch.setattr(scheduler, "PipelineExecutor", FakeExecutor)

    app_db = AppDatabase(tmp_path)
    try:
        due = app_db.save_pipeline("due")
        app_db.update_pipeline(due, schedule="30 14 * * *", schedule_enabled=True)
        not_due = app_db.save_pipeline("not-due")
        app_db.update_pipeline(not_due, schedule="0 0 * * *", schedule_enabled=True)
        disabled = app_db.save_pipeline("disabled")
        app_db.update_pipeline(disabled, schedule="30 14 * * *", schedule_enabled=False)

        now = datetime(2026, 9, 3, 14, 30, 12)
        fired = await scheduler.scheduler_tick(app_db, ConnectionManager(), now)
        assert fired == 1
        assert calls == [(due, "full", "schedule")]
        assert app_db.get_pipeline(due)["last_scheduled_at"] == "2026-09-03T14:30"

        # Same minute again (next 30 s tick) must not re-fire.
        fired = await scheduler.scheduler_tick(app_db, ConnectionManager(), now.replace(second=45))
        assert fired == 0
        assert len(calls) == 1

        # A failing run is logged, does not stop other pipelines, and still claims the slot.
        conn = app_db._get_conn()
        conn.execute("UPDATE df_pipelines SET id = 99 WHERE id = ?", (not_due,))
        conn.commit()
        app_db.update_pipeline(99, schedule="31 14 * * *")
        app_db.update_pipeline(due, schedule="31 14 * * *")
        later = datetime(2026, 9, 3, 14, 31)
        fired = await scheduler.scheduler_tick(app_db, ConnectionManager(), later)
        assert fired == 1  # only the successful one counts
        assert {c[0] for c in calls[1:]} == {due, 99}
        assert app_db.get_pipeline(99)["last_scheduled_at"] == "2026-09-03T14:31"
    finally:
        app_db.close()

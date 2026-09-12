"""Tests for the Data Flow tables in AppDatabase and PipelineService."""

import json
import sqlite3

import pytest

from sqlcipherui_core.services.app_db import AppDatabase
from sqlcipherui_core.services.pipeline_service import PipelineService


@pytest.fixture
def app_db(tmp_path):
    db = AppDatabase(tmp_path)
    yield db
    db.close()


def _columns(conn, table):
    return {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def test_schema_has_indexes_and_schedule_columns(app_db, tmp_path):
    conn = sqlite3.connect(tmp_path / "app.db")
    indexes = {r[1] for r in conn.execute("PRAGMA index_list(df_runs)").fetchall()}
    assert "idx_df_runs_pipeline" in indexes
    indexes = {r[1] for r in conn.execute("PRAGMA index_list(df_run_events)").fetchall()}
    assert "idx_df_run_events_run" in indexes
    cols = _columns(conn, "df_pipelines")
    assert {"schedule", "schedule_enabled", "last_scheduled_at"} <= cols
    conn.close()


def test_migration_adds_schedule_columns_to_legacy_db(tmp_path):
    legacy = sqlite3.connect(tmp_path / "app.db")
    legacy.executescript(
        """
        CREATE TABLE df_pipelines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            starred INTEGER DEFAULT 0,
            tags TEXT DEFAULT '[]',
            definition TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );
        INSERT INTO df_pipelines (name) VALUES ('old');
        """
    )
    legacy.commit()
    legacy.close()

    db = AppDatabase(tmp_path)
    try:
        row = db.get_pipeline(1)
        assert row["name"] == "old"
        assert row["schedule"] == ""
        assert row["schedule_enabled"] == 0
        assert row["last_scheduled_at"] is None
        # Re-opening must be idempotent.
        db.close()
        db = AppDatabase(tmp_path)
        assert db.get_pipeline(1)["schedule"] == ""
    finally:
        db.close()


def test_update_pipeline_schedule_fields_and_scheduled_listing(app_db):
    a = app_db.save_pipeline("a")
    b = app_db.save_pipeline("b")
    c = app_db.save_pipeline("c")
    assert app_db.update_pipeline(a, schedule="*/5 * * * *", schedule_enabled=True)
    assert app_db.update_pipeline(b, schedule="0 0 * * *", schedule_enabled=False)
    assert app_db.update_pipeline(c, schedule="", schedule_enabled=True)
    assert app_db.update_pipeline(a, last_scheduled_at="2026-09-03T14:30")

    scheduled = app_db.get_scheduled_pipelines()
    assert [p["id"] for p in scheduled] == [a]
    assert scheduled[0]["last_scheduled_at"] == "2026-09-03T14:30"
    assert app_db.get_pipeline(a)["schedule_enabled"] == 1

    # Unknown keys are ignored; nothing to update returns False.
    assert app_db.update_pipeline(a, bogus=1) is False
    assert app_db.update_pipeline(9999, name="x") is False


def test_runs_get_prune_and_stats(app_db):
    pid = app_db.save_pipeline("p")
    other = app_db.save_pipeline("q")
    run_ids = [app_db.create_run(pid, mode="full") for _ in range(10)]
    other_run = app_db.create_run(other, mode="full")
    app_db.create_run(pid, mode="preview")  # excluded from stats

    for i, rid in enumerate(run_ids):
        status = "failed" if i % 3 == 0 else "ok"
        app_db.update_run(rid, status=status, total_rows=100)
    app_db.update_run(other_run, status="ok", total_rows=5)

    run = app_db.get_run(run_ids[0])
    assert run["id"] == run_ids[0]
    assert run["status"] == "failed"
    assert app_db.get_run(999_999) is None

    stats = app_db.get_df_stats(7)
    assert stats == {"runs": 11, "rows_moved": 1005, "failed": 4}

    deleted = app_db.prune_runs(pid, keep=3)
    assert deleted == 8  # 10 full + 1 preview, keep newest 3
    remaining = app_db.get_runs(pid)
    assert len(remaining) == 3
    assert remaining[0]["id"] > remaining[1]["id"] > remaining[2]["id"]
    # Other pipeline untouched.
    assert len(app_db.get_runs(other)) == 1
    # Events cascade with runs.
    app_db.add_run_event(remaining[0]["id"], "info", None, "hi")
    app_db.prune_runs(pid, keep=0)
    assert app_db.get_run_events(remaining[0]["id"]) == []


def test_df_connection_update(app_db):
    cid = app_db.add_df_connection("dev", "sqlite", False, "/tmp/dev.db")
    assert app_db.get_df_connection(cid)["encrypted"] == 0
    assert app_db.update_df_connection(cid, name="prod", encrypted=True)
    row = app_db.get_df_connection(cid)
    assert row["name"] == "prod"
    assert row["encrypted"] == 1
    assert row["path"] == "/tmp/dev.db"
    assert app_db.update_df_connection(cid) is False
    assert app_db.update_df_connection(cid, kind="sqlcipher", path="/x.db")
    assert app_db.get_df_connection(cid)["path"] == "/x.db"
    assert app_db.update_df_connection(999, name="nope") is False
    assert app_db.get_df_connection(999) is None


def test_get_latest_runs_one_per_pipeline(app_db):
    a = app_db.save_pipeline("a")
    b = app_db.save_pipeline("b")
    app_db.save_pipeline("no-runs")
    app_db.create_run(a)
    a_latest = app_db.create_run(a)
    b_latest = app_db.create_run(b)
    latest = app_db.get_latest_runs()
    assert set(latest) == {a, b}
    assert latest[a]["id"] == a_latest
    assert latest[b]["id"] == b_latest


async def test_pipeline_service_parses_and_summarizes(app_db):
    svc = PipelineService(app_db)
    definition = {
        "nodes": [
            {"id": "n1", "kind": "src-csv", "x": 0, "y": 0, "config": {"path": "a.csv"}},
            {"id": "n2", "kind": "snk-json", "x": 1, "y": 0, "config": {"path": "b.json"}},
        ],
        "edges": [{"from": "n1", "to": "n2", "port": None, "fromPort": "out"}],
    }
    created = await svc.create_pipeline("p", "d", ["x", "y"], definition)
    assert created["definition"] == definition
    assert created["tags"] == ["x", "y"]
    assert created["starred"] is False
    assert created["schedule_enabled"] is False

    # Raw storage is JSON text.
    raw = app_db.get_pipeline(created["id"])
    assert json.loads(raw["definition"]) == definition

    rid = app_db.create_run(created["id"], mode="full")
    app_db.update_run(rid, status="ok", total_rows=42, duration_ms=12.5)

    empty = await svc.create_pipeline("empty")
    listing = await svc.list_pipelines()
    by_id = {p["id"]: p for p in listing}
    assert by_id[created["id"]]["node_count"] == 2
    assert by_id[created["id"]]["last_run"]["status"] == "ok"
    assert by_id[created["id"]]["last_run"]["total_rows"] == 42
    assert set(by_id[created["id"]]["last_run"]) == {
        "status",
        "started_at",
        "duration_ms",
        "total_rows",
    }
    assert by_id[empty["id"]]["node_count"] == 0
    assert by_id[empty["id"]]["last_run"] is None

    assert await svc.update_pipeline(created["id"], tags=["z"], definition={"nodes": []})
    fetched = await svc.get_pipeline(created["id"])
    assert fetched["tags"] == ["z"]
    assert fetched["definition"] == {"nodes": []}

    dup = await svc.duplicate_pipeline(created["id"], "copy")
    assert dup["name"] == "copy"
    assert dup["definition"] == {"nodes": []}
    assert await svc.get_pipeline(999_999) is None

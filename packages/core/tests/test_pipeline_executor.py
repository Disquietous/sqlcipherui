"""Tests for the Data Flows pipeline executor, node executors and helpers."""

from __future__ import annotations

import csv
import importlib.util
import json
import sqlite3

import pytest
import sqlcipher3

from sqlcipherui_core.models.dataflow import PipelineDefinition
from sqlcipherui_core.services import pipeline_executor
from sqlcipherui_core.services.app_db import AppDatabase
from sqlcipherui_core.services.connection_manager import ConnectionManager
from sqlcipherui_core.services.pipeline_executor import (
    EXECUTORS,
    PipelineExecutor,
    _topo_sort,
    active_runs,
    cancel_run,
)
from sqlcipherui_core.services.pipeline_nodes import (
    SCRIPTLET_ERRORS,
    NodeExecutor,
    fake_value,
    register,
)
from sqlcipherui_core.services.pipeline_sql import (
    PARQUET_ERROR,
    assert_read_only_sql,
    infer_column_types,
    quote_ident,
    run_in_memory,
)
from sqlcipherui_core.services.pipeline_templates import PIPELINE_TEMPLATES

HAS_PYARROW = importlib.util.find_spec("pyarrow") is not None

PEOPLE = [
    {"id": 1, "name": "Ann", "age": 25, "email": "ann@x.io", "city": " NYC "},
    {"id": 2, "name": "Bob", "age": 35, "email": "bob@x.io", "city": "la"},
    {"id": 3, "name": "Cy", "age": 45, "email": None, "city": "sf "},
    {"id": 4, "name": "Bob", "age": 55, "email": "bob@x.io", "city": "la"},
]


# ------------------------------------------------------------------ #
# Fixtures and helpers                                                 #
# ------------------------------------------------------------------ #


@pytest.fixture
def app_db(tmp_path):
    db = AppDatabase(tmp_path / "appdata")
    yield db
    db.close()


@pytest.fixture
async def conn_mgr():
    cm = ConnectionManager()
    yield cm
    await cm.close_all()


@pytest.fixture
def executor(conn_mgr, app_db):
    return PipelineExecutor(conn_mgr, app_db)


@pytest.fixture
def pipeline_id(app_db):
    return app_db.save_pipeline("test pipeline")


def write_json(tmp_path, name, rows):
    path = tmp_path / name
    path.write_text(json.dumps(rows))
    return str(path)


def linear(*steps, edges=None):
    """Build a definition from ``(kind, config)`` steps chained n1 -> n2 -> ..."""
    nodes = [
        {"id": f"n{i}", "kind": kind, "x": i * 220, "y": 100, "summary": "", "config": config}
        for i, (kind, config) in enumerate(steps, 1)
    ]
    if edges is None:
        edges = [
            {"from": f"n{i}", "to": f"n{i + 1}", "port": "in", "fromPort": "out"}
            for i in range(1, len(steps))
        ]
    return {"nodes": nodes, "edges": edges}


async def transform(executor, tmp_path, rows, kind, config):
    """Run a single transform over *rows* (via src-json) and return its preview output."""
    definition = linear(
        ("src-json", {"path": write_json(tmp_path, f"{kind}.json", rows)}), (kind, config)
    )
    result = await executor.preview_node(0, definition, "n2", sample_size=1000)
    assert result["error"] is None, result["error"]
    return result["rows"]


def make_sqlite(path, script):
    conn = sqlite3.connect(path)
    conn.executescript(script)
    conn.commit()
    conn.close()
    return str(path)


def read_sqlite(path, sql):
    conn = sqlite3.connect(path)
    try:
        cur = conn.execute(sql)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, r, strict=False)) for r in cur.fetchall()]
    finally:
        conn.close()


# ------------------------------------------------------------------ #
# Helpers                                                              #
# ------------------------------------------------------------------ #


def test_quote_ident():
    assert quote_ident("a") == '"a"'
    assert quote_ident('we"ird') == '"we""ird"'
    assert quote_ident("drop table x; --") == '"drop table x; --"'


def test_infer_column_types():
    rows = [
        {"i": 1, "f": 1.5, "s": "x", "si": "42", "sf": "4.2", "b": b"\x00", "n": None, "m": 1},
        {"i": 2, "f": 2, "s": "y", "si": "7", "sf": "1", "b": b"\x01", "n": None, "m": "abc"},
    ]
    types = {c["name"]: c["type"] for c in infer_column_types(rows)}
    assert types == {
        "i": "INTEGER", "f": "REAL", "s": "TEXT", "si": "INTEGER", "sf": "REAL",
        "b": "BLOB", "n": "NULL", "m": "TEXT",
    }  # fmt: skip
    assert [c["name"] for c in infer_column_types([{"a": 1}, {"b": 2, "a": 3}])] == ["a", "b"]
    assert infer_column_types([]) == []


def test_run_in_memory_typed_and_empty():
    rows = [{"age": "31"}, {"age": "9"}]
    assert run_in_memory(rows, "SELECT * FROM _input WHERE age > 30") == [{"age": 31}]
    assert run_in_memory([], "SELECT * FROM _input WHERE nope > 1") == []


def test_topo_sort_and_cycle():
    nodes = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    edges = [{"from": "b", "to": "c"}, {"from": "a", "to": "b"}]
    assert _topo_sort(nodes, edges) == ["a", "b", "c"]
    with pytest.raises(ValueError, match="cycle"):
        _topo_sort(nodes, edges + [{"from": "c", "to": "a"}])


def test_read_only_guard():
    assert assert_read_only_sql("  select 1", "x") == "select 1"
    assert assert_read_only_sql(
        "-- note\n/* c */ WITH t AS (SELECT 1) SELECT * FROM t;", "x"
    ).startswith("WITH")
    assert assert_read_only_sql("SELECT ';' AS semi", "x") == "SELECT ';' AS semi"
    for bad in (
        "INSERT INTO t VALUES (1)",
        "PRAGMA key='x'",
        "SELECT 1; DROP TABLE t",
        "",
        "-- only",
    ):
        with pytest.raises(ValueError):
            assert_read_only_sql(bad, "x")


# ------------------------------------------------------------------ #
# Transforms                                                           #
# ------------------------------------------------------------------ #


async def test_filter_is_typed(executor, tmp_path):
    rows = await transform(executor, tmp_path, PEOPLE, "tf-filter", {"expr": "age > 30"})
    assert [r["id"] for r in rows] == [2, 3, 4]
    csv_rows = [{"age": "31"}, {"age": "5"}, {"age": "100"}]
    rows = await transform(executor, tmp_path, csv_rows, "tf-filter", {"expr": "age > 30"})
    assert [r["age"] for r in rows] == [31, 100]


async def test_filter_on_empty_input_is_empty(executor, tmp_path):
    rows = await transform(executor, tmp_path, [], "tf-filter", {"expr": "missing_col > 1"})
    assert rows == []


async def test_project_rename_cast_derive(executor, tmp_path):
    rows = await transform(
        executor, tmp_path, PEOPLE, "tf-project", {"columns": "id,name", "mode": "keep"}
    )
    assert rows[0] == {"id": 1, "name": "Ann"}
    rows = await transform(
        executor, tmp_path, PEOPLE, "tf-project", {"columns": "email, city", "mode": "drop"}
    )
    assert set(rows[0]) == {"id", "name", "age"}
    rows = await transform(
        executor, tmp_path, PEOPLE, "tf-rename", {"from_col": "name", "to_col": "full_name"}
    )
    assert list(rows[0]) == ["id", "full_name", "age", "email", "city"]
    rows = await transform(
        executor, tmp_path, PEOPLE, "tf-cast", {"column": "age", "target_type": "TEXT"}
    )
    assert rows[0]["age"] == "25"
    rows = await transform(
        executor, tmp_path, PEOPLE, "tf-derive", {"name": "next", "expr": "age + 1"}
    )
    assert rows[0]["next"] == 26


async def test_join_ports_and_suffix(executor, tmp_path):
    left = [
        {"id": 1, "name": "a", "x": 1},
        {"id": 2, "name": "b", "x": 2},
        {"id": 3, "name": "c", "x": 3},
    ]
    right = [{"id": 2, "name": "B", "y": 20}, {"id": 3, "name": "C", "y": 30}, {"id": 9, "y": 90}]
    l_path = write_json(tmp_path, "l.json", left)
    r_path = write_json(tmp_path, "r.json", right)
    definition = {
        "nodes": [
            {"id": "L", "kind": "src-json", "x": 0, "y": 0, "config": {"path": l_path}},
            {"id": "R", "kind": "src-json", "x": 0, "y": 200, "config": {"path": r_path}},
            {"id": "J", "kind": "tf-join", "x": 220, "y": 100,
             "config": {"join_type": "LEFT", "left_key": "id", "right_key": "id"}},
        ],
        # Right edge listed first: port names, not edge order, must decide the sides.
        "edges": [
            {"from": "R", "to": "J", "port": "R", "fromPort": "out"},
            {"from": "L", "to": "J", "port": "L", "fromPort": "out"},
        ],
    }  # fmt: skip
    res = await executor.preview_node(0, definition, "J", sample_size=100)
    assert res["error"] is None
    rows = res["rows"]
    assert [c["name"] for c in res["columns"]] == ["id", "name", "x", "name_r", "y"]
    assert rows[0] == {"id": 1, "name": "a", "x": 1, "name_r": None, "y": None}
    assert rows[1] == {"id": 2, "name": "b", "x": 2, "name_r": "B", "y": 20}

    definition["nodes"][2]["config"]["join_type"] = "INNER"
    definition["edges"] = [
        {"from": "L", "to": "J", "port": None, "fromPort": "out"},
        {"from": "R", "to": "J", "port": None, "fromPort": "out"},
    ]
    res = await executor.preview_node(0, definition, "J", sample_size=100)
    assert [r["id"] for r in res["rows"]] == [2, 3]


async def test_union_alignment_and_distinct(executor, tmp_path):
    a = [{"id": 1, "name": "a"}, {"id": 2, "name": "b"}]
    b = [{"id": 2, "name": "b"}, {"id": 3, "extra": "z"}]
    a_path = write_json(tmp_path, "a.json", a)
    b_path = write_json(tmp_path, "b.json", b)
    definition = {
        "nodes": [
            {"id": "A", "kind": "src-json", "x": 0, "y": 0, "config": {"path": a_path}},
            {"id": "B", "kind": "src-json", "x": 0, "y": 200, "config": {"path": b_path}},
            {"id": "U", "kind": "tf-union", "x": 220, "y": 100, "config": {"mode": "all"}},
        ],
        "edges": [{"from": "A", "to": "U", "port": "in"}, {"from": "B", "to": "U", "port": "in"}],
    }  # fmt: skip
    res = await executor.preview_node(0, definition, "U", sample_size=100)
    assert len(res["rows"]) == 4
    assert res["rows"][3] == {"id": 3, "name": None, "extra": "z"}
    assert all(list(r) == ["id", "name", "extra"] for r in res["rows"])
    definition["nodes"][2]["config"]["mode"] = "distinct"
    res = await executor.preview_node(0, definition, "U", sample_size=100)
    assert len(res["rows"]) == 3


async def test_group_sort_limit_map(executor, tmp_path):
    rows = await transform(
        executor, tmp_path, PEOPLE, "tf-group",
        {"group_by": "name", "aggregates": "COUNT(*) AS n, MAX(age) AS oldest"},
    )  # fmt: skip
    by_name = {r["name"]: r for r in rows}
    assert by_name["Bob"] == {"name": "Bob", "n": 2, "oldest": 55}
    rows = await transform(executor, tmp_path, PEOPLE, "tf-sort", {"order_by": "age DESC"})
    assert [r["age"] for r in rows] == [55, 45, 35, 25]
    rows = await transform(executor, tmp_path, PEOPLE, "tf-limit", {"limit": "2", "offset": "1"})
    assert [r["id"] for r in rows] == [2, 3]
    mappings = [{"from": "id", "to": "user_id"}, {"from": "name", "to": "who"}]
    rows = await transform(
        executor, tmp_path, PEOPLE, "tf-map", {"mappings": mappings, "drop_unmapped": True}
    )
    assert rows[0] == {"user_id": 1, "who": "Ann"}
    rows = await transform(
        executor, tmp_path, PEOPLE, "tf-map",
        {"mappings": json.dumps([{"from": "id", "to": "user_id"}]), "drop_unmapped": False},
    )  # fmt: skip
    assert set(rows[0]) == {"user_id", "name", "age", "email", "city"}


# ------------------------------------------------------------------ #
# Cleaning                                                             #
# ------------------------------------------------------------------ #


async def test_dedupe(executor, tmp_path):
    rows = await transform(executor, tmp_path, PEOPLE, "cl-dedupe", {"by": "name", "keep": "first"})
    assert [r["id"] for r in rows] == [1, 2, 3]
    rows = await transform(executor, tmp_path, PEOPLE, "cl-dedupe", {"by": "name", "keep": "last"})
    assert [r["id"] for r in rows] == [1, 3, 4]
    rows = await transform(
        executor,
        tmp_path,
        PEOPLE,
        "cl-dedupe",
        {"by": "name", "keep": "first", "order_by": "age DESC"},
    )
    assert [r["id"] for r in rows] == [1, 3, 4]
    dupes = [{"a": 1}, {"a": 1}, {"a": 2}]
    rows = await transform(executor, tmp_path, dupes, "cl-dedupe", {"by": ""})
    assert rows == [{"a": 1}, {"a": 2}]


async def test_fill_trim_case(executor, tmp_path):
    rows = await transform(
        executor, tmp_path, PEOPLE, "cl-fill-null", {"column": "email", "value": "n/a"}
    )
    assert rows[2]["email"] == "n/a"
    rows = await transform(
        executor, tmp_path, [{"n": None}, {"n": 2}], "cl-fill-null", {"column": "n", "value": "0"}
    )
    assert rows[0]["n"] == 0
    rows = await transform(executor, tmp_path, PEOPLE, "cl-trim", {"columns": ""})
    assert [r["city"] for r in rows] == ["NYC", "la", "sf", "la"]
    rows = await transform(
        executor, tmp_path, PEOPLE, "cl-case", {"columns": "city", "mode": "title"}
    )
    assert rows[1]["city"] == "La" and rows[1]["name"] == "Bob"
    rows = await transform(executor, tmp_path, PEOPLE, "cl-case", {"columns": "", "mode": "upper"})
    assert rows[0]["name"] == "ANN" and rows[0]["age"] == 25


async def test_anon_methods(executor, tmp_path, monkeypatch):
    monkeypatch.setenv("DF_SALT", "pepper")
    rows = await transform(
        executor,
        tmp_path,
        PEOPLE,
        "cl-anon",
        {"columns": "email", "method": "hash", "salt": "env:DF_SALT"},
    )
    assert rows[1]["email"] == rows[3]["email"] and len(rows[1]["email"]) == 16
    assert rows[2]["email"] is None
    unsalted = await transform(
        executor, tmp_path, PEOPLE, "cl-anon", {"columns": "email", "method": "hash"}
    )
    assert unsalted[1]["email"] != rows[1]["email"]
    rows = await transform(
        executor, tmp_path, PEOPLE, "cl-anon", {"columns": "email,name", "method": "redact"}
    )
    assert rows[0]["email"] == "***" and rows[0]["name"] == "***"
    rows = await transform(
        executor, tmp_path, PEOPLE, "cl-anon", {"columns": "email", "method": "tokenize"}
    )
    assert rows[0]["email"].startswith("tok_") and len(rows[0]["email"]) == 12
    assert rows[1]["email"] == rows[3]["email"]
    rows = await transform(
        executor, tmp_path, PEOPLE, "cl-anon", {"columns": "email,name", "method": "fake"}
    )
    assert rows[0]["email"].startswith("user") and rows[0]["email"].endswith("@example.com")
    assert " " in rows[0]["name"]
    assert rows[1]["name"] == rows[3]["name"]  # deterministic
    assert fake_value("phone", "ab" * 32).startswith("555-01")
    assert fake_value("misc", "ab" * 32) == "val_ababab"


async def test_validate_drop_route_fail(executor, tmp_path):
    rules = [{"column": "email", "check": "not_null"}, {"expr": "age < 50"}]
    rows = await transform(
        executor, tmp_path, PEOPLE, "cl-validate", {"rules": rules, "on_fail": "drop"}
    )
    assert [r["id"] for r in rows] == [1, 2]

    src = write_json(tmp_path, "v.json", PEOPLE)
    definition = {
        "nodes": [
            {"id": "s", "kind": "src-json", "x": 0, "y": 0, "config": {"path": src}},
            {"id": "v", "kind": "cl-validate", "x": 220, "y": 0,
             "config": {"rules": rules, "on_fail": "route"}},
            {"id": "ok", "kind": "tf-limit", "x": 440, "y": 0, "config": {"limit": 100}},
            {"id": "bad", "kind": "tf-limit", "x": 440, "y": 200, "config": {"limit": 100}},
        ],
        "edges": [
            {"from": "s", "to": "v", "port": "in", "fromPort": "out"},
            {"from": "v", "to": "ok", "port": "in", "fromPort": "out"},
            {"from": "v", "to": "bad", "port": "in", "fromPort": "rejected"},
        ],
    }  # fmt: skip
    good = await executor.preview_node(0, definition, "ok", sample_size=100)
    bad = await executor.preview_node(0, definition, "bad", sample_size=100)
    assert [r["id"] for r in good["rows"]] == [1, 2]
    assert [r["id"] for r in bad["rows"]] == [3, 4]

    definition["nodes"][1]["config"]["on_fail"] = "fail"
    res = await executor.preview_node(0, definition, "v", sample_size=100)
    assert res["rows"] == [] and "row 3 failed" in res["error"]

    checks = [
        {"column": "email", "check": "unique"},
        {"column": "name", "check": "regex:[A-Z][a-z]+"},
        {"column": "age", "check": "numeric"},
        {"column": "city", "check": "non_empty"},
    ]
    rows = await transform(
        executor, tmp_path, PEOPLE, "cl-validate", {"rules": checks, "on_fail": "drop"}
    )
    assert [r["id"] for r in rows] == [1, 2, 3]


# ------------------------------------------------------------------ #
# Sources and file sinks                                               #
# ------------------------------------------------------------------ #


async def test_csv_round_trip(executor, tmp_path, pipeline_id):
    src = tmp_path / "in.csv"
    src.write_text("1;Ann\n2;Bob\n")
    out = tmp_path / "out" / "result.csv"
    definition = linear(
        ("src-csv", {"path": str(src), "delimiter": ";", "header": False}),
        ("snk-csv", {"path": str(out), "delimiter": ",", "header": True}),
    )
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    assert result["total_rows"] == 2
    assert result["node_rows"] == {"n1": {"in": 0, "out": 2}, "n2": {"in": 2, "out": 2}}
    with open(out, newline="") as fh:
        assert list(csv.reader(fh)) == [["c1", "c2"], ["1", "Ann"], ["2", "Bob"]]


async def test_csv_sink_ragged_rows(executor, tmp_path, pipeline_id):
    ragged = [{"a": 1}, {"a": 2, "b": {"nested": True}}, {"c": 3}]
    out = tmp_path / "ragged.csv"
    definition = linear(
        ("src-json", {"path": write_json(tmp_path, "ragged.json", ragged)}),
        ("snk-csv", {"path": str(out)}),
    )
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    with open(out, newline="") as fh:
        rows = list(csv.DictReader(fh))
    assert rows[0] == {"a": "1", "b": "", "c": ""}
    assert json.loads(rows[1]["b"]) == {"nested": True}
    assert rows[2]["c"] == "3"


async def test_json_round_trip_and_folder(executor, tmp_path, pipeline_id):
    folder = tmp_path / "folder"
    folder.mkdir()
    (folder / "a.csv").write_text("id,v\n1,x\n")
    (folder / "b.csv").write_text("id,v\n2,y\n")
    (folder / "ignore.txt").write_text("nope")
    out = tmp_path / "out.jsonl"
    definition = linear(
        (
            "src-folder",
            {"path": str(folder), "glob": "*.csv", "format": "csv", "add_source_column": True},
        ),
        ("snk-json", {"path": str(out), "format": "jsonl"}),
    )
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    lines = [json.loads(line) for line in out.read_text().splitlines()]
    assert lines == [
        {"id": "1", "v": "x", "_source_file": "a.csv"},
        {"id": "2", "v": "y", "_source_file": "b.csv"},
    ]

    back = linear(("src-json", {"path": str(out), "format": "jsonl"}))
    res = await executor.preview_node(pipeline_id, back, "n1", sample_size=1)
    assert res["rows"] == [{"id": "1", "v": "x", "_source_file": "a.csv"}]
    assert [c["type"] for c in res["columns"]] == ["INTEGER", "TEXT", "TEXT"]


async def test_ext_db_with_cipher_key(executor, tmp_path, pipeline_id):
    plain = make_sqlite(
        tmp_path / "plain.db",
        "CREATE TABLE t (id INTEGER, v TEXT); INSERT INTO t VALUES (1,'a'),(2,'b');",
    )
    enc = tmp_path / "enc.db"
    definition = linear(
        ("src-ext-db", {"path": plain, "table": "t", "where": "id > 1"}),
        (
            "snk-ext-db",
            {"path": str(enc), "table": "copy", "key": "secret", "write_mode": "replace"},
        ),
    )
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    with pytest.raises(sqlite3.DatabaseError):
        sqlite3.connect(enc).execute("SELECT count(*) FROM copy").fetchone()
    conn = sqlcipher3.connect(str(enc))
    conn.execute("PRAGMA key = 'secret'")
    assert conn.execute("SELECT id, v FROM copy").fetchall() == [(2, "b")]
    conn.close()

    back = linear(("src-ext-db", {"path": str(enc), "table": "copy", "key": "secret"}))
    res = await executor.preview_node(pipeline_id, back, "n1")
    assert res["rows"] == [{"id": 2, "v": "b"}]
    back["nodes"][0]["config"]["key"] = "wrong"
    res = await executor.preview_node(pipeline_id, back, "n1")
    assert res["rows"] == [] and res["error"]


@pytest.mark.skipif(not HAS_PYARROW, reason="pyarrow not installed")
async def test_parquet_round_trip(executor, tmp_path, pipeline_id):
    out = tmp_path / "p.parquet"
    definition = linear(
        ("src-json", {"path": write_json(tmp_path, "p.json", PEOPLE)}),
        ("snk-parquet", {"path": str(out)}),
    )
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    res = await executor.preview_node(
        pipeline_id, linear(("src-parquet", {"path": str(out)})), "n1", 10
    )
    assert [r["id"] for r in res["rows"]] == [1, 2, 3, 4]


@pytest.mark.skipif(HAS_PYARROW, reason="pyarrow is installed")
async def test_parquet_missing_dependency_message(executor, tmp_path):
    res = await executor.preview_node(
        0, linear(("src-parquet", {"path": str(tmp_path / "x.parquet")})), "n1"
    )
    assert res["error"] == PARQUET_ERROR


# ------------------------------------------------------------------ #
# Table sink via ConnectionManager                                     #
# ------------------------------------------------------------------ #


async def test_snk_table_append_replace_upsert(executor, conn_mgr, tmp_path, pipeline_id):
    db_path = make_sqlite(tmp_path / "target.db", "CREATE TABLE seed (x INTEGER);")
    conn_id, _ = await conn_mgr.open(db_path)
    src = write_json(tmp_path, "people.json", PEOPLE)

    definition = linear(
        ("src-json", {"path": src}),
        (
            "snk-table",
            {"conn": conn_id, "table": "people", "write_mode": "append", "batch_size": 2},
        ),
    )
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    assert result["total_rows"] == 4
    result = await executor.run(pipeline_id, definition, "full")
    assert len(read_sqlite(db_path, "SELECT * FROM people")) == 8
    types = {r["name"]: r["type"] for r in read_sqlite(db_path, "PRAGMA table_info(people)")}
    assert types == {
        "id": "INTEGER",
        "name": "TEXT",
        "age": "INTEGER",
        "email": "TEXT",
        "city": "TEXT",
    }

    definition["nodes"][1]["config"]["write_mode"] = "replace"
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok"
    assert len(read_sqlite(db_path, "SELECT * FROM people")) == 4

    updated = [{"id": 1, "name": "Ann2", "age": 26}, {"id": 9, "name": "New", "age": 1}]
    definition = linear(
        ("src-json", {"path": write_json(tmp_path, "upd.json", updated)}),
        ("snk-table", {"conn": conn_id, "table": "people", "write_mode": "upsert", "key": "id"}),
    )
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    rows = {r["id"]: r for r in read_sqlite(db_path, "SELECT * FROM people ORDER BY id")}
    assert len(rows) == 5
    assert rows[1]["name"] == "Ann2" and rows[1]["email"] == "ann@x.io"
    assert rows[9]["name"] == "New"
    indexes = read_sqlite(db_path, "PRAGMA index_list(people)")
    assert any(i["unique"] for i in indexes)

    # Mappings apply before write; dry/preview never write.
    definition = linear(
        ("src-json", {"path": src}),
        ("snk-table", {"conn": conn_id, "table": "mapped", "write_mode": "append",
                       "mappings": [{"from": "id", "to": "pk"}]}),
    )  # fmt: skip
    for mode in ("preview", "dry"):
        result = await executor.run(pipeline_id, definition, mode)
        assert result["status"] == "ok", result
        assert result["mode"] == mode
        assert read_sqlite(db_path, "SELECT name FROM sqlite_master WHERE name='mapped'") == []
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok"
    assert "pk" in read_sqlite(db_path, "SELECT * FROM mapped")[0]


async def test_transactional_rollback_on_failure(executor, conn_mgr, tmp_path, pipeline_id):
    db_path = make_sqlite(tmp_path / "tx.db", "CREATE TABLE seed (x INTEGER);")
    conn_id, _ = await conn_mgr.open(db_path)
    src = write_json(tmp_path, "tx.json", PEOPLE)
    definition = {
        "nodes": [
            {"id": "s", "kind": "src-json", "x": 0, "y": 0, "config": {"path": src}},
            {"id": "w1", "kind": "snk-table", "x": 220, "y": 0,
             "config": {"conn": conn_id, "table": "first", "write_mode": "append"}},
            {"id": "f", "kind": "tf-filter", "x": 220, "y": 200,
             "config": {"expr": "no_such_col > 1"}},
            {"id": "w2", "kind": "snk-table", "x": 440, "y": 200,
             "config": {"conn": conn_id, "table": "second", "write_mode": "append"}},
        ],
        "edges": [
            {"from": "s", "to": "w1", "port": "in"},
            {"from": "w1", "to": "f", "port": "in"},
            {"from": "f", "to": "w2", "port": "in"},
        ],
    }  # fmt: skip
    result = await executor.run(pipeline_id, definition, "full", transactional=True)
    assert result["status"] == "failed"
    assert "Node f (tf-filter)" in result["error"]
    assert read_sqlite(db_path, "SELECT name FROM sqlite_master WHERE name='first'") == []

    result = await executor.run(pipeline_id, definition, "full", transactional=False)
    assert result["status"] == "failed"
    assert len(read_sqlite(db_path, "SELECT * FROM first")) == 4


async def test_ad_hoc_connections_are_closed(executor, conn_mgr, tmp_path, pipeline_id):
    db_path = make_sqlite(
        tmp_path / "adhoc.db", "CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (1),(2);"
    )
    definition = linear(("src-table", {"conn": db_path, "table": "t", "where": "id = 2"}))
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok" and result["total_rows"] == 1
    assert await conn_mgr.list_connections() == []
    res = await executor.preview_node(pipeline_id, definition, "n1")
    assert res["rows"] == [{"id": 2}]
    assert await conn_mgr.list_connections() == []


# ------------------------------------------------------------------ #
# Schema ops, code, encryption                                         #
# ------------------------------------------------------------------ #


async def test_schema_ops(executor, conn_mgr, tmp_path, pipeline_id):
    db_path = make_sqlite(
        tmp_path / "schema.db",
        "CREATE TABLE t (id INTEGER, amount TEXT); INSERT INTO t VALUES (1,'2.5');",
    )
    conn_id, _ = await conn_mgr.open(db_path)
    definition = linear(
        (
            "sc-add-col",
            {"conn": conn_id, "table": "t", "column": "status", "type": "TEXT", "default": "new"},
        ),
        ("sc-cast-col", {"conn": conn_id, "table": "t", "column": "amount", "target_type": "REAL"}),
        ("sc-add-index", {"conn": conn_id, "table": "t", "columns": "id, status", "unique": True}),
    )
    result = await executor.run(pipeline_id, definition, "preview")
    assert result["status"] == "ok"
    assert [c["name"] for c in read_sqlite(db_path, "PRAGMA table_info(t)")] == ["id", "amount"]

    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    info = {c["name"]: c["type"] for c in read_sqlite(db_path, "PRAGMA table_info(t)")}
    assert info == {"id": "INTEGER", "status": "TEXT", "amount": "REAL"}
    assert read_sqlite(db_path, "SELECT * FROM t") == [{"id": 1, "status": "new", "amount": 2.5}]
    idx = read_sqlite(db_path, "PRAGMA index_list(t)")
    assert idx[0]["name"] == "idx_t_id_status" and idx[0]["unique"] == 1


async def test_co_sql_multi_input_and_guard(executor, tmp_path):
    a = write_json(tmp_path, "ca.json", [{"id": 1}, {"id": 2}])
    b = write_json(tmp_path, "cb.json", [{"id": 2}, {"id": 3}])
    definition = {
        "nodes": [
            {"id": "a", "kind": "src-json", "x": 0, "y": 0, "config": {"path": a}},
            {"id": "b", "kind": "src-json", "x": 0, "y": 200, "config": {"path": b}},
            {"id": "c", "kind": "co-sql", "x": 220, "y": 100,
             "config": {"sql": "SELECT _input.id FROM _input JOIN _input2 USING (id)"}},
        ],
        "edges": [{"from": "a", "to": "c", "port": "in"}, {"from": "b", "to": "c", "port": "in"}],
    }  # fmt: skip
    res = await executor.preview_node(0, definition, "c", 10)
    assert res["rows"] == [{"id": 2}]
    definition["nodes"][2]["config"]["sql"] = "DELETE FROM _input"
    res = await executor.preview_node(0, definition, "c", 10)
    assert "only SELECT or WITH" in res["error"]


async def test_scriptlets_fail_with_exact_text(executor, tmp_path, pipeline_id):
    for kind in ("co-py", "co-js"):
        definition = linear(
            ("src-json", {"path": write_json(tmp_path, "s.json", PEOPLE)}), (kind, {"script": "x"})
        )
        result = await executor.run(pipeline_id, definition, "full")
        assert result["status"] == "failed"
        assert result["error"] == f"Node n2 ({kind}): {SCRIPTLET_ERRORS[kind]}"


async def test_encrypt_decrypt_rekey(executor, conn_mgr, tmp_path, pipeline_id):
    plain = make_sqlite(tmp_path / "p.db", "CREATE TABLE t (id INTEGER); INSERT INTO t VALUES (7);")
    enc = tmp_path / "e.db"
    definition = linear(("en-encrypt", {"conn": plain, "out_path": str(enc), "key": "k1"}))
    result = await executor.run(pipeline_id, definition, "dry")
    assert result["status"] == "ok" and not enc.exists()
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    with pytest.raises(sqlite3.DatabaseError):
        sqlite3.connect(enc).execute("SELECT * FROM t").fetchall()

    definition = linear(("en-rekey", {"conn": str(enc), "key": "k1", "new_key": "k2"}))
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    assert await conn_mgr.list_connections() == []
    conn = sqlcipher3.connect(str(enc))
    conn.execute("PRAGMA key = 'k2'")
    assert conn.execute("SELECT id FROM t").fetchall() == [(7,)]
    conn.close()

    dec = tmp_path / "d.db"
    definition = linear(("en-decrypt", {"conn": str(enc), "key": "k2", "out_path": str(dec)}))
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    assert read_sqlite(dec, "SELECT id FROM t") == [{"id": 7}]

    # Raw hex keys are accepted too.
    hexkey = "x'" + "ab" * 32 + "'"
    enc2 = tmp_path / "e2.db"
    definition = linear(("en-encrypt", {"conn": plain, "out_path": str(enc2), "key": hexkey}))
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok", result
    conn = sqlcipher3.connect(str(enc2))
    conn.execute(f'PRAGMA key = "{hexkey}"')
    assert conn.execute("SELECT id FROM t").fetchall() == [(7,)]
    conn.close()


# ------------------------------------------------------------------ #
# Run lifecycle                                                        #
# ------------------------------------------------------------------ #


async def test_run_ok_events_and_run_row(executor, app_db, tmp_path, pipeline_id):
    out = tmp_path / "o.json"
    definition = linear(
        ("src-json", {"path": write_json(tmp_path, "in.json", PEOPLE)}),
        ("tf-filter", {"expr": "age > 30"}),
        ("snk-json", {"path": str(out)}),
    )
    events = []
    result = await executor.run(pipeline_id, definition, "full", on_event=events.append)
    assert result["status"] == "ok"
    assert result["total_rows"] == 3
    assert result["error"] is None
    assert result["node_rows"]["n2"] == {"in": 4, "out": 3}
    assert len(json.loads(out.read_text())) == 3

    assert all("type" in e and "timestamp" in e for e in events)
    assert all(e["timestamp"].endswith("+00:00") for e in events)
    statuses = [e for e in events if e["type"] == "status"]
    assert statuses[0] == {**statuses[0], "run_id": result["run_id"], "status": "running"}
    assert statuses[-1]["status"] == "ok"
    assert events[0]["type"] == "status"
    progress = {e["node_id"]: e for e in events if e["type"] == "progress"}
    assert progress["n2"]["in_rows"] == 4 and progress["n2"]["out_rows"] == 3
    edge_events = [e for e in events if e["type"] == "edge_progress"]
    edge_n2 = {k: edge_events[1][k] for k in ("from", "to", "from_port", "rows")}
    assert edge_n2 == {"from": "n2", "to": "n3", "from_port": "out", "rows": 3}
    logs = [e for e in events if e["type"] == "log"]
    assert logs and all({"run_id", "level", "node_id", "message"} <= set(e) for e in logs)

    runs = app_db.get_runs(pipeline_id)
    assert len(runs) == 1
    assert runs[0]["status"] == "ok" and runs[0]["total_rows"] == 3
    assert len(runs[0]["finished_at"]) == 19 and runs[0]["finished_at"][10] == " "
    assert len(app_db.get_run_events(result["run_id"])) == len(logs)
    assert active_runs() == []


async def test_run_total_rows_without_sinks(executor, tmp_path, pipeline_id):
    definition = linear(
        ("src-json", {"path": write_json(tmp_path, "in.json", PEOPLE)}), ("tf-limit", {"limit": 2})
    )
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "ok" and result["total_rows"] == 2


async def test_run_partial_failed_and_cycle(executor, tmp_path, pipeline_id):
    src = write_json(tmp_path, "in.json", PEOPLE)
    definition = linear(("src-json", {"path": src}), ("tf-bogus", {}))
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "partial" and result["error"] is None

    definition = linear(
        ("src-json", {"path": src}),
        ("cl-validate", {"rules": [{"expr": "age < 30"}], "on_fail": "drop"}),
    )
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "partial"

    definition = linear(("src-json", {"path": src}), ("tf-filter", {"expr": "nope > 1"}))
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "failed"
    assert result["error"].startswith("Node n2 (tf-filter): ")

    definition = linear(("src-json", {"path": src}), ("tf-limit", {"limit": 1}))
    definition["edges"].append({"from": "n2", "to": "n1", "port": "in"})
    result = await executor.run(pipeline_id, definition, "full")
    assert result["status"] == "failed" and "cycle" in result["error"]


async def test_run_cancelled(executor, app_db, tmp_path, pipeline_id):
    class SlowExecutor(NodeExecutor):
        kind = "test-slow"

        async def execute(self, ctx, node, inputs):
            return inputs.first

    register(SlowExecutor)
    try:
        definition = linear(
            ("src-json", {"path": write_json(tmp_path, "in.json", PEOPLE)}), ("test-slow", {})
        )
        seen = []

        def on_event(event):
            seen.append(event)
            if event["type"] == "status" and event["status"] == "running":
                assert active_runs() == [event["run_id"]]
                assert cancel_run(event["run_id"]) is True

        result = await executor.run(pipeline_id, definition, "full", on_event=on_event)
        assert result["status"] == "cancelled"
        assert result["error"] == "Run cancelled"
        assert seen[-1] == {**seen[-1], "type": "status", "status": "cancelled"}
        assert app_db.get_runs(pipeline_id)[0]["status"] == "cancelled"
        assert cancel_run(result["run_id"]) is False
        assert pipeline_executor.active_runs() == []
    finally:
        EXECUTORS.pop("test-slow", None)


# ------------------------------------------------------------------ #
# Preview / schema / validate                                          #
# ------------------------------------------------------------------ #


async def test_preview_and_infer_schema_shapes(executor, app_db, tmp_path, pipeline_id):
    src = write_json(tmp_path, "in.json", PEOPLE)
    definition = linear(
        ("src-json", {"path": src}),
        ("tf-filter", {"expr": "bad_col > 1"}),
        ("snk-json", {"path": str(tmp_path / "never.json")}),
    )
    res = await executor.preview_node(pipeline_id, definition, "n1", sample_size=2)
    assert res == {
        "columns": [
            {"name": "id", "type": "INTEGER"}, {"name": "name", "type": "TEXT"},
            {"name": "age", "type": "INTEGER"}, {"name": "email", "type": "TEXT"},
            {"name": "city", "type": "TEXT"},
        ],
        "rows": PEOPLE[:2],
        "error": None,
    }  # fmt: skip
    res = await executor.preview_node(pipeline_id, definition, "n2")
    assert res["rows"] == [] and "no such column" in res["error"]
    res = await executor.preview_node(pipeline_id, definition, "nope")
    assert res["error"] == "Node nope not found"

    schema = await executor.infer_schema(pipeline_id, definition, sample_size=3)
    assert set(schema) == {"n1", "n2", "n3"}
    assert [c["name"] for c in schema["n1"]["columns"]] == ["id", "name", "age", "email", "city"]
    assert schema["n1"]["error"] is None
    assert "no such column" in schema["n2"]["error"]
    assert schema["n3"] == {"columns": [], "error": "Upstream node n2 failed"}
    assert not (tmp_path / "never.json").exists()
    assert app_db.get_runs(pipeline_id) == []


async def test_validate(executor):
    definition = {
        "nodes": [
            {"id": "s1", "kind": "src-table", "x": 0, "y": 0, "config": {"conn": "", "table": ""}},
            {"id": "s2", "kind": "src-sql", "x": 0, "y": 0,
             "config": {"conn": "c", "sql": "DELETE FROM t"}},
            {"id": "j", "kind": "tf-join", "x": 0, "y": 0,
             "config": {"left_key": "id", "right_key": "id"}},
            {"id": "p", "kind": "co-py", "x": 0, "y": 0, "config": {"script": "print(1)"}},
            {"id": "u", "kind": "tf-unknown", "x": 0, "y": 0, "config": {}},
            {"id": "k", "kind": "snk-table", "x": 0, "y": 0,
             "config": {"conn": "c", "table": "t", "write_mode": "upsert"}},
            {"id": "f", "kind": "tf-filter", "x": 0, "y": 0, "config": {}},
            {"id": "e", "kind": "en-encrypt", "x": 0, "y": 0, "config": {"conn": "c"}},
        ],
        "edges": [{"from": "s2", "to": "j", "port": "L"}, {"from": "j", "to": "p", "port": "in"}],
    }  # fmt: skip
    issues = await executor.validate(definition)
    by_node = {}
    for issue in issues:
        assert {"node_id", "level", "message"} <= set(issue)
        by_node.setdefault(issue["node_id"], []).append((issue["level"], issue["message"]))

    assert ("error", "src-table: 'conn' is required") in by_node["s1"]
    assert ("error", "src-table: 'table' is required") in by_node["s1"]
    assert ("warn", "Source node has no outgoing edge") in by_node["s1"]
    assert any(lvl == "error" and "SELECT" in msg for lvl, msg in by_node["s2"])
    assert ("error", "tf-join requires two inputs (ports L and R)") in by_node["j"]
    assert ("error", SCRIPTLET_ERRORS["co-py"]) in by_node["p"]
    assert ("error", "Unknown node kind: tf-unknown") in by_node["u"]
    assert ("error", "snk-table: 'key' is required for upsert") in by_node["k"]
    assert ("warn", "Sink node has no incoming edge") in by_node["k"]
    assert ("error", "tf-filter: 'expr' is required") in by_node["f"]
    assert ("warn", "Node has no incoming edge") in by_node["f"]
    assert ("error", "en-encrypt: 'out_path' is required") in by_node["e"]
    assert ("error", "en-encrypt: 'key' is required") in by_node["e"]

    clean = linear(("src-csv", {"path": "a.csv"}), ("snk-json", {"path": "b.json"}))
    assert await executor.validate(clean) == []


def test_every_kind_reports_missing_required_fields():
    for kind, ex in EXECUTORS.items():
        issues = ex.validate({"id": "x", "kind": kind, "config": {}})
        if ex.required or kind in SCRIPTLET_ERRORS:
            assert issues and all(level == "error" for level, _ in issues), kind


# ------------------------------------------------------------------ #
# Templates and models                                                 #
# ------------------------------------------------------------------ #


def test_templates_parse_and_reference_registered_kinds():
    assert len(PIPELINE_TEMPLATES) == 6
    for tpl in PIPELINE_TEMPLATES:
        assert {"id", "name", "icon", "accent", "desc", "node_kinds", "definition"} <= set(tpl)
        parsed = PipelineDefinition.model_validate(tpl["definition"])
        assert parsed.nodes
        assert [n.kind for n in parsed.nodes] == tpl["node_kinds"]
        for node in parsed.nodes:
            assert node.kind in EXECUTORS, node.kind
            assert node.config
        ids = {n.id for n in parsed.nodes}
        for edge in parsed.edges:
            assert edge.from_node in ids and edge.to_node in ids
            assert edge.from_port == "out"
        xs = sorted(n.x for n in parsed.nodes)
        assert all(b - a == 220 for a, b in zip(xs, xs[1:], strict=False))


def test_edge_config_aliases():
    definition = PipelineDefinition.model_validate(
        {"nodes": [], "edges": [{"from": "a", "to": "b", "port": "R", "fromPort": "rejected"}]}
    )
    edge = definition.edges[0]
    assert edge.from_port == "rejected" and edge.port == "R"
    dumped = definition.model_dump()
    assert dumped["edges"][0] == {
        "from": "a", "to": "b", "port": "R", "fromPort": "rejected", "crossDb": False, "rows": 0
    }  # fmt: skip
    default = PipelineDefinition.model_validate({"edges": [{"from": "a", "to": "b"}]})
    assert default.edges[0].from_port == "out"

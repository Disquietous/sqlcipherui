"""Tests for SchemaService.get_completion_snapshot."""

import sqlite3

import pytest

from sqlcipherui_core.services.db_manager import DatabaseManager
from sqlcipherui_core.services.schema_service import SchemaService, _table_options

FIXTURE_SQL = """
CREATE TABLE authors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    upper_name TEXT GENERATED ALWAYS AS (upper(name)) VIRTUAL
);
CREATE TABLE books (
    isbn TEXT NOT NULL,
    edition INTEGER NOT NULL,
    author_id INTEGER REFERENCES authors(id),
    title TEXT,
    PRIMARY KEY (isbn, edition)
) WITHOUT ROWID, STRICT;
CREATE TABLE loans (
    id INTEGER PRIMARY KEY,
    isbn TEXT,
    edition INTEGER,
    FOREIGN KEY (isbn, edition) REFERENCES books(isbn, edition)
);
CREATE VIEW book_titles AS
    SELECT title, name FROM books JOIN authors ON authors.id = books.author_id;
CREATE INDEX idx_books_author ON books(author_id);
CREATE TRIGGER trg_loans AFTER INSERT ON loans BEGIN SELECT 1; END;
"""


@pytest.fixture
async def mgr(tmp_path):
    path = tmp_path / "main.db"
    conn = sqlite3.connect(path)
    conn.executescript(FIXTURE_SQL)
    conn.close()
    other = tmp_path / "other.db"
    conn = sqlite3.connect(other)
    conn.executescript("CREATE TABLE remote_notes (id INTEGER PRIMARY KEY, body TEXT);")
    conn.close()

    m = DatabaseManager()
    await m.open(str(path))
    await m.execute_modify(f"ATTACH DATABASE '{other}' AS aux")
    yield m
    await m.close()


async def test_snapshot_shape(mgr):
    snap = await SchemaService(mgr).get_completion_snapshot()

    assert snap.schema_version > 0
    assert "main" in snap.schemas and "aux" in snap.schemas

    by_name = {(t.schema_name, t.name): t for t in snap.tables}
    assert set(by_name) == {
        ("main", "authors"),
        ("main", "books"),
        ("main", "loans"),
        ("main", "book_titles"),
        ("aux", "remote_notes"),
    }

    authors = by_name[("main", "authors")]
    assert authors.kind == "table"
    cols = {c.name: c for c in authors.columns}
    assert cols["id"].pk and cols["name"].notnull
    assert cols["upper_name"].hidden == 2  # virtual generated column

    books = by_name[("main", "books")]
    assert books.without_rowid and books.strict
    assert [c.name for c in books.columns if c.pk] == ["isbn", "edition"]

    view = by_name[("main", "book_titles")]
    assert view.kind == "view"
    assert [c.name for c in view.columns] == ["title", "name"]

    assert by_name[("aux", "remote_notes")].columns[1].name == "body"


async def test_snapshot_fks_indexes_triggers(mgr):
    snap = await SchemaService(mgr).get_completion_snapshot()

    fks = {(f.from_table, f.from_column, f.to_table, f.to_column) for f in snap.foreign_keys}
    assert ("books", "author_id", "authors", "id") in fks
    assert ("loans", "isbn", "books", "isbn") in fks
    assert ("loans", "edition", "books", "edition") in fks

    assert [(i.name, i.table) for i in snap.indexes] == [("idx_books_author", "books")]
    assert [(t.name, t.table) for t in snap.triggers] == [("trg_loans", "loans")]


async def test_schema_version_changes_on_ddl(mgr):
    svc = SchemaService(mgr)
    before = await svc.get_schema_version()
    await mgr.execute_modify("CREATE TABLE extra (x)")
    after = await svc.get_schema_version()
    assert after > before
    snap = await svc.get_completion_snapshot()
    assert snap.schema_version == after
    assert any(t.name == "extra" for t in snap.tables)


@pytest.mark.parametrize(
    ("sql", "expected"),
    [
        ("CREATE TABLE t (a)", (False, False)),
        ("CREATE TABLE t (a) WITHOUT ROWID", (True, False)),
        ("CREATE TABLE t (a) STRICT", (False, True)),
        ("CREATE TABLE t (a) STRICT, WITHOUT ROWID", (True, True)),
        ("create table t (a)\n  without rowid;", (True, False)),
        (None, (False, False)),
    ],
)
def test_table_options(sql, expected):
    assert _table_options(sql) == expected

"""SQL pretty-printing for schema DDL, built on sqlparse.

sqlparse's generic ``reindent`` handles SELECT-style statements (views, index
WHERE clauses, trigger bodies) well but lays out CREATE TABLE column lists
poorly, so table definitions are formatted with a dedicated pass that uses
sqlparse's tokenizer to place each column / constraint declaration on its own
line.
"""

from __future__ import annotations

import logging
import re

import sqlparse
from sqlparse import sql as S
from sqlparse import tokens as T

logger = logging.getLogger(__name__)

INDENT = "    "
_CREATE_TABLE_RE = re.compile(r"^\s*create\s+(?:temp(?:orary)?\s+)?table\b", re.IGNORECASE)


def format_sql(sql: str | None) -> str | None:
    """Return a formatted copy of ``sql``, or ``None`` if it can't be formatted."""
    if not sql or not sql.strip():
        return None
    try:
        if _CREATE_TABLE_RE.match(sql):
            formatted = _format_create_table(sql)
            if formatted:
                return formatted
        return sqlparse.format(
            sql,
            reindent=True,
            keyword_case="upper",
            indent_width=4,
            strip_comments=False,
        ).strip()
    except Exception:  # pragma: no cover - defensive; formatting must never break the API
        logger.warning("Failed to format SQL", exc_info=True)
        return None


def _flatten_declarations(paren: S.Parenthesis) -> list[str]:
    """Split the contents of a CREATE TABLE parenthesis on top-level commas."""
    # Drop the surrounding "(" and ")" tokens.
    inner = list(paren.tokens[1:-1])

    # sqlparse often groups the column list into an IdentifierList; unwrap it so
    # we iterate its children directly.
    def expand(tokens):
        for t in tokens:
            if isinstance(t, S.IdentifierList):
                yield from expand(t.tokens)
            else:
                yield t

    decls: list[str] = []
    cur: list[str] = []
    for t in expand(inner):
        if t.ttype is T.Punctuation and t.value == ",":
            decls.append("".join(cur))
            cur = []
        else:
            cur.append(str(t))
    if "".join(cur).strip():
        decls.append("".join(cur))
    return [d for d in (_collapse(d) for d in decls) if d]


def _collapse(fragment: str) -> str:
    """Collapse whitespace and upper-case keywords in a single declaration."""
    return (
        sqlparse.format(fragment, keyword_case="upper", strip_whitespace=True)
        .strip()
        .rstrip(";")
        .strip()
    )


def _format_create_table(sql: str) -> str | None:
    statements = sqlparse.parse(sql)
    if not statements:
        return None
    stmt = statements[0]

    paren = None
    paren_idx = None
    for idx, tok in enumerate(stmt.tokens):
        if isinstance(tok, S.Parenthesis):
            paren, paren_idx = tok, idx
            break
    if paren is None:
        # e.g. CREATE TABLE ... AS SELECT — let the generic formatter handle it.
        return None

    head = "".join(str(t) for t in stmt.tokens[:paren_idx])
    tail = "".join(str(t) for t in stmt.tokens[paren_idx + 1 :])

    decls = _flatten_declarations(paren)
    if not decls:
        return None

    head_text = _collapse(head)
    tail_text = _collapse(tail)
    lines = [f"{INDENT}{d}{',' if i < len(decls) - 1 else ''}" for i, d in enumerate(decls)]
    suffix = f" {tail_text}" if tail_text else ""
    return f"{head_text} (\n" + "\n".join(lines) + f"\n){suffix};"

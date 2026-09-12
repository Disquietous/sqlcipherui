"""Minimal 5-field cron expression matching (minute hour day-of-month month day-of-week).

Supported per field: ``*``, single values, comma lists, ranges ``a-b``, steps ``*/n``
and ``a-b/n``. Day-of-week accepts 0-7 where both 0 and 7 mean Sunday.
"""

from __future__ import annotations

from datetime import datetime

# (name, min, max) for each of the five positional fields.
_FIELDS = (
    ("minute", 0, 59),
    ("hour", 0, 23),
    ("day-of-month", 1, 31),
    ("month", 1, 12),
    ("day-of-week", 0, 7),
)


def _parse_field(spec: str, lo: int, hi: int, name: str) -> set[int]:
    """Expand one cron field into the set of matching integer values."""
    values: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if not part:
            raise ValueError(f"{name}: empty list element")
        step = 1
        if "/" in part:
            base, _, step_s = part.partition("/")
            if not step_s.isdigit() or int(step_s) < 1:
                raise ValueError(f"{name}: invalid step '{step_s}'")
            step = int(step_s)
        else:
            base = part
        if base == "*":
            start, end = lo, hi
        elif "-" in base:
            a, _, b = base.partition("-")
            if not (a.isdigit() and b.isdigit()):
                raise ValueError(f"{name}: invalid range '{base}'")
            start, end = int(a), int(b)
            if start > end:
                raise ValueError(f"{name}: range start exceeds end in '{base}'")
        elif base.isdigit():
            start = int(base)
            # "5/10" behaves like "5-hi/10", matching common cron implementations.
            end = hi if "/" in part else start
        else:
            raise ValueError(f"{name}: invalid value '{base}'")
        if start < lo or end > hi:
            raise ValueError(f"{name}: value out of range {lo}-{hi} in '{part}'")
        values.update(range(start, end + 1, step))
    return values


def parse_cron(expr: str) -> list[set[int]]:
    """Parse a 5-field cron expression into per-field value sets. Raises ValueError."""
    if not isinstance(expr, str):
        raise ValueError("cron expression must be a string")
    parts = expr.split()
    if len(parts) != 5:
        raise ValueError(f"expected 5 fields, got {len(parts)}")
    sets = [
        _parse_field(spec, lo, hi, name)
        for spec, (name, lo, hi) in zip(parts, _FIELDS, strict=True)
    ]
    dow = sets[4]
    if 7 in dow:
        dow.discard(7)
        dow.add(0)
    return sets


def validate_cron(expr: str) -> str | None:
    """Return an error message when *expr* is not a valid cron expression, else None."""
    try:
        parse_cron(expr)
    except ValueError as exc:
        return str(exc)
    return None


def cron_matches(expr: str, dt: datetime) -> bool:
    """True when *dt* (to minute precision) satisfies *expr*.

    Day-of-month and day-of-week are combined with OR when both are restricted,
    following Vixie cron semantics.
    """
    minute, hour, dom, month, dow = parse_cron(expr)
    if dt.minute not in minute or dt.hour not in hour or dt.month not in month:
        return False
    # Python: Monday=0 ... Sunday=6; cron: Sunday=0 ... Saturday=6.
    cron_dow = (dt.weekday() + 1) % 7
    dom_ok = dt.day in dom
    dow_ok = cron_dow in dow
    dom_restricted = len(dom) < 31
    dow_restricted = len(dow) < 7
    if dom_restricted and dow_restricted:
        return dom_ok or dow_ok
    return dom_ok and dow_ok


__all__ = ["cron_matches", "parse_cron", "validate_cron"]

"""Tests for the 5-field cron matcher."""

from datetime import datetime

import pytest

from sqlcipherui_core.services.cron import cron_matches, parse_cron, validate_cron

# 2026-09-03 is a Thursday.
THU = datetime(2026, 9, 3, 14, 30)
SUN = datetime(2026, 9, 6, 0, 0)


def test_wildcards_match_anything():
    assert cron_matches("* * * * *", THU)
    assert cron_matches("* * * * *", SUN)


def test_exact_minute_hour():
    assert cron_matches("30 14 * * *", THU)
    assert not cron_matches("31 14 * * *", THU)
    assert not cron_matches("30 15 * * *", THU)


def test_lists_and_ranges():
    assert cron_matches("0,30 9-17 * * *", THU)
    assert not cron_matches("0,15 9-17 * * *", THU)
    assert not cron_matches("30 9-13 * * *", THU)


def test_steps():
    assert cron_matches("*/15 * * * *", THU)  # 30 is a multiple of 15
    assert not cron_matches("*/20 * * * *", THU)
    assert cron_matches("0-59/10 * * * *", THU)
    assert cron_matches("*/5 */2 * * *", THU)  # hour 14 is even
    assert not cron_matches("* */3 * * *", THU)  # 14 is not a multiple of 3


def test_day_of_week_sunday_aliases():
    assert cron_matches("0 0 * * 0", SUN)
    assert cron_matches("0 0 * * 7", SUN)
    assert not cron_matches("0 0 * * 1", SUN)
    assert cron_matches("30 14 * * 4", THU)  # Thursday = 4
    assert cron_matches("30 14 * * 1-5", THU)
    assert not cron_matches("30 14 * * 6,0", THU)


def test_day_of_month_and_month():
    assert cron_matches("30 14 3 9 *", THU)
    assert not cron_matches("30 14 4 9 *", THU)
    assert not cron_matches("30 14 3 10 *", THU)


def test_dom_and_dow_are_or_when_both_restricted():
    # Vixie cron: if both fields are restricted, either may match.
    assert cron_matches("30 14 1 * 4", THU)  # dom mismatch, dow matches
    assert cron_matches("30 14 3 * 1", THU)  # dom matches, dow mismatch
    assert not cron_matches("30 14 1 * 1", THU)


def test_parse_normalizes_dow_seven():
    fields = parse_cron("* * * * 7")
    assert fields[4] == {0}


@pytest.mark.parametrize(
    "expr",
    [
        "",
        "* * * *",
        "* * * * * *",
        "60 * * * *",
        "* 24 * * *",
        "* * 0 * *",
        "* * 32 * *",
        "* * * 13 *",
        "* * * * 8",
        "*/0 * * * *",
        "5-1 * * * *",
        "a * * * *",
        "1,,2 * * * *",
        "* * * * mon",
    ],
)
def test_validate_rejects_bad_expressions(expr):
    assert validate_cron(expr) is not None


@pytest.mark.parametrize(
    "expr", ["* * * * *", "0 0 * * 0", "*/5 * * * *", "0 9-17/2 1,15 * 1-5", "5/10 * * * *"]
)
def test_validate_accepts_good_expressions(expr):
    assert validate_cron(expr) is None


def test_cron_matches_raises_on_invalid():
    with pytest.raises(ValueError):
        cron_matches("bogus", THU)

#!/usr/bin/env python3
import datetime as dt
import importlib.util
from pathlib import Path
import re
import sys

MODULE_PATH = Path(__file__).with_name("kgmu-expand-weekly.py")
spec = importlib.util.spec_from_file_location("kgmu_expand_weekly_base", MODULE_PATH)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

# Disable the legacy note-style override heuristic entirely. Date tokens and
# time tokens both use the dd.mm shape, so a sequence such as
# `26.01-25.05, 01.06-13.45-16.55` can otherwise be misread as an override for
# 26.01. Exact constructs of the form DD.MM-HH.MM-HH.MM remain supported by
# DIRECT_OVERRIDE_RE in the base parser.
base.NOTE_OVERRIDE_RE = re.compile(r"(?!x)x")

# A date followed by a time without the explicit DD.MM-HH.MM-HH.MM delimiter is
# plausible source information, but not safe to infer automatically. Mark such
# segments for review so qaPassed/publishable remains false until the notation
# is handled explicitly.
NOTE_DATE_TIME_RE = re.compile(
    rf"(?<!\d)(?P<date>{base.DATE_TOKEN})\s+(?P<times>{base.TIME_RUN})(?!\d)"
)

_base_parse_segment = base.parse_segment


def safe_parse_segment(segment, start, end, weekday, holidays):
    events, reason, warnings = _base_parse_segment(segment, start, end, weekday, holidays)
    warnings = list(warnings or [])
    for match in NOTE_DATE_TIME_RE.finditer(segment):
        if base.valid_date_token(match.group("date"), start, end):
            marker = "date-time-note-requires-review"
            if marker not in warnings:
                warnings.append(marker)
            break
    return events, reason, warnings


base.parse_segment = safe_parse_segment


def self_test():
    base.self_test()
    start = dt.date(2026, 1, 26)
    end = dt.date(2026, 6, 6)
    holidays = {dt.date(2026, 5, 1), dt.date(2026, 5, 9)}

    # Regression: the range start must keep the ordinary lesson time. Only the
    # explicit 01.06-13.45-16.55 suffix is an override.
    segment = "13.45-15.15 Гистология, эмбриология, цитология 26.01-25.05, 01.06-13.45-16.55"
    events, reason, warnings = safe_parse_segment(segment, start, end, 0, holidays)
    assert reason is None and not warnings
    first = next(item for item in events if item["date"] == "2026-01-26")
    ordinary = next(item for item in events if item["date"] == "2026-05-25")
    override = next(item for item in events if item["date"] == "2026-06-01")
    assert first["start"] == "13:45" and first["end"] == "15:15"
    assert ordinary["start"] == "13:45" and ordinary["end"] == "15:15"
    assert override["start"] == "13:45" and override["end"] == "16:55"

    # Free-text `date time` notes are visible to QA but are never silently
    # promoted to trusted time overrides.
    segment = "13.00-14.30 Учебная практика 06.02-27.03. Зачет с оценкой 22.05 16.20-18.45"
    events, reason, warnings = safe_parse_segment(segment, start, end, 4, holidays)
    assert reason is None and events
    assert "date-time-note-requires-review" in warnings

    print("kgmu weekly safe parser regression tests: OK")


def main():
    if "--self-test" in sys.argv:
        self_test()
        return
    base.main()


if __name__ == "__main__":
    main()

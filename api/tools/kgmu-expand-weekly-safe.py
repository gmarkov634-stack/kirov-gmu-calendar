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

# A note-style time override is only accepted after a semicolon, for patterns
# like `; 05.06- зачет с оценкой 10.55-13.20`. Direct constructs such as
# `01.06-13.45-16.55` are handled by DIRECT_OVERRIDE_RE in the base parser.
# This prevents a date range followed by a direct override from being
# misinterpreted as an override on the range start date.
base.NOTE_OVERRIDE_RE = re.compile(
    rf";\s*(?P<date>{base.DATE_TOKEN})\s*-\s*[^;]{{1,90}}?(?P<times>{base.TIME_RUN})"
)


def self_test():
    base.self_test()
    start = dt.date(2026, 1, 26)
    end = dt.date(2026, 6, 6)
    holidays = {dt.date(2026, 5, 1), dt.date(2026, 5, 9)}

    segment = "13.45-15.15 Гистология, эмбриология, цитология 26.01-25.05, 01.06-13.45-16.55"
    events, reason, warnings = base.parse_segment(segment, start, end, 0, holidays)
    assert reason is None and not warnings
    first = next(item for item in events if item["date"] == "2026-01-26")
    assert first["start"] == "13:45" and first["end"] == "15:15"
    last = next(item for item in events if item["date"] == "2026-06-01")
    assert last["start"] == "13:45" and last["end"] == "16:55"

    segment = "15.30-17.00 История России 30.01-29.05; 05.06- зачет с оценкой 10.55-13.20 1-306"
    events, reason, warnings = base.parse_segment(segment, start, end, 4, holidays)
    assert reason is None and not warnings
    normal = next(item for item in events if item["date"] == "2026-01-30")
    assert normal["start"] == "15:30" and normal["end"] == "17:00"
    exam = next(item for item in events if item["date"] == "2026-06-05")
    assert exam["start"] == "10:55" and exam["end"] == "13:20"

    print("kgmu weekly safe parser regression tests: OK")


def main():
    if "--self-test" in sys.argv:
        self_test()
        return
    base.main()


if __name__ == "__main__":
    main()

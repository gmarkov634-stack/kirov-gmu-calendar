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

# Exact constructs DD.MM-HH.MM-HH.MM are trusted date-specific overrides.
# Example: 01.06-13.45-16.55 means that only 01 June uses 13:45-16:55.
# The old broad note heuristic is disabled because DD.MM is also used for dates.
base.NOTE_OVERRIDE_RE = re.compile(r"(?!x)x")

NOTE_DATE_TIME_RE = re.compile(
    rf"(?<!\d)(?P<date>{base.DATE_TOKEN})\s+(?P<times>{base.TIME_RUN})(?!\d)"
)


def _valid_clock_token(value):
    try:
        hour, minute = map(int, value.replace(":", ".").split("."))
    except (TypeError, ValueError):
        return False
    return 0 <= hour <= 23 and 0 <= minute <= 59


def _valid_time_run(value):
    pairs = re.findall(
        r"(\d{1,2}[.:]\d{2})\s*-\s*(\d{1,2}[.:]\d{2})",
        value,
    )
    return bool(pairs) and all(
        _valid_clock_token(start) and _valid_clock_token(end)
        for start, end in pairs
    )


def _same_cell_period(rows):
    candidates = []
    for row, values in sorted(rows.items()):
        for value in values.values():
            match = base.PERIOD_RE.search(value)
            if not match:
                continue
            try:
                start = base.parse_full_date(match.group(1))
                end = base.parse_full_date(match.group(2))
            except (TypeError, ValueError):
                continue
            duration = (end - start).days
            if 28 <= duration <= 260:
                candidates.append((row, start, end))
    if not candidates:
        return None
    # Prefer the earliest explicit semester range in a single cell. This excludes
    # approval/signature dates that previously bled into the range search.
    _, start, end = min(candidates, key=lambda item: item[0])
    return start, end


_base_infer_file_context = base.infer_file_context


def safe_infer_file_context(path, rows):
    context = _base_infer_file_context(path, rows)
    if not context:
        return context
    period = _same_cell_period(rows)
    if period:
        context = dict(context)
        context["periodStart"], context["periodEnd"] = period
    return context


base.infer_file_context = safe_infer_file_context


def safe_find_time_spans(text, start, end):
    overrides = []
    for match in base.DIRECT_OVERRIDE_RE.finditer(text):
        if not base.valid_date_token(match.group("date"), start, end):
            continue
        if not _valid_time_run(match.group("times")):
            continue
        overrides.append(
            (match.span(), match.span("times"), match.group("date"), match.group("times"))
        )

    override_whole_spans = [item[0] for item in overrides]
    spans = [
        (time_span[0], time_span[1], times, "override", date)
        for _, time_span, date, times in overrides
    ]

    for match in base.TIME_RUN_RE.finditer(text):
        span = match.span()
        if any(base.overlap(span, other) for other in override_whole_spans):
            continue
        candidate = match.group(0)
        # A plain DD.MM-DD.MM sequence inside the body is a date range, not a
        # clock interval. Leading lesson time still wins because it starts at 0.
        date_range = re.fullmatch(
            rf"({base.DATE_TOKEN})\s*-\s*({base.DATE_TOKEN})",
            candidate,
        )
        if span[0] > 3 and date_range and base.looks_like_date_range(date_range, start, end):
            continue
        # Invalid clock values such as 26.01 cannot be lesson times. This also
        # prevents `26.01-11.05, 18.05-9.00` from swallowing a date range plus
        # the beginning of a date-specific override.
        if not _valid_time_run(candidate):
            continue
        spans.append((span[0], span[1], candidate, "normal", None))
    return sorted(spans)


base.find_time_spans = safe_find_time_spans

_base_parse_segment = base.parse_segment


def safe_parse_segment(segment, start, end, weekday, holidays):
    events, reason, warnings = _base_parse_segment(segment, start, end, weekday, holidays)
    warnings = list(warnings or [])
    # Free-text `date time` notes are visible to QA but are not silently trusted.
    # Exact `DD.MM-HH.MM-HH.MM` is handled above and does not trigger this warning.
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
    end = dt.date(2026, 6, 13)
    holidays = {dt.date(2026, 5, 1), dt.date(2026, 5, 9)}

    # User-confirmed semantics: only the named date gets the changed time.
    segment = "13.45-15.15 Гистология, эмбриология, цитология 26.01-25.05, 01.06-13.45-16.55"
    events, reason, warnings = safe_parse_segment(segment, start, end, 0, holidays)
    assert reason is None and not warnings
    first = next(item for item in events if item["date"] == "2026-01-26")
    ordinary = next(item for item in events if item["date"] == "2026-05-25")
    override = next(item for item in events if item["date"] == "2026-06-01")
    assert first["start"] == "13:45" and first["end"] == "15:15"
    assert ordinary["start"] == "13:45" and ordinary["end"] == "15:15"
    assert override["start"] == "13:45" and override["end"] == "16:55"

    # A date range must never be consumed as a clock run.
    segment = "8.00-9.30, 9.40-10.25 Биология 26.01-11.05, 18.05-9.00-10.30"
    events, reason, warnings = safe_parse_segment(segment, start, end, 0, holidays)
    assert reason is None and not warnings
    jan = next(item for item in events if item["date"] == "2026-01-26")
    may = next(item for item in events if item["date"] == "2026-05-18")
    assert jan["start"] == "08:00" and jan["end"] == "10:25"
    assert may["start"] == "09:00" and may["end"] == "10:30"

    # Period extraction must use the semester range cell, not an approval date.
    rows = {
        4: {2: "26.12.2025", 3: "РАСПИСАНИЕ НА ВТОРОЕ ПОЛУГОДИЕ 2025-2026 учебного года"},
        5: {3: "26.01.2026 (1 неделя) - 13.06.2026"},
    }
    period = _same_cell_period(rows)
    assert period == (dt.date(2026, 1, 26), dt.date(2026, 6, 13))

    # Free-text `date time` notes remain blocked for manual QA.
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

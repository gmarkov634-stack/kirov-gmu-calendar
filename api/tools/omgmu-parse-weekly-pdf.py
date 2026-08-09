#!/usr/bin/env python3
"""Parse merged ОмГМУ weekly schedule tables directly from PDF geometry."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

TIME_RE = re.compile(r"(?<!\d)(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})(?!\d)")
RANGE_RE = re.compile(r"(?<!\d)(\d{2})\.(\d{2})\s*[-–]\s*(\d{2})\.(\d{2})(?!\d)")
SINGLE_DATE_RE = re.compile(r"(?<!\d)(\d{2})\.(\d{2})(?!\d)")
COUNT_MARKER_RE = re.compile(
    r",?\s*\d+(?:/\d+)?\s*(?:зан\.?|з\.?|лекц(?:ий|ии|ия|и)?\.?|лек\.?|cl\.?)\s*: ?",
    re.IGNORECASE,
)
GROUP_RE = re.compile(r"\d{3,4}")
HOLIDAYS = {"2026-05-01", "2026-05-09", "2026-06-12"}


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip(" ,;\t")


def valid_time_matches(value: str) -> list[re.Match[str]]:
    matches: list[re.Match[str]] = []
    for match in TIME_RE.finditer(value):
        start_hour, start_minute, end_hour, end_minute = map(int, match.groups())
        duration = end_hour * 60 + end_minute - (start_hour * 60 + start_minute)
        if (
            0 <= start_hour <= 23
            and 0 <= end_hour <= 23
            and 0 <= start_minute <= 59
            and 0 <= end_minute <= 59
            and 0 < duration <= 300
        ):
            matches.append(match)
    return matches


def split_event_segments(cell: str) -> list[str]:
    value = compact(cell)
    matches = valid_time_matches(value)
    return [
        value[match.start() : (matches[index + 1].start() if index + 1 < len(matches) else len(value))].strip(" ,;")
        for index, match in enumerate(matches)
    ]


def valid_semester_date(day: int, month: int) -> bool:
    if month < 4 or month > 8:
        return False
    try:
        date(2026, month, day)
        return True
    except ValueError:
        return False


def protected_spans(matches: list[re.Match[str]]) -> list[tuple[int, int]]:
    return [(match.start(), match.end()) for match in matches]


def overlaps(match: re.Match[str], spans: list[tuple[int, int]]) -> bool:
    return any(match.start() < end and match.end() > start for start, end in spans)


def extract_dates(value: str) -> tuple[list[str], int | None]:
    ranges = list(RANGE_RE.finditer(value))
    range_spans = protected_spans(ranges)
    singles = [match for match in SINGLE_DATE_RE.finditer(value) if not overlaps(match, range_spans)]
    result: set[str] = set()
    last_end: int | None = None

    for match in ranges:
        start_day, start_month, end_day, end_month = map(int, match.groups())
        if not valid_semester_date(start_day, start_month) or not valid_semester_date(end_day, end_month):
            continue
        cursor = date(2026, start_month, start_day)
        end = date(2026, end_month, end_day)
        if end < cursor or (end - cursor).days > 180:
            continue
        while cursor <= end:
            if cursor.isoformat() not in HOLIDAYS:
                result.add(cursor.isoformat())
            cursor += timedelta(days=7)
        last_end = max(last_end or 0, match.end())

    for match in singles:
        day, month = map(int, match.groups())
        if not valid_semester_date(day, month):
            continue
        value_date = date(2026, month, day).isoformat()
        if value_date not in HOLIDAYS:
            result.add(value_date)
        last_end = max(last_end or 0, match.end())

    return sorted(result), last_end


def extract_title_and_location(value: str, date_end: int | None) -> tuple[str, str]:
    ranges = list(RANGE_RE.finditer(value))
    range_spans = protected_spans(ranges)
    singles = [match for match in SINGLE_DATE_RE.finditer(value) if not overlaps(match, range_spans)]
    cut = len(value)
    marker = COUNT_MARKER_RE.search(value)
    if marker:
        cut = min(cut, marker.start())
    if ranges:
        cut = min(cut, ranges[0].start())
    if singles:
        cut = min(cut, singles[0].start())

    title = value[:cut].strip(" ,;.")
    title = re.sub(r"^[,.;\s]+", "", title)
    title = re.sub(r"\(\s*\)", "", title)
    title = re.sub(r"\s+", " ", title).strip(" ,;.")

    location = ""
    if date_end is not None:
        candidate = value[date_end:].strip(" ,;.")
        if candidate and not re.search(r"\b(?:зан|з|лекц)\b", candidate, re.IGNORECASE):
            location = candidate
    return title, location


def parse_event_segment(segment: str) -> dict[str, Any] | None:
    time_matches = valid_time_matches(segment)
    if not time_matches:
        return None
    match = time_matches[0]
    start_hour, start_minute, end_hour, end_minute = map(int, match.groups())
    remainder = segment[match.end() :].strip()
    dates, date_end = extract_dates(remainder)
    title, location = extract_title_and_location(remainder, date_end)
    if not title or not dates:
        return None
    return {
        "title": title,
        "dates": dates,
        "startTime": f"{start_hour:02d}:{start_minute:02d}",
        "endTime": f"{end_hour:02d}:{end_minute:02d}",
        "location": location,
    }


def table_groups(table: list[list[Any]]) -> list[str]:
    if not table:
        return []
    return [compact(value) for value in table[0][1:] if GROUP_RE.fullmatch(compact(value))]


def select_schedule_table(pdf_path: Path) -> list[list[Any]]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required; install tools/requirements-omgmu.txt") from error

    candidates: list[tuple[int, list[list[Any]]]] = []
    with pdfplumber.open(pdf_path) as document:
        for page in document.pages:
            page_text = page.extract_text() or ""
            for table in page.extract_tables():
                groups = table_groups(table)
                if len(groups) < 2:
                    continue
                score = len(groups) * 10 + (100 if "РАСПИСАНИЕ" in page_text.upper() else 0)
                candidates.append((score, table))
    if not candidates:
        raise RuntimeError(f"No schedule table found in {pdf_path}")
    return max(candidates, key=lambda item: item[0])[1]


def event_id(group: str, event_date: str, start_time: str, title: str) -> str:
    digest = hashlib.sha256(title.encode("utf-8")).hexdigest()[:10]
    return f"omgmu-{group}-{event_date}-{start_time.replace(':', '')}-{digest}"


def parse_table(table: list[list[Any]], *, course: int, stream: str | None, source_url: str | None) -> list[dict[str, Any]]:
    groups = table_groups(table)
    if len(groups) < 2:
        raise RuntimeError("Schedule table does not contain group headers")

    events: dict[str, list[dict[str, Any]]] = {group: [] for group in groups}
    warnings: list[str] = []

    for row_index, row in enumerate(table[1:], start=1):
        cells = list(row[1 : 1 + len(groups)])
        cells += [None] * (len(groups) - len(cells))
        index = 0
        while index < len(groups):
            cell = cells[index]
            if cell is None:
                index += 1
                continue
            end_index = index + 1
            while end_index < len(groups) and cells[end_index] is None:
                end_index += 1
            covered_groups = groups[index:end_index]
            value = compact(cell)
            if value:
                segments = split_event_segments(value)
                if not segments and TIME_RE.search(value):
                    warnings.append(f"row {row_index}, groups {covered_groups[0]}-{covered_groups[-1]}: invalid time")
                for segment in segments:
                    parsed = parse_event_segment(segment)
                    if not parsed:
                        warnings.append(f"row {row_index}, groups {covered_groups[0]}-{covered_groups[-1]}: unparsed {segment[:120]}")
                        continue
                    for group in covered_groups:
                        for event_date in parsed["dates"]:
                            events[group].append(
                                {
                                    "id": event_id(group, event_date, parsed["startTime"], parsed["title"]),
                                    "title": parsed["title"],
                                    "start": f"{event_date}T{parsed['startTime']}:00+06:00",
                                    "end": f"{event_date}T{parsed['endTime']}:00+06:00",
                                    "location": parsed["location"],
                                    "sourceType": "weekly-pdf-table",
                                    "course": course,
                                    "stream": stream,
                                }
                            )
            index = end_index

    schedules: list[dict[str, Any]] = []
    for group in groups:
        unique: dict[tuple[str, str, str, str], dict[str, Any]] = {}
        for event in events[group]:
            key = (event["start"], event["end"], event["title"], event["location"])
            unique[key] = event
        normalized_events = sorted(unique.values(), key=lambda event: (event["start"], event["end"], event["title"]))
        schedules.append(
            {
                "version": 1,
                "university": "omgmu",
                "universityName": "ОмГМУ",
                "program": "medicine-international",
                "course": course,
                "stream": stream,
                "academicYear": "2025-2026",
                "semester": 2,
                "timezone": "Asia/Omsk",
                "group": {
                    "id": f"omgmu:medicine-international:{course}:{f'stream-{stream}:' if stream else ''}{group}",
                    "code": group,
                    "displayName": f"Группа {group}",
                },
                "sources": ([{"url": source_url, "part": "combined-pdf-table"}] if source_url else []),
                "events": normalized_events,
                "importWarnings": warnings,
            }
        )
    return schedules


def self_test() -> None:
    table = [
        ["", "1101", "1102", "1103"],
        ["", "08.00-09.40 Анатомия, 3 зан.: 06.04-20.04", None, "10.00-11.40 Химия, 2 зан.: 07.04, 14.04"],
        [None, "11.30-13.10 Иностранный язык, 1 зан.: 11.04", None, ""],
    ]
    schedules = parse_table(table, course=1, stream="1", source_url=None)
    by_group = {item["group"]["code"]: item for item in schedules}
    assert len(by_group["1101"]["events"]) == 4
    assert len(by_group["1102"]["events"]) == 4
    assert len(by_group["1103"]["events"]) == 2
    dates_1101 = {event["start"][:10] for event in by_group["1101"]["events"]}
    assert "2026-04-11" in dates_1101
    assert all(not value.startswith("2026-10") for value in dates_1101)
    assert all("11.04" not in event["title"] for event in by_group["1101"]["events"])
    print("ОмГМУ PDF table parser self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--course", type=int)
    parser.add_argument("--stream", default=None)
    parser.add_argument("--source", default=None)
    parser.add_argument("--output", default="data/imports/omgmu-schedules")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if not args.input or not args.course:
        parser.error("--input and --course are required")

    input_path = Path(args.input).resolve()
    output_dir = Path(args.output).resolve()
    table = select_schedule_table(input_path)
    schedules = parse_table(table, course=args.course, stream=args.stream or None, source_url=args.source)
    output_dir.mkdir(parents=True, exist_ok=True)
    event_count = 0
    for schedule in schedules:
        group = schedule["group"]["code"]
        target = output_dir / f"{group}.json"
        target.write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        event_count += len(schedule["events"])
    print(f"Parsed {event_count} events for {len(schedules)} ОмГМУ groups from PDF table")
    if not schedules or not event_count or any(not schedule["events"] for schedule in schedules):
        raise SystemExit(2)


if __name__ == "__main__":
    main()

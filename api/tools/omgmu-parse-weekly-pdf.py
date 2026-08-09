#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

TIME_RE = re.compile(r"(?<!\d)(\d{1,2})[.:/](\d{2})\s*[-–]\s*(\d{1,2})[.:/](\d{2})(?!\d)")
TIME_START_RE = re.compile(r"^\s*[,;]?\s*(\d{1,2})[.:/](\d{2})\s*[-–]\s*(\d{1,2})[.:/](\d{2})(?!\d)")
RANGE_RE = re.compile(r"(?<!\d)(\d{2})\.(\d{2})\s*[-–]\s*(\d{2})\.(\d{2})(?!\d)")
SINGLE_DATE_RE = re.compile(r"(?<!\d)(\d{2})\.(\d{2})(?!\d)")
COUNT_MARKER_RE = re.compile(
    r",?\s*\d+(?:/\d+)?\s*(?:зан(?:ятий|ятие|ятия)?\.?|з\.?|лекц(?:ий|ии|ия|и)?\.?|лек\.?|cl\.?)\s*[:.]*",
    re.IGNORECASE,
)
GROUP_RE = re.compile(r"\d{3,4}")
HOLIDAYS = {"2026-05-01", "2026-05-09", "2026-06-12"}
DAY_BY_NAME = {
    "понедельник": 0,
    "вторник": 1,
    "среда": 2,
    "четверг": 3,
    "пятница": 4,
    "суббота": 5,
}


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip(" ,;\t")


def valid_time(match: re.Match[str]) -> bool:
    start_hour, start_minute, end_hour, end_minute = map(int, match.groups())
    duration = end_hour * 60 + end_minute - (start_hour * 60 + start_minute)
    return (
        0 <= start_hour <= 23
        and 0 <= end_hour <= 23
        and 0 <= start_minute <= 59
        and 0 <= end_minute <= 59
        and 0 < duration <= 300
    )


def split_event_segments(cell: str) -> list[str]:
    segments: list[str] = []
    current: list[str] = []
    for raw_line in str(cell or "").splitlines():
        line = re.sub(r"(\d{1,2}[.:/]\d)\s+(\d)", r"\1\2", raw_line.strip())
        if not line:
            continue
        match = TIME_START_RE.match(line)
        if match and valid_time(match):
            if current:
                segments.append(" ".join(current).strip(" ,;"))
            current = [line]
        elif current:
            current.append(line)
    if current:
        segments.append(" ".join(current).strip(" ,;"))
    return segments


def valid_semester_date(day: int, month: int) -> bool:
    if not 4 <= month <= 8:
        return False
    try:
        date(2026, month, day)
        return True
    except ValueError:
        return False


def overlaps(match: re.Match[str], spans: list[tuple[int, int]]) -> bool:
    return any(match.start() < end and match.end() > start for start, end in spans)


def extract_dates(value: str) -> tuple[list[str], int | None, list[str]]:
    ranges = list(RANGE_RE.finditer(value))
    range_spans = [(match.start(), match.end()) for match in ranges]
    singles = [match for match in SINGLE_DATE_RE.finditer(value) if not overlaps(match, range_spans)]
    dates: set[str] = set()
    last_date_end: int | None = None
    errors: list[str] = []

    for match in ranges:
        start_day, start_month, end_day, end_month = map(int, match.groups())
        if not valid_semester_date(start_day, start_month) or not valid_semester_date(end_day, end_month):
            errors.append(f"invalid date range {match.group(0)}")
            continue
        cursor = date(2026, start_month, start_day)
        end = date(2026, end_month, end_day)
        if end < cursor or (end - cursor).days > 180:
            errors.append(f"invalid date range {match.group(0)}")
            continue
        while cursor <= end:
            if cursor.isoformat() not in HOLIDAYS:
                dates.add(cursor.isoformat())
            cursor += timedelta(days=7)
        last_date_end = max(last_date_end or 0, match.end())

    for match in singles:
        day, month = map(int, match.groups())
        if not valid_semester_date(day, month):
            continue
        event_date = date(2026, month, day).isoformat()
        if event_date not in HOLIDAYS:
            dates.add(event_date)
        last_date_end = max(last_date_end or 0, match.end())

    return sorted(dates), last_date_end, errors


def extract_title_and_location(value: str, last_date_end: int | None) -> tuple[str, str]:
    ranges = list(RANGE_RE.finditer(value))
    range_spans = [(match.start(), match.end()) for match in ranges]
    singles = [match for match in SINGLE_DATE_RE.finditer(value) if not overlaps(match, range_spans)]
    candidates: list[int] = []
    marker = COUNT_MARKER_RE.search(value)
    if marker:
        candidates.append(marker.start())
    if ranges:
        candidates.append(ranges[0].start())
    if singles:
        candidates.append(singles[0].start())
    cut = min(candidates) if candidates else len(value)
    title = value[:cut].strip(" ,;.")
    title = re.sub(r"^\s*[,.;]+\s*", "", title)
    title = re.sub(r"\(\s*\)", "", title)
    title = re.sub(r"\s+", " ", title).strip(" ,;.")

    location = ""
    if last_date_end is not None:
        location = re.sub(r"\s+", " ", value[last_date_end:].strip(" ,;."))
    return title, location


def decode_day(value: Any) -> int | None:
    letters = re.sub(r"[^а-яё]", "", str(value or "").lower())
    for candidate in (letters, letters[::-1]):
        for name, weekday in DAY_BY_NAME.items():
            if candidate == name or candidate.startswith(name) or (len(candidate) >= 5 and name.startswith(candidate)):
                return weekday
    return None


def parse_segment(segment: str, expected_weekday: int | None) -> tuple[dict[str, Any] | None, list[str]]:
    match = TIME_START_RE.match(segment)
    if not match or not valid_time(match):
        return None, ["invalid or missing start time"]
    start_hour, start_minute, end_hour, end_minute = map(int, match.groups())
    remainder = segment[match.end():].strip(" ,;")
    dates, last_date_end, fatal = extract_dates(remainder)
    title, location = extract_title_and_location(remainder, last_date_end)
    if not title:
        fatal.append("missing title")
    if not dates:
        fatal.append("missing dates")
    if fatal:
        return None, fatal

    warnings: list[str] = []
    if expected_weekday is not None:
        mismatches = [value for value in dates if date.fromisoformat(value).weekday() != expected_weekday]
        if mismatches:
            warnings.append(f"weekday mismatch: {', '.join(mismatches)}")
    return {
        "title": title,
        "dates": dates,
        "startTime": f"{start_hour:02d}:{start_minute:02d}",
        "endTime": f"{end_hour:02d}:{end_minute:02d}",
        "location": location,
    }, warnings


def table_groups(table: list[list[Any]]) -> list[str]:
    if not table:
        return []
    return [compact(value) for value in table[0][1:] if GROUP_RE.fullmatch(compact(value))]


def select_table(pdf_path: Path) -> list[list[Any]]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required; install tools/requirements-omgmu.txt") from error

    candidates: list[tuple[int, list[list[Any]]]] = []
    with pdfplumber.open(pdf_path) as document:
        for page in document.pages:
            text = page.extract_text() or ""
            cyrillic_score = len(re.findall(r"[А-Яа-яЁё]", text))
            for table in page.extract_tables():
                groups = table_groups(table)
                if len(groups) >= 2:
                    candidates.append((len(groups) * 100 + cyrillic_score, table))
    if not candidates:
        raise RuntimeError(f"No schedule table found in {pdf_path}")
    return max(candidates, key=lambda item: item[0])[1]


def event_id(group: str, event_date: str, start_time: str, title: str) -> str:
    digest = hashlib.sha256(title.encode("utf-8")).hexdigest()[:10]
    return f"omgmu-{group}-{event_date}-{start_time.replace(':', '')}-{digest}"


def combine_alternatives(parsed: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str, tuple[str, ...]], list[dict[str, Any]]] = {}
    for item in parsed:
        key = (item["startTime"], item["endTime"], tuple(item["dates"]))
        buckets.setdefault(key, []).append(item)

    combined: list[dict[str, Any]] = []
    for (start_time, end_time, dates), items in buckets.items():
        if len(items) == 1:
            combined.append(items[0])
            continue
        titles: list[str] = []
        locations: list[str] = []
        for item in items:
            if item["title"] not in titles:
                titles.append(item["title"])
            if item["location"] and item["location"] not in locations:
                locations.append(item["location"])
        combined.append({
            "title": " / ".join(titles) + " (уточнить дисциплину)",
            "dates": list(dates),
            "startTime": start_time,
            "endTime": end_time,
            "location": " / ".join(locations),
        })
    return combined


def parse_table(table: list[list[Any]], course: int, stream: str | None, source_url: str | None) -> list[dict[str, Any]]:
    groups = table_groups(table)
    events: dict[str, list[dict[str, Any]]] = {group: [] for group in groups}
    warnings: dict[str, list[str]] = {group: [] for group in groups}
    current_day: int | None = None

    for row_index, row in enumerate(table[1:], start=1):
        day = decode_day(row[0] if row else None)
        if day is not None:
            current_day = day
        row_cells = list(row[1:1 + len(groups)])
        row_cells += [None] * max(0, len(groups) - len(row_cells))
        index = 0
        while index < len(groups):
            cell = row_cells[index]
            if cell is None:
                index += 1
                continue
            end_index = index + 1
            while end_index < len(groups) and row_cells[end_index] is None:
                end_index += 1
            covered_groups = groups[index:end_index]
            segments = split_event_segments(str(cell or ""))
            parsed: list[dict[str, Any]] = []
            if compact(cell) and not segments:
                for group in covered_groups:
                    warnings[group].append(f"row {row_index}: no event time in {compact(cell)[:120]}")
            for segment in segments:
                item, issues = parse_segment(segment, current_day)
                if item:
                    parsed.append(item)
                    for warning in issues:
                        for group in covered_groups:
                            warnings[group].append(f"row {row_index}: {warning}: {segment[:120]}")
                else:
                    for group in covered_groups:
                        warnings[group].append(f"row {row_index}: {'; '.join(issues)}: {segment[:120]}")

            for item in combine_alternatives(parsed):
                for group in covered_groups:
                    for event_date in item["dates"]:
                        events[group].append({
                            "id": event_id(group, event_date, item["startTime"], item["title"]),
                            "title": item["title"],
                            "start": f"{event_date}T{item['startTime']}:00+06:00",
                            "end": f"{event_date}T{item['endTime']}:00+06:00",
                            "location": item["location"],
                            "sourceType": "weekly-pdf-table",
                            "course": course,
                            "stream": stream,
                        })
            index = end_index

    schedules: list[dict[str, Any]] = []
    for group in groups:
        unique: dict[tuple[str, str, str, str], dict[str, Any]] = {}
        for event in events[group]:
            unique[(event["start"], event["end"], event["title"], event["location"])] = event
        normalized_events = sorted(unique.values(), key=lambda event: (event["start"], event["end"], event["title"]))
        schedules.append({
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
            "importWarnings": warnings[group],
        })
    return schedules


def self_test() -> None:
    table = [
        ["", "1101", "1102"],
        ["к\nи\nн\nь\nл\nе\nд\nе\nн\nо\nп", "15.40-17.20 История медицины, 2 лекции: 06.04-13.04\n15.40-17.20 Основы паразитарных заболеваний, 2 лекции: 06.04-13.04", None],
        ["а\nт\nо\nб\nб\nу\nс", "11.30-13.10 Ин. язык (рус. язык), 1 занятие: 11.04", None],
        ["ц\nи\nн\nт\nя\nп", "16.20-18.45 Биохимия, 2 занятия: 09.04-16.04", None],
        [None, "08.30-10.1 0 Общая хирургия, 2 занятия: 10.04-17.04", None],
    ]
    schedules = parse_table(table, course=1, stream="1", source_url=None)
    first = schedules[0]
    assert any("История медицины / Основы паразитарных заболеваний" in event["title"] for event in first["events"])
    assert any(event["start"].startswith("2026-04-11T11:30") for event in first["events"])
    assert not any(event["start"].startswith("2026-10") for event in first["events"])
    assert any(event["start"].startswith("2026-04-10T08:30") for event in first["events"])
    assert any("weekday mismatch" in warning for warning in first["importWarnings"])
    print("ОмГМУ weekly PDF parser self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--course", type=int)
    parser.add_argument("--stream")
    parser.add_argument("--source")
    parser.add_argument("--output", default="data/imports/omgmu-schedules")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.input or not args.course:
        parser.error("--input and --course are required")

    schedules = parse_table(select_table(Path(args.input)), args.course, args.stream, args.source)
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    for schedule in schedules:
        target = output / f"{schedule['group']['code']}.json"
        target.write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    event_count = sum(len(schedule["events"]) for schedule in schedules)
    print(f"Parsed {event_count} events for {len(schedules)} ОмГМУ groups from PDF table")
    for schedule in schedules:
        if schedule["importWarnings"]:
            print(f"Warnings {schedule['group']['code']}: {len(schedule['importWarnings'])}")
    if not schedules or not event_count or any(not schedule["events"] for schedule in schedules):
        raise SystemExit(2)


if __name__ == "__main__":
    main()

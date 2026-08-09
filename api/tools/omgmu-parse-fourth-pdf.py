#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date, timedelta
from pathlib import Path
from typing import Any

HOLIDAYS = {"2026-05-01", "2026-05-09", "2026-06-12"}
WEEKDAYS = {"ПОНЕДЕЛЬНИК": 0, "ВТОРНИК": 1, "СРЕДА": 2, "ЧЕТВЕРГ": 3, "ПЯТНИЦА": 4}
TIME_RE = re.compile(r"(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})")
DATE_RE = re.compile(r"(\d{2})\.(\d{2})(?:\s*[-–]\s*(\d{2})\.(\d{2}))?")


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip(" ,;")


def stable_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:10]


def valid_date(day: int, month: int) -> bool:
    if not 4 <= month <= 8:
        return False
    try:
        date(2026, month, day)
        return True
    except ValueError:
        return False


def range_dates(start_day: int, start_month: int, end_day: int, end_month: int, weekday: int | None = None) -> list[str]:
    try:
        cursor = date(2026, start_month, start_day)
        end = date(2026, end_month, end_day)
    except ValueError:
        return []
    result: list[str] = []
    while cursor <= end:
        allowed = cursor.weekday() < 5 if weekday is None else cursor.weekday() == weekday
        if allowed and cursor.isoformat() not in HOLIDAYS:
            result.append(cursor.isoformat())
        cursor += timedelta(days=1)
    return result


def parse_dates(value: str, weekday: int | None = None) -> list[str]:
    normalized = re.split(r"зач[её]т", str(value or ""), flags=re.IGNORECASE)[0]
    normalized = re.sub(r"с\s+\d{1,2}[.:]\d{2}.*$", "", normalized, flags=re.IGNORECASE)
    result: list[str] = []
    for match in DATE_RE.finditer(normalized):
        start_day = int(match[1])
        start_month = int(match[2])
        end_day = int(match[3] or match[1])
        end_month = int(match[4] or match[2])
        if not valid_date(start_day, start_month) or not valid_date(end_day, end_month):
            continue
        result.extend(range_dates(start_day, start_month, end_day, end_month, weekday))
    return sorted(set(result))


def parse_lectures(text: str) -> list[dict[str, Any]]:
    section = text[text.rfind("РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ"):]
    weekday: int | None = None
    records: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal current
        if not current:
            return
        joined = compact(" ".join(current["lines"]))
        marker = re.match(r"^(.+?),\s*\d+\s+лекц(?:ия|ии|ий):\s*(.+)$", joined, re.IGNORECASE)
        if marker:
            tail = marker[2]
            parts = re.split(r"\s+[–-]\s+", tail, maxsplit=1)
            dates = parse_dates(parts[0], current["weekday"])
            if dates:
                records.append({
                    "discipline": marker[1].strip(),
                    "startTime": current["startTime"],
                    "endTime": current["endTime"],
                    "dates": dates,
                    "location": parts[1].strip() if len(parts) > 1 else "",
                    "kind": "lecture",
                })
        current = None

    for raw_line in section.splitlines():
        line = raw_line.strip()
        if line in WEEKDAYS:
            flush()
            weekday = WEEKDAYS[line]
            continue
        match = re.match(r"^\s*(\*)?(\d{2})[.:](\d{2})-(\d{2})[.:](\d{2})\s+(.+)$", raw_line)
        if match:
            flush()
            current = {
                "startTime": f"{match[2]}:{match[3]}",
                "endTime": f"{match[4]}:{match[5]}",
                "weekday": None if match[1] else weekday,
                "lines": [match[6]],
            }
        elif current and line:
            current["lines"].append(line)
    flush()
    return records


def normalize_spaced_dates(value: Any) -> str:
    normalized = str(value or "")
    normalized = re.sub(r"(?<=\d)\s+(?=\d)", "", normalized)
    normalized = re.sub(r"\s*\.\s*", ".", normalized)
    return normalized


def parse_cycles_pdf(pdf_path: Path) -> dict[str, list[dict[str, Any]]]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required; install tools/requirements-omgmu.txt") from error

    records: dict[str, list[dict[str, Any]]] = {"485": [], "486": []}
    with pdfplumber.open(pdf_path) as document:
        russian_pages = sorted(
            document.pages,
            key=lambda page: len(re.findall(r"[А-Яа-яЁё]", page.extract_text() or "")),
            reverse=True,
        )[:2]
        russian_pages.sort(key=lambda page: page.page_number)
        for page in russian_pages:
            for table in page.extract_tables():
                header_index: int | None = None
                for index, row in enumerate(table):
                    values = [compact(value) for value in row]
                    if "Дисциплина" in values and "485" in values and "486" in values:
                        header_index = index
                        break
                if header_index is None:
                    continue
                header = [compact(value) for value in table[header_index]]
                group_columns = {"485": header.index("485"), "486": header.index("486")}
                current_discipline: str | None = None
                for row in table[header_index + 1:]:
                    values = list(row) + [None] * max(0, len(header) - len(row))
                    discipline = compact(values[0])
                    time_text = compact(values[2] if len(values) > 2 else "")
                    if discipline:
                        current_discipline = re.sub(r",(?=\S)", ", ", discipline)
                    if not current_discipline or not time_text:
                        continue
                    times = list(TIME_RE.finditer(time_text))
                    if not times:
                        continue
                    start_time = f"{int(times[0][1]):02d}:{int(times[0][2]):02d}"
                    end_time = f"{int(times[-1][3]):02d}:{int(times[-1][4]):02d}"
                    for group, column in group_columns.items():
                        cell = normalize_spaced_dates(values[column] if column < len(values) else "")
                        dates = parse_dates(cell)
                        if not dates:
                            continue
                        records[group].append({
                            "discipline": current_discipline,
                            "startTime": start_time,
                            "endTime": end_time,
                            "dates": dates,
                            "location": "",
                            "kind": "lecture" if re.search(r"лекц", cell, re.IGNORECASE) else "cycle",
                        })
    return records


def build_schedule(group: str, lectures: list[dict[str, Any]], cycles: list[dict[str, Any]]) -> dict[str, Any]:
    raw_events: list[dict[str, Any]] = []
    for record in [*lectures, *cycles]:
        for event_date in record["dates"]:
            title = f"{'Лекция' if record['kind'] == 'lecture' else 'Цикл'}: {record['discipline']}"
            raw_events.append({
                "id": f"omgmu-{group}-{event_date}-{record['startTime'].replace(':', '')}-{record['kind']}-{stable_hash(record['discipline'])}",
                "title": title,
                "start": f"{event_date}T{record['startTime']}:00+06:00",
                "end": f"{event_date}T{record['endTime']}:00+06:00",
                "location": record.get("location", ""),
                "sourceType": record["kind"],
            })

    unique: dict[tuple[str, str, str], dict[str, Any]] = {}
    for event in raw_events:
        key = (event["start"], event["end"], event["title"])
        if key not in unique or (not unique[key]["location"] and event["location"]):
            unique[key] = event
    events = sorted(unique.values(), key=lambda event: (event["start"], event["end"], event["title"]))
    return {
        "version": 1,
        "university": "omgmu",
        "universityName": "ОмГМУ",
        "program": "medicine-international",
        "course": 4,
        "stream": None,
        "academicYear": "2025-2026",
        "semester": 2,
        "timezone": "Asia/Omsk",
        "group": {
            "id": f"omgmu:medicine-international:4:{group}",
            "code": group,
            "displayName": f"Группа {group}",
        },
        "sources": [],
        "events": events,
    }


def self_test() -> None:
    lectures = parse_lectures(
        "РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ\n*08.20-10.00 Факультетская терапия, профессиональные болезни, 2 лекции: 07.05-08.05 - Клиника"
    )
    cycles = [{
        "discipline": "Факультетская терапия, профессиональные болезни",
        "startTime": "08:20",
        "endTime": "10:00",
        "dates": ["2026-05-07", "2026-05-08"],
        "location": "",
        "kind": "lecture",
    }, {
        "discipline": "Педиатрия",
        "startTime": "12:50",
        "endTime": "16:00",
        "dates": ["2026-06-30"],
        "location": "",
        "kind": "cycle",
    }]
    schedule = build_schedule("485", lectures, cycles)
    assert len(schedule["events"]) == 3
    assert all(not re.search(r"\b\d{1,2}[.:]\d{1,2}\b", event["title"]) for event in schedule["events"])
    print("ОмГМУ fourth-course parser self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lectures")
    parser.add_argument("--cycles")
    parser.add_argument("--output", default="data/imports/omgmu-schedules")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.lectures or not args.cycles:
        parser.error("--lectures and --cycles are required")

    lectures = parse_lectures(Path(args.lectures).read_text(encoding="utf-8"))
    cycles = parse_cycles_pdf(Path(args.cycles))
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    for group in ("485", "486"):
        schedule = build_schedule(group, lectures, cycles[group])
        (output / f"{group}.json").write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Parsed {len(schedule['events'])} events for ОмГМУ group {group}")
        if not schedule["events"]:
            raise SystemExit(2)


if __name__ == "__main__":
    main()

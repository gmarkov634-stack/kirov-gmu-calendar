#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

DAY_NAMES = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота"]
DAY_INDEX = {name: index for index, name in enumerate(DAY_NAMES)}
GROUP_RE = re.compile(r"^ОЛД\s*\d{3}$", re.IGNORECASE)
TIME_RE = re.compile(
    r"^(?P<prefix>Л\.\s*(?:ДВ\s*)?)?"
    r"(?P<start>\d{1,2}:\d{2})\s*[-–]\s*(?P<end>\d{1,2}:\d{2})\s*(?P<rest>.*)$",
    re.IGNORECASE,
)
WEEK_RE = re.compile(r"(?<![A-Za-zА-Яа-яЁё])(?P<week>I|II)\s*нед\.?", re.IGNORECASE)
MONTHS = {
    "января": 1,
    "февраля": 2,
    "марта": 3,
    "апреля": 4,
    "мая": 5,
    "июня": 6,
    "июля": 7,
    "августа": 8,
    "сентября": 9,
    "октября": 10,
    "ноября": 11,
    "декабря": 12,
}


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip(" ,;")


def normalized(value: str) -> str:
    return re.sub(r"[^a-zа-яё0-9]+", " ", value.lower().replace("ё", "е")).strip()


def parse_period(text: str) -> tuple[date, date]:
    match = re.search(r"(\d{2}\.\d{2}\.\d{4})\s*[-–]\s*(\d{2}\.\d{2}\.\d{4})", text)
    if not match:
        raise RuntimeError("UGMU semester period not found")
    return (
        datetime.strptime(match.group(1), "%d.%m.%Y").date(),
        datetime.strptime(match.group(2), "%d.%m.%Y").date(),
    )


def parse_week_anchor(text: str, roman: str, year: int) -> date:
    match = re.search(
        rf"{roman}\s*нед\.?\s*начинается\s*с\s*(\d{{1,2}})\s+([А-Яа-яЁё]+)",
        text,
        re.IGNORECASE,
    )
    if not match:
        raise RuntimeError(f"UGMU {roman} week anchor not found")
    month = MONTHS.get(match.group(2).lower())
    if not month:
        raise RuntimeError(f"Unknown Russian month in {roman} week anchor")
    return date(year, month, int(match.group(1)))


def decode_rotated_day(value: str) -> str | None:
    letters = re.sub(r"[^А-Яа-яЁё]", "", str(value or "")).lower()
    for candidate in (letters, letters[::-1]):
        if candidate in DAY_INDEX:
            return candidate
    return None


def find_weekly_table(page):
    extracted_tables = page.extract_tables()
    geometry_tables = page.find_tables()
    for table, geometry in zip(extracted_tables, geometry_tables):
        if not table:
            continue
        groups = [compact(value) for value in table[0][1:]]
        if sum(bool(GROUP_RE.fullmatch(group)) for group in groups) >= 2:
            return table, geometry
    raise RuntimeError("UGMU weekly-grid table not found")


def smallest_cell_center(row) -> float:
    cells = [cell for cell in row.cells if cell]
    if not cells:
        return 0.0
    cell = min(cells, key=lambda item: item[3] - item[1])
    return (cell[1] + cell[3]) / 2


def weekday_bounds(page, geometry) -> list[tuple[str, float, float]]:
    labels: dict[str, float] = {}
    for word in page.extract_words(extra_attrs=["upright"]):
        if word.get("upright", True):
            continue
        day = decode_rotated_day(word.get("text", ""))
        if day:
            labels[day] = (word["top"] + word["bottom"]) / 2

    if set(labels) != set(DAY_NAMES):
        raise RuntimeError(f"UGMU weekday labels incomplete: {sorted(labels)}")

    centers = [labels[name] for name in DAY_NAMES]
    header_cell = geometry.rows[0].cells[0]
    footer_cell = geometry.rows[-1].cells[0]
    if not header_cell or not footer_cell:
        raise RuntimeError("UGMU weekly-grid header/footer geometry missing")

    cuts = [header_cell[3]]
    cuts.extend((centers[index] + centers[index + 1]) / 2 for index in range(5))
    cuts.append(footer_cell[1])
    return [(DAY_NAMES[index], cuts[index], cuts[index + 1]) for index in range(6)]


def extract_pilot_group_lines(table, geometry, page, group: str) -> dict[str, list[str]]:
    groups = [compact(value) for value in table[0][1:]]
    if group not in groups:
        raise RuntimeError(f"UGMU group not found in weekly-grid: {group}")
    group_index = groups.index(group)
    if group_index != 0:
        raise RuntimeError("UGMU pilot parser is fail-closed to the first group column only")

    bounds = weekday_bounds(page, geometry)
    result = {day: [] for day in DAY_NAMES}
    for row_index, row in enumerate(table[1:-1], start=1):
        center = smallest_cell_center(geometry.rows[row_index])
        day = next((name for name, top, bottom in bounds if top <= center < bottom), None)
        if not day:
            continue
        value = row[1 + group_index] if len(row) > 1 + group_index else None
        if value is None:
            continue
        for raw_line in str(value).splitlines():
            line = compact(raw_line)
            if line:
                result[day].append(line)
    return result


def split_segments(lines: list[str]) -> list[str]:
    segments: list[str] = []
    current: list[str] = []
    for line in lines:
        if TIME_RE.match(line):
            if current:
                segments.append(" ".join(current))
            current = [line]
        elif current:
            current.append(line)
    if current:
        segments.append(" ".join(current))
    return segments


def extract_reference_rows(document) -> list[dict[str, str]]:
    if len(document.pages) < 2:
        return []
    rows: list[dict[str, str]] = []
    for table in document.pages[1].extract_tables():
        if not table or len(table[0]) < 4:
            continue
        if "дисциплина" not in compact(table[0][1]).lower():
            continue
        for row in table[1:]:
            title = compact(row[1] if len(row) > 1 else "")
            if not title:
                continue
            rows.append({
                "title": title,
                "department": compact(row[2] if len(row) > 2 else ""),
                "address": compact(row[3] if len(row) > 3 else ""),
            })
    return rows


def match_reference(source_title: str, references: list[dict[str, str]]) -> tuple[dict[str, str] | None, list[str]]:
    warnings: list[str] = []
    source_title = source_title.strip(" ,;")

    def candidates(value: str) -> list[dict[str, str]]:
        key = normalized(value)
        exact = [row for row in references if normalized(row["title"]) == key]
        if exact:
            return exact
        return [
            row for row in references
            if normalized(row["title"]).startswith(key) or key.startswith(normalized(row["title"]))
        ]

    matches = candidates(source_title)
    if len(matches) != 1 and re.search(r"\s[А-Яа-яЁё]$", source_title):
        trimmed = re.sub(r"\s[А-Яа-яЁё]$", "", source_title)
        trimmed_matches = candidates(trimmed)
        if len(trimmed_matches) == 1:
            warnings.append(f"dropped extraction artifact from source title: {source_title[-1]}")
            source_title = trimmed
            matches = trimmed_matches

    if len(matches) == 1:
        return matches[0], warnings
    if matches:
        warnings.append(f"ambiguous discipline reference: {source_title}")
    else:
        warnings.append(f"no discipline reference: {source_title}")
    return None, warnings


def parse_pattern(segment: str, weekday: int, references: list[dict[str, str]]) -> tuple[dict[str, Any], list[str]]:
    match = TIME_RE.match(segment)
    if not match:
        raise RuntimeError(f"UGMU invalid event segment: {segment}")

    prefix = compact(match.group("prefix"))
    remainder = compact(match.group("rest"))
    week_match = WEEK_RE.search(remainder)
    week_rule = week_match.group("week").upper() if week_match else "weekly"
    if week_match:
        remainder = compact(WEEK_RE.sub("", remainder))

    reference, warnings = match_reference(remainder, references)
    title = reference["title"] if reference else remainder
    lecture = bool(prefix)
    elective = "ДВ" in prefix.upper()
    department = reference["department"] if reference else ""
    location = "Онлайн" if lecture else ""
    location_note = ""
    if reference and not lecture:
        if normalized(reference["address"]).startswith(normalized("место проведения занятий определяет")):
            location_note = reference["address"]
        else:
            location = reference["address"]

    return ({
        "weekday": weekday,
        "startTime": match.group("start"),
        "endTime": match.group("end"),
        "sourceTitle": remainder,
        "title": title,
        "lessonType": "lecture" if lecture else "class",
        "elective": elective,
        "weekRule": week_rule,
        "location": location,
        "locationNote": location_note,
        "department": department,
    }, warnings)


def week_kind(value: date, first_anchor: date, second_anchor: date) -> str:
    if value < first_anchor:
        raise RuntimeError("UGMU event date precedes I week anchor")
    if value < second_anchor:
        return "I"
    index = (value - second_anchor).days // 7
    return "II" if index % 2 == 0 else "I"


def event_id(group: str, event_date: date, start_time: str, title: str) -> str:
    digest = hashlib.sha256(title.encode("utf-8")).hexdigest()[:10]
    normalized_group = re.sub(r"\s+", "", group).lower()
    return f"ugmu-{normalized_group}-{event_date.isoformat()}-{start_time.replace(':', '')}-{digest}"


def expand_patterns(
    patterns: list[dict[str, Any]],
    period_start: date,
    period_end: date,
    first_anchor: date,
    second_anchor: date,
    group: str,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    cursor = period_start
    while cursor <= period_end:
        for pattern in patterns:
            if cursor.weekday() != pattern["weekday"]:
                continue
            parity = week_kind(cursor, first_anchor, second_anchor)
            if pattern["weekRule"] != "weekly" and pattern["weekRule"] != parity:
                continue
            events.append({
                "id": event_id(group, cursor, pattern["startTime"], pattern["title"]),
                "title": pattern["title"],
                "sourceTitle": pattern["sourceTitle"],
                "start": f"{cursor.isoformat()}T{pattern['startTime']}:00+05:00",
                "end": f"{cursor.isoformat()}T{pattern['endTime']}:00+05:00",
                "location": pattern["location"],
                "locationNote": pattern["locationNote"],
                "department": pattern["department"],
                "lessonType": pattern["lessonType"],
                "elective": pattern["elective"],
                "weekRule": pattern["weekRule"],
                "sourceType": "ugmu-weekly-grid",
            })
        cursor += timedelta(days=1)
    return sorted(events, key=lambda event: (event["start"], event["end"], event["title"]))


def validate_pilot(schedule: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if schedule["group"]["code"] != "ОЛД 101":
        errors.append("pilot group must be ОЛД 101")
    if len(schedule["patterns"]) != 23:
        errors.append(f"expected 23 weekly patterns, got {len(schedule['patterns'])}")
    if len(schedule["events"]) != 357:
        errors.append(f"expected 357 expanded events, got {len(schedule['events'])}")

    keys = [(event["start"], event["end"], event["title"]) for event in schedule["events"]]
    if len(keys) != len(set(keys)):
        errors.append("duplicate expanded events")

    by_date: dict[str, list[tuple[datetime, datetime, str]]] = {}
    for event in schedule["events"]:
        start = datetime.fromisoformat(event["start"])
        end = datetime.fromisoformat(event["end"])
        by_date.setdefault(start.date().isoformat(), []).append((start, end, event["title"]))
    for event_date, items in by_date.items():
        items.sort(key=lambda item: item[0])
        for previous, current in zip(items, items[1:]):
            if current[0] < previous[1]:
                errors.append(f"overlap on {event_date}: {previous[2]} / {current[2]}")
    return errors


def parse_pdf(
    pdf_path: Path,
    group: str = "ОЛД 101",
    source_url: str | None = None,
    source_sha256: str | None = None,
) -> dict[str, Any]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required; install tools/requirements-ugmu.txt") from error

    warnings: list[str] = []
    with pdfplumber.open(pdf_path) as document:
        page = document.pages[0]
        all_text = "\n".join((item.extract_text() or "") for item in document.pages)
        period_start, period_end = parse_period(all_text)
        first_anchor = parse_week_anchor(all_text, "I", period_start.year)
        second_anchor = parse_week_anchor(all_text, "II", period_start.year)
        table, geometry = find_weekly_table(page)
        lines_by_day = extract_pilot_group_lines(table, geometry, page, group)
        references = extract_reference_rows(document)

        patterns: list[dict[str, Any]] = []
        for day in DAY_NAMES:
            for segment in split_segments(lines_by_day[day]):
                pattern, pattern_warnings = parse_pattern(segment, DAY_INDEX[day], references)
                patterns.append(pattern)
                warnings.extend(f"{day}: {warning}" for warning in pattern_warnings)

    events = expand_patterns(patterns, period_start, period_end, first_anchor, second_anchor, group)
    schedule = {
        "version": 1,
        "university": "ugmu",
        "universityName": "УГМУ",
        "program": "medicine",
        "course": 1,
        "stream": "1",
        "academicYear": "2026/2027",
        "semester": 1,
        "timezone": "Asia/Yekaterinburg",
        "group": {
            "id": f"ugmu:medicine:1:stream-1:{group}",
            "code": group,
            "displayName": f"Группа {group}",
        },
        "semesterPeriod": {
            "start": period_start.isoformat(),
            "end": period_end.isoformat(),
        },
        "weekAnchors": {
            "I": first_anchor.isoformat(),
            "II": second_anchor.isoformat(),
        },
        "sources": [{
            "url": source_url,
            "sha256": source_sha256,
            "part": "combined",
            "parserShape": "weekly-grid",
        }],
        "sourceReview": {
            "status": "semantic-reviewed-pilot",
            "publicationAllowed": False,
            "patternCount": len(patterns),
        },
        "patterns": patterns,
        "events": events,
        "importWarnings": warnings,
    }
    schedule["validationErrors"] = validate_pilot(schedule)
    schedule["sourceReview"]["status"] = (
        "semantic-reviewed-pilot" if not schedule["validationErrors"] else "needs-review"
    )
    return schedule


def self_test() -> None:
    references = [
        {"title": "Иностранный язык", "department": "Кафедра", "address": "Ключевская, 7"},
        {"title": "Биоэтика", "department": "Кафедра", "address": "Ключевская, 17"},
    ]
    first, warnings = parse_pattern("Л. 08:50-10:20 Биоэтика I нед", 0, references)
    assert first["lessonType"] == "lecture"
    assert first["weekRule"] == "I"
    assert first["location"] == "Онлайн"
    assert warnings == []
    second, warnings = parse_pattern("10:30-12:00 Иностранный", 1, references)
    assert second["title"] == "Иностранный язык"
    assert second["location"] == "Ключевская, 7"
    assert warnings == []
    assert week_kind(date(2026, 9, 1), date(2026, 9, 1), date(2026, 9, 7)) == "I"
    assert week_kind(date(2026, 9, 7), date(2026, 9, 1), date(2026, 9, 7)) == "II"
    assert week_kind(date(2026, 9, 14), date(2026, 9, 1), date(2026, 9, 7)) == "I"
    print("UGMU weekly-grid parser self-test passed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--group", default="ОЛД 101")
    parser.add_argument("--source")
    parser.add_argument("--sha256")
    parser.add_argument("--output", default="data/imports/ugmu-pilot/OLD-101.json")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return
    if not args.input:
        parser.error("--input is required")

    schedule = parse_pdf(Path(args.input), args.group, args.source, args.sha256)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"UGMU {args.group}: {len(schedule['patterns'])} patterns -> {len(schedule['events'])} events")
    print(f"Warnings: {len(schedule['importWarnings'])}")
    print(f"Validation errors: {len(schedule['validationErrors'])}")
    print(f"Output: {output}")
    if schedule["validationErrors"]:
        raise SystemExit(2)


if __name__ == "__main__":
    main()

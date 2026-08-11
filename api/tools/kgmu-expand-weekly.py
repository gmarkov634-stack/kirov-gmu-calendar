#!/usr/bin/env python3
import argparse
import collections
import datetime as dt
import hashlib
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
DAY_MAP = {"ПН": 0, "ВТ": 1, "СР": 2, "ЧТ": 3, "ПТ": 4, "СБ": 5, "ВС": 6}
DAY_ISO = {"ПН": "MO", "ВТ": "TU", "СР": "WE", "ЧТ": "TH", "ПТ": "FR", "СБ": "SA", "ВС": "SU"}
GROUP_RE = re.compile(r"\bгруппа\s*(\d{3})\b", re.I)
HEADER_RE = re.compile(
    r"РАСПИСАНИЕ.*?(?:НА\s+)?(ПЕРВОЕ|ВТОРОЕ)\s+ПОЛУГОДИЕ\s+(20\d{2})\s*[-/]\s*(20\d{2}|\d{2})",
    re.I,
)
PERIOD_RE = re.compile(
    r"((?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:20\d{2}))[^-]{0,40}-\s*"
    r"((?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])\.(?:20\d{2}))"
)
DATE_TOKEN = r"(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])"
DATE_TOKEN_RE = re.compile(rf"(?<!\d)({DATE_TOKEN})(?!\d)")
DATE_RANGE_RE = re.compile(rf"(?<!\d)({DATE_TOKEN})\s*-\s*({DATE_TOKEN})(?!\d)")
TIME_RUN = (
    r"\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}"
    r"(?:\s*,\s*\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2})*"
)
TIME_RUN_RE = re.compile(rf"(?<!\d)({TIME_RUN})(?!\d)")
DIRECT_OVERRIDE_RE = re.compile(rf"(?<!\d)(?P<date>{DATE_TOKEN})\s*-\s*(?P<times>{TIME_RUN})")
NOTE_OVERRIDE_RE = re.compile(
    rf"(?<!\d)(?P<date>{DATE_TOKEN})\s*-\s*[^;]{{0,90}}?(?P<times>{TIME_RUN})"
)
CROSS_DAY_RE = re.compile(r"\b\d+\s+занят(?:ие|ия)\s+(?:во|в)\s+", re.I)
LOCATION_FULL_RE = re.compile(
    r"\b\d+\s+корпус,\s*аудитория\s*[^,;]+,\s*ул\.?\s*[^;]+?(?=(?:\s+\d{1,2}[.:]\d{2}\s*-)|$)",
    re.I,
)
ROOM_CODE_RE = re.compile(r"(?<!\d)([1-9]-\d{2,4})(?!\d)")


def col_to_num(ref):
    match = re.match(r"([A-Z]+)", ref)
    value = 0
    for char in match.group(1):
        value = value * 26 + ord(char) - 64
    return value


def num_to_col(value):
    result = ""
    while value:
        value, rem = divmod(value - 1, 26)
        result = chr(65 + rem) + result
    return result


def cell_position(ref):
    match = re.match(r"([A-Z]+)(\d+)", ref)
    return col_to_num(ref), int(match.group(2))


def first_sheet_path(archive):
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    sheet = workbook.find(f".//{{{NS_MAIN}}}sheet")
    rel_id = sheet.attrib[f"{{{NS_REL}}}id"]
    rel_ns = "http://schemas.openxmlformats.org/package/2006/relationships"
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    target = next(
        rel.attrib["Target"]
        for rel in rels.findall(f"{{{rel_ns}}}Relationship")
        if rel.attrib.get("Id") == rel_id
    )
    if target.startswith("/"):
        return target.lstrip("/")
    if target.startswith("xl/"):
        return target
    return "xl/" + target.lstrip("/")


def read_xlsx(path):
    with zipfile.ZipFile(path) as archive:
        try:
            shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            shared = [
                "".join(node.text or "" for node in item.iter(f"{{{NS_MAIN}}}t"))
                for item in shared_root.findall(f"{{{NS_MAIN}}}si")
            ]
        except KeyError:
            shared = []
        root = ET.fromstring(archive.read(first_sheet_path(archive)))

    values = {}
    rows = collections.defaultdict(dict)
    for cell in root.findall(f".//{{{NS_MAIN}}}c"):
        ref = cell.attrib["r"]
        col, row = cell_position(ref)
        cell_type = cell.attrib.get("t")
        if cell_type == "inlineStr":
            value = "".join(node.text or "" for node in cell.iter(f"{{{NS_MAIN}}}t"))
        else:
            value_node = cell.find(f"{{{NS_MAIN}}}v")
            raw = "" if value_node is None else (value_node.text or "")
            if cell_type == "s" and raw.isdigit() and int(raw) < len(shared):
                value = shared[int(raw)]
            else:
                value = raw
        value = re.sub(r"\s+", " ", str(value)).strip()
        if value:
            values[ref] = value
            rows[row][col] = value

    merges = {}
    covered = {}
    for item in root.findall(f".//{{{NS_MAIN}}}mergeCell"):
        ref = item.attrib["ref"]
        left, right = (ref.split(":") + [ref])[:2]
        col1, row1 = cell_position(left)
        col2, row2 = cell_position(right)
        merges[left] = (col1, row1, col2, row2)
        for row in range(row1, row2 + 1):
            for col in range(col1, col2 + 1):
                covered[(col, row)] = left
    return values, rows, merges, covered


def parse_full_date(value):
    day, month, year = map(int, value.split("."))
    return dt.date(year, month, day)


def parse_ddmm(value, year):
    day, month = map(int, value.split("."))
    return dt.date(year, month, day)


def overlap(left, right):
    return max(left[0], right[0]) < min(left[1], right[1])


def infer_file_context(path, rows):
    text = " ".join(" ".join(values.values()) for _, values in sorted(rows.items()))
    header = HEADER_RE.search(text)
    period = PERIOD_RE.search(text)
    if not header or not period:
        return None
    second_year = header.group(3)
    if len(second_year) == 2:
        second_year = "20" + second_year
    academic_year = f"{header.group(2)}/{second_year}"
    semester = 1 if header.group(1).upper() == "ПЕРВОЕ" else 2
    start = parse_full_date(period.group(1))
    end = parse_full_date(period.group(2))
    filename = Path(path).name
    course_match = re.search(r"_course-(\d)_", filename)
    program = (
        "medicine" if "_medicine_" in filename
        else "pediatrics" if "_pediatrics_" in filename
        else "dentistry" if "_dentistry_" in filename
        else None
    )
    return {
        "program": program,
        "course": int(course_match.group(1)) if course_match else None,
        "academicYear": academic_year,
        "semester": semester,
        "periodStart": start,
        "periodEnd": end,
    }


def valid_date_token(value, start, end):
    try:
        date = parse_ddmm(value, start.year)
    except ValueError:
        return False
    return start - dt.timedelta(days=14) <= date <= end + dt.timedelta(days=31)


def looks_like_date_range(match, start, end):
    if not valid_date_token(match.group(1), start, end):
        return False
    if not valid_date_token(match.group(2), start, end):
        return False
    return parse_ddmm(match.group(1), start.year) <= parse_ddmm(match.group(2), start.year)


def find_time_spans(text, start, end):
    overrides = []
    for match in DIRECT_OVERRIDE_RE.finditer(text):
        if valid_date_token(match.group("date"), start, end):
            overrides.append(
                (match.span(), match.span("times"), match.group("date"), match.group("times"))
            )
    override_whole_spans = [item[0] for item in overrides]
    spans = [
        (time_span[0], time_span[1], times, "override", date)
        for _, time_span, date, times in overrides
    ]
    for match in TIME_RUN_RE.finditer(text):
        span = match.span()
        if any(overlap(span, other) for other in override_whole_spans):
            continue
        date_range = re.fullmatch(rf"({DATE_TOKEN})\s*-\s*({DATE_TOKEN})", match.group(0))
        if date_range and looks_like_date_range(date_range, start, end):
            continue
        spans.append((span[0], span[1], match.group(0), "normal", None))
    return sorted(spans)


def time_bounds(value):
    pairs = re.findall(r"(\d{1,2}[.:]\d{2})\s*-\s*(\d{1,2}[.:]\d{2})", value)
    if not pairs:
        return None
    return pairs[0][0].replace(".", ":"), pairs[-1][1].replace(".", ":")


def weekday_dates(start, end, weekday):
    current = start
    while current.weekday() != weekday:
        current += dt.timedelta(days=1)
    while current <= end:
        yield current
        current += dt.timedelta(days=7)


def parse_holidays(rows, start, end):
    holidays = set()
    for values in rows.values():
        text = " ".join(values.values())
        if "Праздничные неучебные дни" not in text:
            continue
        text = text.split("Праздничные неучебные дни", 1)[1]
        for match in DATE_TOKEN_RE.finditer(text):
            try:
                date = parse_ddmm(match.group(1), start.year)
            except ValueError:
                continue
            if start <= date <= end + dt.timedelta(days=31):
                holidays.add(date)
    return holidays


def schedule_footer_row(rows):
    for row, values in sorted(rows.items()):
        if any(value.strip().lower() == "дисциплина" for value in values.values()):
            return row
    return max(rows) + 1


def find_group_header(rows):
    for row, values in sorted(rows.items()):
        groups = {
            col: GROUP_RE.search(value).group(1)
            for col, value in values.items()
            if GROUP_RE.search(value)
        }
        if len(groups) >= 2:
            return row, groups
    return None, {}


def event_segments(raw, start, end):
    spans = find_time_spans(raw, start, end)
    normal = [item for item in spans if item[3] == "normal"]
    if not normal or normal[0][0] > 3:
        return []
    starts = [normal[0]]
    for candidate in normal[1:]:
        position = candidate[1]
        next_positions = [item[0] for item in spans if item[0] > position]
        first_date = None
        for match in DATE_TOKEN_RE.finditer(raw, position):
            if not any(overlap(match.span(), (item[0], item[1])) for item in spans):
                first_date = match
                break
        boundary = min(
            next_positions
            + ([first_date.start()] if first_date else [])
            + [len(raw)]
        )
        subject_candidate = raw[position:boundary].strip(" ,;:-")
        if re.search(r"[А-Яа-я]", subject_candidate) and not re.match(
            r"^(?:корпус|аудитория|ул\.?|каб\.?|каф\.?)\b",
            subject_candidate,
            re.I,
        ):
            starts.append(candidate)
    segments = []
    for index, start_span in enumerate(starts):
        boundary = starts[index + 1][0] if index + 1 < len(starts) else len(raw)
        segments.append(raw[start_span[0]:boundary].strip())
    return segments


def clean_subject(value):
    value = re.sub(r"\b[12]\s*недел[яи]\b", "", value, flags=re.I)
    return re.sub(r"\s+", " ", value).strip(" ,;:-")


def extract_location(segment):
    full = LOCATION_FULL_RE.search(segment)
    if full:
        return re.sub(r"\s+", " ", full.group(0)).strip()
    room = ROOM_CODE_RE.search(segment)
    return room.group(1) if room else None


def parse_segment(segment, start, end, weekday, holidays):
    time_spans = find_time_spans(segment, start, end)
    default = next(
        (item for item in time_spans if item[3] == "normal" and item[0] <= 3),
        None,
    )
    if not default:
        return None, "no-leading-time", []
    occupied_time_spans = [(item[0], item[1]) for item in time_spans]
    first_date = None
    for match in DATE_TOKEN_RE.finditer(segment, default[1]):
        if not any(overlap(match.span(), item) for item in occupied_time_spans):
            first_date = match
            break
    if not first_date:
        return None, "no-date", []
    subject = clean_subject(segment[default[1]:first_date.start()])
    if not subject:
        return None, "no-subject", []

    warnings = []
    if CROSS_DAY_RE.search(segment):
        warnings.append("cross-day-note-requires-review")

    covered = []
    overrides = {}
    for match in DIRECT_OVERRIDE_RE.finditer(segment):
        if not valid_date_token(match.group("date"), start, end):
            continue
        date = parse_ddmm(match.group("date"), start.year)
        bounds = time_bounds(match.group("times"))
        if bounds:
            overrides[date] = bounds
            covered.append(match.span())

    for match in NOTE_OVERRIDE_RE.finditer(segment):
        if not valid_date_token(match.group("date"), start, end):
            continue
        date = parse_ddmm(match.group("date"), start.year)
        bounds = time_bounds(match.group("times"))
        if bounds:
            overrides[date] = bounds
            covered.append(match.span())

    ranges = []
    range_spans = []
    for match in DATE_RANGE_RE.finditer(segment):
        span = match.span()
        if any(overlap(span, item) for item in covered):
            continue
        if any(overlap(span, item) for item in occupied_time_spans):
            continue
        if not valid_date_token(match.group(1), start, end):
            continue
        if not valid_date_token(match.group(2), start, end):
            continue
        range_start = parse_ddmm(match.group(1), start.year)
        range_end = parse_ddmm(match.group(2), start.year)
        if range_start <= range_end:
            ranges.append((range_start, range_end))
            range_spans.append(span)

    excluded = covered + range_spans + occupied_time_spans
    explicit_dates = []
    for match in DATE_TOKEN_RE.finditer(segment):
        if any(overlap(match.span(), item) for item in excluded):
            continue
        if valid_date_token(match.group(1), start, end):
            explicit_dates.append(parse_ddmm(match.group(1), start.year))

    dates = set(explicit_dates) | set(overrides)
    for range_start, range_end in ranges:
        dates.update(
            date
            for date in weekday_dates(range_start, range_end, weekday)
            if date not in holidays
        )
    # Explicitly named dates always win over the generic holiday exclusion.
    dates.update(explicit_dates)
    dates.update(overrides)
    dates = {date for date in dates if start <= date <= end}
    if not dates:
        return None, "no-dates-after-parse", warnings

    default_bounds = time_bounds(default[2])
    if not default_bounds:
        return None, "invalid-time", warnings
    location = extract_location(segment)
    events = []
    for date in sorted(dates):
        event_start, event_end = overrides.get(date, default_bounds)
        events.append(
            {
                "date": date.isoformat(),
                "start": event_start,
                "end": event_end,
                "title": subject,
                "locationText": location,
            }
        )
    return events, None, warnings


def stable_event_id(source_file, group, source_cell, event):
    payload = "|".join(
        [
            source_file,
            group,
            source_cell,
            event["date"],
            event["start"],
            event["end"],
            event["title"],
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:24]


def parse_file(path):
    values, rows, merges, covered = read_xlsx(path)
    context = infer_file_context(path, rows)
    if not context:
        return {
            "sourceFile": Path(path).name,
            "status": "unsupported",
            "reason": "missing-period-context",
        }
    header_row, groups = find_group_header(rows)
    if not header_row:
        return {
            "sourceFile": Path(path).name,
            "status": "unsupported",
            "reason": "not-weekly-grid",
            **{key: value for key, value in context.items() if not isinstance(value, dt.date)},
        }

    footer_row = schedule_footer_row(rows)
    holidays = parse_holidays(rows, context["periodStart"], context["periodEnd"])
    result_groups = {
        group: {"events": [], "unresolved": [], "partial": []}
        for group in groups.values()
    }
    current_day = None
    source_cells = 0

    for row in range(header_row + 1, footer_row):
        day_value = rows.get(row, {}).get(1, "").strip().upper()
        if day_value in DAY_MAP:
            current_day = day_value
        if not current_day:
            continue
        for col, group in groups.items():
            top_left = covered.get((col, row), f"{num_to_col(col)}{row}")
            top_col, top_row = cell_position(top_left)
            raw = values.get(top_left, "")
            if not raw:
                continue
            left, first_row, right, _ = merges.get(
                top_left, (top_col, top_row, top_col, top_row)
            )
            # A vertically merged cell is parsed once, on its top row. A horizontally
            # merged lecture applies to every covered group column.
            if row != first_row or not (left <= col <= right):
                continue
            if raw.startswith("Факультативы:") or raw.startswith("1 неделя-") or raw.startswith("2 неделя-"):
                continue
            source_cells += 1
            segments = event_segments(raw, context["periodStart"], context["periodEnd"])
            if not segments:
                result_groups[group]["unresolved"].append(
                    {
                        "sourceCell": top_left,
                        "sourceRow": row,
                        "sourceWeekday": current_day,
                        "raw": raw,
                        "reason": "no-event-segments",
                    }
                )
                continue
            for segment in segments:
                parsed, reason, warnings = parse_segment(
                    segment,
                    context["periodStart"],
                    context["periodEnd"],
                    DAY_MAP[current_day],
                    holidays,
                )
                if reason:
                    result_groups[group]["unresolved"].append(
                        {
                            "sourceCell": top_left,
                            "sourceRow": row,
                            "sourceWeekday": current_day,
                            "raw": segment,
                            "reason": reason,
                        }
                    )
                    continue
                if warnings:
                    result_groups[group]["partial"].append(
                        {
                            "sourceCell": top_left,
                            "sourceRow": row,
                            "sourceWeekday": current_day,
                            "raw": segment,
                            "warnings": warnings,
                        }
                    )
                for event in parsed:
                    event.update(
                        {
                            "id": stable_event_id(Path(path).name, group, top_left, event),
                            "groupCode": group,
                            "sourceCell": top_left,
                            "sourceRow": row,
                            "sourceWeekday": DAY_ISO[current_day],
                            "raw": segment,
                            "confidence": "partial" if warnings else "high",
                        }
                    )
                    result_groups[group]["events"].append(event)

    for group_data in result_groups.values():
        deduplicated = {}
        for event in group_data["events"]:
            key = (
                event["date"],
                event["start"],
                event["end"],
                event["title"],
                event.get("locationText"),
                event["raw"],
            )
            deduplicated[key] = event
        group_data["events"] = sorted(
            deduplicated.values(),
            key=lambda item: (item["date"], item["start"], item["title"]),
        )
        group_data["stats"] = {
            "eventCount": len(group_data["events"]),
            "unresolvedCount": len(group_data["unresolved"]),
            "partialCount": len(group_data["partial"]),
        }

    unresolved_count = sum(item["stats"]["unresolvedCount"] for item in result_groups.values())
    partial_count = sum(item["stats"]["partialCount"] for item in result_groups.values())
    event_count = sum(item["stats"]["eventCount"] for item in result_groups.values())
    target_commercial_period = context["academicYear"] == "2026/2027" and context["semester"] == 1
    qa_passed = unresolved_count == 0 and partial_count == 0

    return {
        "version": 1,
        "status": "parsed",
        "sourceFile": Path(path).name,
        "layout": "weekly-grid",
        "program": context["program"],
        "course": context["course"],
        "academicYear": context["academicYear"],
        "semester": context["semester"],
        "period": {
            "start": context["periodStart"].isoformat(),
            "end": context["periodEnd"].isoformat(),
        },
        "archiveReferenceOnly": not target_commercial_period,
        "commercialTargetPeriod": target_commercial_period,
        "qaPassed": qa_passed,
        "publishable": target_commercial_period and qa_passed,
        "holidayExclusions": sorted(date.isoformat() for date in holidays),
        "groupHeaderRow": header_row,
        "scheduleFooterRow": footer_row,
        "sourceCellCount": source_cells,
        "stats": {
            "eventCount": event_count,
            "unresolvedCount": unresolved_count,
            "partialCount": partial_count,
        },
        "groups": result_groups,
    }


def self_test():
    start = dt.date(2026, 1, 26)
    end = dt.date(2026, 6, 6)
    holidays = {dt.date(2026, 5, 1), dt.date(2026, 5, 9)}

    segment = "13.45-15.15 Гистология, эмбриология, цитология 26.01-25.05, 01.06-13.45-16.55"
    events, reason, warnings = parse_segment(segment, start, end, 0, holidays)
    assert reason is None and not warnings
    assert events[-1]["date"] == "2026-06-01"
    assert events[-1]["start"] == "13:45" and events[-1]["end"] == "16:55"

    segment = "8.00-9.30, 9.40-10.25 Биология 31.01-02.05; 16.05-8.30-10.00"
    events, reason, _ = parse_segment(segment, start, end, 5, holidays)
    assert reason is None
    assert not any(item["date"] == "2026-05-09" for item in events)
    override = next(item for item in events if item["date"] == "2026-05-16")
    assert override["start"] == "8:30" and override["end"] == "10:00"

    raw = (
        "8.30-10.00 ЛЕКЦИЯ БИОЭТИКА 26.01, 09.02 1 корпус, аудитория 106, ул. Владимирская, 137 "
        "8.30-10.00 ЛЕКЦИЯ ИСТОРИЯ РОССИИ 27.04, 11.05, 25.05 1 корпус, аудитория 106, ул. Владимирская, 137"
    )
    segments = event_segments(raw, start, end)
    assert len(segments) == 2

    segment = "12.20-13.50 Латинский язык 26.01-01.06 (1 занятие во вт.)"
    events, reason, warnings = parse_segment(segment, start, end, 0, holidays)
    assert reason is None and events
    assert "cross-day-note-requires-review" in warnings

    print("kgmu weekly event parser self-test: OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", nargs="?")
    parser.add_argument("--output")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    if not args.input:
        parser.error("input is required unless --self-test is used")

    path = Path(args.input)
    files = sorted(path.glob("*.xlsx")) if path.is_dir() else [path]
    reports = [parse_file(file) for file in files]
    parsed = [item for item in reports if item.get("status") == "parsed"]
    summary = {
        "version": 1,
        "fileCount": len(reports),
        "parsedWeeklyFileCount": len(parsed),
        "eventCount": sum(item["stats"]["eventCount"] for item in parsed),
        "unresolvedCount": sum(item["stats"]["unresolvedCount"] for item in parsed),
        "partialCount": sum(item["stats"]["partialCount"] for item in parsed),
        "publishableFileCount": sum(bool(item.get("publishable")) for item in parsed),
        "archiveReferenceOnlyFileCount": sum(bool(item.get("archiveReferenceOnly")) for item in parsed),
        "files": [
            {
                "sourceFile": item.get("sourceFile"),
                "status": item.get("status"),
                "program": item.get("program"),
                "course": item.get("course"),
                "academicYear": item.get("academicYear"),
                "semester": item.get("semester"),
                "archiveReferenceOnly": item.get("archiveReferenceOnly"),
                "qaPassed": item.get("qaPassed"),
                "publishable": item.get("publishable"),
                "stats": item.get("stats"),
                "reason": item.get("reason"),
            }
            for item in reports
        ],
    }
    output = {"summary": summary, "reports": reports}
    text = json.dumps(output, ensure_ascii=False, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()

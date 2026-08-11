#!/usr/bin/env python3
import argparse
import collections
import datetime as dt
import difflib
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships"

MONTHS = {
    "январь": 1,
    "февраль": 2,
    "март": 3,
    "апрель": 4,
    "май": 5,
    "июнь": 6,
    "июль": 7,
    "август": 8,
    "сентябрь": 9,
    "октябрь": 10,
    "ноябрь": 11,
    "декабрь": 12,
}
SIMPLE_TIME_RE = re.compile(r"^\s*\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}\s*$")
YEAR_RE = re.compile(r"(20\d{2})\s*[-/]\s*(20\d{2}|\d{2})")
COURSE_RE = re.compile(r"(\d)\s*КУРС", re.I)


def col_to_num(ref):
    match = re.match(r"([A-Z]+)", ref)
    value = 0
    for char in match.group(1):
        value = value * 26 + ord(char) - 64
    return value


def num_to_col(value):
    result = ""
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result


def cell_position(ref):
    match = re.match(r"([A-Z]+)(\d+)", ref)
    return col_to_num(ref), int(match.group(2))


def first_sheet_path(archive):
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    sheet = workbook.find(f".//{{{NS_MAIN}}}sheet")
    rel_id = sheet.attrib[f"{{{NS_REL}}}id"]
    rels = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    target = next(
        rel.attrib["Target"]
        for rel in rels.findall(f"{{{NS_PKG_REL}}}Relationship")
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
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet_node = workbook.find(f".//{{{NS_MAIN}}}sheet")
        sheet_name = sheet_node.attrib.get("name")
        root = ET.fromstring(archive.read(first_sheet_path(archive)))

    values = {}
    rows = collections.defaultdict(dict)
    for cell in root.findall(f".//{{{NS_MAIN}}}c"):
        ref = cell.attrib.get("r")
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

    merges = []
    covered = {}
    merge_by_top_left = {}
    for item in root.findall(f".//{{{NS_MAIN}}}mergeCell"):
        ref = item.attrib["ref"]
        left, right = (ref.split(":") + [ref])[:2]
        col1, row1 = cell_position(left)
        col2, row2 = cell_position(right)
        merge = (col1, row1, col2, row2, left, right)
        merges.append(merge)
        merge_by_top_left[(col1, row1)] = merge
        for row in range(row1, row2 + 1):
            for col in range(col1, col2 + 1):
                covered[(col, row)] = merge
    return sheet_name, values, rows, merges, covered, merge_by_top_left


def normalize_text(value):
    text = str(value or "").lower().replace("ё", "е")
    text = text.replace("\n", " ")
    text = re.sub(r"\([^)]*\)", " ", text)
    text = re.sub(r"[*\"«»]", " ", text)
    replacements = [
        (r"\bпроф\.?\s*болезн\w*\b", "профессиональные болезни"),
        (r"\bпб\b", "профессиональные болезни"),
        (r"\bдн\b", "детская неврология"),
        (r"\bмп\b", "медицинская психология"),
        (r"\bэз\b", "экономика здравоохранения"),
        (r"\bгоспит\.?\b", "госпитальная"),
        (r"\bфакультет\.?\b", "факультетская"),
        (r"\bхирургич\.?\b", "хирургическая"),
        (r"\bклин\.?\b", "клиническая"),
        (r"\bортопед\.?\b", "ортопедическая"),
        (r"\bстомат\.?\b", "стоматология"),
        (r"\bхирург\.?\s*болезн\w*\b", "хирургические болезни"),
        (r"фтизи\s+атрия", "фтизиатрия"),
        (r"\b\d+\s+по\s+\d+\b", " "),
    ]
    for pattern, replacement in replacements:
        text = re.sub(pattern, replacement, text)
    text = re.sub(r"[^a-zа-я0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


ALIASES = {
    "пп нмм": "практика по неотложным медицинским манипуляциям",
    "диб": "детские инфекционные болезни",
    "оск": "обучающий симуляционный курс",
}


def expanded_name(value):
    normalized = normalize_text(value)
    return ALIASES.get(normalized, normalized)


def similarity(left, right):
    left = expanded_name(left)
    right = expanded_name(right)
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    if left in right or right in left:
        return 0.95
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    jaccard = len(left_tokens & right_tokens) / max(1, len(left_tokens | right_tokens))
    sequence = difflib.SequenceMatcher(None, left, right).ratio()
    return 0.6 * jaccard + 0.4 * sequence


def program_from_file(path, text):
    filename = Path(path).name
    if "_medicine_" in filename:
        return "medicine"
    if "_pediatrics_" in filename:
        return "pediatrics"
    if "_dentistry_" in filename:
        return "dentistry"
    upper = text.upper()
    if "ПЕДИАТРИ" in upper:
        return "pediatrics"
    if "СТОМАТОЛ" in upper:
        return "dentistry"
    if "ЛЕЧЕБНОЕ ДЕЛО" in upper:
        return "medicine"
    return None


def file_context(path, rows):
    text = " ".join(" ".join(values.values()) for _, values in sorted(rows.items()))
    year_match = YEAR_RE.search(text)
    course_match = COURSE_RE.search(text)
    if not year_match:
        return None
    second_year = year_match.group(2)
    if len(second_year) == 2:
        second_year = "20" + second_year
    academic_year = f"{year_match.group(1)}/{second_year}"
    semester = 2 if "ВТОРОЕ ПОЛУГОДИЕ" in text.upper() else 1 if "ПЕРВОЕ ПОЛУГОДИЕ" in text.upper() else None
    if not semester:
        return None
    if not course_match:
        course_match = re.search(r"_course-(\d)_", Path(path).name)
    return {
        "academicYear": academic_year,
        "semester": semester,
        "program": program_from_file(path, text),
        "course": int(course_match.group(1)) if course_match else None,
    }


def find_layout_rows(rows):
    number_row = next(
        (row for row, values in rows.items() if any(value.strip().lower() == "число" for value in values.values())),
        None,
    )
    if not number_row:
        return None
    month_row = number_row - 1
    weekday_row = number_row + 1
    group_start = next(
        (
            row
            for row in range(weekday_row + 1, min(max(rows) + 1, weekday_row + 9))
            if re.fullmatch(r"\d{3}", rows.get(row, {}).get(2, ""))
        ),
        None,
    )
    if not group_start:
        return None
    group_end = group_start
    while re.fullmatch(r"\d{3}", rows.get(group_end + 1, {}).get(2, "")):
        group_end += 1
    metadata_header = next(
        (
            row
            for row in range(group_end + 1, max(rows) + 1)
            if any(value.strip().lower() == "дисциплина" for value in rows.get(row, {}).values())
        ),
        None,
    )
    if not metadata_header:
        return None
    return {
        "monthRow": month_row,
        "numberRow": number_row,
        "weekdayRow": weekday_row,
        "groupStartRow": group_start,
        "groupEndRow": group_end,
        "metadataHeaderRow": metadata_header,
    }


def date_columns(rows, merge_by_top_left, layout, context):
    month_row = layout["monthRow"]
    number_row = layout["numberRow"]
    first_year, second_year = map(int, context["academicYear"].split("/"))
    default_year = second_year if context["semester"] == 2 else first_year
    month_by_col = {}
    for col, value in sorted(rows.get(month_row, {}).items()):
        lower = value.lower()
        month = next((number for name, number in MONTHS.items() if name in lower), None)
        if not month:
            continue
        merge = merge_by_top_left.get((col, month_row))
        end_col = merge[2] if merge else col
        for current in range(col, end_col + 1):
            month_by_col[current] = month
    last_month = None
    max_col = max(rows.get(number_row, {}) or {0: None})
    for col in range(3, max_col + 1):
        if col in month_by_col:
            last_month = month_by_col[col]
        elif last_month:
            month_by_col[col] = last_month

    result = {}
    for col, value in rows.get(number_row, {}).items():
        if col < 3:
            continue
        try:
            day = int(float(value))
        except ValueError:
            continue
        month = month_by_col.get(col)
        if not month or not 1 <= day <= 31:
            continue
        try:
            result[col] = dt.date(default_year, month, day)
        except ValueError:
            continue
    return result


def metadata_columns(rows, layout):
    result = {}
    start = layout["metadataHeaderRow"]
    for row in range(start, min(start + 3, max(rows) + 1)):
        for col, value in rows.get(row, {}).items():
            normalized = normalize_text(value)
            if normalized == "дисциплина" and "discipline" not in result:
                result["discipline"] = col
            elif normalized.startswith("адрес") and "address" not in result:
                result["address"] = col
            elif "база практической подготовки" in normalized and "base" not in result:
                result["base"] = col
            elif normalized == "1 смена" and "shift1" not in result:
                result["shift1"] = col
            elif normalized == "2 смена" and "shift2" not in result:
                result["shift2"] = col
            elif "время проведения занятий" in normalized and "time" not in result:
                result["time"] = col
    return result


def metadata_records(rows, layout, columns):
    if "discipline" not in columns:
        return []
    result = []
    for row in range(layout["metadataHeaderRow"] + 1, max(rows) + 1):
        discipline = rows.get(row, {}).get(columns["discipline"], "")
        if not discipline:
            continue
        if "лекции по дисциплинам" in discipline.lower():
            break
        record = {"row": row, "discipline": discipline}
        for key in ("base", "address", "shift1", "shift2"):
            if key in columns:
                record[key] = rows.get(row, {}).get(columns[key])
        if "shift1" not in record and "time" in columns:
            record["shift1"] = rows.get(row, {}).get(columns["time"])
        result.append(record)
    return result


def marker_info(raw):
    stripped = re.sub(r"\s+", " ", raw).strip()
    lower = stripped.lower().replace("ё", "е")
    normalized = normalize_text(stripped)
    if stripped == "**" or normalized in {"ср", "самостоятельная работа"}:
        return {"type": "independent-study", "requiresReview": False}
    if normalized == "м":
        return {"type": "assessment-marker", "requiresReview": True}
    if normalized in {"экзамен", "экзамены", "эказмен"} or normalized.startswith("экзамен "):
        return {"type": "exam-period", "requiresReview": True}
    if normalized == "гиа":
        return {"type": "state-final-assessment", "requiresReview": True}
    if normalized in {"электив", "дв 4", "дв 5"}:
        return {"type": "elective-choice", "requiresReview": True}
    if normalized == "практика":
        return {"type": "practice-phase", "requiresReview": True}
    return None


def match_metadata(raw, metadata):
    candidates = sorted(
        ((similarity(raw, record["discipline"]), record) for record in metadata),
        key=lambda item: item[0],
        reverse=True,
    )
    if not candidates:
        return None, 0.0
    score, record = candidates[0]
    return (record if score >= 0.62 else None), score


def normalize_time(value):
    if not value:
        return None
    value = re.sub(r"\s+", " ", str(value)).strip()
    if not SIMPLE_TIME_RE.fullmatch(value):
        return None
    start, end = re.split(r"\s*-\s*", value)
    start = start.replace(".", ":")
    end = end.replace(".", ":")
    hour, minute = map(int, start.split(":"))
    start = f"{hour:02d}:{minute:02d}"
    hour, minute = map(int, end.split(":"))
    end = f"{hour:02d}:{minute:02d}"
    return {"start": start, "end": end}


def timing_status(metadata, first_day_second_shift):
    if not metadata:
        return {"status": "unresolved", "reason": "metadata-not-matched"}
    shift1_text = metadata.get("shift1")
    shift2_text = metadata.get("shift2")
    shift1 = normalize_time(shift1_text)
    shift2 = normalize_time(shift2_text)
    if first_day_second_shift:
        if shift2 and shift1:
            return {
                "status": "resolved",
                "rule": "first-date-shift-2-then-shift-1",
                "firstDateTime": shift2,
                "remainingDatesTime": shift1,
                "sourceShift1": shift1_text,
                "sourceShift2": shift2_text,
            }
        if shift2 and not shift1_text:
            return {
                "status": "resolved",
                "rule": "shift-2-only",
                "allDatesTime": shift2,
                "sourceShift2": shift2_text,
            }
        return {
            "status": "partial",
            "reason": "star-marker-needs-simple-two-shift-time",
            "sourceShift1": shift1_text,
            "sourceShift2": shift2_text,
        }
    if shift1:
        return {
            "status": "resolved",
            "rule": "shift-1",
            "allDatesTime": shift1,
            "sourceShift1": shift1_text,
            "sourceShift2": shift2_text,
        }
    if shift2 and not shift1_text:
        return {
            "status": "resolved",
            "rule": "only-listed-shift-2",
            "allDatesTime": shift2,
            "sourceShift2": shift2_text,
        }
    return {
        "status": "partial",
        "reason": "complex-or-missing-time",
        "sourceShift1": shift1_text,
        "sourceShift2": shift2_text,
    }


def block_dates(date_map, start_col, end_col):
    return [date_map[col] for col in sorted(date_map) if start_col <= col <= end_col]


def parse_file(path):
    sheet_name, values, rows, merges, covered, merge_by_top_left = read_xlsx(path)
    context = file_context(path, rows)
    layout = find_layout_rows(rows)
    if not context or not layout:
        return {
            "version": 1,
            "sourceFile": Path(path).name,
            "status": "unsupported",
            "reason": "not-calendar-grid",
        }
    dates = date_columns(rows, merge_by_top_left, layout, context)
    if not dates:
        return {
            "version": 1,
            "sourceFile": Path(path).name,
            "status": "unsupported",
            "reason": "calendar-date-columns-not-found",
        }
    columns = metadata_columns(rows, layout)
    metadata = metadata_records(rows, layout, columns)
    if not metadata:
        return {
            "version": 1,
            "sourceFile": Path(path).name,
            "status": "unsupported",
            "reason": "metadata-table-not-found",
        }

    min_date_col = min(dates)
    max_date_col = max(dates)
    groups = {}
    for row in range(layout["groupStartRow"], layout["groupEndRow"] + 1):
        group = rows.get(row, {}).get(2)
        if not re.fullmatch(r"\d{3}", group or ""):
            continue
        seen = set()
        blocks = []
        for col in sorted(dates):
            merge = covered.get((col, row))
            if merge:
                col1, row1, col2, row2, top_left, _ = merge
                raw = values.get(top_left, "")
                start_col = max(col1, min_date_col)
                end_col = min(col2, max_date_col)
                source_key = (top_left, start_col, end_col)
            else:
                top_left = f"{num_to_col(col)}{row}"
                raw = values.get(top_left, "")
                start_col = end_col = col
                source_key = (top_left, start_col, end_col)
            if not raw or source_key in seen:
                continue
            seen.add(source_key)
            dates_in_block = block_dates(dates, start_col, end_col)
            if not dates_in_block:
                continue

            marker = marker_info(raw)
            first_day_second_shift = "*" in raw and raw.strip() != "**"
            metadata_match = None
            metadata_score = None
            timing = None
            status = "marker" if marker else "matched"
            review_reasons = []
            if marker:
                if marker.get("requiresReview"):
                    review_reasons.append("marker-requires-review")
            else:
                metadata_match, score = match_metadata(raw, metadata)
                metadata_score = round(score, 3)
                if not metadata_match:
                    status = "unresolved"
                    review_reasons.append("discipline-metadata-not-matched")
                else:
                    timing = timing_status(metadata_match, first_day_second_shift)
                    if timing["status"] != "resolved":
                        status = "partial"
                        review_reasons.append(timing.get("reason", "time-requires-review"))

            blocks.append(
                {
                    "sourceCell": top_left,
                    "raw": raw,
                    "startDate": dates_in_block[0].isoformat(),
                    "endDate": dates_in_block[-1].isoformat(),
                    "dateCount": len(dates_in_block),
                    "dates": [date.isoformat() for date in dates_in_block],
                    "firstDaySecondShift": first_day_second_shift,
                    "kind": marker["type"] if marker else "discipline-cycle",
                    "status": status,
                    "requiresReview": bool(review_reasons),
                    "reviewReasons": review_reasons,
                    "metadataMatch": metadata_match["discipline"] if metadata_match else None,
                    "metadataMatchScore": metadata_score,
                    "practiceBase": metadata_match.get("base") if metadata_match else None,
                    "address": metadata_match.get("address") if metadata_match else None,
                    "timing": timing,
                }
            )
        groups[group] = {"blocks": blocks}

    all_blocks = [block for group in groups.values() for block in group["blocks"]]
    unresolved = [block for block in all_blocks if block["status"] == "unresolved"]
    partial = [block for block in all_blocks if block["status"] == "partial"]
    review_markers = [block for block in all_blocks if block["status"] == "marker" and block["requiresReview"]]
    target_period = context["academicYear"] == "2026/2027" and context["semester"] == 1
    qa_passed = not unresolved and not partial and not review_markers

    return {
        "version": 1,
        "sourceFile": Path(path).name,
        "sheetName": sheet_name,
        "status": "parsed",
        "layout": "calendar-grid",
        **context,
        "archiveReferenceOnly": not target_period,
        "commercialTargetPeriod": target_period,
        "qaPassed": qa_passed,
        "publishable": target_period and qa_passed,
        "layoutRows": layout,
        "dateColumnCount": len(dates),
        "metadataColumns": columns,
        "metadata": metadata,
        "stats": {
            "groupCount": len(groups),
            "blockCount": len(all_blocks),
            "disciplineBlockCount": sum(block["kind"] == "discipline-cycle" for block in all_blocks),
            "markerBlockCount": sum(block["kind"] != "discipline-cycle" for block in all_blocks),
            "metadataMatchedBlockCount": sum(bool(block["metadataMatch"]) for block in all_blocks),
            "unresolvedBlockCount": len(unresolved),
            "partialBlockCount": len(partial),
            "reviewMarkerCount": len(review_markers),
        },
        "groups": groups,
    }


def self_test():
    assert expanded_name("ПП НММ") == "практика по неотложным медицинским манипуляциям"
    assert expanded_name("ДИБ") == "детские инфекционные болезни"
    assert expanded_name("ОСК") == "обучающий симуляционный курс"
    assert similarity("Неврология, ДН", "Неврология, детская неврология") > 0.9
    assert similarity("Ортопед. стомат.", "Ортопедическая стоматология") > 0.9
    assert marker_info("**")["type"] == "independent-study"
    assert marker_info("Экзамены")["type"] == "exam-period"
    assert marker_info("ДВ.5")["type"] == "elective-choice"
    assert normalize_time("8.30-11.35") == {"start": "08:30", "end": "11:35"}
    assert normalize_time("8.00-11.55, один день - 8.00-11.05") is None
    print("kgmu calendar-grid parser self-test: OK")


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
    source = Path(args.input)
    files = sorted(source.glob("*.xlsx")) if source.is_dir() else [source]
    reports = [parse_file(path) for path in files]
    parsed = [report for report in reports if report.get("status") == "parsed"]
    summary = {
        "version": 1,
        "fileCount": len(reports),
        "parsedCalendarFileCount": len(parsed),
        "archiveReferenceOnlyFileCount": sum(bool(report.get("archiveReferenceOnly")) for report in parsed),
        "publishableFileCount": sum(bool(report.get("publishable")) for report in parsed),
        "groupCount": sum(report["stats"]["groupCount"] for report in parsed),
        "blockCount": sum(report["stats"]["blockCount"] for report in parsed),
        "unresolvedBlockCount": sum(report["stats"]["unresolvedBlockCount"] for report in parsed),
        "partialBlockCount": sum(report["stats"]["partialBlockCount"] for report in parsed),
        "reviewMarkerCount": sum(report["stats"]["reviewMarkerCount"] for report in parsed),
        "files": [
            {
                "sourceFile": report.get("sourceFile"),
                "status": report.get("status"),
                "program": report.get("program"),
                "course": report.get("course"),
                "academicYear": report.get("academicYear"),
                "semester": report.get("semester"),
                "archiveReferenceOnly": report.get("archiveReferenceOnly"),
                "qaPassed": report.get("qaPassed"),
                "publishable": report.get("publishable"),
                "stats": report.get("stats"),
                "reason": report.get("reason"),
            }
            for report in reports
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

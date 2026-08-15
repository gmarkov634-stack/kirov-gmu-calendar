#!/usr/bin/env python3
import argparse
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path
from xml.etree import ElementTree as ET

MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"a": MAIN_NS}
OLE_MAGIC = bytes.fromhex("d0cf11e0a1b11ae1")
XLSX_ZIP_MAGICS = {bytes.fromhex("504b0304"), bytes.fromhex("504b0506"), bytes.fromhex("504b0708")}
MONTH_RE = re.compile(r"^(январ|феврал|март|апрел|май|июн|июл|август|сентябр|октябр|ноябр|декабр)", re.I)
GROUP_RE = re.compile(r"^\s*\d{3,4}(?:\s*[А-ЯA-Z])?(?:\s*[-–]\s*\d{3,4}(?:\s*[А-ЯA-Z])?)?\s*$", re.I)


def col_to_num(col):
    value = 0
    for ch in col:
        if ch.isalpha():
            value = value * 26 + ord(ch.upper()) - 64
    return value


def detect_file_kind(path):
    head = path.read_bytes()[:8]
    if head[:4] in XLSX_ZIP_MAGICS:
        return "xlsx"
    if head.startswith(OLE_MAGIC):
        return "xls"
    return "unknown"


def shared_strings(zf):
    name = "xl/sharedStrings.xml"
    if name not in zf.namelist():
        return []
    root = ET.fromstring(zf.read(name))
    values = []
    for si in root.findall(f"{{{MAIN_NS}}}si"):
        text = "".join(node.text or "" for node in si.iter(f"{{{MAIN_NS}}}t"))
        values.append(text)
    return values


def sheet_targets(zf):
    workbook = ET.fromstring(zf.read("xl/workbook.xml"))
    rels = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
    relation_map = {
        rel.attrib["Id"]: rel.attrib["Target"]
        for rel in rels.findall(f"{{{PKG_REL_NS}}}Relationship")
    }
    result = []
    sheets = workbook.find(f"{{{MAIN_NS}}}sheets")
    for sheet in sheets or []:
        rid = sheet.attrib[f"{{{REL_NS}}}id"]
        target = relation_map[rid]
        filename = target.lstrip("/") if target.startswith("/") else f"xl/{target}"
        result.append((sheet.attrib.get("name", ""), filename))
    return result


def read_sheet(zf, filename, shared):
    root = ET.fromstring(zf.read(filename))
    rows = {}
    max_row = 0
    max_col = 0
    for cell in root.findall(f".//{{{MAIN_NS}}}sheetData/{{{MAIN_NS}}}row/{{{MAIN_NS}}}c"):
        ref = cell.attrib.get("r", "")
        match = re.match(r"([A-Z]+)(\d+)", ref)
        if not match:
            continue
        col, row = match.group(1), int(match.group(2))
        kind = cell.attrib.get("t")
        value_node = cell.find(f"{{{MAIN_NS}}}v")
        value = ""
        if kind == "s" and value_node is not None:
            index = int(value_node.text or "0")
            value = shared[index] if 0 <= index < len(shared) else ""
        elif kind == "inlineStr":
            value = "".join(node.text or "" for node in cell.iter(f"{{{MAIN_NS}}}t"))
        elif value_node is not None:
            value = value_node.text or ""
        rows.setdefault(row, {})[col] = value
        max_row = max(max_row, row)
        max_col = max(max_col, col_to_num(col))

    merge_cells = root.find(f"{{{MAIN_NS}}}mergeCells")
    merge_count = int(merge_cells.attrib.get("count", "0")) if merge_cells is not None else 0
    return rows, max_row, max_col, merge_count


def inspect_xlsx(path):
    with zipfile.ZipFile(path) as zf:
        shared = shared_strings(zf)
        targets = sheet_targets(zf)
        if not targets:
            raise ValueError("workbook-has-no-sheets")
        sheet_name, sheet_file = targets[0]
        rows, max_row, max_col, merge_count = read_sheet(zf, sheet_file, shared)

    items = [
        (row, col, str(value).strip())
        for row, cells in rows.items()
        for col, value in cells.items()
        if str(value).strip()
    ]
    first_ten = [value for row, _, value in items if row <= 10]
    lowered = [value.lower() for value in first_ten]
    groups = [(row, col, value) for row, col, value in items if GROUP_RE.match(value)]
    metadata = [
        value for row, col, value in items
        if col == "A" and any(marker in value.lower() for marker in (
            "кафедра", "форма контроля", "база практической подготовки", "время"
        ))
    ]
    months = [value for _, _, value in items if MONTH_RE.search(value)]

    return {
        "sheetCount": len(targets),
        "sheetNames": [name for name, _ in targets],
        "firstSheet": sheet_name,
        "rows": max_row,
        "cols": max_col,
        "mergeCount": merge_count,
        "groupTokenCount": len(groups),
        "cycleMetadataCount": len(metadata),
        "monthHeaderCount": len(months),
        "hasDayHeader": any(value in ("день", "weekday") for value in lowered),
        "hasTimeHeader": any(value in ("время", "time") for value in lowered),
        "hasSubjectHeader": any(value in ("предмет", "subject", "дисциплина") for value in lowered),
        "hasAuditoriumHeader": any(value.startswith("ауд") or value.startswith("auditorium") for value in lowered),
        "hasWeekHeader": any(value in ("неделя", "week") for value in lowered),
        "hasDaysOfWeekHeader": any("дни недели" in value or "days of week" in value for value in lowered),
    }


def classify_features(features):
    if (
        features["cols"] >= 80
        and features["groupTokenCount"] >= 3
        and features["cycleMetadataCount"] >= 2
    ):
        return "IZH-CYCLE", ["wide-calendar-matrix", "group-rows", "cycle-metadata-block"]

    if (
        (features["hasDaysOfWeekHeader"] or (features["hasSubjectHeader"] and features["hasWeekHeader"]))
        and features["hasTimeHeader"]
        and features["hasAuditoriumHeader"]
        and features["monthHeaderCount"] >= 2
    ):
        return "IZH-LECTURE", ["lecture-columns", "weekday-time-subject-auditorium", "month-date-grid"]

    if (
        features["cols"] < 50
        and features["hasDayHeader"]
        and features["hasTimeHeader"]
        and features["groupTokenCount"] >= 2
    ):
        return "IZH-WEEKLY", ["compact-day-time-group-grid", "group-header-row"]

    return None, []


def fingerprint_file(path, source_meta=None):
    source_meta = source_meta or {}
    kind = detect_file_kind(path)
    base = {
        "filename": path.name,
        "sourceKind": source_meta.get("sourceKind"),
        "faculty": source_meta.get("faculty"),
        "course": source_meta.get("course"),
        "stream": source_meta.get("stream"),
        "language": source_meta.get("language"),
        "sha256": source_meta.get("sha256"),
        "spreadsheetKind": kind,
    }

    if kind == "xls":
        return {
            **base,
            "status": "needs-review",
            "parserProfile": "IZH-LEGACY-XLS",
            "parserDispatchReady": False,
            "rules": ["IZH-F04"],
            "warnings": ["legacy-xls-content-reader-required"],
            "features": None,
        }
    if kind != "xlsx":
        return {
            **base,
            "status": "needs-review",
            "parserProfile": None,
            "parserDispatchReady": False,
            "rules": [],
            "warnings": ["unknown-spreadsheet-container"],
            "features": None,
        }

    try:
        features = inspect_xlsx(path)
        profile, evidence = classify_features(features)
    except Exception as exc:
        return {
            **base,
            "status": "needs-review",
            "parserProfile": None,
            "parserDispatchReady": False,
            "rules": [],
            "warnings": [f"fingerprint-error:{exc}"],
            "features": None,
        }

    rule = {
        "IZH-WEEKLY": "IZH-F01",
        "IZH-CYCLE": "IZH-F02",
        "IZH-LECTURE": "IZH-F03",
    }.get(profile)
    return {
        **base,
        "status": "classified" if profile else "needs-review",
        "parserProfile": profile,
        "parserDispatchReady": bool(profile),
        "rules": [rule] if rule else [],
        "evidence": evidence,
        "warnings": [] if profile else ["unknown-xlsx-layout"],
        "features": features,
    }


def run(input_dir, output=None):
    root = Path(input_dir).resolve()
    download_report = root / "download-report.json"
    source_by_filename = {}
    if download_report.exists():
        report = json.loads(download_report.read_text(encoding="utf-8"))
        source_by_filename = {item.get("filename"): item for item in report.get("files", []) if item.get("filename")}

    files = sorted([*root.glob("*.xlsx"), *root.glob("*.xls")])
    results = [fingerprint_file(path, source_by_filename.get(path.name)) for path in files]
    counts = Counter(item.get("parserProfile") or "UNKNOWN" for item in results)
    unknown_xlsx = [item for item in results if item["spreadsheetKind"] == "xlsx" and not item["parserDispatchReady"]]
    legacy = [item for item in results if item["parserProfile"] == "IZH-LEGACY-XLS"]

    payload = {
        "version": 1,
        "university": "izhgmu",
        "fileCount": len(results),
        "profileCounts": dict(counts),
        "xlsxFingerprintStatus": "ok" if not unknown_xlsx else "needs-review",
        "legacyXlsCount": len(legacy),
        "overallStatus": "needs-review" if unknown_xlsx or legacy else "ok",
        "parserDispatchReady": not unknown_xlsx and not legacy,
        "files": results,
    }
    output_path = Path(output or (root / "fingerprint-report.json"))
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return payload


def self_test():
    weekly = {
        "cols": 15, "groupTokenCount": 10, "cycleMetadataCount": 0, "monthHeaderCount": 0,
        "hasDayHeader": True, "hasTimeHeader": True, "hasSubjectHeader": False,
        "hasAuditoriumHeader": False, "hasWeekHeader": False, "hasDaysOfWeekHeader": False,
    }
    cycle = {
        "cols": 119, "groupTokenCount": 18, "cycleMetadataCount": 4, "monthHeaderCount": 0,
        "hasDayHeader": False, "hasTimeHeader": False, "hasSubjectHeader": False,
        "hasAuditoriumHeader": False, "hasWeekHeader": False, "hasDaysOfWeekHeader": False,
    }
    lecture = {
        "cols": 32, "groupTokenCount": 0, "cycleMetadataCount": 0, "monthHeaderCount": 4,
        "hasDayHeader": False, "hasTimeHeader": True, "hasSubjectHeader": True,
        "hasAuditoriumHeader": True, "hasWeekHeader": True, "hasDaysOfWeekHeader": True,
    }
    assert classify_features(weekly)[0] == "IZH-WEEKLY"
    assert classify_features(cycle)[0] == "IZH-CYCLE"
    assert classify_features(lecture)[0] == "IZH-LECTURE"
    print("IZHGMU_FINGERPRINT_SELF_TEST_OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir")
    parser.add_argument("--output")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if not args.input_dir:
        parser.error("--input-dir is required")
    report = run(args.input_dir, args.output)
    print("IZHGMU_FINGERPRINT", json.dumps({
        "fileCount": report["fileCount"],
        "profileCounts": report["profileCounts"],
        "xlsxFingerprintStatus": report["xlsxFingerprintStatus"],
        "legacyXlsCount": report["legacyXlsCount"],
        "overallStatus": report["overallStatus"],
    }, ensure_ascii=False))
    return 4 if report["xlsxFingerprintStatus"] != "ok" else 0


if __name__ == "__main__":
    sys.exit(main())

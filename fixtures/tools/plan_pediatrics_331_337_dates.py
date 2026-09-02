#!/usr/bin/env python3
"""Expand date semantics for tokenized KGMU Pediatrics course 3 source cells.

The output is review evidence, not the final normalized calendar. It turns each
recognized semantic segment into explicit date/time occurrences and fails closed
when no dates can be established.
"""
import json
import re
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOKENS = ROOT / "qa/2026-2027-semester-1/pediatrics-331-337.semantic-tokenization.json"
SOURCE = ROOT / "fixtures/2026-2027-semester-1/pediatrics-331-337.source.json"
OUT = ROOT / "qa/2026-2027-semester-1/pediatrics-331-337.date-plan.json"

YEAR = 2026
WEEKDAY = {"пн": 0, "вт": 1, "ср": 2, "чт": 3, "пт": 4, "сб": 5}
WEEK1_RANGES = [
    ("01.09", "05.09"), ("14.09", "19.09"), ("28.09", "03.10"),
    ("12.10", "17.10"), ("26.10", "31.10"), ("09.11", "14.11"),
    ("23.11", "28.11"), ("07.12", "12.12"), ("21.12", "26.12"),
]
WEEK2_RANGES = [
    ("07.09", "12.09"), ("21.09", "26.09"), ("05.10", "10.10"),
    ("19.10", "24.10"), ("02.11", "07.11"), ("16.11", "21.11"),
    ("30.11", "05.12"), ("14.12", "19.12"),
]

DATE_RANGE_RE = re.compile(r"(?<!\d)(\d{1,2}\.\d{2})-(\d{1,2}\.\d{2})(?!-\d)")
DATE_TOKEN_RE = re.compile(r"(?<!\d)(\d{1,2}\.\d{2})(?!\d)")
TRIPLE_OVERRIDE_RE = re.compile(
    r"(?<!\d)(\d{1,2}\.\d{2})-(\d{1,2}\.\d{2})-(\d{1,2}\.\d{2})(?!\d)"
)
SPACE_OVERRIDE_RE = re.compile(
    r"(?<!\d)(\d{1,2}\.\d{2})\s+(\d{1,2}\.\d{2})-(\d{1,2}\.\d{2})(?!\d)"
)
SHARED_OVERRIDE_RE = re.compile(
    r"\((\d{1,2}\.\d{2})\s*,\s*(\d{1,2}\.\d{2})\s+"
    r"(\d{1,2}\.\d{2})-(\d{1,2}\.\d{2})\)"
)
PARITY_CUTOFF_RE = re.compile(r"\b([12])\s+недел[яи]\s+по\s+(\d{1,2}\.\d{2})", re.IGNORECASE)
PARITY_LABEL_RE = re.compile(r"\b([12])\s+недел[яи]\b", re.IGNORECASE)
CROSS_DAY_NOTE_RE = re.compile(
    r"\(\s*\d+\s+(?:занят(?:ие|ия|ий)|лекци(?:я|и|й))\s+(?:в|во)\s+[^)]+\)", re.IGNORECASE
)
LOCATION_RE = re.compile(r"\b[123]\s+корпус,?\s+аудитория\s+\d+\s+ул\.\s+Владимирская,\s*\d+", re.IGNORECASE)


def parse_ddmm(token: str) -> date:
    day, month = map(int, token.split("."))
    return date(YEAR, month, day)


def iso(token: str) -> str:
    return parse_ddmm(token).isoformat()


def valid_date_token(token: str) -> bool:
    try:
        parsed = parse_ddmm(token)
    except ValueError:
        return False
    return date(YEAR, 9, 1) <= parsed <= date(YEAR, 12, 30)


def normalize_time(token: str) -> str:
    hour, minute = token.split(".")
    hour_i = int(hour)
    minute_i = int(minute)
    if not (0 <= hour_i <= 23 and 0 <= minute_i <= 59):
        raise ValueError(f"invalid time {token}")
    return f"{hour_i:02d}:{minute_i:02d}"


def weekly_dates(start_token: str, end_token: str, weekday: str):
    start = parse_ddmm(start_token)
    end = parse_ddmm(end_token)
    target = WEEKDAY[weekday]
    current = start
    while current.weekday() != target:
        current += timedelta(days=1)
    values = []
    while current <= end:
        values.append(current.isoformat())
        current += timedelta(days=7)
    return values


def parity_dates(parity: int, weekday: str, cutoff_token: str):
    cutoff = parse_ddmm(cutoff_token)
    ranges = WEEK1_RANGES if parity == 1 else WEEK2_RANGES
    values = []
    target = WEEKDAY[weekday]
    for start_token, end_token in ranges:
        start = parse_ddmm(start_token)
        end = min(parse_ddmm(end_token), cutoff)
        if start > cutoff:
            continue
        current = start
        while current.weekday() != target:
            current += timedelta(days=1)
        if current <= end:
            values.append(current.isoformat())
    return sorted(set(values))


def extract_overrides(tail: str):
    overrides = {}
    consumed = []

    for match in SHARED_OVERRIDE_RE.finditer(tail):
        d1, d2, start, end = match.groups()
        if valid_date_token(d1) and valid_date_token(d2):
            value = {"startTime": normalize_time(start), "endTime": normalize_time(end)}
            overrides[iso(d1)] = value
            overrides[iso(d2)] = value
            consumed.append(match.span())

    for regex in (TRIPLE_OVERRIDE_RE, SPACE_OVERRIDE_RE):
        for match in regex.finditer(tail):
            d, start, end = match.groups()
            if not valid_date_token(d):
                continue
            overrides[iso(d)] = {
                "startTime": normalize_time(start),
                "endTime": normalize_time(end),
            }
            consumed.append(match.span())

    scrubbed = list(tail)
    for start, end in consumed:
        for index in range(start, end):
            scrubbed[index] = " "
    return overrides, "".join(scrubbed)


def plan_segment(segment, weekday):
    tail = re.sub(r"\s+", " ", segment["tail"]).strip()
    base_start = segment["time"]["startTime"]
    base_end = segment["time"]["endTime"]
    overrides, working = extract_overrides(tail)
    working = CROSS_DAY_NOTE_RE.sub(" ", working)
    working = LOCATION_RE.sub(" ", working)

    dates = []
    basis = []
    parity_cutoff = PARITY_CUTOFF_RE.search(working)
    if parity_cutoff:
        parity = int(parity_cutoff.group(1))
        cutoff = parity_cutoff.group(2)
        dates.extend(parity_dates(parity, weekday, cutoff))
        basis.append({"kind": "parity-cutoff", "parity": parity, "cutoff": iso(cutoff)})
        working = working[:parity_cutoff.start()] + " " + working[parity_cutoff.end():]
    else:
        ranges = []
        for match in DATE_RANGE_RE.finditer(working):
            start_token, end_token = match.groups()
            if valid_date_token(start_token) and valid_date_token(end_token):
                ranges.append((match.span(), start_token, end_token))
        if len(ranges) > 1:
            return None, [f"multiple-date-ranges:{ranges}"]
        if ranges:
            span, start_token, end_token = ranges[0]
            dates.extend(weekly_dates(start_token, end_token, weekday))
            basis.append({"kind": "weekly-range", "start": iso(start_token), "end": iso(end_token)})
            chars = list(working)
            for index in range(span[0], span[1]):
                chars[index] = " "
            working = "".join(chars)

    # A parity label without "по" accompanies an explicit list; remove only the label.
    parity_label = PARITY_LABEL_RE.search(working)
    if parity_label:
        basis.append({"kind": "parity-label", "parity": int(parity_label.group(1))})
        working = working[:parity_label.start()] + " " + working[parity_label.end():]

    explicit = []
    for token in DATE_TOKEN_RE.findall(working):
        if valid_date_token(token):
            explicit.append(iso(token))
    dates.extend(explicit)
    if explicit:
        basis.append({"kind": "explicit-dates", "dates": explicit})

    dates.extend(overrides.keys())
    dates = sorted(set(dates))
    if not dates:
        return None, ["no-dates-resolved"]

    occurrences = []
    for value in dates:
        timing = overrides.get(value, {"startTime": base_start, "endTime": base_end})
        occurrences.append({"date": value, **timing})

    # Validate that all non-override occurrences stay on the timetable row weekday.
    weekday_issues = []
    target = WEEKDAY[weekday]
    for occurrence in occurrences:
        if occurrence["date"] in overrides:
            continue
        if date.fromisoformat(occurrence["date"]).weekday() != target:
            weekday_issues.append(f"row-weekday-mismatch:{occurrence['date']}:{weekday}")

    return {
        "segmentId": segment["segmentId"],
        "discipline": segment["discipline"],
        "lessonType": segment["lessonType"],
        "baseTime": {"startTime": base_start, "endTime": base_end},
        "dateBasis": basis,
        "overrides": overrides,
        "occurrences": occurrences,
        "sourceTail": segment["tail"],
    }, weekday_issues


def main():
    tokenization = json.loads(TOKENS.read_text(encoding="utf-8"))
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    assert tokenization["sourceSha256"] == source["source"]["sha256"]
    assert tokenization["reviewRequiredCellCount"] == 0

    cells = []
    issues = []
    occurrence_count = 0
    for cell in tokenization["cells"]:
        planned = []
        cell_issues = []
        for segment in cell["segments"]:
            plan, segment_issues = plan_segment(segment, cell["weekday"])
            if plan is not None:
                planned.append(plan)
                occurrence_count += len(plan["occurrences"])
            cell_issues.extend(f"{segment['segmentId']}:{issue}" for issue in segment_issues)
        status = "pass" if not cell_issues and len(planned) == len(cell["segments"]) else "review_required"
        if status != "pass":
            issues.append({"sourceLocator": cell["sourceLocator"], "issues": cell_issues})
        cells.append({
            "sourceLocator": cell["sourceLocator"],
            "weekday": cell["weekday"],
            "groups": cell["groups"],
            "status": status,
            "issues": cell_issues,
            "segments": planned,
        })

    payload = {
        "schema": "kgmu-explicit-date-plan-v1",
        "fixtureId": source["fixtureId"],
        "sourceSha256": source["source"]["sha256"],
        "semanticNormalizationPerformed": False,
        "sourceCellCount": len(cells),
        "sourceSegmentCount": sum(len(cell["segments"]) for cell in tokenization["cells"]),
        "plannedSegmentCount": sum(len(cell["segments"]) for cell in cells),
        "occurrenceCountBeforeGroupExpansion": occurrence_count,
        "passCellCount": sum(1 for cell in cells if cell["status"] == "pass"),
        "reviewRequiredCellCount": sum(1 for cell in cells if cell["status"] != "pass"),
        "issues": issues,
        "cells": cells,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "sourceCellCount": payload["sourceCellCount"],
        "sourceSegmentCount": payload["sourceSegmentCount"],
        "plannedSegmentCount": payload["plannedSegmentCount"],
        "occurrenceCountBeforeGroupExpansion": payload["occurrenceCountBeforeGroupExpansion"],
        "passCellCount": payload["passCellCount"],
        "reviewRequiredCellCount": payload["reviewRequiredCellCount"],
        "issues": payload["issues"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

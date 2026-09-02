#!/usr/bin/env python3
"""Tokenize KGMU Pediatrics course 3 timetable cells before normalization.

This script is deliberately source-preserving: it identifies timetable cells,
source day/group scope, time blocks and canonical discipline mentions, but does
not expand dates or emit normalized events. Any cell that cannot be segmented
exactly is reported as review_required.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "fixtures/2026-2027-semester-1/pediatrics-331-337.source-probe.json"
SOURCE = ROOT / "fixtures/2026-2027-semester-1/pediatrics-331-337.source.json"
OUT = ROOT / "qa/2026-2027-semester-1/pediatrics-331-337.semantic-tokenization.json"

GROUP_BY_COL = {
    "B": "331", "C": "332", "D": "333", "E": "334",
    "F": "335", "G": "336", "H": "337",
}
DAY_BLOCKS = [
    (8, 12, "пн"),
    (13, 17, "вт"),
    (18, 22, "ср"),
    (23, 25, "чт"),
    (26, 28, "пт"),
    (30, 33, "сб"),
]
LECTURE_CELLS = {"B9", "B10", "B11", "B14", "B15", "B16", "B18", "B19", "B26"}
ALL_GROUP_CELLS = LECTURE_CELLS | {"B30"}

DISCIPLINES = [
    "Учебная практика. Практика по получению первичных профессиональных умений и навыков диагностического профиля",
    "Патологическая анатомия, клиническая патологическая анатомия, патологическая анатомия (модуль)",
    "Патофизиология, клиническая патофизиология. Патофизиология (модуль)",
    "Топографическая анатомия и оперативная хирургия",
    "Элективные дисциплины (модули) по физической культуре и спорту",
    "Пропедевтика внутренних болезней",
    "Пропедевтика детских болезней",
    "Микробиология, вирусология",
    "Общая хирургия",
    "Иммунология",
    "Фармакология",
    "Гигиена",
]

ALIASES = {
    "Патологическая анатомия, клиническая патологическая анатомия, патологическая анатомия (модуль)": [
        r"ПАТОЛОГИЧЕСКАЯ\s+АНАТОМИЯ,\s*КЛИНИЧЕСКАЯ\s+ПАТОЛОГИЧЕСКАЯ\s+АНАТОМИЯ\.\s*ПАТОЛОГИЧЕСКАЯ\s+АНАТОМИЯ\s*\(модуль\)",
        r"Патологическая\s+анатомия,\s*клиническая\s+патологическая\s+анатомия,\s*патологическая\s+анатомия\s*\(модуль\s*\)",
    ],
    "Патофизиология, клиническая патофизиология. Патофизиология (модуль)": [
        r"ПАТОФИЗИОЛОГИЯ,\s*КЛИНИЧЕСКАЯ\s+ПАТОФИЗИОЛОГИЯ\.\s*ПАТОФИЗИОЛОГИЯ\s*\(модуль\)",
        r"Патофизиология,\s*клиническая\s+патофизиология\.\s*Патофизиология\s*\(модуль\)",
    ],
    "Элективные дисциплины (модули) по физической культуре и спорту": [
        r"ЭЛЕКТИВНЫЕ\s+ДИСЦИПЛИНЫ\s*\(модули\)\s*ПО\s+ФИЗИЧЕСКОЙ\s+КУЛЬТУРЕ\s+И\s+СПОРТУ",
    ],
}

TIME_RANGE_RE = re.compile(r"(?<!\d)(\d{1,2})[.:](\d{2})-(\d{1,2})[.:](\d{2})(?!\d)")


def day_for_row(row: int):
    for start, end, day in DAY_BLOCKS:
        if start <= row <= end:
            return day
    return None


def cell_row_col(coord: str):
    match = re.fullmatch(r"([A-Z]+)(\d+)", coord)
    if not match:
        return None, None
    return match.group(1), int(match.group(2))


def discipline_matches(text: str):
    matches = []
    occupied = []
    for canonical in DISCIPLINES:
        patterns = ALIASES.get(canonical, []) + [re.escape(canonical)]
        for pattern in patterns:
            for match in re.finditer(pattern, text, flags=re.IGNORECASE):
                if any(not (match.end() <= a or match.start() >= b) for a, b in occupied):
                    continue
                matches.append((match.start(), match.end(), canonical, match.group(0)))
                occupied.append((match.start(), match.end()))
    return sorted(matches)


def preceding_time_start(text: str, discipline_start: int, lower_bound: int):
    candidates = [m for m in TIME_RANGE_RE.finditer(text, lower_bound, discipline_start)]
    if not candidates:
        return None
    # A segment may start with two adjacent time ranges; include both by walking
    # backward while only punctuation/whitespace separates them.
    first = candidates[-1]
    start = first.start()
    if len(candidates) >= 2:
        prev = candidates[-2]
        between = text[prev.end():first.start()]
        if re.fullmatch(r"[\s,.;]+", between or ""):
            start = prev.start()
    return start


def normalize_time_block(text: str):
    ranges = list(TIME_RANGE_RE.finditer(text))
    if not ranges:
        return None
    start = f"{int(ranges[0].group(1)):02d}:{ranges[0].group(2)}"
    end = f"{int(ranges[-1].group(3)):02d}:{ranges[-1].group(4)}"
    return {"startTime": start, "endTime": end, "raw": text.strip()}


def main():
    probe = json.loads(PROBE.read_text(encoding="utf-8"))
    source_manifest = json.loads(SOURCE.read_text(encoding="utf-8"))
    source = probe["source"]
    assert source["sha256"] == source_manifest["source"]["sha256"]

    cells = source["sheets"][0]["nonEmptyCells"]
    timetable = []
    for cell in cells:
        col, row = cell_row_col(cell["coord"])
        day = day_for_row(row or -1)
        if day is None or col == "A":
            continue
        if col not in GROUP_BY_COL:
            continue
        timetable.append(cell)

    results = []
    review_required = []
    total_segments = 0
    for cell in timetable:
        coord = cell["coord"]
        raw = re.sub(r"\s+", " ", cell["value"]).strip()
        col, row = cell_row_col(coord)
        matches = discipline_matches(raw)
        entry = {
            "sourceLocator": f"3пед.!{coord}",
            "weekday": day_for_row(row),
            "groups": source_manifest["expectedGroupIds"] if coord in ALL_GROUP_CELLS else [GROUP_BY_COL[col]],
            "raw": cell["value"],
            "segments": [],
            "status": "pass",
            "issues": [],
        }
        if not matches:
            entry["status"] = "review_required"
            entry["issues"].append("no-known-discipline-match")
            review_required.append(entry["sourceLocator"])
            results.append(entry)
            continue

        segment_starts = []
        lower_bound = 0
        for start, end, canonical, matched_text in matches:
            time_start = preceding_time_start(raw, start, lower_bound)
            if time_start is None:
                entry["issues"].append(f"no-preceding-time:{canonical}")
                continue
            segment_starts.append((time_start, start, end, canonical, matched_text))
            lower_bound = end

        segment_starts.sort()
        for index, (time_start, d_start, d_end, canonical, matched_text) in enumerate(segment_starts):
            segment_end = segment_starts[index + 1][0] if index + 1 < len(segment_starts) else len(raw)
            prefix = raw[time_start:d_start]
            # Drop LECTURE marker from the time prefix, while preserving its type.
            lesson_type = "lecture" if re.search(r"ЛЕКЦИЯ", prefix, re.IGNORECASE) else "practice"
            time_text = re.sub(r"\bЛЕКЦИЯ\b", "", prefix, flags=re.IGNORECASE).strip()
            time_block = normalize_time_block(time_text)
            if time_block is None:
                entry["issues"].append(f"bad-time-block:{canonical}")
                continue
            tail = raw[d_end:segment_end].strip()
            entry["segments"].append({
                "segmentId": f"{coord}#s{index + 1}",
                "discipline": canonical,
                "lessonType": lesson_type,
                "time": time_block,
                "tail": tail,
            })

        if len(entry["segments"]) != len(matches):
            entry["issues"].append(
                f"segment-count-mismatch:{len(entry['segments'])}/{len(matches)}"
            )
        if entry["issues"]:
            entry["status"] = "review_required"
            review_required.append(entry["sourceLocator"])
        total_segments += len(entry["segments"])
        results.append(entry)

    payload = {
        "schema": "kgmu-semantic-tokenization-v1",
        "fixtureId": source_manifest["fixtureId"],
        "sourceSha256": source["sha256"],
        "semanticNormalizationPerformed": False,
        "timetableCellCount": len(timetable),
        "segmentCount": total_segments,
        "passCellCount": sum(1 for item in results if item["status"] == "pass"),
        "reviewRequiredCellCount": sum(1 for item in results if item["status"] != "pass"),
        "reviewRequiredLocators": review_required,
        "cells": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: payload[k] for k in [
        "sourceSha256", "timetableCellCount", "segmentCount",
        "passCellCount", "reviewRequiredCellCount", "reviewRequiredLocators"
    ]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Audit all source-declared cross-day/additional-session cues for Pediatrics 331-337.

Pairings are operator-authored from the same pinned XLSX. The script proves that
all mechanically extracted cues are covered, evidence locators contain the cited
explicit dates, and cited dates land on the weekday named by the source note.
It does not synthesize missing dates.
"""
import datetime as dt
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROBE = ROOT / "fixtures/2026-2027-semester-1/pediatrics-331-337.source-probe.json"
INVENTORY = ROOT / "qa/2026-2027-semester-1/pediatrics-331-337.source-inventory.json"
OUT = ROOT / "qa/2026-2027-semester-1/pediatrics-331-337.cross-day-audit.json"

PAIRINGS = {
    "B8": ("B25", ["12.11", "26.11", "10.12"]),
    "D8": ("D23", ["19.11", "03.12"]),
    "F8": ("F17", ["08.12", "22.12"]),
    "G8": ("G25", ["12.11", "26.11", "10.12"]),
    "H8": ("H17", ["08.12", "15.12", "22.12"]),
    "B12": ("B13", ["15.12", "22.12"]),
    "E13": ("E23", ["26.11", "03.12"]),
    "G13": ("G25", ["03.12"]),
    "H13": ("H28", ["11.12", "18.12"]),
    "D17": ("D12", ["30.11", "14.12"]),
    "F17": ("F25", ["03.12"]),
    "B19": ("B9", ["30.11", "14.12"]),
    "B20": ("B25", ["03.12", "17.12", "24.12"]),
    "C20": ("C28", ["11.12", "18.12"]),
    "D20": ("D12", ["07.12"]),
    "E20": ("E23", ["03.12", "17.12"]),
    "F20": ("F24", ["05.11", "19.11"]),
    "H20": ("H31", ["26.12"]),
    "D21": ("D28", ["30.10", "06.11"]),
    "F21": ("F12", ["30.11", "07.12", "14.12"]),
    "G22": ("G33", ["12.12", "19.12"]),
    "F23": ("F28", ["11.12"]),
    "G23": ("G17", ["22.12"]),
    "H23": ("H17", ["24.11"]),
    "B24": ("B17", ["15.12"]),
    "C24": ("C12", ["21.12"]),
    "C25": ("C17", ["01.12", "08.12"]),
    "D25": ("D31", ["05.12", "12.12"]),
    "E25": ("E12", ["07.12", "14.12"]),
    "H25": ("H12", ["14.12"]),
    "C27": ("C21", ["25.11", "02.12"]),
    "E27": ("E17", ["08.12"]),
    "F27": ("F17", ["24.11"]),
    "G27": ("G17", ["01.12"]),
    "H27": ("H25", ["26.11"]),
    "E28": ("E21", ["02.12"]),
    "G28": ("G12", ["23.11", "30.11"]),
    "H28": ("H12", ["26.10"]),
    "B31": ("B17", ["10.11"]),
    "C31": ("C23", ["03.12"]),
    "E31": ("E17", ["15.12"]),
    "G31": ("G17", ["15.12"]),
    "C32": ("C12", ["07.12"]),
    "F33": ("F12", ["09.11", "16.11"]),
}

DAY_INDEX = {"пн": 0, "вт": 1, "ср": 2, "чт": 3, "пт": 4, "сб": 5, "вс": 6}


def normalized_day(raw: str) -> str:
    value = raw.strip().lower().replace(".", "")
    value = re.sub(r"\s+", "", value)
    if value not in DAY_INDEX:
        raise AssertionError(f"unsupported source weekday: {raw!r}")
    return value


def iso_date(token: str) -> str:
    day, month = (int(part) for part in token.split("."))
    return dt.date(2026, month, day).isoformat()


def main() -> None:
    probe = json.loads(PROBE.read_text(encoding="utf-8"))
    inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
    source_cells = {
        cell["coord"]: cell["value"]
        for cell in probe["source"]["sheets"][0]["nonEmptyCells"]
    }
    cues = inventory["crossDayExpectationCues"]
    assert len(cues) == 44, len(cues)
    cue_by_coord = {}
    for cue in cues:
        coord = cue["sourceLocator"].split("!", 1)[1]
        if coord in cue_by_coord:
            raise AssertionError(f"multiple cross-day cues in one source cell not modeled: {coord}")
        cue_by_coord[coord] = cue
    assert set(cue_by_coord) == set(PAIRINGS), (
        sorted(set(cue_by_coord) - set(PAIRINGS)),
        sorted(set(PAIRINGS) - set(cue_by_coord)),
    )

    checks = []
    unresolved = []
    for coord, cue in cue_by_coord.items():
        evidence_coord, tokens = PAIRINGS[coord]
        evidence_raw = source_cells[evidence_coord]
        for token in tokens:
            if token not in evidence_raw:
                raise AssertionError(f"{coord}: explicit date {token} absent from {evidence_coord}")
        target_day = normalized_day(cue["targetDayRaw"])
        dates = [iso_date(token) for token in tokens]
        for date_text in dates:
            date = dt.date.fromisoformat(date_text)
            if date.weekday() != DAY_INDEX[target_day]:
                raise AssertionError(f"{coord}: {date_text} is not {target_day}")
        expected = cue["expectedCount"]
        status = "pass" if len(dates) == expected else "review_required"
        check = {
            "sourceLocator": cue["sourceLocator"],
            "expectedCount": expected,
            "targetWeekday": target_day,
            "evidenceLocator": f"3пед.!{evidence_coord}",
            "matchedExplicitDates": dates,
            "matchedCount": len(dates),
            "status": status,
        }
        checks.append(check)
        if status != "pass":
            unresolved.append(check)

    assert len(checks) == 44
    assert sum(check["status"] == "pass" for check in checks) == 43
    assert [check["sourceLocator"] for check in unresolved] == ["3пед.!D20"]
    payload = {
        "schema": "kgmu-cross-day-audit-v1",
        "fixtureId": inventory["fixtureId"],
        "sourceSha256": inventory["sourceSha256"],
        "rules": ["R07", "R08", "R09", "R67", "R83"],
        "cueCount": len(checks),
        "passCount": 43,
        "reviewRequiredCount": 1,
        "checks": checks,
        "unresolved": unresolved,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "cueCount": payload["cueCount"],
        "passCount": payload["passCount"],
        "reviewRequiredCount": payload["reviewRequiredCount"],
        "unresolved": payload["unresolved"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

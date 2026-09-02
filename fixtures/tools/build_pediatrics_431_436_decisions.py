#!/usr/bin/env python3
"""Build explicit semantic decisions for KGMU Pediatrics course 4, groups 431-436.

This is intentionally course/source-specific. It consumes the verified compact
semantic source evidence plus the reviewed G21 decision and emits the existing
`kgmu-explicit-semantic-decisions-v3` manifest. It does not modify common parser,
schema, pipeline, publishing, database, or production state.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PERIOD = ROOT / "fixtures/2026-2027-semester-1"
SOURCE_PATH = PERIOD / "pediatrics-431-436.source.json"
SEMANTIC_PATH = PERIOD / "pediatrics-431-436.semantic-source.json"
REVIEW_PATH = ROOT / "qa/2026-2027-semester-1/pediatrics-431-436.semantic-review.json"
OUT = PERIOD / "pediatrics-431-436.decisions.json"
EVIDENCE_OUT = ROOT / "qa/2026-2027-semester-1/pediatrics-431-436.normalization-evidence.json"

GROUPS = ["431", "432", "433", "434", "435", "436"]
SOURCE_SHA = "2a06f31b31e59e2c8408a6c20876e62869ce9ce8b98a4ea5dc2004fa2a486c86"
SHEET = "4 курс осень 2026 Пед"
RULES = "kgmu-2026-08-30-v4"

DISCIPLINES = [
    "Факультетская терапия, профессиональные болезни",
    "Клиническая патологическая анатомия (модуль)",
    "Клиническая патофизиология (модуль)",
    "Факультетская хирургия (раздел)",
    "Урология (раздел)",
    "Лучевая диагностика и терапия",
    "Оториноларингология",
    "Клиническая микробиология",
    "Офтальмология",
    "Неврология, детская неврология",
    "Акушерство и гинекология",
    "Менеджмент в здравоохранении",
    "Инклюзивно ориентированная компетентность врача-педиатра",
    "Факультетская педиатрия, эндокринология",
    "ЗАЩИТА ПРОЕКТА — МЕНЕДЖМЕНТ В ЗДРАВООХРАНЕНИИ",
    "Дисциплины по физической культуре и спорту",
]
LESSON_TYPES = ["other", "practice"]
LOCATIONS = [
    "Клиническая больница «РЖД-Медицина» города Кирова, Октябрьский проспект, 151",
    "КОГБ СЭУЗ «Кировское областное бюро судебно-медицинской экспертизы», Патологоанатомическое отделение № 2 (морг), ул. Тихая, 1",
    "Кировский ГМУ, учебный корпус № 3, ул. Владимирская, 112",
    "КОГКБУЗ «Больница скорой медицинской помощи», ул. Свердлова, 4",
    "КОГБУЗ «Центр онкологии и медицинской радиологии», пр. Строителей, 23",
    "КОГБУЗ «Кировская областная клиническая больница», ул. Воровского, 42",
    "КОГБУЗ «Кировская клиническая офтальмологическая больница», Октябрьский проспект, 10а",
    "Кировский ГМУ, учебный корпус № 1, каб. 413, ул. Владимирская, 137",
    "Кировский ГМУ, учебный корпус № 1, каб. 415, ул. Владимирская, 137",
    "Кировский ГМУ, учебный корпус № 1, каб. 419, ул. Владимирская, 137",
    "Кировский ГМУ, учебный корпус № 1, ул. Владимирская, 137",
    "КОГБУЗ «Кировская областная детская клиническая больница», ул. Менделеева, 16",
    "Кировский ГМУ, учебный корпус № 3, Физкультурно-оздоровительный комплекс, ул. Владимирская, 112",
]

D = {name: index for index, name in enumerate(DISCIPLINES)}
L = {name: index for index, name in enumerate(LOCATIONS)}
PRACTICE = LESSON_TYPES.index("practice")
OTHER = LESSON_TYPES.index("other")

ASSESSMENTS = {
    D["Клиническая патологическая анатомия (модуль)"]: ("credit", "зачёт", "X25"),
    D["Клиническая патофизиология (модуль)"]: ("credit", "зачёт", "X26"),
    D["Факультетская хирургия (раздел)"]: ("exam", "экзамен", "X27:AC28"),
    D["Урология (раздел)"]: ("exam", "экзамен", "X27:AC28"),
    D["Лучевая диагностика и терапия"]: ("credit", "зачёт", "X29"),
    D["Оториноларингология"]: ("credit", "зачёт", "X30"),
    D["Клиническая микробиология"]: ("credit", "зачёт", "X31"),
    D["Менеджмент в здравоохранении"]: ("credit", "зачёт", "X35"),
    D["Инклюзивно ориентированная компетентность врача-педиатра"]: ("credit", "зачёт", "X36"),
    D["ЗАЩИТА ПРОЕКТА — МЕНЕДЖМЕНТ В ЗДРАВООХРАНЕНИИ"]: ("credit", "зачёт", "X35"),
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def compact(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def mask_for(table: list[str], values: list[str]) -> str:
    indexes = {value: index for index, value in enumerate(table)}
    mask = 0
    for value in values:
        if value not in indexes:
            raise SystemExit(f"value outside mask table: {value}")
        mask |= 1 << indexes[value]
    if mask == 0:
        raise SystemExit("empty mask")
    return format(mask, "x")


def row_cells(semantic: dict, row_number: int) -> dict[str, str]:
    row = next((item for item in semantic["lowerTable"] if item["row"] == row_number), None)
    if row is None:
        raise SystemExit(f"missing lower-table row {row_number}")
    return {item["coord"]: item["value"] for item in row["cells"]}


def require_contains(actual: str, *parts: str) -> None:
    normalized = compact(actual).lower()
    for part in parts:
        if compact(part).lower() not in normalized:
            raise SystemExit(f"expected {part!r} in source value {actual!r}")


def validate_lower_table(semantic: dict) -> None:
    checks = {
        24: ("C24", "Факультетская терапия", "BW24", "Октябрьский проспект, 151"),
        25: ("C25", "Клиническая патологическая анатомия", "CE25", "8:30-12:25"),
        26: ("C26", "Клиническая патофизиология", "CE26", "9:00-12:05"),
        27: ("C27", "Факультетская хирургия", "CE27", "8.30-11.35"),
        28: ("C28", "Урология", "CE28", "8.30-11.35"),
        29: ("C29", "Лучевая диагностика", "CE29", "8.30-11.35"),
        30: ("C30", "Оториноларингология", "CE30", "9:00-12:05"),
        31: ("C31", "Клиническая микробиология", "CE31", "9:00-12:05"),
        32: ("C32", "Офтальмология", "CE32", "9:00-12:05"),
        33: ("C33", "Неврология", "CE33", "9:00-12:05"),
        34: ("C34", "Акушерство и гинекология", "CE34", "9:00-12:05"),
        35: ("C35", "Менеджмент в здравоохранении", "CE35", "два дня"),
        36: ("C36", "Инклюзивно ориентированная", "CE36", "один день"),
        37: ("C37", "Факультетская педиатрия", "CE37", "9:00-12:05"),
        38: ("C38", "Дисциплины по физической культуре", "CE38", "15:10-16:40"),
    }
    for row_number, (subject_coord, subject_part, time_coord, time_part) in checks.items():
        cells = row_cells(semantic, row_number)
        require_contains(cells[subject_coord], subject_part)
        require_contains(cells[time_coord], time_part)
    require_contains(row_cells(semantic, 24)["CI24"], "431,432,435", "13.00-16.05")
    require_contains(row_cells(semantic, 32)["CI32"], "431", "433", "434", "436", "12:30-15:35")
    require_contains(row_cells(semantic, 33)["CI33"], "433", "10:30-13:35")
    require_contains(row_cells(semantic, 35)["CE35"], "8.30-11.35", "8:30-13:10")
    require_contains(row_cells(semantic, 36)["CE36"], "9:00-12:05", "9:00-13:40")


def management_location(group: str) -> int:
    if group in {"433", "435", "436"}:
        return L["Кировский ГМУ, учебный корпус № 1, каб. 413, ул. Владимирская, 137"]
    if group in {"431", "432"}:
        return L["Кировский ГМУ, учебный корпус № 1, каб. 415, ул. Владимирская, 137"]
    if group == "434":
        return L["Кировский ГМУ, учебный корпус № 1, каб. 419, ул. Владимирская, 137"]
    raise SystemExit(f"unexpected management group: {group}")


def resolve_regular(raw_value: str, group: str):
    starred = raw_value.rstrip().endswith("*")
    name = compact(raw_value.replace("*", ""))
    if name == "Факультетская терапия, профессиональные болезни":
        time = ("08:30", "11:35") if group in {"433", "434", "436"} else ("13:00", "16:05")
        return D[name], time, L["Клиническая больница «РЖД-Медицина» города Кирова, Октябрьский проспект, 151"], starred
    if name in {"Клиническая пат. анатомия", "Клиническая пат. анатомия (модуль)"}:
        return D["Клиническая патологическая анатомия (модуль)"], ("08:30", "12:25"), L["КОГБ СЭУЗ «Кировское областное бюро судебно-медицинской экспертизы», Патологоанатомическое отделение № 2 (морг), ул. Тихая, 1"], starred
    if name in {"Клиническая патофизиология", "Клиническая патофизиология (модуль)"}:
        return D["Клиническая патофизиология (модуль)"], ("09:00", "12:05"), L["Кировский ГМУ, учебный корпус № 3, ул. Владимирская, 112"], starred
    if name == "Факультетская хирургия":
        return D["Факультетская хирургия (раздел)"], ("08:30", "11:35"), L["КОГКБУЗ «Больница скорой медицинской помощи», ул. Свердлова, 4"], starred
    if name == "Урология":
        return D["Урология (раздел)"], ("08:30", "11:35"), L["КОГКБУЗ «Больница скорой медицинской помощи», ул. Свердлова, 4"], starred
    if name == "Лучевая диагностика и терапия":
        return D[name], ("08:30", "11:35"), L["КОГБУЗ «Центр онкологии и медицинской радиологии», пр. Строителей, 23"], starred
    if name == "Оториноларингология":
        return D[name], ("09:00", "12:05"), L["КОГБУЗ «Кировская областная клиническая больница», ул. Воровского, 42"], starred
    if name == "Клиническая микробиология":
        return D[name], ("09:00", "12:05"), L["Кировский ГМУ, учебный корпус № 3, ул. Владимирская, 112"], starred
    if name == "Офтальмология":
        return D[name], ("09:00", "12:05"), L["КОГБУЗ «Кировская клиническая офтальмологическая больница», Октябрьский проспект, 10а"], starred
    if name == "Неврология, детская неврология":
        return D[name], ("09:00", "12:05"), L["КОГБУЗ «Кировская областная клиническая больница», ул. Воровского, 42"], starred
    if name == "Акушерство и гинекология":
        return D[name], ("09:00", "12:05"), L["КОГКБУЗ «Больница скорой медицинской помощи», ул. Свердлова, 4"], starred
    if name == "Менеджмент в здравоохранении":
        return D[name], ("08:30", "11:35"), management_location(group), starred
    if name.startswith("ИОК врача-"):
        return D["Инклюзивно ориентированная компетентность врача-педиатра"], ("09:00", "12:05"), L["Кировский ГМУ, учебный корпус № 1, ул. Владимирская, 137"], starred
    if name == "Факультетская педиатрия, эндокринология":
        return D[name], ("09:00", "12:05"), L["КОГБУЗ «Кировская областная детская клиническая больница», ул. Менделеева, 16"], starred
    raise SystemExit(f"unclassified cycle value for group {group}: {raw_value!r}")


def assessment_metadata():
    result = {}
    for discipline_index, (kind, label, locator) in ASSESSMENTS.items():
        result[str(discipline_index)] = {
            "type": kind,
            "label": label,
            "sourceRef": {"sourceId": "pediatrics", "locator": f"{SHEET}!{locator}"},
        }
    return result


def main() -> None:
    source = read_json(SOURCE_PATH)
    semantic = read_json(SEMANTIC_PATH)
    review = read_json(REVIEW_PATH)
    if source["source"]["sha256"] != SOURCE_SHA or semantic["sourceSha256"] != SOURCE_SHA or review["sourceSha256"] != SOURCE_SHA:
        raise SystemExit("source/review SHA mismatch")
    if source["parserRulesVersion"] != RULES or review["parserRulesVersion"] != RULES:
        raise SystemExit("parser rules mismatch")
    if source["expectedGroupIds"] != GROUPS or review["reviewedScope"]["groups"] != GROUPS:
        raise SystemExit("group scope mismatch")
    if review.get("unresolvedAmbiguities") != [] or not review["qaGate"]["semanticAmbiguitiesResolved"]:
        raise SystemExit("semantic ambiguities are not resolved")
    resolved = {item["ambiguityId"]: item for item in review["resolvedAmbiguities"]}
    if resolved["PED4-C20-MANAGEMENT-EXTENDED-DAYS"].get("exceptionDatePolicy") != "last-2-calendar-dates":
        raise SystemExit("Management G21 policy is not last-2-calendar-dates")
    if resolved["PED4-C20-IOK-EXTENDED-DAY"].get("exceptionDatePolicy") != "last-1-calendar-date":
        raise SystemExit("IOK G21 policy is not last-1-calendar-date")
    validate_lower_table(semantic)

    date_table = [item["date"] for item in semantic["dateAxis"] if item["date"] <= "2027-01-23"]
    if date_table != sorted(set(date_table)):
        raise SystemExit("date table is not unique/sorted")
    decisions = []
    classifications = []
    generating_blocks = 0
    service_blocks = 0
    starred_blocks = 0
    management_blocks = 0
    iok_blocks = 0
    defense_blocks = 0

    def add(locator: str, groups: list[str], dates: list[str], start: str, end: str, discipline_index: int, lesson_type_index: int, location_index: int):
        if not dates:
            raise SystemExit(f"decision has no dates: {locator}")
        decisions.append([
            locator,
            mask_for(GROUPS, groups),
            mask_for(date_table, dates),
            start,
            end,
            discipline_index,
            lesson_type_index,
            location_index,
        ])

    for block in semantic["cycleBlocks"]:
        group = block["group"]
        raw = block["value"]
        value = compact(raw)
        locator = block["locator"]
        dates = [item for item in block["dates"] if item <= "2027-01-23"]
        if value.lower() in {"экзамен", "экзамены", "каникулы"}:
            service_blocks += 1
            classifications.append({"locator": locator, "group": group, "value": raw, "classification": "service-no-event"})
            continue
        if value == "М":
            if len(dates) != 1:
                raise SystemExit(f"M marker must have one date: {group} {locator} {dates}")
            add(locator, [group], dates, "08:30", "11:35", D["ЗАЩИТА ПРОЕКТА — МЕНЕДЖМЕНТ В ЗДРАВООХРАНЕНИИ"], OTHER, management_location(group))
            generating_blocks += 1
            defense_blocks += 1
            classifications.append({"locator": locator, "group": group, "value": raw, "classification": "C03/C04-management-defense", "dates": dates})
            continue

        discipline_index, base_time, location_index, starred = resolve_regular(raw, group)
        discipline = DISCIPLINES[discipline_index]
        if starred:
            starred_blocks += 1
            if discipline == "Офтальмология":
                add(locator, [group], dates[:1], "12:30", "15:35", discipline_index, PRACTICE, location_index)
                if dates[1:]:
                    add(locator, [group], dates[1:], base_time[0], base_time[1], discipline_index, PRACTICE, location_index)
            elif discipline == "Неврология, детская неврология" and group == "433":
                add(locator, [group], dates[:1], "10:30", "13:35", discipline_index, PRACTICE, location_index)
                if dates[1:]:
                    add(locator, [group], dates[1:], base_time[0], base_time[1], discipline_index, PRACTICE, location_index)
            else:
                raise SystemExit(f"unsupported starred block: {group} {locator} {raw!r}")
            classification = "C02-first-day-second-shift"
        elif discipline == "Менеджмент в здравоохранении":
            if len(dates) < 2:
                raise SystemExit(f"Management block too short for G21: {group} {locator}")
            if dates[:-2]:
                add(locator, [group], dates[:-2], "08:30", "11:35", discipline_index, PRACTICE, location_index)
            add(locator, [group], dates[-2:], "08:30", "13:10", discipline_index, PRACTICE, location_index)
            management_blocks += 1
            classification = "C20/G21-last-two-dates-extended"
        elif discipline == "Инклюзивно ориентированная компетентность врача-педиатра":
            if len(dates) < 1:
                raise SystemExit(f"IOK block has no dates: {group} {locator}")
            if dates[:-1]:
                add(locator, [group], dates[:-1], "09:00", "12:05", discipline_index, PRACTICE, location_index)
            add(locator, [group], dates[-1:], "09:00", "13:40", discipline_index, PRACTICE, location_index)
            iok_blocks += 1
            classification = "C20/G21-last-date-extended"
        else:
            add(locator, [group], dates, base_time[0], base_time[1], discipline_index, PRACTICE, location_index)
            classification = "C01/C08-regular-cycle"
        generating_blocks += 1
        classifications.append({"locator": locator, "group": group, "value": raw, "classification": classification, "dates": dates})

    if management_blocks != 6 or iok_blocks != 6 or defense_blocks != 6:
        raise SystemExit(f"unexpected special-block counts: management={management_blocks}, iok={iok_blocks}, M={defense_blocks}")
    if starred_blocks != 5:
        raise SystemExit(f"unexpected starred block count: {starred_blocks}")

    phys_dates = [
        item["date"] for item in semantic["dateAxis"]
        if "2026-09-02" <= item["date"] <= "2026-12-23" and item["weekday"] == "ср"
    ]
    add(
        "C38:CL38",
        GROUPS,
        phys_dates,
        "15:10",
        "16:40",
        D["Дисциплины по физической культуре и спорту"],
        PRACTICE,
        L["Кировский ГМУ, учебный корпус № 3, Физкультурно-оздоровительный комплекс, ул. Владимирская, 112"],
    )

    manifest = {
        "schema": "kgmu-explicit-semantic-decisions-v3",
        "fixtureId": source["fixtureId"],
        "sourceSha256": SOURCE_SHA,
        "parserRulesVersion": RULES,
        "sheetName": SHEET,
        "semanticDecisionMode": "operator-authored-explicit",
        "logicalSourceCellCount": len(semantic["cycleBlocks"]) + 1,
        "decisionCount": len(decisions),
        "dateTable": date_table,
        "disciplineTable": DISCIPLINES,
        "locationTable": LOCATIONS,
        "assessmentMetadataByDisciplineIndex": assessment_metadata(),
        "groupTable": GROUPS,
        "lessonTypeTable": LESSON_TYPES,
        "tupleFields": ["locator", "groupMaskHex", "dateMaskHex", "startTime", "endTime", "disciplineIndex", "lessonTypeIndex", "locationIndex"],
        "decisions": decisions,
    }
    OUT.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    evidence = {
        "schema": "kgmu-pediatrics-431-436-normalization-evidence-v1",
        "sourceSha256": SOURCE_SHA,
        "parserRulesVersion": RULES,
        "semanticSourceCycleBlockCount": len(semantic["cycleBlocks"]),
        "classifiedCycleBlockCount": generating_blocks + service_blocks,
        "generatingCycleBlockCount": generating_blocks,
        "serviceNoEventBlockCount": service_blocks,
        "decisionCount": len(decisions),
        "managementG21BlockCount": management_blocks,
        "iokG21BlockCount": iok_blocks,
        "managementDefenseBlockCount": defense_blocks,
        "starredC02BlockCount": starred_blocks,
        "independentC12Schedules": [{"locator": "C38:CL38", "eventDateCount": len(phys_dates), "groups": GROUPS}],
        "classifications": classifications,
    }
    EVIDENCE_OUT.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE_OUT.write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        "logicalSourceCellCount": manifest["logicalSourceCellCount"],
        "cycleBlockCount": len(semantic["cycleBlocks"]),
        "generatingCycleBlockCount": generating_blocks,
        "serviceNoEventBlockCount": service_blocks,
        "decisionCount": len(decisions),
        "dateCount": len(date_table),
        "physEdDateCount": len(phys_dates),
        "specialCounts": {"management": management_blocks, "iok": iok_blocks, "M": defense_blocks, "starred": starred_blocks},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

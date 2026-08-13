from __future__ import annotations

from datetime import date
from pathlib import Path
import csv
import json
import os
import re

GROUPS = [str(value) for value in range(401, 421)]
SOURCE_SHA256 = "146876a71f1ad8503593aeb82fcc72fef76022896b85d7f7dc61ca7ec97c0dae"
SOURCE_URL = "https://kirovgma.ru/sites/default/files/files/2026/02/02/1078/4_kurs_lechebnyy_fakultet-02-02-2026-14.xlsx"
OUTPUT_PATH = f"reviewed/kgmu/2025-26/2/medicine/4/{SOURCE_SHA256}.json"
DATA_DIR = Path(__file__).with_name("medicine4_2025_26_data")

# Manually reviewed transcription of the official XLSX main grid. The data files
# preserve exact merged-cell geometry and the explicit calendar columns. Rules
# C01-C13 are then applied here deterministically.
DATE_BY_COL: dict[int, str] = {}
with (DATA_DIR / "date-map.txt").open(encoding="utf-8") as source:
    for line in source:
        line = line.rstrip("\n")
        if not line:
            continue
        col, _letters, iso = line.split("\t")
        DATE_BY_COL[int(col)] = iso

BLOCKS: list[dict] = []
with (DATA_DIR / "blocks.txt").open(encoding="utf-8") as source:
    reader = csv.DictReader(source, delimiter="\t")
    for row in reader:
        BLOCKS.append({
            "group": row["group"],
            "row": int(row["row"]),
            "startCol": int(row["startCol"]),
            "endCol": int(row["endCol"]),
            "startRef": row["startRef"],
            "sourceRange": row["sourceRange"],
            "rawTitle": json.loads(row["rawTitle"]),
        })

DISCIPLINES = {
    "Факультетская терапия, профессиональные болезни": {
        "start": "09:00", "end": "12:05",
        "location": 'КОГБУЗ "Центр кардиологии и неврологии", ул. Ивана Попова, 41',
        "attestation": "экзамен",
    },
    "Педиатрия": {
        "start": "08:30", "end": "11:35",
        "location": 'КОГБУЗ "Детский клинический консультативно-диагностический центр", ул. Красноармейская, 43',
    },
    "Неврология, нейрохирургия": {
        "start": "09:00", "end": "12:05", "secondStart": "10:30", "secondEnd": "13:35",
        "location": 'КОГБУЗ "Кировская областная клиническая больница", ул. Воровского, 42',
        "attestation": "экзамен",
    },
    "Офтальмология": {
        "start": "08:30", "end": "11:35",
        "location": 'КОГБУЗ "Кировская клиническая офтальмологическая больница", Октябрьский проспект, 10а',
        "attestation": "зачёт",
    },
    "Психиатрия, медицинская психология": {
        "start": "09:00", "end": "12:05",
        "location": 'КОГБУЗ "Кировская областная клиническая психиатрическая больница им. академика В. М. Бехтерева", пос. Ганино',
    },
    "Акушерство и гинекология": {
        "start": "08:30", "end": "12:25",
        "location": 'КОГБУЗ "Кировский областной клинический перинатальный центр", ул. Московская, 163',
        "attestation": "зачёт",
    },
    "Менеджмент в здравоохранении": {
        "start": "08:30", "end": "11:35", "secondStart": "12:00", "secondEnd": "15:05",
        "location": "1 корпус, ул. Владимирская, 137",
        "attestation": "зачёт",
    },
    "Оториноларингология": {
        "start": "09:00", "end": "12:05",
        "location": 'КОГБУЗ "Кировская областная клиническая больница", ул. Воровского, 42',
        "attestation": "зачёт",
    },
    "Факультетская хирургия (раздел)": {
        "start": "08:30", "end": "11:35",
        "location": 'КОГКБУЗ "Больница скорой медицинской помощи", ул. Свердлова, 4',
        "attestation": "экзамен",
    },
    "Урология (раздел)": {
        "start": "08:30", "end": "11:35",
        "location": 'КОГКБУЗ "Больница скорой медицинской помощи", ул. Свердлова, 4',
    },
}

TITLE_ALIASES = {
    "Факультетская терапия, профессиональные болезни": "Факультетская терапия, профессиональные болезни",
    "Факультетская терапия, проф. болезни": "Факультетская терапия, профессиональные болезни",
    "Педиатрия": "Педиатрия",
    "Неврология, нейрохирургия": "Неврология, нейрохирургия",
    "Офтальмология": "Офтальмология",
    "Психиатрия, МП": "Психиатрия, медицинская психология",
    "Акушерство и гинекология": "Акушерство и гинекология",
    "Менеджмент в здравоохранении": "Менеджмент в здравоохранении",
    "Оториноларингология": "Оториноларингология",
    "Факультет. хирургия": "Факультетская хирургия (раздел)",
    "Урология": "Урология (раздел)",
}


def clean_raw_title(value: str) -> str:
    return re.sub(r"\s+", " ", str(value).replace("\r", " ").replace("\n", " ")).strip()


def canonical_title(raw: str) -> tuple[str | None, bool, str | None]:
    text = clean_raw_title(raw)
    if text in {"**", "Экзамены"}:
        return None, False, None
    if text == "М":
        return "ЗАЩИТА ПРОЕКТА — МЕНЕДЖМЕНТ В ЗДРАВООХРАНЕНИИ", False, "M"
    second_shift_first_day = "*" in text
    text = clean_raw_title(text.replace("*", ""))
    title = TITLE_ALIASES.get(text)
    if not title:
        raise AssertionError(f"Unreviewed discipline title: {raw!r} -> {text!r}")
    return title, second_shift_first_day, None


def description_for(title: str, *, marker: str | None = None) -> str:
    if marker == "M":
        return "Форма промежуточной аттестации: зачёт."
    attestation = DISCIPLINES[title].get("attestation")
    return f"Форма промежуточной аттестации: {attestation}." if attestation else ""


def timed_event(*, title: str, iso_date: str, start: str, end: str, location: str,
                kind: str = "lesson", source_cell: str | None = None,
                source_range: str | None = None, description: str = "") -> dict:
    event = {
        "title": title,
        "start": f"{iso_date}T{start}:00+03:00",
        "end": f"{iso_date}T{end}:00+03:00",
        "location": location,
        "kind": kind,
    }
    if description:
        event["description"] = description
    if source_cell:
        event["sourceCell"] = source_cell
    if source_range:
        event["sourceRange"] = source_range
    return event


events: dict[str, list[dict]] = {group: [] for group in GROUPS}

# Main cyclic grid: merged horizontal discipline blocks expand to one event per
# explicit study-date column (C01). Asterisk changes only the first day to the
# second shift (C02). M is a one-day first-shift project defence (C03-C04).
for block in BLOCKS:
    group = block["group"]
    assert group in events, f"Unexpected group {group}"
    title, second_shift_first_day, marker = canonical_title(block["rawTitle"])
    if title is None:
        continue
    if marker == "M":
        iso_date = DATE_BY_COL[block["startCol"]]
        meta = DISCIPLINES["Менеджмент в здравоохранении"]
        events[group].append(timed_event(
            title=title, iso_date=iso_date, start=meta["start"], end=meta["end"],
            location=meta["location"], source_cell=block["startRef"],
            source_range=block["sourceRange"], description=description_for(title, marker="M"),
        ))
        continue

    meta = DISCIPLINES[title]
    for col in range(block["startCol"], block["endCol"] + 1):
        iso_date = DATE_BY_COL.get(col)
        if not iso_date:
            raise AssertionError(f"Block uses non-calendar column {col}: {block}")
        use_second = second_shift_first_day and col == block["startCol"]
        if use_second:
            assert meta.get("secondStart") and meta.get("secondEnd"), f"No second shift for {title}"
            start, end = meta["secondStart"], meta["secondEnd"]
        else:
            start, end = meta["start"], meta["end"]
        events[group].append(timed_event(
            title=title, iso_date=iso_date, start=start, end=end,
            location=meta["location"], source_cell=block["startRef"],
            source_range=block["sourceRange"], description=description_for(title),
        ))


def date_in_grid(iso: str) -> bool:
    return iso in set(DATE_BY_COL.values())


def grid_dates(start_iso: str, end_iso: str, weekday: int) -> list[str]:
    return [
        iso for iso in DATE_BY_COL.values()
        if start_iso <= iso <= end_iso and date.fromisoformat(iso).weekday() == weekday
    ]


def add_shared(groups: list[str], title: str, dates: list[str], start: str, end: str,
               location: str, *, kind: str, source_cell: str, source_range: str | None = None,
               description: str = "") -> None:
    for group in groups:
        for iso_date in dates:
            events[group].append(timed_event(
                title=title, iso_date=iso_date, start=start, end=end, location=location,
                kind=kind, source_cell=source_cell, source_range=source_range or source_cell,
                description=description,
            ))

# Explicit independent lower-table schedules (C10-C12).
stream1 = [str(value) for value in range(401, 411)]
stream2 = [str(value) for value in range(411, 421)]

add_shared(
    stream1,
    "ЛЕКЦ. ФАКУЛЬТЕТСКАЯ ТЕРАПИЯ, ПРОФЕССИОНАЛЬНЫЕ БОЛЕЗНИ",
    grid_dates("2026-02-02", "2026-04-06", 0),
    "14:45", "16:15", "3 корпус, аудитория 803, ул. Владимирская, 112",
    kind="lecture", source_cell="BX41",
)
add_shared(
    stream2,
    "ЛЕКЦ. ФАКУЛЬТЕТСКАЯ ТЕРАПИЯ, ПРОФЕССИОНАЛЬНЫЕ БОЛЕЗНИ",
    grid_dates("2026-02-04", "2026-03-25", 2),
    "14:30", "16:00", "3 корпус, аудитория 819, ул. Владимирская, 112",
    kind="lecture", source_cell="CD41",
)

pe_location = "3 корпус, Физкультурно-оздоровительный комплекс, ул. Владимирская, 112"
pe_description = "Форма промежуточной аттестации: зачёт."
stream1_pe_dates = grid_dates("2026-02-02", "2026-05-18", 0) + ["2026-04-07", "2026-04-14"]
assert all(date_in_grid(value) for value in stream1_pe_dates)
add_shared(
    stream1,
    "Элективные дисциплины по физической культуре и спорту",
    stream1_pe_dates,
    "16:45", "18:15", pe_location,
    kind="lesson", source_cell="BX51", description=pe_description,
)
# The two Tuesday additions have their own explicit time in the same source cell.
for group in stream1:
    for event in events[group]:
        if event.get("sourceCell") == "BX51" and event["start"][:10] in {"2026-04-07", "2026-04-14"}:
            iso_date = event["start"][:10]
            event["start"] = f"{iso_date}T14:30:00+03:00"
            event["end"] = f"{iso_date}T16:00:00+03:00"

add_shared(
    stream2,
    "Элективные дисциплины по физической культуре и спорту",
    grid_dates("2026-02-04", "2026-05-20", 2),
    "16:30", "18:00", pe_location,
    kind="lesson", source_cell="CD51", description=pe_description,
)

# Sort and exact-deduplicate. Explicit overlaps are deliberately preserved (C13).
for group in GROUPS:
    deduped = []
    seen = set()
    for event in sorted(events[group], key=lambda item: (item["start"], item["end"], item["title"], item["location"])):
        key = (event["title"], event["start"], event["end"], event["location"])
        if key not in seen:
            seen.add(key)
            deduped.append(event)
    events[group] = deduped

# Deterministic semantic QA of the transcription/rules application.
assert set(events) == set(GROUPS)
assert all(events[group] for group in GROUPS)
assert len(DATE_BY_COL) == 104
assert len(BLOCKS) >= 200
assert sum(1 for block in BLOCKS if clean_raw_title(block["rawTitle"]) == "М") == 20
assert sum(1 for block in BLOCKS if "*" in clean_raw_title(block["rawTitle"]) and clean_raw_title(block["rawTitle"]) != "**") == 10
assert sum(1 for block in BLOCKS if clean_raw_title(block["rawTitle"]) == "**") == 1
assert any(event["title"].startswith("ЛЕКЦ.") for event in events["401"])
assert any(event["title"] == "Элективные дисциплины по физической культуре и спорту" for event in events["420"])

# Report overlaps for QA without modifying source-explicit events.
overlap_count = 0
for group in GROUPS:
    ordered = events[group]
    for index, first in enumerate(ordered):
        first_date = first["start"][:10]
        for second in ordered[index + 1:]:
            if second["start"][:10] != first_date:
                if second["start"][:10] > first_date:
                    break
                continue
            if second["start"] < first["end"] and first["start"] < second["end"]:
                overlap_count += 1

counts = {group: len(events[group]) for group in GROUPS}
print("Medicine course 4 counts:", counts)
print("Medicine course 4 total:", sum(counts.values()), "explicit overlap pairs:", overlap_count)

bundle = {
    "version": 1,
    "university": "kgmu",
    "program": "medicine",
    "course": 4,
    "academicYear": "2025/26",
    "semester": 2,
    "source": {
        "filename": "4_kurs_lechebnyy_fakultet-02-02-2026-14.xlsx",
        "sha256": SOURCE_SHA256,
        "url": SOURCE_URL,
        "groupRange": "401-420",
    },
    "normalizer": {
        "type": "chatgpt-reviewed",
        "rulesRevision": "C13",
    },
    "groups": {group: {"events": events[group]} for group in GROUPS},
}

seen_bundle_keys = set()
for group in GROUPS:
    for event in bundle["groups"][group]["events"]:
        key = (group, event["title"], event["start"], event["end"], event.get("location", ""))
        assert key not in seen_bundle_keys, f"duplicate event: {key}"
        seen_bundle_keys.add(key)

os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
with open(OUTPUT_PATH, "w", encoding="utf-8") as output:
    json.dump(bundle, output, ensure_ascii=False, indent=2)
print(f"Wrote {OUTPUT_PATH}: {sum(counts.values())} events")

manifest = os.environ.get("KGMU_MATERIALIZED_FILE_LIST")
if manifest:
    with open(manifest, "a", encoding="utf-8") as target:
        target.write(OUTPUT_PATH + "\n")

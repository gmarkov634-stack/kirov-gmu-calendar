#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

RUSSIAN_TITLE = "РАСПИСАНИЕ УЧЕБНЫХ ЗАНЯТИЙ"
GROUP_RE = re.compile(r"\d{3,4}")
AUDITORIUM_RE = re.compile(r"Аудиторные\s+занятия\s*:\s*(\d{2}\.\d{2})\s*[-–]\s*(\d{2}\.\d{2})(.*)", re.I)


def compact(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("\n", " ")).strip()


def close(a: float, b: float, tolerance: float = 0.8) -> bool:
    return abs(float(a) - float(b)) <= tolerance


def cell_bounds(cell: tuple[float, float, float, float] | None) -> tuple[float, float] | None:
    if cell is None:
        return None
    return float(cell[0]), float(cell[2])


def role_schema_from_header(table: Any, extracted: list[list[Any]], header_index: int) -> dict[str, Any]:
    values = [compact(value) for value in extracted[header_index]]
    cells = table.rows[header_index].cells

    def column_of(label: str) -> int:
        try:
            return values.index(label)
        except ValueError as error:
            raise RuntimeError(f"OMG_COMBINED_HEADER_ROLE_NOT_FOUND: {label}") from error

    discipline_col = column_of("Дисциплина")
    time_col = column_of("Время")
    kdays_col = column_of("К.дн.")
    group_columns: list[tuple[int, str]] = []
    for index, value in enumerate(values):
        if GROUP_RE.fullmatch(value):
            group_columns.append((index, value))
    if len(group_columns) != 1:
        raise RuntimeError(f"OMG_COMBINED_EXPECTED_ONE_GROUP_COLUMN: {group_columns}")
    group_col, group_code = group_columns[0]

    roles: dict[str, dict[str, Any]] = {}
    for role, column_index in (
        ("discipline", discipline_col),
        ("time", time_col),
        ("kDays", kdays_col),
        ("group", group_col),
    ):
        cell = cells[column_index]
        if cell is None:
            raise RuntimeError(f"OMG_COMBINED_HEADER_CELL_MISSING: {role}")
        x0, _y0, x1, _y1 = cell
        roles[role] = {"columnIndex": column_index, "x0": round(x0, 3), "x1": round(x1, 3)}

    return {
        "groupCode": group_code,
        "roles": roles,
        "headerValues": values,
    }


def row_matches_schema(row: Any, schema: dict[str, Any]) -> bool:
    cells = row.cells
    for role in ("discipline", "time", "kDays", "group"):
        spec = schema["roles"][role]
        column_index = spec["columnIndex"]
        if column_index >= len(cells):
            return False
        bounds = cell_bounds(cells[column_index])
        if bounds is None:
            # Discipline is allowed to be vertically merged, producing None on
            # the continuation subrow. The other semantic columns must exist.
            if role == "discipline":
                continue
            return False
        if not close(bounds[0], spec["x0"]) or not close(bounds[1], spec["x1"]):
            return False
    return True


def row_payload(page_number: int, table: Any, extracted: list[list[Any]], row_index: int, schema: dict[str, Any], inherited_discipline: str) -> tuple[dict[str, Any] | None, str]:
    values = extracted[row_index]
    row = table.rows[row_index]
    roles = schema["roles"]

    def value(role: str) -> str:
        index = roles[role]["columnIndex"]
        return compact(values[index] if index < len(values) else "")

    discipline = value("discipline")
    discipline_inherited = False
    if discipline:
        inherited_discipline = discipline
    elif inherited_discipline:
        discipline = inherited_discipline
        discipline_inherited = True

    time_text = value("time")
    kdays_text = value("kDays")
    group_text = value("group")
    if not discipline or not time_text or not kdays_text.isdigit() or not group_text:
        return None, inherited_discipline

    def bbox(role: str) -> list[float] | None:
        index = roles[role]["columnIndex"]
        if index >= len(row.cells) or row.cells[index] is None:
            return None
        return [round(v, 3) for v in row.cells[index]]

    return {
        "pageNumber": page_number,
        "rowIndex": row_index,
        "discipline": discipline,
        "disciplineInherited": discipline_inherited,
        "disciplineBbox": bbox("discipline"),
        "timeText": time_text,
        "timeBbox": bbox("time"),
        "declaredDays": int(kdays_text),
        "kDaysBbox": bbox("kDays"),
        "groupCode": schema["groupCode"],
        "groupText": group_text,
        "groupBbox": bbox("group"),
    }, inherited_discipline


def extract_combined_geometry(pdf_path: Path) -> dict[str, Any]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError("pdfplumber is required; install tools/requirements-omgmu.txt") from error

    schema: dict[str, Any] | None = None
    schema_page: int | None = None
    pages: list[dict[str, Any]] = []
    local_envelope: dict[str, Any] | None = None
    russian_started = False

    with pdfplumber.open(pdf_path) as document:
        for page_number, page in enumerate(document.pages, start=1):
            page_text = page.extract_text() or ""
            if RUSSIAN_TITLE in page_text:
                russian_started = True
            if not russian_started:
                continue

            tables = page.find_tables()
            if not tables:
                continue
            table = max(tables, key=lambda candidate: (candidate.bbox[2] - candidate.bbox[0]) * (candidate.bbox[3] - candidate.bbox[1]))
            extracted = table.extract()
            if not extracted:
                continue

            header_index = None
            for index, row in enumerate(extracted):
                values = [compact(value) for value in row]
                if "Дисциплина" in values and "Время" in values and "К.дн." in values:
                    header_index = index
                    break

            if header_index is not None:
                if schema is not None:
                    raise RuntimeError(f"OMG_COMBINED_UNEXPECTED_SECOND_SCHEMA: page {page_number}")
                schema = role_schema_from_header(table, extracted, header_index)
                schema_page = page_number
                for row in extracted[:header_index]:
                    joined = compact(" ".join(compact(value) for value in row if value))
                    match = AUDITORIUM_RE.search(joined)
                    if match:
                        local_envelope = {
                            "start": match.group(1),
                            "end": match.group(2),
                            "raw": joined,
                            "withoutSaturday": "без суббот" in match.group(3).lower(),
                        }
                start_index = header_index + 1
                schema_inherited = False
            else:
                if schema is None or schema_page is None:
                    raise RuntimeError(f"OMG_COMBINED_CONTINUATION_WITHOUT_SCHEMA: page {page_number}")
                # O69: a headerless continuation may inherit only if the actual
                # semantic column boundaries align with the proven schema.
                semantic_rows = [row for row in table.rows if any(cell is not None for cell in row.cells)]
                if not semantic_rows or not all(row_matches_schema(row, schema) for row in semantic_rows):
                    raise RuntimeError(f"OMG_COMBINED_SCHEMA_ALIGNMENT_AMBIGUOUS: page {page_number}")
                start_index = 0
                schema_inherited = True

            inherited_discipline = ""
            rows: list[dict[str, Any]] = []
            for row_index in range(start_index, len(extracted)):
                payload, inherited_discipline = row_payload(
                    page_number,
                    table,
                    extracted,
                    row_index,
                    schema,
                    inherited_discipline,
                )
                if payload is not None:
                    rows.append(payload)

            if rows:
                pages.append({
                    "pageNumber": page_number,
                    "tableBbox": [round(value, 3) for value in table.bbox],
                    "schemaInherited": schema_inherited,
                    "schemaFromPage": schema_page,
                    "rows": rows,
                })

    if schema is None or schema_page is None or not pages:
        raise RuntimeError(f"OMG_COMBINED_RU_GEOMETRY_NOT_FOUND: {pdf_path}")
    if local_envelope is None:
        raise RuntimeError("OMG_COMBINED_LOCAL_ENVELOPE_NOT_FOUND")

    return {
        "version": 1,
        "sourceProfile": "combined_rotation_table",
        "sourceLanguage": "ru",
        "columnSchema": schema,
        "localEnvelope": local_envelope,
        "pages": pages,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Russian combined_rotation_table geometry from ОмГМУ PDF")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    geometry = extract_combined_geometry(Path(args.input))
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(geometry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"combined_rotation_table geometry: group={geometry['columnSchema']['groupCode']} "
        f"schemaPage={geometry['pages'][0]['schemaFromPage']} pages={len(geometry['pages'])} "
        f"rows={sum(len(page['rows']) for page in geometry['pages'])} -> {output_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

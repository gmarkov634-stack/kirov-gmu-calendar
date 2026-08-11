#!/usr/bin/env python3
import importlib.util
import sys
from pathlib import Path

SAFE_PATH = Path(__file__).with_name("kgmu-expand-weekly-safe.py")
spec = importlib.util.spec_from_file_location("kgmu_expand_weekly_safe", SAFE_PATH)
safe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(safe)
base = safe.base

CYCLE_LABEL = "расписание занятий цикла"


def cycle_header_rows(rows):
    result = []
    for row, values in sorted(rows.items()):
        if any(CYCLE_LABEL in str(value).lower() for value in values.values()):
            result.append(row)
    return result


_original_schedule_footer_row = base.schedule_footer_row


def qa_schedule_footer_row(rows):
    normal_footer = _original_schedule_footer_row(rows)
    cycle_rows = cycle_header_rows(rows)
    return min([normal_footer, *cycle_rows]) if cycle_rows else normal_footer


base.schedule_footer_row = qa_schedule_footer_row
_original_parse_file = base.parse_file


def metadata_row_after(rows, start_row):
    for row in range(start_row + 1, max(rows) + 1):
        if any(str(value).strip().lower() == "дисциплина" for value in rows.get(row, {}).values()):
            return row
    return max(rows) + 1


def cycle_blockers(path, report):
    _values, rows, _merges, _covered = base.read_xlsx(path)
    cycle_rows = cycle_header_rows(rows)
    if not cycle_rows:
        return {}

    _header_row, group_columns = base.find_group_header(rows)
    known_groups = set(group_columns.values())
    blockers = {group: [] for group in known_groups}

    for cycle_row in cycle_rows:
        end_row = metadata_row_after(rows, cycle_row)
        header_text = " ".join(rows.get(cycle_row, {}).values()).strip()
        explicit_group_rows = {
            row: str(rows.get(row, {}).get(1, "")).strip()
            for row in range(cycle_row + 1, end_row)
            if str(rows.get(row, {}).get(1, "")).strip() in known_groups
        }

        if explicit_group_rows:
            # Variant B (e.g. Dentistry year 2): each cycle row explicitly names
            # its group in column A. This is authoritative, so normal group-column
            # scanning is intentionally skipped to avoid duplicate blockers.
            for row, explicit_group in explicit_group_rows.items():
                fragments = [str(value).strip() for _, value in sorted(rows.get(row, {}).items()) if value]
                if fragments:
                    blockers[explicit_group].append({
                        "sourceCell": f"cycle@{row}",
                        "sourceRow": row,
                        "sourceWeekday": None,
                        "raw": " | ".join([header_text, *fragments]),
                        "reason": "supplementary-cycle-requires-review",
                    })
            continue

        # Variant A (e.g. Dentistry year 1): the row after the cycle heading has
        # one group-specific time/range cell in each normal group column.
        for col, group in group_columns.items():
            fragments = []
            for row in range(cycle_row + 1, end_row):
                value = rows.get(row, {}).get(col)
                if value:
                    fragments.append(str(value).strip())
            if fragments:
                blockers[group].append({
                    "sourceCell": f"cycle@{cycle_row}",
                    "sourceRow": cycle_row,
                    "sourceWeekday": None,
                    "raw": " | ".join([header_text, *fragments]),
                    "reason": "supplementary-cycle-requires-review",
                })

    for group, items in blockers.items():
        unique = {}
        for item in items:
            unique[(item["reason"], item["raw"])] = item
        blockers[group] = list(unique.values())
    return blockers


def qa_parse_file(path):
    report = _original_parse_file(path)
    if report.get("status") != "parsed" or report.get("layout") != "weekly-grid":
        return report

    blockers = cycle_blockers(path, report)
    for group, items in blockers.items():
        group_data = report.get("groups", {}).get(group)
        if not group_data or not items:
            continue
        group_data.setdefault("unresolved", []).extend(items)
        group_data["stats"] = {
            "eventCount": len(group_data.get("events", [])),
            "unresolvedCount": len(group_data.get("unresolved", [])),
            "partialCount": len(group_data.get("partial", [])),
        }

    unresolved_count = sum(item["stats"]["unresolvedCount"] for item in report["groups"].values())
    partial_count = sum(item["stats"]["partialCount"] for item in report["groups"].values())
    event_count = sum(item["stats"]["eventCount"] for item in report["groups"].values())
    report["stats"] = {
        "eventCount": event_count,
        "unresolvedCount": unresolved_count,
        "partialCount": partial_count,
    }
    report["qaPassed"] = unresolved_count == 0 and partial_count == 0
    report["publishable"] = bool(report.get("commercialTargetPeriod")) and report["qaPassed"]
    return report


base.parse_file = qa_parse_file


def self_test():
    # Keep all safe-parser regressions, including the user-confirmed 01.06 rule.
    safe.self_test()

    rows = {
        45: {2: 'Расписание занятий цикла "Пропедевтическая стоматология"'},
        46: {2: "08.00-12.05 цикл 26.01-10.02", 3: "08.00-12.05 цикл 11.02-27.02"},
        47: {2: "Дисциплина"},
    }
    assert cycle_header_rows(rows) == [45]
    assert qa_schedule_footer_row(rows) == 45

    rows = {
        49: {1: "Расписание занятий цикла Пропедевтическая стоматология 13.00-17.05"},
        50: {1: "291", 2: "02.02.2026-25.02.2026"},
        51: {1: "292", 2: "26.02.2026-21.03.2026"},
        54: {1: "Дисциплина"},
    }
    explicit = {
        row: str(rows.get(row, {}).get(1, "")).strip()
        for row in range(50, 54)
        if str(rows.get(row, {}).get(1, "")).strip() in {"291", "292"}
    }
    assert explicit == {50: "291", 51: "292"}
    assert metadata_row_after(rows, 49) == 54
    print("kgmu weekly supplementary-cycle QA tests: OK")


def main():
    if "--self-test" in sys.argv:
        self_test()
        return
    base.main()


if __name__ == "__main__":
    main()

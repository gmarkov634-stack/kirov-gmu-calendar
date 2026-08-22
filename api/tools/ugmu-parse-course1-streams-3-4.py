#!/usr/bin/env python3
from __future__ import annotations

import argparse
import importlib.util
import json
import re
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any

BASE_PATH = Path(__file__).with_name('ugmu-parse-weekly-pdf.py')
SPEC = importlib.util.spec_from_file_location('ugmu_weekly_base', BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError('Unable to load UGMU weekly-grid base parser')
BASE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASE)

STREAMS: dict[str, dict[str, Any]] = {
    '3': {
        'groups': [f'ОЛД {v}' for v in range(125, 137)],
        'sha256': '248f436baa3254ee891506628b05e945bddfbb708616ec5e38b34e7d893783ca',
        'expectedPatterns': {**{f'ОЛД {v}': 22 for v in range(125, 137)}, 'ОЛД 130': 21},
        'expectedEvents': {
            'ОЛД 125': 339, 'ОЛД 126': 339, 'ОЛД 127': 339, 'ОЛД 128': 339,
            'ОЛД 129': 318, 'ОЛД 130': 318, 'ОЛД 131': 339, 'ОЛД 132': 339,
            'ОЛД 133': 340, 'ОЛД 134': 340, 'ОЛД 135': 338, 'ОЛД 136': 338,
        },
        'expectedOverlaps': {'ОЛД 131': 19, 'ОЛД 132': 19, 'ОЛД 133': 36},
        'missingReferenceLecture': 'Права обучающихся в инклюзивном образовании.',
    },
    '4': {
        'groups': [f'ОЛД {v}' for v in range(137, 151)],
        'sha256': '5fa092b9eac42190cf06a927f30d4b6442a5c159bea94f95da484c44b050e90d',
        'expectedPatterns': {**{f'ОЛД {v}': 22 for v in range(137, 151)}, 'ОЛД 137': 21},
        'expectedEvents': {
            'ОЛД 137': 321, 'ОЛД 138': 340, 'ОЛД 139': 339, 'ОЛД 140': 339,
            'ОЛД 141': 338, 'ОЛД 142': 338, 'ОЛД 143': 338, 'ОЛД 144': 338,
            'ОЛД 145': 339, 'ОЛД 146': 339, 'ОЛД 147': 339, 'ОЛД 148': 340,
            'ОЛД 149': 339, 'ОЛД 150': 339,
        },
        'expectedOverlaps': {},
    },
}

STANDARD_COUNTS_STREAM_3 = {
    'Анатомия': 2,
    'Биология': 2,
    'Биоэтика': 2,
    'Иностранный язык': 1,
    'История России': 2,
    'Латинский язык': 1,
    'НИР: ЗОЖ в профессии врача': 1,
    'НИР: получение первичных навыков научно-исследовательской работы': 1,
    'Основы Российской государственности': 2,
    'Основы военной подготовки': 2,
    'Права обучающихся в инклюзивном образовании.': 1,
    'Физика, математика': 2,
    'Химия': 2,
    'Элективные курсы по физической культуре и спорту': 1,
}
STANDARD_COUNTS_STREAM_4 = {
    'Анатомия': 2,
    'Антропологические основы деятельности врача': 1,
    'Биология': 2,
    'Биоэтика': 2,
    'Иностранный язык': 1,
    'История России': 2,
    'Латинский язык': 1,
    'НИР: ЗОЖ в профессии врача': 1,
    'НИР: получение первичных навыков научно-исследовательской работы': 1,
    'Основы Российской государственности': 2,
    'Основы военной подготовки': 2,
    'Физика, математика': 2,
    'Химия': 2,
    'Элективные курсы по физической культуре и спорту': 1,
}


def compact(value: Any) -> str:
    return BASE.compact(value)


def repair_line(value: str) -> str:
    """Repair only mechanical PDF text-extraction spacing, never semantic source data."""
    value = compact(value)
    value = re.sub(r'(?<!\d)(\d)\s+(\d)\s*:\s*(\d)\s+(\d)(?!\d)', r'\1\2:\3\4', value)
    value = re.sub(r'(?<!\d)(\d)\s+(\d)\s*:\s*(\d{2})(?!\d)', r'\1\2:\3', value)
    value = re.sub(r'(?<!\d)(\d{1,2})\s*:\s*(\d)\s+(\d)(?!\d)', r'\1:\2\3', value)
    value = re.sub(r'(?<!\d)(\d{1,2})\s+:\s*(\d{2})(?!\d)', r'\1:\2', value)
    return value


def repair_segment(value: str) -> str:
    """Join letter fragments created by PDF line breaking after time segmentation."""
    value = compact(value)
    value = value.replace('Иностранны й язык', 'Иностранный язык')
    value = value.replace('Иностранны й', 'Иностранный')
    value = re.sub(r'\bп\s+р\s*офессии\b', 'профессии', value, flags=re.I)
    value = re.sub(r'\bп\s+р\s+офессии\b', 'профессии', value, flags=re.I)
    return value


def header_group_centers(table, geometry, expected_groups: list[str]) -> dict[str, float]:
    groups = [compact(value) for value in table[0][1:]]
    if groups != expected_groups:
        raise RuntimeError(f'Unexpected UGMU stream header: {groups}')
    centers: dict[str, float] = {}
    for column_index, group in enumerate(groups, start=1):
        cell = geometry.rows[0].cells[column_index]
        if not cell:
            raise RuntimeError(f'Missing UGMU header geometry for {group}')
        centers[group] = (cell[0] + cell[2]) / 2
    return centers


def extract_group_lines(table, geometry, page, group: str, expected_groups: list[str]) -> dict[str, list[str]]:
    centers = header_group_centers(table, geometry, expected_groups)
    if group not in centers:
        raise RuntimeError(f'Group outside reviewed stream: {group}')
    target_center = centers[group]
    bounds = BASE.weekday_bounds(page, geometry)
    result = {day: [] for day in BASE.DAY_NAMES}

    for row_index, row_values in enumerate(table[1:-1], start=1):
        row_geometry = geometry.rows[row_index]
        center_y = BASE.smallest_cell_center(row_geometry)
        day = next((name for name, top, bottom in bounds if top <= center_y < bottom), None)
        if not day:
            continue
        for column_index in range(1, min(len(row_values), len(row_geometry.cells))):
            raw_value = row_values[column_index]
            cell = row_geometry.cells[column_index]
            if raw_value is None or cell is None or not compact(raw_value):
                continue
            x0, _top, x1, _bottom = cell
            if not (x0 - 1e-6 <= target_center <= x1 + 1e-6):
                continue
            for raw_line in str(raw_value).splitlines():
                line = repair_line(raw_line)
                if line:
                    result[day].append(line)
    return result


def expected_title_counts(stream: str, group: str) -> dict[str, int]:
    counts = dict(STANDARD_COUNTS_STREAM_3 if stream == '3' else STANDARD_COUNTS_STREAM_4)
    if stream == '3' and group == 'ОЛД 130':
        counts.pop('НИР: ЗОЖ в профессии врача')
    if stream == '4' and group == 'ОЛД 137':
        counts.pop('НИР: получение первичных навыков научно-исследовательской работы')
    return counts


def is_invalid_source_time(pattern: dict[str, Any], stream: str, group: str, sha256: str | None) -> bool:
    return (
        stream == '3'
        and sha256 == STREAMS['3']['sha256']
        and group == 'ОЛД 129'
        and pattern['weekday'] == 2
        and pattern['startTime'] == '13:50'
        and pattern['endTime'] == '11:10'
        and pattern['sourceTitle'].startswith('НИР: получение первичных')
    )


def accept_missing_reference_lecture(
    pattern: dict[str, Any], warnings: list[str], stream: str, group: str, sha256: str | None
) -> tuple[list[str], dict[str, Any] | None]:
    if stream != '3' or sha256 != STREAMS['3']['sha256']:
        return warnings, None
    expected_title = STREAMS['3']['missingReferenceLecture']
    expected_warning = f'no discipline reference: {expected_title}'
    if not (
        pattern['weekday'] == 2
        and pattern['startTime'] == '08:50'
        and pattern['endTime'] == '10:30'
        and pattern['lessonType'] == 'lecture'
        and pattern['elective'] is True
        and pattern['sourceTitle'] == expected_title
        and expected_warning in warnings
    ):
        return warnings, None
    warnings = [warning for warning in warnings if warning != expected_warning]
    return warnings, {
        'kind': 'source-reference-omission',
        'sourceSha256': sha256,
        'group': group,
        'weekday': 2,
        'startTime': '08:50',
        'endTime': '10:30',
        'title': expected_title,
        'location': 'Онлайн',
        'department': '',
        'evidence': [
            'full title is visible in the exact official weekly grid',
            'lecture row spans the whole stream',
            'page-2 reference table omits this title',
            'source states that lectures are online',
        ],
    }


def apply_explicit_anthropology_location(
    pattern: dict[str, Any], stream: str, group: str, sha256: str | None
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    if not (
        stream == '4'
        and sha256 == STREAMS['4']['sha256']
        and pattern['weekday'] == 1
        and pattern['startTime'] == '13:00'
        and pattern['endTime'] == '14:30'
        and pattern['title'] == 'Антропологические основы деятельности врача'
        and 'ауд. БА (Репина, 3)' in pattern['sourceTitle']
    ):
        return pattern, None
    pattern = dict(pattern)
    pattern['location'] = 'Репина, 3'
    pattern['locationNote'] = 'ауд. БА'
    return pattern, {
        'kind': 'explicit-grid-location-overrides-general-lecture-note',
        'sourceSha256': sha256,
        'group': group,
        'weekday': 1,
        'startTime': '13:00',
        'endTime': '14:30',
        'title': pattern['title'],
        'location': 'Репина, 3',
        'locationNote': 'ауд. БА',
        'evidence': ['exact weekly-grid cell explicitly states ауд. БА (Репина, 3)'],
    }


def overlap_records(events: list[dict[str, Any]]) -> list[dict[str, str]]:
    by_date: dict[str, list[dict[str, Any]]] = {}
    for event in events:
        by_date.setdefault(event['start'][:10], []).append(event)
    overlaps: list[dict[str, str]] = []
    for event_date, items in by_date.items():
        items.sort(key=lambda item: item['start'])
        for previous, current in zip(items, items[1:]):
            if datetime.fromisoformat(current['start']) < datetime.fromisoformat(previous['end']):
                overlaps.append({
                    'date': event_date,
                    'firstTitle': previous['title'],
                    'firstStart': previous['start'][11:16],
                    'firstEnd': previous['end'][11:16],
                    'secondTitle': current['title'],
                    'secondStart': current['start'][11:16],
                    'secondEnd': current['end'][11:16],
                })
    return overlaps


def validate_schedule(schedule: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    stream = schedule['stream']
    config = STREAMS[stream]
    group = schedule['group']['code']
    source_sha = schedule['sources'][0].get('sha256')

    if source_sha != config['sha256']:
        errors.append('source SHA-256 is not approved for stream semantic rules')
    if group not in config['groups']:
        errors.append(f'group outside stream {stream}: {group}')
    if len(schedule['patterns']) != config['expectedPatterns'][group]:
        errors.append(f"expected {config['expectedPatterns'][group]} patterns, got {len(schedule['patterns'])}")
    if len(schedule['events']) != config['expectedEvents'][group]:
        errors.append(f"expected {config['expectedEvents'][group]} valid events, got {len(schedule['events'])}")
    if sum(p['lessonType'] == 'lecture' for p in schedule['patterns']) != 9:
        errors.append('expected 9 lecture patterns')

    actual_counts = Counter(p['title'] for p in schedule['patterns'])
    if dict(actual_counts) != expected_title_counts(stream, group):
        errors.append(f'discipline pattern invariant mismatch: {dict(actual_counts)}')

    unresolved = [
        warning for warning in schedule['importWarnings']
        if 'ambiguous discipline reference:' in warning or 'no discipline reference:' in warning
    ]
    if unresolved:
        errors.append(f'unresolved discipline references: {unresolved}')

    expected_defects = 1 if stream == '3' and group == 'ОЛД 129' else 0
    if len(schedule['sourceReview']['sourceDefects']) != expected_defects:
        errors.append(f"expected {expected_defects} source defects, got {len(schedule['sourceReview']['sourceDefects'])}")

    expected_omissions = 1 if stream == '3' else 0
    if len(schedule['sourceReview']['sourceReferenceOmissions']) != expected_omissions:
        errors.append(
            f"expected {expected_omissions} reference omissions, got "
            f"{len(schedule['sourceReview']['sourceReferenceOmissions'])}"
        )

    expected_locations = 1 if stream == '4' else 0
    if len(schedule['sourceReview']['semanticDecisions']) != expected_locations:
        errors.append(
            f"expected {expected_locations} semantic decisions, got "
            f"{len(schedule['sourceReview']['semanticDecisions'])}"
        )

    expected_overlaps = config['expectedOverlaps'].get(group, 0)
    if len(schedule['sourceReview']['sourceOverlaps']) != expected_overlaps:
        errors.append(
            f"expected {expected_overlaps} visually reviewed overlaps, got "
            f"{len(schedule['sourceReview']['sourceOverlaps'])}"
        )

    keys = [(e['start'], e['end'], e['title']) for e in schedule['events']]
    if len(keys) != len(set(keys)):
        errors.append('duplicate expanded events')
    for event in schedule['events']:
        if datetime.fromisoformat(event['end']) <= datetime.fromisoformat(event['start']):
            errors.append(f"non-positive event duration: {event['id']}")
            break

    return errors


def parse_pdf(pdf_path: Path, stream: str, group: str, source_url: str | None, source_sha256: str | None) -> dict[str, Any]:
    try:
        import pdfplumber  # type: ignore
    except ImportError as error:
        raise RuntimeError('pdfplumber is required') from error

    config = STREAMS[stream]
    warnings: list[str] = []
    semantic_decisions: list[dict[str, Any]] = []
    source_reference_omissions: list[dict[str, Any]] = []
    source_defects: list[dict[str, Any]] = []

    with pdfplumber.open(pdf_path) as document:
        page = document.pages[0]
        all_text = '\n'.join((item.extract_text() or '') for item in document.pages)
        period_start, period_end = BASE.parse_period(all_text)
        first_anchor = BASE.parse_week_anchor(all_text, 'I', period_start.year)
        second_anchor = BASE.parse_week_anchor(all_text, 'II', period_start.year)
        table, geometry = BASE.find_weekly_table(page)
        lines_by_day = extract_group_lines(table, geometry, page, group, config['groups'])
        references = BASE.extract_reference_rows(document)

        patterns: list[dict[str, Any]] = []
        valid_patterns: list[dict[str, Any]] = []
        for day in BASE.DAY_NAMES:
            for raw_segment in BASE.split_segments(lines_by_day[day]):
                segment = repair_segment(raw_segment)
                pattern, pattern_warnings = BASE.parse_pattern(segment, BASE.DAY_INDEX[day], references)
                pattern_warnings, omission = accept_missing_reference_lecture(
                    pattern, pattern_warnings, stream, group, source_sha256
                )
                pattern, semantic_decision = apply_explicit_anthropology_location(
                    pattern, stream, group, source_sha256
                )
                patterns.append(pattern)
                warnings.extend(f'{day}: {warning}' for warning in pattern_warnings)
                if omission:
                    source_reference_omissions.append(omission)
                if semantic_decision:
                    semantic_decisions.append(semantic_decision)

                if is_invalid_source_time(pattern, stream, group, source_sha256):
                    source_defects.append({
                        'kind': 'official-source-invalid-time-range',
                        'sourceSha256': source_sha256,
                        'group': group,
                        'weekday': pattern['weekday'],
                        'startTime': pattern['startTime'],
                        'endTime': pattern['endTime'],
                        'title': pattern['title'],
                        'rawSource': '13:50-11:10 НИР: получение первичных',
                        'action': 'excluded-from-dated-events-until-official-correction',
                        'evidence': [
                            'exact official PDF visibly prints 13:50-11:10',
                            'end time is earlier than start time',
                            'no inferred correction is applied',
                        ],
                    })
                elif pattern['endTime'] <= pattern['startTime']:
                    warnings.append(
                        f"{day}: invalid time range not covered by reviewed source defect: "
                        f"{pattern['startTime']}-{pattern['endTime']} {pattern['sourceTitle']}"
                    )
                else:
                    valid_patterns.append(pattern)

    events = BASE.expand_patterns(
        valid_patterns, period_start, period_end, first_anchor, second_anchor, group
    )
    overlaps = overlap_records(events)
    status = f'semantic-reviewed-stream-{stream}'
    if source_defects:
        status = f'semantic-reviewed-stream-{stream}-with-source-defect'

    schedule = {
        'version': 1,
        'university': 'ugmu',
        'universityName': 'УГМУ',
        'program': 'medicine',
        'course': 1,
        'stream': stream,
        'academicYear': '2026/2027',
        'semester': 1,
        'timezone': 'Asia/Yekaterinburg',
        'group': {
            'id': f'ugmu:medicine:1:stream-{stream}:{group}',
            'code': group,
            'displayName': f'Группа {group}',
        },
        'semesterPeriod': {'start': period_start.isoformat(), 'end': period_end.isoformat()},
        'weekAnchors': {'I': first_anchor.isoformat(), 'II': second_anchor.isoformat()},
        'sources': [{
            'url': source_url,
            'sha256': source_sha256,
            'part': 'combined',
            'parserShape': 'weekly-grid',
        }],
        'sourceReview': {
            'status': status,
            'publicationAllowed': False,
            'patternCount': len(patterns),
            'validExpansionPatternCount': len(valid_patterns),
            'semanticDecisions': semantic_decisions,
            'sourceReferenceOmissions': source_reference_omissions,
            'sourceDefects': source_defects,
            'sourceOverlaps': overlaps,
        },
        'patterns': patterns,
        'events': events,
        'importWarnings': warnings,
    }
    schedule['validationErrors'] = validate_schedule(schedule)
    if schedule['validationErrors']:
        schedule['sourceReview']['status'] = 'needs-review'
    return schedule


def build_summary(stream: str, schedules: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        'stream': stream,
        'sourceSha256': STREAMS[stream]['sha256'],
        'groupCount': len(schedules),
        'validatedGroups': sum(not item['validationErrors'] for item in schedules),
        'sourceDefectGroups': sum(bool(item['sourceReview']['sourceDefects']) for item in schedules),
        'weeklyPatterns': sum(len(item['patterns']) for item in schedules),
        'validExpansionPatterns': sum(item['sourceReview']['validExpansionPatternCount'] for item in schedules),
        'events': sum(len(item['events']) for item in schedules),
        'lecturePatterns': sum(sum(p['lessonType'] == 'lecture' for p in item['patterns']) for item in schedules),
        'semanticDecisions': sum(len(item['sourceReview']['semanticDecisions']) for item in schedules),
        'sourceReferenceOmissions': sum(len(item['sourceReview']['sourceReferenceOmissions']) for item in schedules),
        'sourceDefects': sum(len(item['sourceReview']['sourceDefects']) for item in schedules),
        'sourceOverlaps': sum(len(item['sourceReview']['sourceOverlaps']) for item in schedules),
        'validationErrors': sum(len(item['validationErrors']) for item in schedules),
        'groups': {
            item['group']['code']: {
                'patterns': len(item['patterns']),
                'validExpansionPatterns': item['sourceReview']['validExpansionPatternCount'],
                'events': len(item['events']),
                'sourceDefects': len(item['sourceReview']['sourceDefects']),
                'sourceOverlaps': len(item['sourceReview']['sourceOverlaps']),
                'validationErrors': item['validationErrors'],
            } for item in schedules
        },
    }


def self_test() -> None:
    assert repair_line('1 2:1 0-13:40') == '12:10-13:40'
    assert repair_line('1 2 :0 0-13:40') == '12:00-13:40'
    assert repair_line('12:1 0-13:40') == '12:10-13:40'
    assert repair_segment('Иностранны й язык') == 'Иностранный язык'
    assert sum(STREAMS['3']['expectedPatterns'].values()) == 263
    assert sum(STREAMS['4']['expectedPatterns'].values()) == 307
    print('UGMU course-1 streams 3/4 parser self-test passed')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--input')
    parser.add_argument('--stream', choices=['3', '4'])
    parser.add_argument('--group')
    parser.add_argument('--source')
    parser.add_argument('--sha256')
    parser.add_argument('--output', default='data/imports/ugmu-course1-later-streams')
    parser.add_argument('--all-groups', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()

    if args.self_test:
        self_test(); return
    if not args.input or not args.stream:
        parser.error('--input and --stream are required')
    if not args.group and not args.all_groups:
        parser.error('--group or --all-groups is required')
    if args.group and args.all_groups:
        parser.error('--group and --all-groups are mutually exclusive')

    pdf_path = Path(args.input)
    output = Path(args.output)
    groups = STREAMS[args.stream]['groups'] if args.all_groups else [args.group]
    schedules = [parse_pdf(pdf_path, args.stream, g, args.source, args.sha256) for g in groups]

    if args.all_groups:
        output.mkdir(parents=True, exist_ok=True)
        for schedule in schedules:
            slug = schedule['group']['code'].replace(' ', '-')
            (output / f'{slug}.json').write_text(
                json.dumps(schedule, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
            )
        summary = build_summary(args.stream, schedules)
        (output / 'summary.json').write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
        )
        print(
            f"UGMU stream {args.stream}: {summary['validatedGroups']}/{summary['groupCount']} groups validated; "
            f"{summary['weeklyPatterns']} patterns ({summary['validExpansionPatterns']} expandable) -> "
            f"{summary['events']} events"
        )
        print(
            f"Source defects: {summary['sourceDefects']}; overlaps: {summary['sourceOverlaps']}; "
            f"reference omissions: {summary['sourceReferenceOmissions']}; "
            f"semantic decisions: {summary['semanticDecisions']}; validation errors: {summary['validationErrors']}"
        )
        if summary['validationErrors']:
            raise SystemExit(2)
    else:
        schedule = schedules[0]
        if output.suffix.lower() != '.json':
            output.mkdir(parents=True, exist_ok=True)
            output = output / f"{schedule['group']['code'].replace(' ', '-')}.json"
        else:
            output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(schedule, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f"UGMU {schedule['group']['code']}: {len(schedule['patterns'])} patterns -> {len(schedule['events'])} events")
        print(f"Validation errors: {len(schedule['validationErrors'])}")
        if schedule['validationErrors']:
            raise SystemExit(2)

if __name__ == '__main__':
    main()

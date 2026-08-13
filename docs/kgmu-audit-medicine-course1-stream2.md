# KGMU parser audit — medicine course 1, stream 2

## Source

- Official file: `1_lech._2_potok-24-03-2026-10.xlsx`
- Program: medicine
- Course: 1
- Groups: 111–120
- Academic period: 2025/26, semester 2
- SHA-256: `24dfd9284d7683b91c77f3ddb03da016436a5f03516bb84e89709a3f03ea3a68`
- Production source-bound review: `14ed4151-dc31-49e8-ac33-f89307b498d9`
- Ingest status: `REVIEW_REQUIRED / MANUAL_NORMALIZATION_REQUIRED`

## Classification

**Existing weekly profile R. No new XLSX structural family is required.**

The workbook has the same base geometry as the already audited first stream: group columns, weekday sections, stream lectures, explicit date lists/ranges, multiple time intervals inside one lesson, individual rescheduled dates, curator hour, electives/facultatives, and the lower discipline/department/assessment reference table.

## Patterns checked

The source contains patterns already covered by current R rules:

- multiple lectures in one merged source cell with separate date sets;
- multiple disciplines in one group/day cell with separate date/time fragments;
- a main recurring range followed by a one-date changed time;
- assessment entries (`зачет с оценкой`) with their own date/time/location;
- `1 неделя / 2 неделя` lecture schedules and explicit week calendars;
- curator-hour entries;
- lower reference table for discipline normalization and location recovery;
- source defects such as impossible `29.01–28.01`, handled by the existing correction/review policy rather than by a new parser type.

## Architecture impact

No change to canonical JSON, validation, postprocessing, versioning, publication, or steps 2–12 is required.

Result: medicine course 1 is structurally covered by profile R on both streams 101–110 and 111–120.

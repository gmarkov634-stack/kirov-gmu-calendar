# KGMU parser audit — dentistry course 1

Status: covered by existing parser family **S** (mixed weekly + embedded cycle timetable). No new XLSX family is required.

## Control source

- Official KGMU page: dentistry timetable
- Groups: 191–194
- Academic period: 2025/26, semester 2
- Source file: `1_stomat-03-04-2026-10.xlsx`
- Source SHA-256: `25f29f591ad88a725b74b54e0719da869b560799f9efc270ae37633c8bb54bbf`
- Source size: 18,475 bytes
- Sheet: `1 стом.`
- Grid dimensions: 66 × 12

The workbook was fetched read-only from the exact official KGMU XLSX and inspected directly.

## Classification

The workbook is a mixed S-layout:

- the main body is a weekly R-style timetable by weekday and groups 191–194;
- the same XLSX contains a separate table `Расписание занятий цикла "Пропедевтическая стоматология"`;
- that cycle maps one period to each group and is expanded by S01 over teaching days inside the explicit period.

Cycle periods in the source are:

- 191: 26.01–10.02;
- 192: 11.02–27.02;
- 193: 28.02–17.03;
- 194: 18.03–02.04.

The cycle naturally replaces the ordinary weekly blocks during those periods because the weekly entries for each group resume outside its cycle interval.

## S02/S03 scope clarification — new S08/S09

The existing S02 and S03 were historical rules from the 2nd-course control workbook and contained fixed time/place/assessment values. Course 1 proves that these values are source-specific, not universal properties of the S family.

Two explicit extension rules were therefore added:

- **S08** — if the cycle table in the current XLSX explicitly specifies a different time, that source time overrides the historical S02 value. For this workbook the cycle consists of 08:00–09:30, 09:40–11:10 and 11:20–12:05 and is represented as one daily cycle event 08:00–12:05.
- **S09** — the cycle location and assessment form come from the current workbook's lower reference row. For this workbook: the dentistry department / consultative-diagnostic department of the Kirov GMU clinic, ul. Nikitskaya 161; assessment form: `зачёт`. These override the historical 2nd-course example when parsing this workbook.

The general S range is now S01–S09.

## Weekly-part observations

The weekly R-part contains already-known patterns: multiple time intervals, explicit final dates with changed time, several lectures in one cell, week-number annotations that conflict with individual explicit dates, curator-hour entries, additional lessons described only as `N занятий` in another weekday, and lower reference rows with departments/addresses/assessment forms.

No new R-family structural rule is required. Ambiguous additional lessons without concrete recoverable dates remain fail-closed under the existing weekly rules; explicit dates take precedence over computed week labels.

## Result

- Parser family: S (weekly R + embedded cycle).
- New XLSX family: no.
- New rules: S08, S09.
- Canonical JSON schema: unchanged.
- Steps 2–12: no structural change required.

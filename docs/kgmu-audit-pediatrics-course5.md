# KGMU parser audit — pediatrics course 5

Status: covered by existing parser family **C** (cyclic senior-course timetable). No new XLSX family or new C rule is required.

## Control source

- Official KGMU page: `https://kirovgma.ru/raspisanie-pediatricheskiy-fakultet`
- Groups: 531–539
- Academic period: 2025/26, semester 2
- Source file: `5_kurs_pediatricheskiy_fakultet-14-01-2026-11.xlsx`
- Source SHA-256: `5a31461b9b2b1ed9117a531a20b5a223c465df82f9fd13a67288eaa157b462b8`

## Classification

The workbook is a standard C-layout:

- rows are student groups;
- columns are concrete calendar dates;
- horizontally merged discipline blocks define cyclic attendance periods;
- `*` marks only the first day in second shift and is covered by C02;
- the lower reference table supplies discipline names, assessment form, practice base, address and shift times;
- the generic line saying lectures are published on the educational site contains no concrete dates/times and does not itself create events.

## Independent lower-table schedules

Two rows contain explicit schedules independently of the upper cyclic grid:

- `Дисциплины по физической культуре и спорту`: Fridays 13.02–05.06, 14:00–15:30;
- `Адаптация выпускников вуза на рынке труда (факультатив)`: Tuesdays 10.02–02.06.2026, 12:30–14:00, with a separately stated 02.06.2026 interval 12:30–15:35.

These are already covered by C12: an explicit day/date/time schedule in the lower table is itself an authoritative source of calendar events even if the discipline has no separate block in the main group grid. The exceptional final date/time must remain explicit and must not be flattened into the recurring interval.

## Result

No new parser family, canonical JSON field, validation rule, publication rule or subscription behavior is required. Steps 2–12 are unchanged by this workbook.

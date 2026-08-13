# KGMU parser audit — pediatrics course 4

Status: covered by existing parser family **C** (cyclic senior-course timetable). No new XLSX family or new C rule is required.

## Control source

- Official KGMU page: `https://kirovgma.ru/raspisanie-pediatricheskiy-fakultet`
- Groups: 431–439
- Academic period: 2025/26, semester 2
- Source file: `4_kurs_pediatricheskiy_fakultet-13-01-2026-08.xlsx`
- Source SHA-256: `000db40b7a80f657f6286a5d18c47b690f0a30e2b88713efc3ed19816f7ca1b3`

## Classification

The workbook is a standard C-layout:

- rows are student groups;
- columns are concrete calendar dates;
- horizontally merged discipline blocks define cyclic attendance periods;
- `*` marks the first day in second shift and is covered by C02;
- the lower reference table supplies normalized discipline names, assessment form, training base, address and first/second shift time;
- independently scheduled physical education is described in the lower table and is covered by C12;
- the generic line saying lectures are published on the educational site contains no dates/times and does not itself create events.

## Self-study dates

The source explicitly states `2, 16 мая - дни самостоятельной работы`. Inspection of the workbook geometry confirms that May 2 and May 16 are empty in every group row and are not covered by merged discipline blocks. Therefore this is already covered by C06 (empty dates designated as self-study create no calendar events); no separate C rule is needed.

## Result

No new parser family, canonical JSON field, validation rule, publication rule or subscription behavior is required. Steps 2–12 are unchanged by this workbook.

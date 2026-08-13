# KGMU parser audit — pediatrics course 6

Status: covered by existing parser family **C** (cyclic senior-course timetable), with two new explicit service-block rules C16–C17. No new XLSX family is required.

## Control source

- Official KGMU page: pediatrics timetable
- Groups: 631–637
- Academic period: 2025/26, semester 2
- Source file: `6_kurs_pediatricheskiy_fakultet-16-01-2026-16.xlsx`
- Source size: 29,064 bytes
- Source SHA-256: `a7bb836a7f28c1a73f7ecff2da002f65aff7dcf6fe3dcb55776414388cf5d101`
- Sheet: `Педиатрия 6 курс`
- Source grid dimensions: 44 × 130

The exact official XLSX was fetched read-only from KGMU and inspected directly, including worksheet merged ranges.

## Classification

The workbook is a standard C-layout:

- rows are groups 631–637;
- columns are concrete calendar dates from 26 January through 29 June 2026;
- horizontally merged discipline blocks define cyclic attendance periods;
- the lower reference table supplies full discipline names, assessment forms, departments, training bases, addresses and first/second-shift times.

Regular cycles include hospital pediatrics, outpatient/emergency pediatrics, simulation course, forensic medicine, disaster medicine and infectious diseases in children.

## Elective block — C15

Every group begins with `Дисциплина по выбору Б.1В.ДВ.4`. The lower reference table lists five possible electives, including clinical biochemistry in pediatrics, ultrasound diagnostics, thoracoabdominal congenital malformations in pediatric surgery, pediatric gastroenterology topics and pediatric pulmonology. The workbook does not map a concrete elective choice to a concrete group/student.

Therefore C15 applies: the parser must not pick one elective automatically. A concrete elective event can be created only after an unambiguous mapping to the student's actual choice is available. This repeats the already known architecture dependency first identified on medicine course 6; it does not require a new schedule-event/v1 field by itself.

## Service blocks — new C16 and C17

The worksheet contains merged blocks spanning all groups:

- explicit `Самостоятельная работа` periods;
- a common `ГИА` period.

These are materially different from an ordinary discipline cycle and are now made explicit in the C rules:

- **C16** — an explicit merged `Самостоятельная работа` block is a service/self-study period and is not expanded into daily calendar events;
- **C17** — a common merged `ГИА` / `Государственная итоговая аттестация` block without a concrete assessment component, exact date and time is a service GIA period and is not expanded into daily events. Specific GIA events require a separate unambiguous detailed schedule.

## Other source details

The note `4, 11, 18, 26 апреля, 16, 23, 30 мая - дни самостоятельной работы` is compatible with C06. Dates present in the grid are empty for group rows; 26 April is a Sunday and is absent from the calendar grid, so it is not silently changed to another date.

Typos such as `эказмен`, `Актуальные влпросы гастроэнторологии у детей` and `Детская пумонология` are handled only when the intended value is unambiguous under G08. They do not require a new parser-family rule.

The generic line saying lectures are published on the KGMU educational site contains no concrete dates/times and does not itself create events.

## Result

- Parser family: C.
- New XLSX family: no.
- New C rules: C16, C17.
- C15 dependency: confirmed again for elective choice.
- Canonical JSON schema: unchanged.
- Steps 2–12: no new structural change beyond the already recorded C15 requirement to resolve the student's chosen elective before forming a complete personal calendar.

# KGMU parser audit — dentistry course 4

Status: covered by existing parser family C.

Source: `4_kurs_stomatologicheskiy_fakultet-13-01-2026-08.xlsx`, groups 491–494, semester 2 of 2025/26.
SHA-256: `c02f2bdd7171eadc6438d631dc8b071ab568c3578ffc11a9e55fa9a845a6d82d`.
Size: 23,762 bytes. Grid: 49 x 105.

The workbook uses the cyclic C layout: groups by rows, calendar dates by columns, merged discipline blocks, and a lower reference table with locations, assessment forms and times.

Ambiguity review completed. The apparent missing times for dentistry rows are resolved by the actual XLSX merged range `CE22:CJ27`, so the same explicit source time applies to rows 22–27. The common `Экзамен` blocks are merged across all four group rows and several dates, so existing C14 treats them as service exam periods rather than concrete exam events. Abbreviated discipline names map unambiguously to the lower reference table under C08/G11.

Result: no new XLSX family, no new parser rule, no canonical schema change, no changes required to steps 2–12.

# KGMU dependency review after parser closure

Scope: medicine, pediatrics, dentistry, foreign students.

## Result

Steps 2-12 stay unchanged. The existing event schema, QA, versioning, postprocessing, ICS and publication flow are sufficient for all confirmed parser rules.

C22 remains a normal `needs_review` case and requires no downstream model change.

C15 is represented neutrally. For each date covered by an `Электив`, `ДВ.4`, `ДВ.5` or equivalent grid block, the normalized calendar keeps an event named `Дисциплина по выбору`; no concrete elective is inferred.

Only values common to all listed variants may be used. When no common time exists, the canonical event is date-only/all-day with `start_time=null` and `end_time=null`. When no common location exists, location remains empty. The event carries C15 in `rule_ids` and a warning that exact time/place depend on the selected discipline.

The unknown concrete elective is not `needs_review` by itself. No separate choice manifest or personalized elective layer is used. Canonical review is the authoritative path for these complex C sources.

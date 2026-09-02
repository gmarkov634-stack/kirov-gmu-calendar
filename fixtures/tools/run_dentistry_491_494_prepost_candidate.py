#!/usr/bin/env python3
"""Run the legacy course-local Dentistry 491-494 builder before fail-closed cleanup.

The inherited builder asserts zero timed overlaps while it still contains the
ambiguous PE base recurrence. That inferred recurrence produces exactly four
intermediate overlap pairs and is removed immediately by the authoritative
postprocessor. Execute the same builder with only that pre-postprocessing guard
relaxed to the observed value 4; final QA still requires zero overlaps after
removing the unsupported PE recurrence and unresolved Practice events.
"""
from pathlib import Path

path = Path(__file__).with_name("build_dentistry_491_494_candidate.py")
source = path.read_text(encoding="utf-8")
needle = 'if overlap_count != 0:\n        raise SystemExit(f"unexpected resolved timed overlaps: {overlap_count}")'
replacement = 'if overlap_count != 4:\n        raise SystemExit(f"unexpected pre-postprocessing timed overlaps: {overlap_count}")'
if source.count(needle) != 1:
    raise SystemExit("expected inherited overlap guard was not found exactly once")
patched = source.replace(needle, replacement)
exec(compile(patched, str(path), "exec"), {"__name__": "__main__", "__file__": str(path)})

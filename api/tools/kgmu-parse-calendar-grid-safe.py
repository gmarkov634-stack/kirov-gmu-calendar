#!/usr/bin/env python3
import datetime as dt
import importlib.util
import re
import sys
from pathlib import Path

MODULE_PATH = Path(__file__).with_name("kgmu-parse-calendar-grid.py")
spec = importlib.util.spec_from_file_location("kgmu_calendar_grid_base", MODULE_PATH)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

_original_normalize_text = base.normalize_text
_original_parse_file = base.parse_file


def safe_normalize_text(value):
    text = str(value or "")
    # Official source occasionally inserts a visual line-break/hyphen inside the
    # discipline name. This is orthographic normalization, not semantic guessing.
    text = re.sub(r"фтизи\s*-\s*атрия", "фтизиатрия", text, flags=re.I)
    return _original_normalize_text(text)


base.normalize_text = safe_normalize_text


def stitch_fragment_text(left, right):
    """Reconstruct a word that Excel visually split across adjacent blocks.

    Example from the official KGMU archive:
      `Гос хиру` + `пит. ргия` -> `Госпит. хирургия`.
    The function only proposes a candidate; it is accepted later only when the
    official metadata table matches it with very high confidence.
    """
    left_tokens = re.findall(r"\S+", str(left or ""))
    right_tokens = re.findall(r"\S+", str(right or ""))
    if not left_tokens or len(left_tokens) != len(right_tokens) or len(left_tokens) > 4:
        return None
    return " ".join(a + b for a, b in zip(left_tokens, right_tokens))


def merge_fragmented_blocks(blocks, metadata):
    result = []
    index = 0
    while index < len(blocks):
        current = blocks[index]
        if index + 1 >= len(blocks):
            result.append(current)
            break
        following = blocks[index + 1]
        if not (
            current.get("kind") == "discipline-cycle"
            and following.get("kind") == "discipline-cycle"
            and current.get("status") == "unresolved"
            and following.get("status") == "unresolved"
        ):
            result.append(current)
            index += 1
            continue

        try:
            left_end = dt.date.fromisoformat(current["endDate"])
            right_start = dt.date.fromisoformat(following["startDate"])
        except (KeyError, ValueError):
            result.append(current)
            index += 1
            continue
        gap = (right_start - left_end).days
        candidate = stitch_fragment_text(current.get("raw"), following.get("raw"))
        if not candidate or not 1 <= gap <= 7:
            result.append(current)
            index += 1
            continue

        metadata_match, score = base.match_metadata(candidate, metadata)
        # This rule is intentionally strict. A fragment pair is merged only when
        # the reconstructed text is essentially the official discipline name.
        if not metadata_match or score < 0.90:
            result.append(current)
            index += 1
            continue

        first_day_second_shift = bool(
            current.get("firstDaySecondShift") or following.get("firstDaySecondShift")
        )
        timing = base.timing_status(metadata_match, first_day_second_shift)
        review_reasons = []
        status = "matched"
        if timing.get("status") != "resolved":
            status = "partial"
            review_reasons.append(timing.get("reason", "time-requires-review"))
        dates = sorted(set(current.get("dates", [])) | set(following.get("dates", [])))
        merged = {
            "sourceCell": f"{current.get('sourceCell')}+{following.get('sourceCell')}",
            "sourceCells": [current.get("sourceCell"), following.get("sourceCell")],
            "raw": candidate,
            "rawFragments": [current.get("raw"), following.get("raw")],
            "startDate": dates[0],
            "endDate": dates[-1],
            "dateCount": len(dates),
            "dates": dates,
            "firstDaySecondShift": first_day_second_shift,
            "kind": "discipline-cycle",
            "status": status,
            "requiresReview": bool(review_reasons),
            "reviewReasons": review_reasons,
            "metadataMatch": metadata_match["discipline"],
            "metadataMatchScore": round(score, 3),
            "practiceBase": metadata_match.get("base"),
            "address": metadata_match.get("address"),
            "timing": timing,
            "reconstructedFromSplitCells": True,
        }
        result.append(merged)
        index += 2
    return result


def recalculate_report(report):
    groups = report.get("groups", {})
    all_blocks = [block for group in groups.values() for block in group.get("blocks", [])]
    unresolved = [block for block in all_blocks if block.get("status") == "unresolved"]
    partial = [block for block in all_blocks if block.get("status") == "partial"]
    review_markers = [
        block
        for block in all_blocks
        if block.get("status") == "marker" and block.get("requiresReview")
    ]
    report["stats"] = {
        "groupCount": len(groups),
        "blockCount": len(all_blocks),
        "disciplineBlockCount": sum(block.get("kind") == "discipline-cycle" for block in all_blocks),
        "markerBlockCount": sum(block.get("kind") != "discipline-cycle" for block in all_blocks),
        "metadataMatchedBlockCount": sum(bool(block.get("metadataMatch")) for block in all_blocks),
        "unresolvedBlockCount": len(unresolved),
        "partialBlockCount": len(partial),
        "reviewMarkerCount": len(review_markers),
    }
    report["qaPassed"] = not unresolved and not partial and not review_markers
    report["publishable"] = bool(report.get("commercialTargetPeriod") and report["qaPassed"])
    return report


def safe_parse_file(path):
    report = _original_parse_file(path)
    if report.get("status") != "parsed":
        return report
    metadata = report.get("metadata", [])
    for group in report.get("groups", {}).values():
        group["blocks"] = merge_fragmented_blocks(group.get("blocks", []), metadata)
    return recalculate_report(report)


base.parse_file = safe_parse_file


def self_test():
    base.self_test()
    assert safe_normalize_text("Фтизи- атрия") == "фтизиатрия"
    assert stitch_fragment_text("Гос хиру", "пит. ргия") == "Госпит. хирургия"
    metadata = [
        {
            "discipline": "Госпитальная хирургия",
            "base": "Тестовая база",
            "address": "Тестовый адрес",
            "shift1": "8.30-11.35",
            "shift2": None,
        }
    ]
    blocks = [
        {
            "sourceCell": "BW14",
            "raw": "Гос хиру",
            "startDate": "2026-04-29",
            "endDate": "2026-04-30",
            "dates": ["2026-04-29", "2026-04-30"],
            "kind": "discipline-cycle",
            "status": "unresolved",
            "firstDaySecondShift": False,
        },
        {
            "sourceCell": "BZ14",
            "raw": "пит. ргия",
            "startDate": "2026-05-04",
            "endDate": "2026-05-05",
            "dates": ["2026-05-04", "2026-05-05"],
            "kind": "discipline-cycle",
            "status": "unresolved",
            "firstDaySecondShift": False,
        },
    ]
    merged = merge_fragmented_blocks(blocks, metadata)
    assert len(merged) == 1
    assert merged[0]["metadataMatch"] == "Госпитальная хирургия"
    assert merged[0]["dates"] == ["2026-04-29", "2026-04-30", "2026-05-04", "2026-05-05"]
    assert merged[0]["timing"]["allDatesTime"] == {"start": "08:30", "end": "11:35"}
    print("kgmu safe calendar-grid parser regression tests: OK")


def main():
    if "--self-test" in sys.argv:
        self_test()
        return
    base.main()


if __name__ == "__main__":
    main()

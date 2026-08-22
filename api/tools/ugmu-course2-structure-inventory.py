#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

GROUP_RE = re.compile(r"\b(О?ЛД)\s*(\d{3})\b", re.IGNORECASE)
PERIOD_RE = re.compile(r"\b\d{2}\.\d{2}\.\d{4}\s*[-–—]\s*\d{2}\.\d{2}\.\d{4}\b")
DATE_RE = re.compile(r"\b\d{2}\.\d{2}\.\d{4}\b")
TIME_RE = re.compile(r"\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*[-–—]\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b")


def compact(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(value for value in values if value))


def group_inventory(text: str) -> dict[str, object]:
    raw: list[str] = []
    numbers: list[int] = []
    for prefix, number in GROUP_RE.findall(text):
        raw.append(f"{prefix.upper()} {number}")
        numbers.append(int(number))
    return {
        "labels": unique(raw),
        "numbers": sorted(set(numbers)),
        "count": len(set(numbers)),
    }


def note_lines(text: str) -> list[str]:
    result: list[str] = []
    for raw in text.splitlines():
        line = compact(raw)
        lowered = line.lower()
        if not line:
            continue
        if any(token in lowered for token in (
            "недел",
            "лекц",
            "онлайн",
            "очно",
            "место проведения",
            "начинается",
            "семестр",
            "учебного года",
        )):
            result.append(line)
    return unique(result)[:80]


def reverse_time_ranges(text: str) -> list[str]:
    result: list[str] = []
    for match in TIME_RE.finditer(text):
        sh, sm, eh, em = (int(value) for value in match.groups())
        if (eh, em) <= (sh, sm):
            result.append(match.group(0).replace(".", ":"))
    return unique(result)


def table_shape(table: list[list[object]] | None) -> dict[str, object]:
    rows = len(table or [])
    cols = max((len(row or []) for row in table or []), default=0)
    header = [compact(value) for value in ((table or [[]])[0] or [])]
    header_text = " ".join(header)
    groups = group_inventory(header_text)
    return {
        "rows": rows,
        "cols": cols,
        "header": header[:50],
        "headerGroupLabels": groups["labels"],
        "headerGroupNumbers": groups["numbers"],
    }


def inspect_pdf(pdf_path: Path) -> dict[str, object]:
    import pdfplumber  # type: ignore

    with pdfplumber.open(pdf_path) as doc:
        page_texts = [(page.extract_text() or "") for page in doc.pages]
        full_text = "\n".join(page_texts)
        groups = group_inventory(full_text)
        periods = unique(PERIOD_RE.findall(full_text))
        dates = unique(DATE_RE.findall(full_text))

        pages: list[dict[str, object]] = []
        reference_tables: list[dict[str, object]] = []
        for page_index, page in enumerate(doc.pages, start=1):
            tables = page.extract_tables() or []
            shapes = [table_shape(table) for table in tables]
            pages.append({
                "page": page_index,
                "width": round(float(page.width), 2),
                "height": round(float(page.height), 2),
                "tableCount": len(shapes),
                "tables": shapes,
                "textStart": compact(page_texts[page_index - 1])[:2200],
            })
            for table_index, shape in enumerate(shapes, start=1):
                header_text = " ".join(shape["header"]).lower()
                if any(token in header_text for token in ("дисцип", "кафед", "адрес")):
                    reference_tables.append({
                        "page": page_index,
                        "table": table_index,
                        **shape,
                    })

        return {
            "pageCount": len(doc.pages),
            "groups": groups,
            "periodsLiteral": periods,
            "datesLiteral": dates[:120],
            "notesLiteral": note_lines(full_text),
            "reverseTimeRangesLiteral": reverse_time_ranges(full_text),
            "referenceTables": reference_tables,
            "pages": pages,
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--dir", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    directory = Path(args.dir)
    files = [
        item for item in report.get("files", [])
        if item.get("course") == 2
        and item.get("semester") == "autumn"
        and item.get("status") == "downloaded"
    ]
    files.sort(key=lambda item: int(str(item.get("stream", "999"))))

    if len(files) != 4:
        raise SystemExit(f"Expected 4 downloaded autumn course-2 sources from discovery, got {len(files)}")

    sources: list[dict[str, object]] = []
    for item in files:
        filename = item.get("filename")
        if not filename:
            raise SystemExit("Downloaded source is missing filename")
        pdf_path = directory / str(filename)
        if not pdf_path.exists():
            raise SystemExit(f"Downloaded PDF is missing: {pdf_path}")
        structure = inspect_pdf(pdf_path)
        sources.append({
            "stream": str(item.get("stream")),
            "course": item.get("course"),
            "part": item.get("part"),
            "semester": item.get("semester"),
            "url": item.get("url"),
            "filename": filename,
            "bytes": item.get("bytes"),
            "sha256": item.get("sha256"),
            **structure,
        })

    all_numbers = sorted({number for source in sources for number in source["groups"]["numbers"]})
    result = {
        "mode": "read-only-structure-inventory",
        "semanticCorrectionsApplied": False,
        "parserEventsProduced": False,
        "canonicalizationPerformed": False,
        "storageWritesPerformed": False,
        "sources": sources,
        "aggregate": {
            "sourceCount": len(sources),
            "streams": [source["stream"] for source in sources],
            "distinctGroupNumbers": all_numbers,
            "distinctGroupCount": len(all_numbers),
        },
    }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    for source in sources:
        print(json.dumps({
            "stream": source["stream"],
            "url": source["url"],
            "sha256": source["sha256"],
            "bytes": source["bytes"],
            "groups": source["groups"],
            "periodsLiteral": source["periodsLiteral"],
            "reverseTimeRangesLiteral": source["reverseTimeRangesLiteral"],
            "pageCount": source["pageCount"],
            "referenceTableCount": len(source["referenceTables"]),
        }, ensure_ascii=False))


if __name__ == "__main__":
    main()

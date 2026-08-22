#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

GROUP_RE = re.compile(r"ОЛД\s*(\d{3})", re.IGNORECASE)
TIME_RE = re.compile(r"\b([01]?\d|2[0-3])[:.]\d{2}\s*[-–]\s*([01]?\d|2[0-3])[:.]\d{2}\b")
PERIOD_RE = re.compile(r"\d{2}\.\d{2}\.\d{4}\s*[-–]\s*\d{2}\.\d{2}\.\d{4}")


def compact(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def relevant_notes(text: str) -> list[str]:
    result: list[str] = []
    for raw in text.splitlines():
        line = compact(raw)
        lowered = line.lower()
        if any(token in lowered for token in ("недел", "лекц", "онлайн", "очно", "ауд", "место проведения", "начинается")):
            if line and line not in result:
                result.append(line)
    return result[:40]


def table_shape(table) -> dict[str, object]:
    rows = len(table or [])
    cols = max((len(row or []) for row in table or []), default=0)
    header = [compact(value) for value in (table[0] if table else [])]
    groups = []
    for value in header:
        match = GROUP_RE.search(value)
        if match:
            groups.append(f"ОЛД {match.group(1)}")
    return {"rows": rows, "cols": cols, "header": header[:40], "headerGroups": groups}


def inspect_pdf(pdf_path: Path) -> dict[str, object]:
    import pdfplumber  # type: ignore

    with pdfplumber.open(pdf_path) as doc:
        texts = [(page.extract_text() or "") for page in doc.pages]
        full_text = "\n".join(texts)
        first = doc.pages[0]
        tables = first.extract_tables()
        group_codes = sorted({f"ОЛД {value}" for value in GROUP_RE.findall(full_text)}, key=lambda item: int(item.split()[-1]))
        periods = list(dict.fromkeys(PERIOD_RE.findall(full_text)))
        times = list(dict.fromkeys(match.group(0).replace(".", ":") for match in TIME_RE.finditer(full_text)))
        page_tables = [table_shape(table) for table in tables]
        reference_tables = []
        if len(doc.pages) > 1:
            for table in doc.pages[1].extract_tables():
                if not table:
                    continue
                shape = table_shape(table)
                header_text = " ".join(shape["header"]).lower()
                if "дисцип" in header_text or "кафед" in header_text or "адрес" in header_text:
                    reference_tables.append(shape)

        return {
            "pages": len(doc.pages),
            "page1": {"width": round(first.width, 2), "height": round(first.height, 2)},
            "groups": group_codes,
            "periods": periods,
            "times": times[:80],
            "page1Tables": page_tables,
            "page2ReferenceTables": reference_tables,
            "notes": relevant_notes(full_text),
            "page1TextStart": compact(texts[0])[:1800] if texts else "",
            "page2TextStart": compact(texts[1])[:1800] if len(texts) > 1 else "",
        }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--dir", required=True)
    args = parser.parse_args()

    report = json.loads(Path(args.report).read_text(encoding="utf-8"))
    directory = Path(args.dir)
    files = [item for item in report.get("files", []) if item.get("course") == 2 and item.get("status") == "downloaded"]
    if len(files) != 4:
        raise SystemExit(f"Expected exactly 4 downloaded autumn course-2 sources, got {len(files)}")

    output = []
    for item in sorted(files, key=lambda value: int(str(value.get("stream", "999")))):
        pdf_path = directory / item["filename"]
        structure = inspect_pdf(pdf_path)
        output.append({
            "stream": str(item.get("stream")),
            "url": item.get("url"),
            "sha256": item.get("sha256"),
            "bytes": item.get("bytes"),
            "filename": item.get("filename"),
            **structure,
        })

    print(json.dumps({"course": 2, "sources": output}, ensure_ascii=False, indent=2))

    streams = {item["stream"] for item in output}
    if streams != {"1", "2", "3", "4"}:
        raise SystemExit(f"Unexpected streams: {sorted(streams)}")
    if any(not item["groups"] for item in output):
        raise SystemExit("At least one source has no discoverable ОЛД group headers")
    if any(not item["periods"] for item in output):
        raise SystemExit("At least one source has no semester period")


if __name__ == "__main__":
    main()

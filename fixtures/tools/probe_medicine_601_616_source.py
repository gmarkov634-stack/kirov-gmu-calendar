#!/usr/bin/env python3
"""Fetch the current official KGMU medicine 6th-year XLSX without semantic parsing."""
import hashlib
import html
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "medicine-601-616-source-probe.json"
XLSX_OUT = ROOT / "medicine-601-616-official.xlsx"
PAGE = "https://kirovgma.ru/lechebnyy-fakultet-raspisanie"
ALLOWED_PREFIX = "/sites/default/files/files/"
PATTERN = re.compile(r"6_lech[^\"'<>\s]*\.xlsx", re.IGNORECASE)


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "kgmu-calendar-source-probe/1.0"})
    with urllib.request.urlopen(req, timeout=45) as response:
        return response.read()


def discover():
    page = html.unescape(fetch(PAGE).decode("utf-8", errors="replace"))
    hrefs = re.findall(r"href\s*=\s*[\"']([^\"']+)[\"']", page, flags=re.IGNORECASE)
    matches = []
    for href in hrefs:
        if not PATTERN.search(urllib.parse.unquote(href)):
            continue
        url = urllib.parse.urljoin(PAGE, href)
        parsed = urllib.parse.urlparse(url)
        if parsed.netloc != "kirovgma.ru" or not parsed.path.startswith(ALLOWED_PREFIX):
            raise SystemExit(f"source outside allowed KGMU path: {url}")
        matches.append(url)
    matches = sorted(set(matches))
    if len(matches) != 1:
        raise SystemExit(f"expected exactly one current 6th-year XLSX, found {matches}")
    return matches[0]


def main():
    url = discover()
    data = fetch(url)
    if not data.startswith(b"PK"):
        raise SystemExit("official source is not an XLSX/ZIP payload")
    XLSX_OUT.write_bytes(data)
    payload = {
        "schema": "kgmu-official-source-probe-v1",
        "semanticParsingPerformed": False,
        "timetablePage": PAGE,
        "source": {
            "stream": "601-616",
            "url": url,
            "sha256": hashlib.sha256(data).hexdigest(),
            "byteLength": len(data),
        },
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(payload["source"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Read-only mechanical source replay using exact SHA-pinned XLSX objects.
Requires openpyxl on the reviewing machine. No download, database, publication or
semantic parsing; the existing JS engine replays reviewed decisions independently.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import re
import subprocess
from openpyxl import load_workbook
from openpyxl.utils.cell import range_boundaries

ROOT = Path(__file__).resolve().parents[1]
HISTORICAL_SHA = "43ecb37de9db7ba69153c8514f62de0b058e51c2032e0ee320b117378a740c62"
LOCATOR = re.compile(r"[A-Z]+[1-9][0-9]*(?::[A-Z]+[1-9][0-9]*)?\Z")


def verified_bytes(objects, sha, length):
    if not re.fullmatch(r"[a-f0-9]{64}", sha):
        raise ValueError("invalid source SHA")
    b = (objects / (sha + ".xlsx")).read_bytes()
    if len(b) != length or hashlib.sha256(b).hexdigest() != sha:
        raise ValueError("immutable source identity mismatch: " + sha)
    return b


def check_locator(workbook, locator):
    sheet, sep, coord = locator.partition("!")
    if sep != "!" or sheet not in workbook.sheetnames or not LOCATOR.fullmatch(coord):
        raise ValueError("unresolved exact locator " + repr(locator))
    ws = workbook[sheet]
    c1, r1, c2, r2 = range_boundaries(coord)
    if not (1 <= c1 <= c2 <= ws.max_column and 1 <= r1 <= r2 <= ws.max_row):
        raise ValueError("range outside source worksheet: " + repr(locator))
    if not any(cell.value is not None for row in ws.iter_rows(min_col=c1,max_col=c2,min_row=r1,max_row=r2) for cell in row):
        raise ValueError("empty exact source range: " + repr(locator))


def replay(objects):
    plan = json.loads(subprocess.check_output(["node",str(ROOT/"tools/replay_reviewed_intake.mjs")], cwd=ROOT))
    if plan["publicationAllowed"] is not False or plan["releaseGate"] != "REVIEW_REQUIRED":
        raise ValueError("review-only gate missing")
    out=[]
    for source in plan["sources"]:
        b=verified_bytes(objects,source["sourceSha256"],source["byteLength"])
        wb=load_workbook(io.BytesIO(b),data_only=False)
        locators=source.get("locators",[])
        for locator in locators: check_locator(wb,locator)
        row={k:v for k,v in source.items() if k!="locators"}
        row["exactWorkbookSheets"]=wb.sheetnames
        row["verifiedNonemptyLocators"]=len(locators)
        row["sourceReplayScope"]="EXACT_BYTES_AND_LOCATORS" if locators else "EXACT_BYTES_ONLY_KNOWN_FIXTURE"
        if source.get("correction"):
            correction=source["correction"]
            if wb.sheetnames!=[correction["exactSheet"]] or correction["priorSheet"] in wb.sheetnames:
                raise ValueError("source-specific correction not supported by workbook")
        out.append(row)
    verified_bytes(objects,HISTORICAL_SHA,31755)
    return {**{k:v for k,v in plan.items() if k!="sources"},"originalXlsxVerified":len(out),"historical501516":{"sourceSha256":HISTORICAL_SHA,"byteLength":31755,"exactBytesVerified":True},"reviewedLocatorCount":sum(r["verifiedNonemptyLocators"] for r in out),"sources":out}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--objects",type=Path,required=True)
    p.add_argument("--out",type=Path)
    args=p.parse_args()
    text=json.dumps(replay(args.objects),ensure_ascii=False,sort_keys=True,indent=2)+"\n"
    if args.out: args.out.write_text(text,encoding="utf-8")
    else: print(text,end="")

if __name__ == "__main__":
    main()

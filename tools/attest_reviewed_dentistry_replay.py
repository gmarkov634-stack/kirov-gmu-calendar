#!/usr/bin/env python3
"""Attest a completed isolated dentistry replay against the frozen intake.
Pass the source-review directory and replay work directory; no DB/network access.
This verifies replay outputs, it does not run parsers or authorize publication.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
REG = BASE / "qa/2026-2027-semester-1/intake-2026-11-26"
STEPS = {
    "dentistry-291-294": ["build_dentistry_291_294_candidate.py", "resolve_dentistry_291_294_qa.py", "finalize_dentistry_291_294_draft.mjs"],
    "dentistry-391-394": ["run_dentistry_391_394_candidate.py", "audit-current.py", "build-final-local.mjs"],
    "dentistry-491-494": ["run_dentistry_491_494_prepost_candidate.py", "postprocess_dentistry_491_494_candidate.py", "build-local.py"],
}
def require(ok, message):
    if not ok:
        raise ValueError(message)
def sha(data):
    return hashlib.sha256(data).hexdigest()
def read(path):
    return json.loads(path.read_bytes())
def events(doc):
    return doc["events"] if "events" in doc else doc["parsingResult"]["events"]
def attest(source_review, work):
    registry = read(REG / "registry.json")
    rows = []
    for stem, steps in STEPS.items():
        entry = next(e for e in registry["sources"] if e.get("package", "").startswith("packages/" + stem + "-"))
        source = entry["sourceSha256"]
        raw = (source_review / "objects" / (source + ".xlsx")).read_bytes()
        require(sha(raw) == source and len(raw) == entry["byteLength"], stem + " source")
        package = (REG / entry["package"]).read_bytes()
        require(sha(package) == entry["packageSha256"], stem + " package")
        unpacked = gzip.decompress(package)
        require(sha(unpacked) == entry["uncompressedSha256"], stem + " uncompressed")
        doc = json.loads(unpacked)
        artifacts = {a["path"]: a for a in doc["artifacts"]}
        for a in artifacts.values():
            require(sha(a["content"].encode()) == a["sha256"], stem + " artifact")
        original = events(json.loads(artifacts[doc["originalCandidatePath"]]["content"]))
        prior = source_review / stem / source
        if stem == "dentistry-291-294":
            prior = prior / "local-reviewed-draft-v2"
            replay = work / "kgmu-engine/qa/2026-2027-semester-1/dentistry-291-294.normalized-draft.json"
        else:
            replay = work / "source-review" / stem / source / "bundle-local.json"
        require(sha((prior / doc["originalEvidencePath"]).read_bytes()) == entry["originalEvidenceSha256"], stem + " evidence")
        require(events(read(prior / doc["originalCandidatePath"])) == original, stem + " prior")
        result = events(read(replay))
        require(result == original, stem + " replay differs")
        digest = "sha256:" + sha(json.dumps(result, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode())
        require(digest == entry["eventSetDigest"] and len(result) == entry["eventCount"], stem + " digest")
        require(doc["publicationAllowed"] is False and entry["publicationAllowed"] is False, stem + " gate")
        rows.append({"profile": stem, "sourceSha256": source, "byteLength": len(raw), "originalEvidenceSha256": entry["originalEvidenceSha256"], "packageSha256": entry["packageSha256"], "eventCount": len(result), "eventSetDigest": digest, "groupCounts": entry["groupCounts"], "semanticDifferences": 0, "builderSteps": steps, "publicationAllowed": False,
            "sourceVerification": {"dentistry-291-294": "exact local XLSX supplied to pinned builder", "dentistry-391-394": "exact current XLSX audited against archived mechanical probe", "dentistry-491-494": "exact current XLSX audited against prior validated archived mechanical probe; old XLSX unavailable"}[stem]})
    return {"schema": "kgmu-local-dentistry-replay-v1", "engineBaseCommit": registry["engineBaseCommit"], "platformBaseCommit": registry["platformBaseCommit"], "sourceCount": len(rows), "eventCount": sum(r["eventCount"] for r in rows), "publicationAllowed": False, "releaseGate": "REVIEW_REQUIRED", "sources": rows}
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_review", type=Path)
    parser.add_argument("work", type=Path)
    args = parser.parse_args()
    print(json.dumps(attest(args.source_review.resolve(), args.work.resolve()), ensure_ascii=False, indent=2, sort_keys=True))


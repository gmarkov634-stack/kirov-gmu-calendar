#!/usr/bin/env python3
"""Verify this explicit, non-publishable source revision; no semantic inference."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import urllib.request
from urllib.parse import urlsplit
from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[2]
PERIOD = '2026-2027-semester-1'
STEM = 'dentistry-191-194-2026-11-09'
SOURCE_SHA = 'a0ea58290bd5e3a3de909b48e3ea9f1c69217b7134185d2606b56cd78e1029e5'
CANDIDATE_DIGEST = 'sha256:069cba1ec84088ea35630d79d05c464a5dbd597c73900ab6abdb460a9cde8198'
PREVIOUS_SHA = 'b0912c1da92106e9f282fdc4657ad45ead8b4f1dfce30a93ba78c4e0d4a510a7'
ORIGIN = 'https://kirovgma.ru/sites/default/files/files/2026/11/09/1097/1_stomat-09-11-2026-10.xlsx'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def sha(data):
    return hashlib.sha256(data).hexdigest()

def require(condition, message):
    if not condition:
        raise ValueError(message)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError(f'unexpected official source redirect: {newurl}')

def fetch():
    require(urlsplit(ORIGIN).scheme == 'https' and urlsplit(ORIGIN).hostname == 'kirovgma.ru', 'invalid origin')
    request = urllib.request.Request(ORIGIN, headers={'User-Agent': 'kgmu-source-review-ci/1.0'})
    with urllib.request.build_opener(NoRedirect()).open(request, timeout=45) as response:
        require(response.geturl() == ORIGIN, 'unexpected final URL')
        return response.read(17984)

def probe_bytes(data):
    wb = load_workbook(io.BytesIO(data), data_only=False)
    sheets = []
    for sheet in wb.worksheets:
        cells = []
        for row in sheet.iter_rows():
            for cell in row:
                if cell.value is None:
                    continue
                entry = {'coord': cell.coordinate, 'value': str(cell.value).strip()}
                if cell.hyperlink:
                    entry['hyperlink'] = {key: getattr(cell.hyperlink, key) for key in ('target', 'location', 'display')}
                cells.append(entry)
        sheets.append({'title': sheet.title, 'maxRow': sheet.max_row, 'maxColumn': sheet.max_column,
                       'mergedRanges': sorted(map(str, sheet.merged_cells.ranges)),
                       'nonEmptyCellCount': len(cells), 'nonEmptyCells': cells})
    return wb.sheetnames, sheets

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--xlsx', type=Path, help='Previously downloaded exact official source; otherwise HTTPS fetch')
    parser.add_argument('--output-dir', required=True, type=Path)
    args = parser.parse_args()
    fixture = ROOT / 'fixtures' / PERIOD
    qa = ROOT / 'qa' / PERIOD
    q = lambda name: qa / f'{STEM}.{name}.json'
    f = lambda name: fixture / f'{STEM}.{name}.json'
    manifest = read(q('review-package-manifest'))
    require(manifest['sourceSha256'] == SOURCE_SHA and manifest['publicationAllowed'] is False, 'manifest gate')
    files = manifest['files']
    require(len(files) == 13, 'manifest file count')
    for record in files:
        path = (ROOT / record['path']).resolve()
        require(path.is_relative_to(ROOT), 'manifest path escapes repository')
        data = path.read_bytes()
        require(len(data) == record['bytes'] and sha(data) == record['sha256'], f"manifest hash mismatch: {path.name}")
    source, artifact, job, decisions = [read(f(n)) for n in ('source', 'source-artifact', 'parsing-job', 'decisions')]
    review, report, evidence, probe = [read(q(n)) for n in ('semantic-review', 'qa-report', 'evidence', 'source-probe')]
    draft_path = fixture / 'normalized' / f'{STEM}.normalized.json'
    draft = read(draft_path)
    require(source['source']['url'] == ORIGIN and source['source']['sha256'] == SOURCE_SHA, 'source identity')
    require(source['previousReviewedSource']['sha256'] == PREVIOUS_SHA, 'previous identity')
    require(artifact['sha256'] == decisions['sourceSha256'] == draft['sourceSha256'] == review['sourceSha256'] == report['sourceSha256'] == evidence['sourceSha256'] == probe['source']['sha256'] == SOURCE_SHA, 'artifact source identity')
    require(source['lifecycle']['publicationAllowed'] is False and artifact['lifecycle']['publicationAllowed'] is False and report['publicationAllowed'] is False and evidence['publicationAllowed'] is False and review['publicationEligible'] is False, 'source must remain fail-closed')
    require(report['decision'] == 'pass' and review['status'] == 'SEMANTIC_QA_PASS' and review['unresolvedAmbiguities'] == 0 and decisions['unresolved'] == [], 'semantic QA')
    require(report['candidateDigest'] == evidence['candidateDigest'] == draft['candidateDigest'] == CANDIDATE_DIGEST, 'candidate identity')
    data = args.xlsx.read_bytes() if args.xlsx else fetch()
    require(len(data) == 17983 and sha(data) == SOURCE_SHA, 'official XLSX changed: REVIEW_REQUIRED')
    sheet_names, sheets = probe_bytes(data)
    require(sheet_names == probe['source']['sheetNames'] and sheets == probe['source']['sheets'], 'mechanical workbook differs from reviewed probe')
    # Use the existing deterministic builder in a private sandbox, not a new parser.
    with tempfile.TemporaryDirectory(prefix='dentistry-review-') as tmp:
        tmp = Path(tmp)
        spec = importlib.util.spec_from_file_location('builder', ROOT / 'fixtures/tools/build_dentistry_191_194_candidate.py')
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        for attr, file in [('SOURCE', f('source')), ('SOURCE_ARTIFACT', f('source-artifact')), ('PARSING_JOB', f('parsing-job')), ('DECISIONS', f('decisions')), ('R90_CONFIRMATION', f('r90-confirmation')), ('PROBE', q('source-probe'))]:
            target = tmp / file.name
            shutil.copyfile(file, target)
            setattr(builder, attr, target)
        builder.QA = tmp
        for attr, name in [('NORMALIZED', 'normalized.json'), ('EVIDENCE', 'evidence.json'), ('SEMANTIC_REVIEW', 'review.json'), ('QA_REPORT', 'qa-report.json')]:
            setattr(builder, attr, tmp / name)
        builder.main()
        generated = read(builder.NORMALIZED)
        require(generated == draft, 'regenerated normalized artifact differs')
        actual = read(builder.QA_REPORT)
        require(actual['candidateDigest'] == CANDIDATE_DIGEST and actual['decision'] == 'pass' and actual['publicationAllowed'] is False, 'regenerated gate')
        require(read(builder.SEMANTIC_REVIEW)['unresolvedAmbiguities'] == 0, 'unresolved generated ambiguities')
    events = draft['events']
    require(Counter(e['groupId'] for e in events) == {'191':429, '192':414, '193':414, '194':415}, 'group counts')
    require(len(events) == 1672 and sum(e.get('facultativeId') is not None for e in events) == 340, 'event counts')
    require(len(set(e['eventId'] for e in events)) == 1672, 'duplicate event IDs')
    require(report['unresolvedSemanticItemCount'] == 0 and report['publicationPerformed'] is False, 'QA gate')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / 'dentistry-191-194-source.xlsx').write_bytes(data)
    (args.output_dir / 'source-probe.json').write_text(json.dumps(probe, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    result = {'sourceSha256': SOURCE_SHA, 'byteLength': len(data), 'candidateDigest': CANDIDATE_DIGEST,
              'eventCount': len(events), 'facultativeCount': 340, 'mechanicalProbe': 'PASS',
              'deterministicRebuild': 'PASS', 'publicationAllowed': False, 'publicationPerformed': False}
    (args.output_dir / 'verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))

if __name__ == '__main__':
    main()

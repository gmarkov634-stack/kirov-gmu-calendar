# Immutable workbook and reviewed decision replay (2026-11-28)

This is a **review-only** follow-up to the intake registry. Original packages,
registry hashes and historical fixtures remain unaltered. No publication, no
runtime fixture promotion, no persistent database import, no raw XLSX in Git.

- `node tools/replay_reviewed_intake.mjs` deterministically re-expands the seven
  reviewed explicit v3/v4 manifests using the existing KGMU engine (18,458
  records); all seven original event arrays are identical to their reviewed
  candidates before the source-specific provenance correction.
- `python tools/audit_reviewed_intake_xlsx.py --objects /path/to/immutable-objects --out /path/to/report.json`
  additionally checks the SHA-256 and bytes of all 20 exact XLSX objects and
  the separately archived historical 501–516 object. Requires openpyxl.
  The 12 reviewed candidates' 1,212 unique sheet/coordinate or range locators
  resolve to nonempty cells. For the eight already-known fixtures, this is
  exact-byte identity only; for the other five reviewed packages it is a
  mechanical provenance audit, not independent semantic re-parsing.
- The exact 111–120 SHA has a single worksheet with two trailing spaces in its
  title. The prior decision/facultative manifests trimmed these two spaces.
  Correcting only these manifest fields regenerates source-derived event IDs
  and the event digest while keeping all 4,293 semantic event records unchanged.
  No general sheet-name alias or normalization rule is introduced. The
  correction is restricted to this SHA and the exact workbook title. Historical
  evidence remains intact. Deployment and cross-version stable-key continuity
  must still be verified through the canonical platform bridge.

`local-archive-report.json` records local mechanical replay, not hosted source
replay or authorization to publish. The automated engine regression tests do
not require access to raw XLSX files and do not substitute for that check.

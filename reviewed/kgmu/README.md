# Reviewed KGMU schedule bundles

Production KGMU schedules are normalized outside the server and committed here as reviewed JSON bundles. The server does not parse these XLSX files in the production path.

Each JSON file uses schema version 1:

```json
{
  "version": 1,
  "university": "kgmu",
  "program": "pediatrics",
  "course": 2,
  "academicYear": "2026/27",
  "semester": 1,
  "source": {
    "filename": "schedule.xlsx",
    "sha256": "<64 hex chars>",
    "url": "https://kirovgma.ru/.../schedule.xlsx",
    "groupRange": "231-238"
  },
  "normalizer": {
    "type": "chatgpt-reviewed",
    "rulesRevision": "R69"
  },
  "groups": {
    "231": {
      "events": [
        {
          "title": "Дисциплина",
          "start": "2026-09-01T09:00:00+03:00",
          "end": "2026-09-01T10:30:00+03:00",
          "location": ""
        }
      ]
    }
  }
}
```

The validator requires the group keys to exactly match `source.groupRange`, rejects malformed dates/times and duplicate events, and the API independently downloads the official `kirovgma.ru` XLSX and verifies its SHA-256 before staging or publication.

A push of a JSON file under this directory triggers the reviewed-bundle workflow. After local schema validation, the workflow sends the bundle to the production API. The API validates again, verifies the official source hash, stages an atomic bundle, and publishes it only if every technical check passes. The previous published schedule remains active if any check fails.

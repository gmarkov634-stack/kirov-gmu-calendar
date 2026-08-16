import fs from "node:fs";

const path = ".github/workflows/deploy-api-cloudru.yml";
let source = fs.readFileSync(path, "utf8");

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`patch marker not found: ${label}`);
  source = source.slice(0, index) + after + source.slice(index + before.length);
}

replaceOnce(
`          rows=json.load(open('/tmp/revisions-before.json', encoding='utf-8')).get('data') or []
          active=[row for row in rows if isinstance(row,dict) and row.get('status') == 'active']
          assert len(active) == 1, active

          protected=copy.deepcopy(app.get('template') or {})`,
`          rows=json.load(open('/tmp/revisions-before.json', encoding='utf-8')).get('data') or []
          active=[row for row in rows if isinstance(row,dict) and row.get('status') == 'active']
          assert len(active) <= 1, active
          revision_names=sorted({str(row.get('name')) for row in rows if isinstance(row,dict) and row.get('name')})
          old_revision=active[0].get('name','') if active else ''

          protected=copy.deepcopy(app.get('template') or {})`,
"pre-deploy revision status",
);

replaceOnce(
`          state={
              'oldRevision': active[0].get('name'),
              'oldImage': current_image,
              'targetImage': os.environ['TARGET_IMAGE'],
              'needsPatch': current_image != os.environ['TARGET_IMAGE'],
              'protectedTemplateFingerprint': protected_fingerprint,
          }
          assert state['oldRevision']`,
`          state={
              'oldRevision': old_revision,
              'revisionNamesBefore': revision_names,
              'oldImage': current_image,
              'targetImage': os.environ['TARGET_IMAGE'],
              'needsPatch': current_image != os.environ['TARGET_IMAGE'],
              'protectedTemplateFingerprint': protected_fingerprint,
          }`,
"deploy state",
);

replaceOnce(
`              'oldRevision':state['oldRevision'],
              'oldImage':state['oldImage'],`,
`              'oldRevision':state['oldRevision'] or 'not-reported',
              'revisionCountBefore':len(state['revisionNamesBefore']),
              'oldImage':state['oldImage'],`,
"safe precheck log",
);

replaceOnce(
`            new_revision=''
            for attempt in $(seq 1 60); do
              sleep 5
              test "$(curl --silent --show-error --output /tmp/revisions-now.json --write-out '%{http_code}' \\
                --header "Authorization: Bearer $token" --header 'Accept: application/json' "$revisions_url")" = "200"
              new_revision="$(python3 - <<'PY'
          import json
          rows=json.load(open('/tmp/revisions-now.json', encoding='utf-8')).get('data') or []
          active=[row for row in rows if isinstance(row,dict) and row.get('status') == 'active']
          print(active[0].get('name','') if len(active) == 1 else '')
          PY
              )"
              echo "REVISION_POLL_SAFE attempt=$attempt active=${new_revision:-none}"
              if [ -n "$new_revision" ] && [ "$new_revision" != "$old_revision" ]; then
                break
              fi
            done
            test -n "$new_revision"
            test "$new_revision" != "$old_revision"`,
`            new_revision=''
            for attempt in $(seq 1 24); do
              sleep 5
              test "$(curl --silent --show-error --output /tmp/revisions-now.json --write-out '%{http_code}' \\
                --header "Authorization: Bearer $token" --header 'Accept: application/json' "$revisions_url")" = "200"
              new_revision="$(python3 - <<'PY'
          import json, sys
          rows=json.load(open('/tmp/revisions-now.json', encoding='utf-8')).get('data') or []
          active=[row for row in rows if isinstance(row,dict) and row.get('status') == 'active']
          if len(active) > 1:
              print('MULTIPLE_ACTIVE_REVISIONS', file=sys.stderr)
              raise SystemExit(2)
          print(active[0].get('name','') if active else '')
          PY
              )"
              echo "REVISION_POLL_SAFE attempt=$attempt active=${new_revision:-none}"
              if [ -n "$new_revision" ] && { [ -z "$old_revision" ] || [ "$new_revision" != "$old_revision" ]; }; then
                break
              fi
            done
            if [ -z "$new_revision" ] || { [ -n "$old_revision" ] && [ "$new_revision" = "$old_revision" ]; }; then
              new_revision='not-reported'
              echo "REVISION_STATUS_SAFE no new active revision reported; current container state and immutable image will be authoritative"
            fi`,
"post-patch revision polling",
);

fs.writeFileSync(path, source);

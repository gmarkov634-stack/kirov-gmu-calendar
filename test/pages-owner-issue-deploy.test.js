import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');

test('Pages deploy accepts only manual dispatch or an exact owner-authored issue', () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /issues:\n\s+types: \[opened\]/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /github\.repository == 'gmarkov634-stack\/kirov-gmu-calendar'/);
  assert.match(workflow, /github\.actor == 'gmarkov634-stack'/);
  assert.match(workflow, /github\.event\.issue\.user\.login == 'gmarkov634-stack'/);
  assert.match(workflow, /github\.event\.issue\.author_association == 'OWNER'/);
  assert.match(workflow, /github\.event\.issue\.title == '\[pages-op\] deploy'/);
  assert.match(workflow, /github\.event\.issue\.body == null/);
  assert.match(workflow, /github\.event\.issue\.body == ''/);
  assert.doesNotMatch(workflow, /self-hosted/);
});

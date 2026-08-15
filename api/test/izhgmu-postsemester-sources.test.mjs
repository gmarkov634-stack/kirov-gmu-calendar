import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IZHGMU_MEDICINE6_POSTSEMESTER_SOURCES,
  IZHGMU_MEDICINE6_STREAM_MAPPING_POLICY,
  canonicalOfficialPdfUrl,
  resolveOfficialPdfRedirect,
  fetchIzhgmuPostsemesterSource,
  collectIzhgmuMedicine6PostsemesterSources,
} from '../src/adapters/izhgmu/postsemester-sources.mjs';

function pdfResponse(bytes = '%PDF-1.7\nmock\n', { url = 'https://www.igma.ru/mock.pdf', status = 200 } = {}) {
  const response = new Response(Buffer.from(bytes), {
    status,
    headers: { 'content-type': 'application/pdf' },
  });
  Object.defineProperty(response, 'url', { value: url });
  return response;
}

test('medicine-6 stream mapping policy is source-local and does not guess communication-skills groups', () => {
  assert.equal(IZHGMU_MEDICINE6_STREAM_MAPPING_POLICY.scope, 'source_local');
  assert.equal(IZHGMU_MEDICINE6_STREAM_MAPPING_POLICY.communicationSkillsStatus, 'unresolved');
  assert.equal(IZHGMU_MEDICINE6_STREAM_MAPPING_POLICY.evidence.length, 2);
  assert.notEqual(
    IZHGMU_MEDICINE6_STREAM_MAPPING_POLICY.evidence[0].observed,
    IZHGMU_MEDICINE6_STREAM_MAPPING_POLICY.evidence[1].observed,
  );
});

test('post-semester boundary pins separate official attestation and GIA PDF sources', () => {
  assert.deepEqual(
    IZHGMU_MEDICINE6_POSTSEMESTER_SOURCES.map((source) => source.kind),
    ['intermediate_attestation_schedule', 'gia_schedule'],
  );
  assert.equal(IZHGMU_MEDICINE6_POSTSEMESTER_SOURCES.every((source) => source.calendarAuthority === 'exact_schedule_required'), true);
  assert.equal(IZHGMU_MEDICINE6_POSTSEMESTER_SOURCES.every((source) => source.rangeMarkerFallback === false), true);
  assert.equal(IZHGMU_MEDICINE6_POSTSEMESTER_SOURCES.every((source) => source.url.startsWith('https://www.igma.ru/')), true);
});

test('post-semester redirect policy canonicalizes only the initial host and preserves an allowed redirect host', () => {
  assert.equal(
    canonicalOfficialPdfUrl('https://igma.ru/images/a.pdf').href,
    'https://www.igma.ru/images/a.pdf',
  );
  assert.equal(
    resolveOfficialPdfRedirect('https://www.igma.ru/images/a.pdf', 'https://igma.ru/images/a.pdf').href,
    'https://igma.ru/images/a.pdf',
  );
  assert.equal(
    resolveOfficialPdfRedirect('https://www.igma.ru/images/a.pdf', '../b.pdf').href,
    'https://www.igma.ru/b.pdf',
  );
  assert.throws(
    () => resolveOfficialPdfRedirect('https://www.igma.ru/images/a.pdf', 'https://example.com/a.pdf'),
    (error) => error.code === 'IZH_POSTSEMESTER_URL_REJECTED',
  );
});

test('post-semester PDF fetch validates official host, PDF magic and SHA', async () => {
  const source = IZHGMU_MEDICINE6_POSTSEMESTER_SOURCES[0];
  const result = await fetchIzhgmuPostsemesterSource(source, {
    fetchImpl: async () => pdfResponse('%PDF-1.7\nverified\n'),
  });
  assert.equal(result.bytes, Buffer.byteLength('%PDF-1.7\nverified\n'));
  assert.match(result.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.source.finalUrl, 'https://www.igma.ru/mock.pdf');

  await assert.rejects(
    () => fetchIzhgmuPostsemesterSource({ ...source, url: 'https://example.com/a.pdf' }, { fetchImpl: async () => pdfResponse() }),
    (error) => error.code === 'IZH_POSTSEMESTER_URL_REJECTED',
  );
  await assert.rejects(
    () => fetchIzhgmuPostsemesterSource(source, {
      fetchImpl: async () => new Response('<html>not pdf</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    }),
    (error) => error.code === 'IZH_POSTSEMESTER_NOT_PDF',
  );
});

test('post-semester collection is fail-closed if either exact schedule PDF is unavailable', async () => {
  let calls = 0;
  const report = await collectIzhgmuMedicine6PostsemesterSources({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return pdfResponse('%PDF-1.7\nfirst\n');
      return new Response('missing', { status: 404 });
    },
  });
  assert.equal(report.expectedCount, 2);
  assert.equal(report.downloadedCount, 1);
  assert.equal(report.failedCount, 1);
  assert.equal(report.status, 'needs_review');
  assert.equal(report.files[1].status, 'failed');
  assert.equal(report.files[1].buffer, null);
});

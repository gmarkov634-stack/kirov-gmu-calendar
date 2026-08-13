import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const base = 'https://kgmu-calendar-api.containerapps.ru';
const adminToken = process.env.KGMU_ADMIN_TOKEN;
const source = 'reviewed/kgmu/2025-26/2/medicine/4/146876a71f1ad8503593aeb82fcc72fef76022896b85d7f7dc61ca7ec97c0dae.json';
if (!adminToken || adminToken.length < 32) throw new Error('KGMU_ADMIN_TOKEN missing');

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function jsonRequest(path, { method = 'GET', body, admin = false } = {}) {
  const headers = {};
  if (admin) headers['X-Admin-Token'] = adminToken;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${path}: ${JSON.stringify(parsed)}`);
  return { response, body: parsed };
}

async function publish(batch) {
  return (await jsonRequest('/api/v1/admin/schedules/publish', {
    method: 'POST', admin: true, body: batch,
  })).body;
}

async function fetchIcs(url) {
  const response = await fetch(url, { cache: 'no-store' });
  const text = await response.text();
  if (!response.ok) throw new Error(`subscription HTTP ${response.status}`);
  return {
    text,
    status: response.headers.get('x-subscription-status'),
    expiresAt: response.headers.get('x-subscription-expires-at'),
  };
}

function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
}

function icsEvents(text) {
  const out = [];
  let current = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { current = []; continue; }
    if (line === 'END:VEVENT') { if (current) out.push(current); current = null; continue; }
    if (current) current.push(line);
  }
  return out;
}

function field(block, name) {
  const prefix = `${name}:`;
  const line = block.find((value) => value.startsWith(prefix));
  return line?.slice(prefix.length) ?? null;
}

function chooseSafeCandidate(batch) {
  const byDate = new Map();
  for (const event of batch.events) {
    if (event.timing?.all_day === true) continue;
    if (!/^\d{2}:\d{2}$/.test(event.timing?.start_time || '') || !/^\d{2}:\d{2}$/.test(event.timing?.end_time || '')) continue;
    const list = byDate.get(event.timing.date) || [];
    list.push(event);
    byDate.set(event.timing.date, list);
  }
  for (const [date, list] of [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (list.length !== 1) continue;
    const event = list[0];
    const [sh, sm] = event.timing.start_time.split(':').map(Number);
    const [eh, em] = event.timing.end_time.split(':').map(Number);
    if ((eh * 60 + em) - (sh * 60 + sm) > 10) return event;
  }
  throw new Error('no safe single-event day candidate');
}

function oneMinuteEarlier(value) {
  const [h, m] = value.split(':').map(Number);
  const total = h * 60 + m - 1;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function assertDiffOneChanged(result, expectedUnchanged = 111) {
  const counts = result.diff?.counts || {};
  assert(result.status === 'published', `expected published, got ${result.status}`);
  assert(counts.added === 0 && counts.changed === 1 && counts.removed === 0 && counts.unchanged === expectedUnchanged,
    `unexpected diff ${JSON.stringify(counts)}`);
  const changed = result.diff.changed?.[0];
  assert(changed?.event_id, 'changed event_id missing');
  assert(changed.changes?.length === 1 && changed.changes[0].path === '/timing/end_time', `unexpected changes ${JSON.stringify(changed?.changes)}`);
  return changed;
}

function targetFromIcs(text, uid) {
  const events = icsEvents(text);
  const target = events.find((block) => field(block, 'UID') === uid);
  assert(target, `target UID missing ${uid}`);
  return { events, target };
}

execFileSync(process.execPath, [
  'api/tools/kgmu-legacy-reviewed-to-canonical.mjs',
  '--input', source,
  '--groups', 'all',
  '--week1-start', '2026-02-02',
  '--output', '/tmp/kgmu-all-canonical.json',
], { stdio: 'inherit' });

const pkg = JSON.parse(fs.readFileSync('/tmp/kgmu-all-canonical.json', 'utf8'));
const a = pkg.batches.find((batch) => batch.schedule.group === '401');
assert(a && a.events.length === 112, `bad group 401 baseline ${a?.events?.length}`);
const b = structuredClone(a);
const candidate = chooseSafeCandidate(b);
const originalEnd = candidate.timing.end_time;
candidate.timing.end_time = oneMinuteEarlier(originalEnd);
console.log(`CANDIDATE ${candidate.timing.date} ${candidate.timing.start_time}-${originalEnd} -> ${candidate.timing.end_time} ${candidate.lesson?.discipline?.normalized}`);

let subscriptionUrl = null;
let subscriptionHash = null;
let needsRestore = false;

try {
  const health = (await jsonRequest('/health')).body;
  assert(health.status === 'ok' && health.service === 'medical-calendar-api', `bad health ${JSON.stringify(health)}`);
  console.log('HEALTH_OK');

  const baseline = await publish(a);
  assert(baseline.status === 'unchanged' && baseline.diff?.same_content === true, `baseline is not current ${JSON.stringify({status: baseline.status, diff: baseline.diff?.counts})}`);
  assert(baseline.eventCount === 112, `baseline event count ${baseline.eventCount}`);
  console.log(`BASELINE_UNCHANGED version=${baseline.scheduleVersionId} fingerprint=${baseline.contentFingerprint} events=${baseline.eventCount}`);

  const preview = (await jsonRequest('/api/v1/admin/subscriptions/preview', {
    method: 'POST', admin: true,
    body: { university: 'kgmu', program: 'medicine', course: 4, groupCode: '401', academicYear: '2025/2026', semester: 2, days: 1 },
  })).body;
  assert(preview.status === 'active' && preview.preview === true && preview.groupCode === '401', 'bad preview response');
  const url = new URL(preview.subscriptionUrl);
  const match = url.pathname.match(/^\/api\/v1\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/);
  assert(match, 'bad subscription URL shape');
  subscriptionUrl = preview.subscriptionUrl;
  subscriptionHash = createHash('sha256').update(match[1]).digest('hex');
  console.log(`::add-mask::${match[1]}`);
  console.log(`PREVIEW_CREATED group=401 expiresAt=${preview.expiresAt}`);

  const feedA = await fetchIcs(subscriptionUrl);
  assert(feedA.status === 'active', `A subscription status ${feedA.status}`);

  const publishedB = await publish(b);
  needsRestore = true;
  const changedB = assertDiffOneChanged(publishedB);
  console.log(`B_PUBLISHED version=${publishedB.scheduleVersionId} previous=${publishedB.previousScheduleVersionId} event=${changedB.event_id} revision=${changedB.revision} matchedBy=${changedB.matched_by}`);
  console.log(`B_DIFF ${JSON.stringify(publishedB.diff.counts)}`);

  const feedB = await fetchIcs(subscriptionUrl);
  assert(feedB.status === 'active', `B subscription status ${feedB.status}`);
  const uid = `${changedB.event_id}@kgmu-calendar`;
  const aIcs = targetFromIcs(feedA.text, uid);
  const bIcs = targetFromIcs(feedB.text, uid);
  assert(aIcs.events.length === bIcs.events.length && aIcs.events.length >= 100, `VEVENT count A=${aIcs.events.length} B=${bIcs.events.length}`);
  const seqA = Number(field(aIcs.target, 'SEQUENCE'));
  const seqB = Number(field(bIcs.target, 'SEQUENCE'));
  assert(Number.isInteger(seqA) && seqB === seqA + 1, `SEQUENCE ${seqA}->${seqB}`);
  assert(field(aIcs.target, 'DTSTART') === field(bIcs.target, 'DTSTART'), 'DTSTART changed');
  assert(field(aIcs.target, 'DTEND') !== field(bIcs.target, 'DTEND'), 'DTEND did not change');
  const uidsA = aIcs.events.map((block) => field(block, 'UID')).sort();
  const uidsB = bIcs.events.map((block) => field(block, 'UID')).sort();
  assert(JSON.stringify(uidsA) === JSON.stringify(uidsB), 'UID set changed A->B');
  console.log(`SUBSCRIPTION_A_B_OK uid=${uid} sequence=${seqA}->${seqB} dtend=${field(aIcs.target, 'DTEND')}->${field(bIcs.target, 'DTEND')} vevents=${aIcs.events.length}`);

  const restored = await publish(a);
  const changedC = assertDiffOneChanged(restored);
  assert(changedC.event_id === changedB.event_id, 'event_id changed on restore');
  assert(changedC.revision === changedB.revision + 1, `revision did not increment ${changedB.revision}->${changedC.revision}`);
  needsRestore = false;
  console.log(`A_RESTORED version=${restored.scheduleVersionId} previous=${restored.previousScheduleVersionId} event=${changedC.event_id} revision=${changedC.revision}`);

  const feedC = await fetchIcs(subscriptionUrl);
  assert(feedC.status === 'active', `C subscription status ${feedC.status}`);
  const cIcs = targetFromIcs(feedC.text, uid);
  const seqC = Number(field(cIcs.target, 'SEQUENCE'));
  assert(seqC === seqB + 1, `restore SEQUENCE ${seqA}->${seqB}->${seqC}`);
  assert(field(cIcs.target, 'DTSTART') === field(aIcs.target, 'DTSTART'), 'DTSTART not restored');
  assert(field(cIcs.target, 'DTEND') === field(aIcs.target, 'DTEND'), `DTEND not restored ${field(aIcs.target, 'DTEND')} vs ${field(cIcs.target, 'DTEND')}`);
  const uidsC = cIcs.events.map((block) => field(block, 'UID')).sort();
  assert(JSON.stringify(uidsA) === JSON.stringify(uidsC), 'UID set changed after restore');
  console.log(`SUBSCRIPTION_A_B_A_OK uid=${uid} sequence=${seqA}->${seqB}->${seqC} restoredDtend=${field(cIcs.target, 'DTEND')} sameUrl=true vevents=${cIcs.events.length}`);

  const finalBaseline = await publish(a);
  assert(finalBaseline.status === 'unchanged' && finalBaseline.diff?.same_content === true, 'final production state is not baseline');
  console.log(`FINAL_BASELINE_CONFIRMED version=${finalBaseline.scheduleVersionId} fingerprint=${finalBaseline.contentFingerprint}`);

  const revoke = (await jsonRequest(`/api/v1/admin/subscriptions/${subscriptionHash}/revoke`, { method: 'POST', admin: true })).body;
  assert(revoke.status === 'revoked' && revoke.groupCode === '401', `revoke failed ${JSON.stringify(revoke)}`);
  console.log('PREVIEW_REVOKED');
  subscriptionHash = null;

  const revokedFeed = await fetchIcs(subscriptionUrl);
  assert(revokedFeed.status === 'revoked', `revoked status ${revokedFeed.status}`);
  assert(icsEvents(revokedFeed.text).length === 0, 'revoked feed still has events');
  console.log('REVOKED_FEED_EMPTY_OK');
  console.log('STABLE_SUBSCRIPTION_URL_E2E_SUCCESS');
} finally {
  if (needsRestore) {
    try {
      const restored = await publish(a);
      console.log(`CLEANUP_RESTORE status=${restored.status} version=${restored.scheduleVersionId || 'n/a'}`);
    } catch (error) {
      console.error(`CLEANUP_RESTORE_FAILED ${error.message}`);
    }
  }
  if (subscriptionHash) {
    try {
      const result = (await jsonRequest(`/api/v1/admin/subscriptions/${subscriptionHash}/revoke`, { method: 'POST', admin: true })).body;
      console.log(`CLEANUP_REVOKE status=${result.status || result.error || 'unknown'}`);
    } catch (error) {
      console.error(`CLEANUP_REVOKE_FAILED ${error.message}`);
    }
  }
}

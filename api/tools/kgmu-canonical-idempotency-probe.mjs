import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const token = process.env.KGMU_ADMIN_TOKEN;
if (!token || token.length < 32) throw new Error('KGMU_ADMIN_TOKEN missing');
const base = 'https://kgmu-calendar-api.containerapps.ru';
const source = 'reviewed/kgmu/2025-26/2/medicine/4/146876a71f1ad8503593aeb82fcc72fef76022896b85d7f7dc61ca7ec97c0dae.json';
execFileSync(process.execPath, ['api/tools/kgmu-legacy-reviewed-to-canonical.mjs','--input',source,'--groups','all','--week1-start','2026-02-02','--output','/tmp/all.json'], {stdio:'inherit'});
const pkg=JSON.parse(fs.readFileSync('/tmp/all.json','utf8'));
const batch=pkg.batches.find((b)=>b.schedule.group==='401');
if (!batch) throw new Error('401 missing');
const response=await fetch(`${base}/api/v1/admin/schedules/publish`,{method:'POST',headers:{'X-Admin-Token':token,'Content-Type':'application/json'},body:JSON.stringify(batch)});
const body=await response.json();
if (!response.ok) throw new Error(`HTTP ${response.status} ${JSON.stringify(body)}`);
console.log('IDEMPOTENCY_PROBE_RESULT');
console.log(JSON.stringify({status:body.status,scheduleVersionId:body.scheduleVersionId,previousScheduleVersionId:body.previousScheduleVersionId,contentFingerprint:body.contentFingerprint,diffSameContent:body.diff?.same_content,diffCounts:body.diff?.counts,publicationUnchanged:body.publication?.unchanged,publicationVersion:body.publication?.scheduleVersionId},null,2));

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseIzhgmuMedicine6LectureWorkbook, IZHGMU_MEDICINE6_EXPECTED_GROUPS } from '../src/adapters/izhgmu/lecture-medicine6.mjs';
import { buildIzhgmuMedicine6LectureQaCandidate, buildIzhgmuMedicine6LectureCanonicalBatch } from '../src/adapters/izhgmu/lecture-medicine6-canonical.mjs';
import { prepareSchedulePublication } from '../src/schedule/pipeline.js';

function arg(name,fallback=null){const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:fallback;}
function sha256(buffer){return crypto.createHash('sha256').update(buffer).digest('hex');}
function normalizeAcademicYear(value){const m=String(value||'').match(/(20\d{2})\D+(20\d{2}|\d{2})/);if(!m)throw new Error(`Invalid academic year: ${value}`);const start=Number(m[1]);let end=Number(m[2]);if(m[2].length===2)end=Math.floor(start/100)*100+end;if(end!==start+1)throw new Error(`Non-consecutive academic year: ${value}`);return `${start}/${end}`;}

const inputDir=path.resolve(arg('--input-dir','/tmp/izhgmu-current'));
const report=JSON.parse(await fs.readFile(path.join(inputDir,'download-report.json'),'utf8'));
const sources=report.files.filter((item)=>item.status==='downloaded'&&item.spreadsheetKind==='xlsx'&&item.faculty==='medicine'&&Number(item.course)===6&&item.language==='ru'&&item.term==='spring'&&item.sourceKind==='lecture');
if(sources.length!==1)throw new Error(`Expected one medicine-6 lecture source; got ${sources.map(x=>x.filename).join(', ')}`);
const source=sources[0];
const buffer=await fs.readFile(path.join(inputDir,source.filename));
if(sha256(buffer)!==source.sha256)throw new Error(`Medicine-6 lecture SHA mismatch: ${source.filename}`);
const parsed=await parseIzhgmuMedicine6LectureWorkbook(buffer,{courseGroups:IZHGMU_MEDICINE6_EXPECTED_GROUPS});

if(parsed.period.start_date!=='2026-02-02'||parsed.period.end_date!=='2026-05-30')throw new Error(`Medicine-6 lecture period changed: ${parsed.period.start_date}..${parsed.period.end_date}`);
const expected={sourceRows:25,coreSeries:14,coreOccurrences:78,courseWideCoreSeries:12,courseWideCoreOccurrences:72,streamSeries:2,streamOccurrences:6,electiveSeries:11,electiveOccurrences:74,electiveOptionCount:11,electiveDeclaredCountMismatchRows:3,structuralReviewCount:0,periodMarkerCount:2,titleStudentCount:396};
for(const [key,value] of Object.entries(expected))if(parsed.stats[key]!==value)throw new Error(`Medicine-6 lecture ${key} changed: ${parsed.stats[key]}/${value}`);
if(parsed.stats.electiveRosterTotals?.[4]!==386||parsed.stats.electiveRosterTotals?.[5]!==386)throw new Error(`Medicine-6 lecture elective roster totals changed: ${JSON.stringify(parsed.stats.electiveRosterTotals)}`);
if(parsed.periodMarkers.map(x=>`${x.kind}:${x.startDate}:${x.endDateInclusive}`).join('|')!=='preliminary_attestation:2026-06-01:2026-06-08|gia:2026-06-09:2026-06-22')throw new Error(`Medicine-6 post-semester markers changed: ${JSON.stringify(parsed.periodMarkers)}`);
if(parsed.reviewRequired.length!==0||parsed.sourceLevelReady!==true||parsed.courseWideGroupReady!==true)throw new Error(`Medicine-6 lecture structural review changed: ${JSON.stringify(parsed.reviewRequired)}`);
if(parsed.publishable!==false||parsed.blockers.map(x=>x.warning).join('|')!=='stream_group_mapping_required|elective_choice_required')throw new Error(`Medicine-6 lecture blocker set changed: ${JSON.stringify(parsed.blockers)}`);
if(parsed.courseGroups.join('|')!==IZHGMU_MEDICINE6_EXPECTED_GROUPS.join('|'))throw new Error('Medicine-6 lecture course group set changed');
if(parsed.courseWideCoreSeries.some(x=>x.groups.length!==30)||parsed.streamSeries.some(x=>x.groups.length)||parsed.electiveSeries.some(x=>x.groups.length))throw new Error('Medicine-6 lecture audience attribution leaked across course/stream/choice boundaries');

const expectedDisciplines=['Онкология','Основы экстренной и неотложной помощи','Фтизиатрия','Коммуникативные навыки','Основы современной хирургии','Поликлиническая терапия','Эпидемиология','Избр. вопр. терапии','Госпитальная терапия','Функциональная диагностика в клинике внутренних болезней'].sort();
const actualDisciplines=[...new Set(parsed.series.filter(x=>!x.choiceRequired).map(x=>x.discipline))].sort();
if(actualDisciplines.join('|')!==expectedDisciplines.join('|'))throw new Error(`Medicine-6 lecture core discipline set changed: ${actualDisciplines.join(', ')}`);
const fti=parsed.series.filter(x=>x.discipline==='Фтизиатрия');
if(fti.reduce((n,x)=>n+x.dates.length,0)!==7||fti.find(x=>x.declaredCount===7)?.declaredCountScope!=='discipline_total')throw new Error(`Medicine-6 phthisiology count reconciliation changed: ${JSON.stringify(fti)}`);
const oncology=parsed.courseWideCoreSeries.find(x=>x.discipline==='Онкология');
const oncologyDates=['2026-02-16','2026-03-02','2026-03-16','2026-03-23','2026-03-30','2026-04-06','2026-04-13','2026-04-20','2026-04-27','2026-05-04'];
if(!oncology||oncology.startTime!=='13:00'||oncology.endTime!=='14:35'||oncology.dates.join(',')!==oncologyDates.join(','))throw new Error(`Medicine-6 oncology lecture evidence changed: ${JSON.stringify(oncology)}`);
if(parsed.streamSeries.map(x=>`${x.stream}:${x.dates.length}`).sort().join('|')!=='1:3|2:3')throw new Error(`Medicine-6 communication stream evidence changed: ${JSON.stringify(parsed.streamSeries)}`);
const rosterCounts={4:parsed.electiveRoster.filter(x=>x.slot===4).length,5:parsed.electiveRoster.filter(x=>x.slot===5).length};
if(rosterCounts[4]!==6||rosterCounts[5]!==5)throw new Error(`Medicine-6 elective roster option count changed: ${JSON.stringify(rosterCounts)}`);
const diagnostics=parsed.diagnostics.map(x=>x.warning);
if(!diagnostics.includes('elective_roster_total_differs_from_title_count'))throw new Error(`Medicine-6 enrollment/roster source diagnostic disappeared: ${JSON.stringify(parsed.diagnostics)}`);

const input={parsed,metadata:{academicYear:normalizeAcademicYear(source.academicYear),semester:source.term,facultyCode:source.faculty,course:6,groupCode:'601',stream:null},source:{fileName:source.filename,fileHash:source.sha256}};
const candidate=buildIzhgmuMedicine6LectureQaCandidate(input);
if(candidate.events.length!==72)throw new Error(`Medicine-6 course-wide lecture candidate changed: ${candidate.events.length}/72`);
const prepared=prepareSchedulePublication(candidate,{now:'2026-08-16T00:00:00.000Z'});
if(!prepared.inputQa.publishable||!prepared.outputQa.publishable)throw new Error(`Medicine-6 lecture safe candidate failed shared QA: ${JSON.stringify({input:prepared.inputQa.errors,output:prepared.outputQa.errors})}`);
let productionError=null;
try{buildIzhgmuMedicine6LectureCanonicalBatch(input);}catch(error){productionError=error;}
if(productionError?.code!=='IZH_LECTURE_M6_INCOMPLETE'||productionError.blockers?.length!==2)throw new Error(`Medicine-6 lecture production gate changed: ${productionError?.code} ${JSON.stringify(productionError?.blockers)}`);

const summary={profile:parsed.profile,sourceFile:source.filename,sourceHash:source.sha256,period:parsed.period,periodMarkers:parsed.periodMarkers,stats:parsed.stats,courseWideDisciplines:[...new Set(parsed.courseWideCoreSeries.map(x=>x.discipline))].sort(),streamSeries:parsed.streamSeries.map(x=>({discipline:x.discipline,stream:x.stream,dates:x.dates,startTime:x.startTime,endTime:x.endTime,blocker:x.warning})),electiveRoster:parsed.electiveRoster,diagnostics:parsed.diagnostics,blockers:parsed.blockers.map(x=>x.warning),qaCandidateEvents:candidate.events.length,inputQa:prepared.inputQa.publishable,outputQa:prepared.outputQa.publishable,productionGate:productionError.code,publishable:false};
await fs.writeFile(path.join(inputDir,'medicine6-lecture-diagnostic.json'),`${JSON.stringify(summary,null,2)}\n`);
console.log('IZHGMU_LECTURE_MEDICINE6_REAL',JSON.stringify(summary));

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';

function arg(name, fallback = null) { const i=process.argv.indexOf(name); return i>=0 ? process.argv[i+1] : fallback; }
const norm=(v)=>String(v??'').replace(/\s+/g,' ').trim();
const low=(v)=>norm(v).toLowerCase().replace(/ё/g,'е');
const inputDir=path.resolve(arg('--input-dir','/tmp/izhgmu-current'));

const MONTHS=new Map([['февраль',2],['март',3],['апрель',4],['май',5]]);
const WEEKDAYS=new Map([['понедельник',1],['вторник',2],['среда',3],['четверг',4],['пятница',5],['суббота',6],['воскресенье',0]]);

function canonicalDiscipline(value){
  const v=low(value).replace(/[.]/g,'');
  if(/^фармак/.test(v)) return 'Фармакология';
  if(/стомат/.test(v)) return 'Стоматология';
  if(/патофиз/.test(v)) return 'Патофизиология';
  if(/общ.*хир/.test(v)) return 'Общая хирургия';
  if(v==='озз'||/обществен.*здоров|организац.*здоров/.test(v)) return 'Общественное здоровье и здравоохранение';
  if(/пат.*анатом/.test(v)) return 'Патологическая анатомия';
  if(/пр.*вн.*бол|пропед.*внут/.test(v)) return 'Пропедевтика внутренних болезней';
  return null;
}
function isPhysicalCulture(value){ return /физическ.*культур/.test(low(value)); }
function seq(a,b){ return Array.from({length:b-a+1},(_,i)=>String(a+i)); }
function physicalAudience(value){
  const v=low(value);
  if(/все\s*3\s*поток/.test(v)) return {kind:'russian_all_streams',groups:seq(301,326)};
  if(/1\s*поток/.test(v)&&/301/.test(v)&&/310/.test(v)) return {kind:'russian_stream_1',groups:seq(301,310)};
  if(/2\s*поток/.test(v)&&/311/.test(v)&&/318/.test(v)) return {kind:'russian_stream_2',groups:seq(311,318)};
  if(/3\s*поток/.test(v)&&/319/.test(v)&&/326/.test(v)) return {kind:'russian_stream_3',groups:seq(319,326)};
  if(/англ|350\d/.test(v)) return {kind:'english_explicit',groups:[]};
  return null;
}
function pairIndex(pairs){
  const map=new Map();
  for(const pair of pairs){
    for(const series of pair.series){
      for(const date of series.dates){
        const key=`${series.discipline}\u0000${date}`;
        if(!map.has(key)) map.set(key,[]);
        map.get(key).push(pair.groupSpan);
      }
    }
  }
  return map;
}
function groupsFromPairs(spans){
  const groups=[];
  for(const span of spans){
    const m=String(span).match(/^(\d+)-(\d+)$/); if(!m) continue;
    groups.push(...seq(Number(m[1]),Number(m[2])));
  }
  return [...new Set(groups)];
}
function isoDate(year,month,day){
  const d=new Date(Date.UTC(year,month-1,day));
  if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day) return null;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function utcWeekday(iso){ return new Date(`${iso}T00:00:00Z`).getUTCDay(); }

const report=JSON.parse(await fs.readFile(path.join(inputDir,'download-report.json'),'utf8'));
const cycles=JSON.parse(await fs.readFile(path.join(inputDir,'medicine3-legacy-cycle.json'),'utf8'));
if(cycles.parserVersion!=='izhgmu-medicine3-legacy-cycle-v2') throw new Error(`medicine-3 cycle parser v2 required, got ${cycles.parserVersion}`);
const source=report.files.find((x)=>x.status==='downloaded'&&x.faculty==='medicine'&&Number(x.course)===3&&x.language==='ru'&&x.term==='spring'&&x.sourceKind==='lecture');
if(!source) throw new Error('medicine-3 lecture source missing');
const bytes=await fs.readFile(path.join(inputDir,source.filename));
if(crypto.createHash('sha256').update(bytes).digest('hex')!==source.sha256) throw new Error('lecture SHA mismatch');
const structure=await readIzhgmuXlsxStructure(bytes);
if(structure.sheets.length!==1) throw new Error(`expected one medicine-3 lecture sheet, got ${structure.sheets.length}`);
const sheet=structure.sheets[0];
const year=Number(String(cycles.period.start_date).slice(0,4));
const rusIndex=pairIndex(cycles.groupPairs);
const engIndex=pairIndex(cycles.englishGroupPairs);
const allRussianGroups=seq(301,326);
const perGroup=Object.fromEntries(allRussianGroups.map((g)=>[g,[]]));

const byRow=new Map();
for(const cell of sheet.cells){
  if(!byRow.has(cell.row)) byRow.set(cell.row,[]);
  byRow.get(cell.row).push(cell);
}
const cellAt=(cells,col)=>cells.find((c)=>c.col===col);
const monthHeaders=[...MONTHS.entries()].flatMap(([name,month])=>sheet.cells.filter((c)=>c.row===6&&low(c.value)===name).map((c)=>({col:c.col,month,name})) ).sort((a,b)=>a.col-b.col);
if(monthHeaders.length!==4||monthHeaders.map((x)=>x.month).join(',')!=='2,3,4,5') throw new Error(`medicine-3 lecture month headers unexpected: ${JSON.stringify(monthHeaders)}`);
function monthForCol(col){
  let found=null;
  for(const h of monthHeaders){ if(h.col<=col) found=h; else break; }
  return found?.month??null;
}

const ordinary=[]; const physical=[]; const unresolved=[]; const rowAudits=[];
let currentDay=null;
for(const row of [...byRow.keys()].filter((r)=>r>=7).sort((a,b)=>a-b)){
  const cells=byRow.get(row).slice().sort((a,b)=>a.col-b.col);
  const dayCell=cellAt(cells,1); const explicitDay=low(dayCell?.value);
  if(WEEKDAYS.has(explicitDay)) currentDay=explicitDay;
  const disciplineRaw=norm(cellAt(cells,3)?.value);
  if(!disciplineRaw) continue;
  const time=norm(cellAt(cells,2)?.value)||null;
  const location=norm(cellAt(cells,4)?.value)||null;
  const dateCells=cells.filter((c)=>c.col>=5&&c.col<=22&&/^\d{1,2}$/.test(norm(c.value)));
  const declaredRaw=norm(cellAt(cells,23)?.value);
  const declaredCount=/^\d+$/.test(declaredRaw)?Number(declaredRaw):null;
  if(declaredCount!==null&&declaredCount!==dateCells.length){
    unresolved.push({kind:'lecture_count_mismatch',row,disciplineRaw,declaredCount,dateCellCount:dateCells.length,sourceRef:`${sheet.name}!W${row}`});
  }
  const canonical=canonicalDiscipline(disciplineRaw);
  const phys=isPhysicalCulture(disciplineRaw);
  if(!canonical&&!phys){
    unresolved.push({kind:'lecture_unknown_discipline',row,disciplineRaw,sourceRef:`${sheet.name}!C${row}`});
    continue;
  }
  const physAudience=phys?physicalAudience(disciplineRaw):null;
  if(phys&&!physAudience){
    unresolved.push({kind:'physical_culture_audience_unresolved',row,disciplineRaw,sourceRef:`${sheet.name}!C${row}`});
  }
  const audit={row,day:currentDay,disciplineRaw,discipline:canonical,time,location,declaredCount,dateCellCount:dateCells.length,classifications:{}};
  for(const cell of dateCells){
    const month=monthForCol(cell.col); const day=Number(norm(cell.value)); const iso=month?isoDate(year,month,day):null;
    if(!iso){
      unresolved.push({kind:'lecture_date_invalid',row,ref:cell.ref,value:norm(cell.value),month});
      continue;
    }
    if(!currentDay||utcWeekday(iso)!==WEEKDAYS.get(currentDay)){
      unresolved.push({kind:'lecture_date_weekday_mismatch',row,ref:cell.ref,date:iso,sourceWeekday:currentDay,disciplineRaw});
      audit.classifications.weekdayMismatch=(audit.classifications.weekdayMismatch||0)+1;
      continue;
    }
    if(phys){
      if(!physAudience) continue;
      const item={kind:'physical_culture',row,ref:cell.ref,date:iso,discipline:'Физическая культура и спорт',disciplineRaw,time,location,audience:physAudience.kind,russianGroups:physAudience.groups};
      physical.push(item);
      for(const group of physAudience.groups){ if(perGroup[group]) perGroup[group].push(item); }
      audit.classifications[physAudience.kind]=(audit.classifications[physAudience.kind]||0)+1;
      continue;
    }
    const key=`${canonical}\u0000${iso}`;
    const russianPairs=rusIndex.get(key)||[]; const englishPairs=engIndex.get(key)||[];
    let classification='neither';
    if(russianPairs.length&&englishPairs.length) classification='russian_and_english';
    else if(russianPairs.length) classification='russian_only';
    else if(englishPairs.length) classification='english_only';
    const russianGroups=groupsFromPairs(russianPairs); const englishGroups=groupsFromPairs(englishPairs);
    const item={kind:'ordinary_lecture',row,ref:cell.ref,date:iso,discipline:canonical,disciplineRaw,time,location,fillId:cell.fillId??null,styleId:cell.styleId??null,classification,russianPairs,englishPairs,russianGroups,englishGroups};
    ordinary.push(item);
    audit.classifications[classification]=(audit.classifications[classification]||0)+1;
    for(const group of russianGroups){ if(perGroup[group]) perGroup[group].push(item); }
    if(classification==='neither') unresolved.push({kind:'lecture_audience_no_cycle_match',...item});
  }
  rowAudits.push(audit);
}

for(const group of Object.keys(perGroup)) perGroup[group].sort((a,b)=>a.date.localeCompare(b.date)||String(a.time).localeCompare(String(b.time))||a.ref.localeCompare(b.ref));
const counts={};
for(const item of ordinary) counts[item.classification]=(counts[item.classification]||0)+1;
const unresolvedKinds={};
for(const item of unresolved) unresolvedKinds[item.kind]=(unresolvedKinds[item.kind]||0)+1;
const perGroupCounts=Object.fromEntries(Object.entries(perGroup).map(([g,events])=>[g,events.length]));
const out={
  profile:'IZH-MEDICINE3-LECTURE-AUDIENCE',
  verifierVersion:'izhgmu-medicine3-lecture-audience-v1',
  source:{filename:source.filename,sha256:source.sha256,sheet:sheet.name},
  cycleParserVersion:cycles.parserVersion,
  method:'audience is cross-checked against exact same-date same-discipline cycle occupancy; physical-culture Russian streams use explicit source labels',
  ordinary,
  physical,
  unresolved,
  rowAudits,
  perRussianGroup:perGroup,
  stats:{ordinaryDateCells:ordinary.length,physicalDateCells:physical.length,classifications:counts,unresolvedKinds,perRussianGroupCounts:perGroupCounts},
  publishable:false,
  blockers:[
    {kind:'time_semantics_pending',message:'Practice parenthesized time variants remain unresolved.'},
    ...(unresolved.length?[{kind:'lecture_source_review_required',count:unresolved.length,byKind:unresolvedKinds}]:[]),
  ],
};
await fs.writeFile(path.join(inputDir,'medicine3-lecture-audience.json'),`${JSON.stringify(out,null,2)}\n`);
console.log('IZHGMU_MEDICINE3_LECTURE_AUDIENCE',JSON.stringify({ordinaryDateCells:ordinary.length,physicalDateCells:physical.length,classifications:counts,unresolvedKinds,perRussianGroupCounts:perGroupCounts,publishable:false}));

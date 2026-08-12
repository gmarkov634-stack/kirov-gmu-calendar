import { createHash } from 'node:crypto';

const WEEKDAYS = new Map([
  ['пн',1],['понедельник',1],['вт',2],['вторник',2],['ср',3],['среда',3],
  ['чт',4],['четверг',4],['пт',5],['пятница',5],['сб',6],['суббота',6],
]);

const BUILDINGS = {
  '1': { building: '1 корпус', address: 'ул. Владимирская, 137' },
  '2': { building: '2 корпус', address: 'ул. Пролетарская, 38' },
  '3': { building: '3 корпус', address: 'ул. Владимирская, 112' },
};

const SUBJECTS = [
  { canonical:'Коммуникативная грамматика русского языка (факультатив)', aliases:[/коммуникативная\s+грамматика\s+русского\s+языка(?:\s*\(факультатив\))?/i] },
  { canonical:'Учебная практика. Ознакомительная. Общий уход', aliases:[/учебная\s+практика\.\s*озн[ао]комительная\.\s*общий\s+уход/i] },
  { canonical:'Иностранный язык (русский язык)', aliases:[/иностранный\s+язык\s*\(русский(?:\s+язык)?\)/i] },
  { canonical:'Элективные дисциплины по физической культуре и спорту', aliases:[/элективные\s+дисциплины(?:\s*\(модули\))?\s+по\s+физической\s+культуре\s+и\s+спорту/i] },
  { canonical:'Гистология, эмбриология, цитология', aliases:[/гистология\s*,\s*эмбриология\s*,\s*цитология/i] },
  { canonical:'Общая и биоорганическая химия', aliases:[/(?:общая\s+и\s+биоорганическая|общая\s+биоорганическая)\s+химия/i] },
  { canonical:'Медицинская информатика', aliases:[/медицинская\s+информатика/i] },
  { canonical:'Медицинская биология', aliases:[/медицинская\s+биология/i] },
  { canonical:'Физика, математика', aliases:[/физика\s*,\s*математика/i] },
  { canonical:'Латинский язык', aliases:[/латинский(?:\s+язык)?/i] },
  { canonical:'История России', aliases:[/история\s+россии/i] },
  { canonical:'Анатомия', aliases:[/анатомия/i] },
  { canonical:'Час куратора', aliases:[/час\s+куратора/i] },
];

const TIME = String.raw`\d{1,2}[.:]\d{2}\s*-\s*\d{1,2}[.:]\d{2}`;
const TIME_SINGLE_RE = new RegExp(String.raw`(?<!\d)(\d{1,2})[.:](\d{2})\s*-\s*(\d{1,2})[.:](\d{2})(?!\d)`, 'g');
const TIME_GROUP_RE = new RegExp(String.raw`(?<!\d)(?:${TIME})(?:\s*,\s*${TIME})*`, 'g');
const DATE_RANGE_RE = /(?<!\d)(\d{1,2})\.(\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})(?!\d)/g;
const DATE_TOKEN_RE = /(?<!\d)(\d{1,2})\.(\d{2})(?!\d)/g;
const DATE_WITH_TIME_RE = new RegExp(String.raw`(?<!\d)(\d{1,2})\.(\d{2})(\s*[-–]\s*|\s+)((?:${TIME})(?:\s*,\s*${TIME})*)`, 'g');
const PERIOD_RE = /(\d{1,2})\.(\d{2})\.(20\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})(?:\.|-)(20\d{2})/g;

function clean(value){return String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();}
function pad(n){return String(n).padStart(2,'0');}
function iso(year,month,day){return `${year}-${pad(month)}-${pad(day)}`;}
function toDateTime(date,time){return `${date}T${time}:00+03:00`;}
function dateObj(year,month,day){const d=new Date(Date.UTC(year,month-1,day));if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;return d;}
function validDatePart(day,month,year=2026){return Boolean(dateObj(year,month,day));}
function weekdayIso(date){const n=date.getUTCDay();return n===0?7:n;}
function spansOverlap(a,b){return a[0]<b[1]&&b[0]<a[1];}
function addDays(date,days){const d=new Date(date);d.setUTCDate(d.getUTCDate()+days);return d;}
function dateKey(date){return iso(date.getUTCFullYear(),date.getUTCMonth()+1,date.getUTCDate());}

function groupCode(value){
  const m=clean(value).match(/^(?:группа|гр\.?)\s*(\d{3})\s*([иi])?\s*$/i);
  if(!m)return null;
  return `${m[1]}${m[2]?'и':''}`;
}

function subjectMatches(text){
  const out=[];
  for(const subject of SUBJECTS){
    for(const re of subject.aliases){
      for(const m of text.matchAll(new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g'))){
        out.push({index:m.index,end:m.index+m[0].length,canonical:subject.canonical,raw:m[0]});
      }
    }
  }
  return out.sort((a,b)=>a.index-b.index||(b.end-b.index)-(a.end-a.index))
    .filter((m,i,arr)=>!arr.slice(0,i).some(x=>m.index>=x.index&&m.end<=x.end));
}

function validTimeParts(parts){const [sh,sm,eh,em]=parts.map(Number);return sh<=23&&eh<=23&&sm<=59&&em<=59;}
function timeSingles(raw){
  const out=[];
  for(const m of String(raw).matchAll(new RegExp(TIME_SINGLE_RE.source,'g'))){
    const parts=[m[1],m[2],m[3],m[4]];
    if(validTimeParts(parts))out.push({start:`${pad(parts[0])}:${pad(parts[1])}`,end:`${pad(parts[2])}:${pad(parts[3])}`});
  }
  return out;
}
function correctTimeGroup(raw){
  const norm=clean(raw);
  if(norm==='15.30-17.00, 14.10-17.55')return {time:{start:'15:30',end:'17:55'},note:'G08: исправлено 14.10 → 17.10 во второй паре времени'};
  const parts=timeSingles(raw);if(!parts.length)return null;
  return {time:{start:parts[0].start,end:parts.at(-1).end},note:null};
}
function validTimeGroupMatches(text){
  const out=[];
  for(const m of text.matchAll(new RegExp(TIME_GROUP_RE.source,'g'))){
    const parsed=correctTimeGroup(m[0]);if(!parsed)continue;
    out.push({start:m.index,end:m.index+m[0].length,raw:m[0],...parsed});
  }
  return out;
}

function segmentStarts(text){
  const subjects=subjectMatches(text),times=validTimeGroupMatches(text),result=[];
  let previousBoundary=0;
  for(const sub of subjects){
    const candidates=times.filter(t=>t.start>=previousBoundary&&t.end<=sub.index);
    if(!candidates.length){previousBoundary=sub.end;continue;}
    const t=candidates.at(-1),between=text.slice(t.end,sub.index);
    result.push({start:t.start,subjectStart:sub.index,subjectEnd:sub.end,subject:sub.canonical,lecture:/лекц/i.test(between),timeRaw:t.raw,defaultTime:t.time,defaultNote:t.note});
    previousBoundary=sub.end;
  }
  return result.map((s,i)=>({...s,end:result[i+1]?.start??text.length,raw:text.slice(s.start,result[i+1]?.start??text.length),tailStart:s.subjectEnd-s.start}));
}

function parsePeriodWindows(sheet){
  const windows=[];
  for(const cell of sheet.cells||[]){
    const text=clean(cell.value);
    for(const m of text.matchAll(new RegExp(PERIOD_RE.source,'g'))){
      const [sd,sm,sy,ed,em,ey]=[m[1],m[2],m[3],m[4],m[5],m[6]].map(Number);
      const start=dateObj(sy,sm,sd),end=dateObj(ey,em,ed);if(start&&end&&end>=start)windows.push({start,end});
    }
    if(windows.length)break;
  }
  return windows;
}

function rangeDates(start,end,weekday){
  const out=[];for(let d=new Date(start);d<=end;d=addDays(d,1))if(weekdayIso(d)===weekday)out.push(dateKey(d));return out;
}

function mergeContaining(sheet,row,col){return (sheet.merges||[]).find(m=>m.startRow<=row&&row<=m.endRow&&m.startCol<=col&&col<=m.endCol)||null;}
function valueAt(sheet,row,col){
  const merge=mergeContaining(sheet,row,col),r=merge?.startRow??row,c=merge?.startCol??col;
  return (sheet.cells||[]).find(cell=>cell.row===r&&cell.col===c)?.value??null;
}

function findGroupHeader(sheet){
  const rows=new Map();for(const c of sheet.cells||[]){if(!rows.has(c.row))rows.set(c.row,[]);rows.get(c.row).push(c);}
  let best=null;
  for(const [row,cells] of rows){const groups=cells.map(c=>{const code=groupCode(c.value);return code?{code,col:c.col}:null;}).filter(Boolean);if(!best||groups.length>best.groups.length)best={row,groups};}
  return best;
}

function initialWeekdays(sheet,startRow,endRow){
  const map=new Map();
  for(const c of (sheet.cells||[]).filter(c=>c.col===1)){
    const wd=WEEKDAYS.get(clean(c.value).toLowerCase());if(!wd)continue;
    const merge=mergeContaining(sheet,c.row,1),a=merge?.startRow??c.row,b=merge?.endRow??c.row;
    for(let row=Math.max(a,startRow);row<=Math.min(b,endRow);row++)map.set(row,wd);
  }
  return map;
}

function canonicalSubject(value){const text=clean(value);const m=subjectMatches(text);return m[0]?.canonical||null;}
function normalizeAssessment(value){const s=clean(value).toLowerCase();if(!s)return null;if(s.includes('экзамен'))return 'экзамен';if(s.includes('с оценкой'))return 'зачет с оценкой';if(s.includes('зач'))return 'зачёт';return clean(value);}
function locationFromReference(text,subject){
  const t=clean(text);if(!t)return '';
  if(/центр онкологии и медицинской радиологии/i.test(t))return 'КОГБУЗ «Центр онкологии и медицинской радиологии», пр. Строителей, 23';
  if(/фок/i.test(t))return 'ФОК, ул. Владимирская, 112';
  if(subject==='Иностранный язык (русский язык)'&&/красноармейская/i.test(t)&&/владимирская/i.test(t))return '1 корпус, ул. Владимирская, 137 / ул. Красноармейская, 35';
  if(/(?:класс|аудитори\w*)\s*№?\s*414/i.test(t)&&/3\s*корпус/i.test(t))return '3 корпус, аудитория 414, ул. Владимирская, 112';
  const b=t.match(/([123])\s*корпус/i);if(b)return `${b[1]} корпус, ${BUILDINGS[b[1]].address}`;
  const addr=t.match(/ул\.\s*(Владимирская|Пролетарская|Красноармейская)\s*,?\s*(\d+)/i);if(addr)return `ул. ${addr[1]}, ${addr[2]}`;
  return '';
}

function footerMeta(sheet,footerRow){
  const meta=new Map();
  for(let row=footerRow+1;row<=footerRow+8;row++){
    const left=canonicalSubject(valueAt(sheet,row,1))||canonicalSubject(valueAt(sheet,row,2));
    if(left){const dept=clean(valueAt(sheet,row,3)),assessment=normalizeAssessment(valueAt(sheet,row,4));meta.set(left,{assessment,location:locationFromReference(dept,left)});}
    const right=canonicalSubject(valueAt(sheet,row,5))||canonicalSubject(valueAt(sheet,row,6))||canonicalSubject(valueAt(sheet,row,7));
    if(right&&!meta.has(`right:${right}`)){
      const dept=clean(valueAt(sheet,row,8)),base=clean(valueAt(sheet,row,9))||clean(valueAt(sheet,row,10)),assessment=normalizeAssessment(valueAt(sheet,row,11));
      meta.set(right,{assessment,location:locationFromReference(base,right)||locationFromReference(dept,right)});meta.set(`right:${right}`,true);
    }
  }
  for(const key of [...meta.keys()])if(String(key).startsWith('right:'))meta.delete(key);
  return meta;
}

function tokenizeTail(text,year){
  const combos=[],blocked=[];
  for(const m of text.matchAll(new RegExp(DATE_WITH_TIME_RE.source,'g'))){
    const d=Number(m[1]),mo=Number(m[2]);if(!validDatePart(d,mo,year))continue;const parsed=correctTimeGroup(m[4]);if(!parsed)continue;
    const dateStart=m.index,dateEnd=m.index+m[1].length+1+m[2].length;
    combos.push({kind:'date',start:dateStart,end:dateEnd,raw:`${m[1]}.${m[2]}`,date:iso(year,mo,d),override:parsed.time,propagateBackward:!/[–-]/.test(m[3]),comboSpan:[m.index,m.index+m[0].length]});blocked.push([m.index,m.index+m[0].length]);
  }
  const times=[];
  for(const m of text.matchAll(new RegExp(TIME_GROUP_RE.source,'g'))){
    const span=[m.index,m.index+m[0].length];if(blocked.some(b=>spansOverlap(span,b)))continue;const singles=timeSingles(m[0]);if(!singles.length)continue;
    if(singles.length===1){const raw=[...m[0].matchAll(new RegExp(TIME_SINGLE_RE.source,'g'))][0];const [a,b,c,d]=[raw[1],raw[2],raw[3],raw[4]].map(Number);if(validDatePart(a,b,year)&&validDatePart(c,d,year))continue;}
    const parsed=correctTimeGroup(m[0]);times.push({start:m.index,end:m.index+m[0].length,raw:m[0],...parsed});
  }
  const timeSpans=times.map(t=>[t.start,t.end]),ranges=[];
  for(const m of text.matchAll(new RegExp(DATE_RANGE_RE.source,'g'))){
    const span=[m.index,m.index+m[0].length];if([...blocked,...timeSpans].some(b=>spansOverlap(span,b)))continue;
    const [sd,sm,ed,em]=[m[1],m[2],m[3],m[4]].map(Number);if(!validDatePart(sd,sm,year)||!validDatePart(ed,em,year))continue;
    ranges.push({kind:'range',start:m.index,end:m.index+m[0].length,raw:m[0],startDate:iso(year,sm,sd),endDate:iso(year,em,ed)});
  }
  const rangeSpans=ranges.map(r=>[r.start,r.end]),dates=[...combos];
  for(const m of text.matchAll(new RegExp(DATE_TOKEN_RE.source,'g'))){
    const span=[m.index,m.index+m[0].length];if([...blocked,...timeSpans,...rangeSpans].some(b=>spansOverlap(span,b)))continue;
    const d=Number(m[1]),mo=Number(m[2]);if(validDatePart(d,mo,year))dates.push({kind:'date',start:m.index,end:m.index+m[0].length,raw:m[0],date:iso(year,mo,d),override:null,propagateBackward:false});
  }
  return {items:[...ranges,...dates].sort((a,b)=>a.start-b.start),times};
}

function groupDateItems(text,items){
  const groups=[];let i=0;
  while(i<items.length){const group=[items[i]];let j=i+1;while(j<items.length){const previous=group.at(-1),prevEnd=previous.comboSpan?.[1]??previous.end;const between=text.slice(prevEnd,items[j].start);if(/^[\s,()]*$/.test(between)){group.push(items[j]);j++;}else break;}groups.push(group);i=j;}
  return groups;
}

function assignTimes(text,group,times,defaultTime){
  const result=group.map(()=>defaultTime);
  group.forEach((item,i)=>{if(!item.override)return;result[i]=item.override;if(item.propagateBackward){for(let j=i-1;j>=0;j--){if(group[j].kind!=='date')break;const between=text.slice(group[j].end,group[j+1].start);if(!/^[\s,]*$/.test(between))break;result[j]=item.override;}}});
  const start=group[0].start,end=Math.max(...group.map(item=>item.comboSpan?.[1]??item.end));
  const before=times.filter(t=>t.end<=start).at(-1),after=times.find(t=>t.start>=end);
  const beforeOk=before&&/^[\s\-–,:;()]*$/.test(text.slice(before.end,start));const afterOk=after&&/^[\s\-–,:()]*$/.test(text.slice(end,after.start));
  const alt=beforeOk?before.time:(afterOk?after.time:null);if(alt)for(let i=0;i<result.length;i++)if(result[i]===defaultTime)result[i]=alt;
  return result;
}

function explicitLocations(clause){
  const out=[];
  const full=/(?:(?<b>[123])\s*корпус\s*,?\s*)?аудитори[яи]\s*(?<room>\d{3})\s*,?\s*ул\.\s*(?<street>Владимирская|Пролетарская|Красноармейская)\s*,?\s*(?<num>\d+)/gi;
  for(const m of clause.matchAll(full)){let b=m.groups.b;if(!b){if(m.groups.street.toLowerCase().startsWith('влад')&&m.groups.num==='137')b='1';else if(m.groups.street.toLowerCase().startsWith('пролет')&&m.groups.num==='38')b='2';else if(m.groups.street.toLowerCase().startsWith('влад')&&m.groups.num==='112')b='3';}out.push({start:m.index,end:m.index+m[0].length,location:`${b?`${b} корпус, `:''}аудитория ${m.groups.room}, ул. ${m.groups.street}, ${m.groups.num}`});}
  for(const m of clause.matchAll(/(?<!\d)([123])\s*-\s*(\d{3})(?!\d)/g)){const span=[m.index,m.index+m[0].length];if(out.some(x=>spansOverlap(span,[x.start,x.end])))continue;out.push({start:m.index,end:m.index+m[0].length,location:`${m[1]} корпус, аудитория ${m[2]}, ${BUILDINGS[m[1]].address}`});}
  return out.sort((a,b)=>a.start-b.start);
}
function locationForGroup(group,locations,fallback){if(!locations.length)return fallback;const end=Math.max(...group.map(item=>item.comboSpan?.[1]??item.end));return locations.find(l=>l.start>=end)?.location??locations.at(-1).location;}

function excludedDates(clause,year){const set=new Set();for(const m of clause.matchAll(/кроме\s+(\d{1,2})\.(\d{2})/gi)){const d=Number(m[1]),mo=Number(m[2]);if(validDatePart(d,mo,year))set.add(iso(year,mo,d));}return set;}
function isExcludedOccurrence(clause,item){return item.kind==='date'&&new RegExp(`кроме\\s+${item.raw.replace('.','\\.')}`,'i').test(clause);}
function isControl(clause,item,items){
  const normalized=clause.toLowerCase().replaceAll('ё','е'),phrase='зачет с оценкой';let pos=normalized.indexOf(phrase);if(pos<0)return false;
  while(pos>=0){if(pos<=item.start&&item.start-pos<=70&&!items.some(x=>x!==item&&x.start>pos&&x.start<item.start))return true;pos=normalized.indexOf(phrase,pos+1);}
  if(item===items.at(-1)){pos=normalized.indexOf(phrase);while(pos>=0){if(pos>=item.end&&pos-item.end<=70)return true;pos=normalized.indexOf(phrase,pos+1);}}
  return false;
}

function makeEvent({group,subject,date,start,end,location,assessment,kind,dateMode,sourceCell,sourceRange,note}){
  const title=kind==='lecture'?`ЛЕКЦ. ${subject.toUpperCase()}`:kind==='control'?`ЗАЧЕТ С ОЦЕНКОЙ — ${subject.toUpperCase()}`:subject;
  const hash=createHash('sha1').update([group,date,start,end,title,sourceCell,sourceRange].join('|')).digest('hex').slice(0,16);
  return {id:`kgmu-${group}-${date}-${start.replace(':','')}-${hash}`,group,title,start:toDateTime(date,start),end:toDateTime(date,end),location,assessment:assessment||null,sourceType:'kgmu-xlsx',sourceCell,sourceRange,source:sourceRange,kind,dateMode,note:note||null,subject};
}

function parseSegment(segment,{group,weekday,year,windows,sourceCell,sourceRange,meta}){
  const defaultParsed=correctTimeGroup(segment.timeRaw);if(!defaultParsed)return {events:[],issues:['invalid-default-time']};
  const tail=clean(segment.raw.slice(segment.tailStart)),clauses=tail.split(';').map(clean).filter(Boolean),events=[],issues=[];let hadDates=false;const exclusions=new Set();
  const subjectMeta=meta.get(segment.subject)||{};const fallback=subjectMeta.location||'';
  for(const clause of clauses){for(const d of excludedDates(clause,year))exclusions.add(d);const tokenized=tokenizeTail(clause,year);const items=tokenized.items.filter(item=>!isExcludedOccurrence(clause,item));if(!items.length)continue;hadDates=true;const dateGroups=groupDateItems(clause,items),locations=explicitLocations(clause);
    for(const dateGroup of dateGroups){const times=assignTimes(clause,dateGroup,tokenized.times,defaultParsed.time);dateGroup.forEach((item,index)=>{const control=isControl(clause,item,items),kind=segment.lecture?'lecture':(control?'control':'practical'),location=locationForGroup(dateGroup,locations,fallback);let dates=[];if(item.kind==='date')dates=[item.date];else{const a=new Date(`${item.startDate}T12:00:00Z`),b=new Date(`${item.endDate}T12:00:00Z`);dates=rangeDates(a,b,weekday);}for(const d of dates){if(exclusions.has(d))continue;events.push(makeEvent({group,subject:segment.subject,date:d,start:times[index].start,end:times[index].end,location,assessment:subjectMeta.assessment,kind,dateMode:item.kind,sourceCell,sourceRange,note:defaultParsed.note}));}});}
  }
  if(segment.subject==='Час куратора'&&!hadDates){const possible=[];for(const w of windows)possible.push(...rangeDates(w.start,w.end,weekday));for(const d of possible.filter(d=>!exclusions.has(d)).slice(0,2))events.push(makeEvent({group,subject:'Час куратора',date:d,start:defaultParsed.time.start,end:defaultParsed.time.end,location:'',assessment:null,kind:'curator',dateMode:'derived',sourceCell,sourceRange,note:defaultParsed.note}));}
  else if(!hadDates)issues.push('no-dates');
  return {events,issues};
}

function inferMissingWeekdays(sheet,anchors,weekdays,year){
  const rows=[...new Set(anchors.filter(a=>!weekdays.has(a.row)).map(a=>a.row))];
  for(const row of rows){const evidence=[];for(const anchor of anchors.filter(a=>a.row===row)){for(const segment of segmentStarts(anchor.text)){const tail=clean(segment.raw.slice(segment.tailStart)),{items}=tokenizeTail(tail,year);for(const item of items){if(item.kind==='range'){const a=new Date(`${item.startDate}T12:00:00Z`),b=new Date(`${item.endDate}T12:00:00Z`);if(weekdayIso(a)===weekdayIso(b))evidence.push(weekdayIso(a));}else evidence.push(weekdayIso(new Date(`${item.date}T12:00:00Z`)));}}}const unique=[...new Set(evidence)];if(unique.length===1)weekdays.set(row,unique[0]);}
}

function dedupe(events){const seen=new Set();return events.filter(e=>{const key=[e.group,e.start,e.end,e.title,e.location].join('|');if(seen.has(key))return false;seen.add(key);return true;});}
function resolveSameSourceOverrides(events){const explicit=new Set(events.filter(e=>e.dateMode==='date').map(e=>[e.group,e.start.slice(0,10),e.subject,e.sourceCell].join('|')));return events.filter(e=>!(e.dateMode==='range'&&explicit.has([e.group,e.start.slice(0,10),e.subject,e.sourceCell].join('|'))));}
function findOverlaps(events){const by=new Map(),out=[];for(const e of events){const key=`${e.group}|${e.start.slice(0,10)}`;if(!by.has(key))by.set(key,[]);by.get(key).push(e);}for(const list of by.values()){const sorted=[...list].sort((a,b)=>a.start.localeCompare(b.start));for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){if(sorted[j].start>=sorted[i].end)break;if(sorted[j].start<sorted[i].end&&sorted[i].start<sorted[j].end)out.push({group:sorted[i].group,date:sorted[i].start.slice(0,10),event1:sorted[i].id,event2:sorted[j].id,source1:sorted[i].sourceCell,source2:sorted[j].sourceCell});}}return out;}

function extraLessonExpectations(anchors){
  const out=[],re=/\((\d+)\s+занят(?:ие|ия)\s+(?:в(?:о)?\s*)?(пн|вт|ср|чт|пт|сб)\.?\)/i;
  for(const anchor of anchors){for(const seg of segmentStarts(anchor.text)){const m=seg.raw.match(re);if(!m)continue;for(const group of anchor.groups)out.push({group,subject:seg.subject,count:Number(m[1]),weekday:WEEKDAYS.get(m[2].toLowerCase()),sourceCell:anchor.ref,raw:m[0]});}}
  return out;
}
function validateExtraLessons(events,expectations){return expectations.map(expected=>{const matches=events.filter(e=>e.group===expected.group&&e.subject===expected.subject&&e.kind==='practical'&&e.dateMode==='date'&&weekdayIso(new Date(`${e.start.slice(0,10)}T12:00:00Z`))===expected.weekday&&e.sourceCell!==expected.sourceCell);return {...expected,actual:matches.length,eventIds:matches.map(e=>e.id)};}).filter(x=>x.actual!==x.count);}

function derivePeriod(sheet){const text=(sheet.cells||[]).map(c=>clean(c.value)).join(' ');const y=text.match(/(20\d{2})\s*[-–/]\s*(20\d{2})/);const academicYear=y?`${y[1]}/${y[2].slice(-2)}`:null;const semester=/втор(?:ое|ой)\s+(?:полугодие|семестр)/i.test(text)?2:(/перв(?:ое|ый)\s+(?:полугодие|семестр)/i.test(text)?1:null);return {academicYear,semester};}

export function parseForeignRWorkbook(workbook,{university='kgmu',program='foreign',course=1,academicYear=null,semester=null}={}){
  const sheet=workbook?.sheets?.[0];if(!sheet)throw new Error('Workbook has no sheet');const header=findGroupHeader(sheet);if(!header||header.groups.length<2)throw new Error('Foreign weekly group header not found');
  const footerHeader=(sheet.cells||[]).find(c=>c.col===1&&/^дисциплина(?:\s|\(|$)/i.test(clean(c.value)))?.row;if(!footerHeader)throw new Error('Foreign footer reference not found');
  const startRow=header.row+1,endRow=footerHeader-1,weekdays=initialWeekdays(sheet,startRow,endRow),windows=parsePeriodWindows(sheet);const year=windows[0]?.start?.getUTCFullYear()||2026,meta=footerMeta(sheet,footerHeader),derived=derivePeriod(sheet);
  const anchors=[];
  for(const c of sheet.cells||[]){if(c.row<startRow||c.row>endRow||!header.groups.some(g=>g.col===c.col))continue;const containing=mergeContaining(sheet,c.row,c.col);if(containing&&(containing.startRow!==c.row||containing.startCol!==c.col))continue;const startCol=containing?.startCol??c.col,endCol=containing?.endCol??c.col,groups=header.groups.filter(g=>g.col>=startCol&&g.col<=endCol).map(g=>g.code);if(!groups.length)continue;anchors.push({ref:c.ref,range:containing?.ref||c.ref,row:c.row,col:c.col,groups,text:clean(c.value)});}
  inferMissingWeekdays(sheet,anchors,weekdays,year);for(const a of anchors)a.weekday=weekdays.get(a.row)||null;
  const events=[],uncovered=[];
  for(const anchor of anchors){if(!anchor.weekday){uncovered.push({source:anchor.range,reason:'weekday-not-found',text:anchor.text});continue;}const segments=segmentStarts(anchor.text);if(!segments.length){uncovered.push({source:anchor.range,reason:'segments-not-found',text:anchor.text});continue;}let produced=0;for(const group of anchor.groups)for(const segment of segments){const parsed=parseSegment(segment,{group,weekday:anchor.weekday,year,windows,sourceCell:anchor.ref,sourceRange:anchor.range,meta});events.push(...parsed.events);produced+=parsed.events.length;for(const issue of parsed.issues)uncovered.push({source:anchor.range,reason:issue,subject:segment.subject,text:anchor.text});}if(!produced)uncovered.push({source:anchor.range,reason:'no-events',text:anchor.text});}
  const final=resolveSameSourceOverrides(dedupe(events)),expectations=extraLessonExpectations(anchors),extraLessonFailures=validateExtraLessons(final,expectations),sourceConflicts=findOverlaps(final);
  const byGroup=new Map(header.groups.map(g=>[g.code,[]]));for(const event of final)byGroup.get(event.group)?.push(event);const schedules=header.groups.map(g=>({version:1,university,universityName:'КГМУ',program,course,academicYear:academicYear||derived.academicYear,semester:semester||derived.semester,timezone:'Europe/Moscow',group:{id:`kgmu:${program}:${course}:${g.code}`,code:g.code,displayName:`Группа ${g.code}`},sources:[],events:byGroup.get(g.code).sort((a,b)=>a.start.localeCompare(b.start)||a.title.localeCompare(b.title))}));
  const qa={status:uncovered.length||extraLessonFailures.length||sourceConflicts.length?'REVIEW_REQUIRED':'PASS',sourceAnchorCount:anchors.length,coveredSourceAnchors:anchors.length-uncovered.length,uncovered,extraLessonExpectations:expectations,extraLessonFailures,sourceConflicts,eventCount:final.length,eventCountsByGroup:Object.fromEntries(schedules.map(s=>[s.group.code,s.events.length])),inferredWeekdayRows:[...weekdays.entries()].filter(([row])=>![...(sheet.cells||[])].some(c=>c.col===1&&c.row===row&&WEEKDAYS.has(clean(c.value).toLowerCase()))).map(([row,weekday])=>({row,weekday}))};
  return {schedules,qa};
}

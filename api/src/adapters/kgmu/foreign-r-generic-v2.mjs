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

const STATIC_SUBJECTS = [
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
const TIME_SINGLE_RE = new RegExp(String.raw`(?<!\d)(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})(?!\d)`, 'g');
const DATE_RANGE_RE = /(?<!\d)(\d{1,2})\.(\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})(?!\d)/g;
const DATE_TOKEN_RE = /(?<!\d)(\d{1,2})\.(\d{2})(?!\d)/g;
const DATE_WITH_TIME_RE = new RegExp(String.raw`(?<!\d)(\d{1,2})\.(\d{2})(\s*[-–]\s*|\s+)((?:${TIME})(?:\s*(?:,|[-–])\s*${TIME})*)`, 'g');
const PERIOD_RE = /(\d{1,2})\.(\d{2})\.(20\d{2})(?:\s*\([^)]*\))?\s*[-–]\s*(\d{1,2})\.(\d{2})(?:\.|-)(20\d{2})/g;

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
function escapeRegex(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

function groupCode(value){
  const m=clean(value).match(/^(?:группа|гр\.?)\s*(\d{3})\s*([иi])?\s*$/i);
  if(!m)return null;
  return `${m[1]}${m[2]?'и':''}`;
}

function mergeContaining(sheet,row,col){return (sheet.merges||[]).find(m=>m.startRow<=row&&row<=m.endRow&&m.startCol<=col&&col<=m.endCol)||null;}
function valueAt(sheet,row,col){const merge=mergeContaining(sheet,row,col),r=merge?.startRow??row,c=merge?.startCol??col;return (sheet.cells||[]).find(cell=>cell.row===r&&cell.col===c)?.value??null;}

function normalizeDynamicSubject(value){
  let s=clean(value);
  s=s.replace(/деловой\s+иностранный\s+зык/i,'Деловой иностранный язык');
  if(/элективные\s+дисциплины/i.test(s)&&/физической\s+культуре/i.test(s))s=s.replace(/\s*\(модули\)\s*/i,' ');
  return clean(s);
}

function footerSubjectRanges(sheet,footerRow){
  const out=[];
  for(const cell of (sheet.cells||[]).filter(c=>c.row===footerRow&&/^дисциплина(?:\s|\(|$)/i.test(clean(c.value)))){
    const merge=mergeContaining(sheet,cell.row,cell.col);
    out.push({startCol:merge?.startCol??cell.col,endCol:merge?.endCol??cell.col});
  }
  return out;
}

function footerSubjectNames(sheet,footerRow){
  const ranges=footerSubjectRanges(sheet,footerRow),names=[];
  for(let row=footerRow+1;row<=footerRow+20;row++){
    const rowText=(sheet.cells||[]).filter(c=>c.row===row).map(c=>clean(c.value)).join(' ');
    if(/начальник\s+учебного|декан|проректор|подпис/i.test(rowText))break;
    for(const range of ranges){
      let raw='';
      for(let col=range.startCol;col<=range.endCol;col++){raw=clean(valueAt(sheet,row,col));if(raw)break;}
      if(!raw||/^(зач|экзамен)/i.test(raw)||/кафедр|корпус|ул\.|фок/i.test(raw))continue;
      const normalized=normalizeDynamicSubject(raw);
      if(normalized&&!names.some(x=>x.toLowerCase()===normalized.toLowerCase()))names.push(normalized);
    }
  }
  return names;
}

function dynamicAliases(names){
  const tokenLists=names.map(name=>clean(name.toLowerCase().replace(/[(),.]/g,' ')).split(/\s+/).filter(Boolean));
  return names.map((canonical,index)=>{
    const aliases=[];
    const raw=escapeRegex(canonical).replace(/\\ /g,'\\s+').replace(/\\\(модули\\\)/gi,'(?:\\s*\\(модули\\)\\s*)?');
    aliases.push(new RegExp(raw,'i'));
    const tokens=tokenLists[index];
    const noConjunction=tokens.filter(t=>!['и'].includes(t));
    if(noConjunction.join(' ')!==tokens.join(' '))aliases.push(new RegExp(noConjunction.map(escapeRegex).join('\\s+(?:и\\s+)?'),'i'));
    if(tokens.length>=4){
      const sig=tokens.filter(t=>!['и','по','на','в','с'].includes(t));
      if(sig.length>=2){
        const prefix=sig.slice(0,2).join(' ');
        const unique=tokenLists.filter(list=>list.filter(t=>!['и','по','на','в','с'].includes(t)).slice(0,2).join(' ')===prefix).length===1;
        if(unique)aliases.push(new RegExp(sig.slice(0,2).map(escapeRegex).join('\\s+'),'i'));
      }
    }
    return {canonical,aliases};
  });
}

function buildSubjects(sheet,footerRow){
  const dynamic=dynamicAliases(footerSubjectNames(sheet,footerRow));
  const result=[...STATIC_SUBJECTS];
  for(const item of dynamic){
    const existing=result.find(x=>x.canonical.toLowerCase()===item.canonical.toLowerCase());
    if(existing)existing.aliases=[...existing.aliases,...item.aliases];else result.push(item);
  }
  return result;
}

function subjectMatches(text,subjects){
  const out=[];
  for(const subject of subjects){
    for(const re of subject.aliases){
      for(const m of text.matchAll(new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g')))out.push({index:m.index,end:m.index+m[0].length,canonical:subject.canonical,raw:m[0]});
    }
  }
  return out.sort((a,b)=>a.index-b.index||(b.end-b.index)-(a.end-a.index)).filter((m,i,arr)=>!arr.slice(0,i).some(x=>m.index>=x.index&&m.end<=x.end));
}

function validTimeParts(parts){const [sh,sm,eh,em]=parts.map(Number);return sh<=23&&eh<=23&&sm<=59&&em<=59&&(sh*60+sm)<(eh*60+em);}
function timeSingles(raw){
  const out=[];
  for(const m of String(raw).matchAll(new RegExp(TIME_SINGLE_RE.source,'g'))){const parts=[m[1],m[2],m[3],m[4]];if(validTimeParts(parts))out.push({index:m.index,end:m.index+m[0].length,start:`${pad(parts[0])}:${pad(parts[1])}`,endTime:`${pad(parts[2])}:${pad(parts[3])}`});}
  return out;
}
function correctTimeGroup(raw){
  const norm=clean(raw);
  if(norm==='15.30-17.00, 14.10-17.55')return {time:{start:'15:30',end:'17:55'},note:'G08: исправлено 14.10 → 17.10 во второй паре времени'};
  const parts=timeSingles(raw);if(!parts.length)return null;
  return {time:{start:parts[0].start,end:parts.at(-1).endTime},note:null};
}
function validTimeSequences(text){
  const singles=timeSingles(text),out=[];
  for(let i=0;i<singles.length;i++){
    let j=i;
    while(j+1<singles.length&&/^\s*(?:,|[-–])\s*$/.test(text.slice(singles[j].end,singles[j+1].index)))j++;
    const raw=text.slice(singles[i].index,singles[j].end),parsed=correctTimeGroup(raw);
    if(parsed)out.push({start:singles[i].index,end:singles[j].end,raw,...parsed});
    i=j;
  }
  return out;
}

function segmentStarts(text,subjects){
  const subs=subjectMatches(text,subjects),times=validTimeSequences(text),result=[];let previousBoundary=0;
  for(const sub of subs){
    const candidates=times.filter(t=>t.start>=previousBoundary&&t.end<=sub.index);
    if(!candidates.length){previousBoundary=sub.end;continue;}
    const t=candidates.at(-1),between=text.slice(t.end,sub.index);
    result.push({start:t.start,subjectStart:sub.index,subjectEnd:sub.end,subject:sub.canonical,lecture:/лекц/i.test(between),timeRaw:t.raw,defaultTime:t.time,defaultNote:t.note});previousBoundary=sub.end;
  }
  return result.map((s,i)=>({...s,end:result[i+1]?.start??text.length,raw:text.slice(s.start,result[i+1]?.start??text.length),tailStart:s.subjectEnd-s.start}));
}

function parsePeriodWindows(sheet){
  const windows=[];
  for(const cell of sheet.cells||[]){
    const text=clean(cell.value);
    for(const m of text.matchAll(new RegExp(PERIOD_RE.source,'g'))){const [sd,sm,sy,ed,em,ey]=[m[1],m[2],m[3],m[4],m[5],m[6]].map(Number);const start=dateObj(sy,sm,sd),end=dateObj(ey,em,ed);if(start&&end&&end>=start)windows.push({start,end});}
    if(windows.length)break;
  }
  return windows;
}

function holidayDates(sheet,year){
  const out=new Set();
  for(const cell of sheet.cells||[]){
    const text=clean(cell.value);if(!/праздничные\s+неучебные\s+дни/i.test(text))continue;
    const tail=text.split(/праздничные\s+неучебные\s+дни\s*[-–]?/i).at(-1)||'';
    for(const m of tail.matchAll(new RegExp(DATE_TOKEN_RE.source,'g'))){const d=Number(m[1]),mo=Number(m[2]);if(validDatePart(d,mo,year))out.add(iso(year,mo,d));}
  }
  return out;
}

function rangeDates(start,end,weekday,holidays){const out=[];for(let d=new Date(start);d<=end;d=addDays(d,1)){const key=dateKey(d);if(weekdayIso(d)===weekday&&!holidays.has(key))out.push(key);}return out;}

function serviceWeekWindows(sheet,year){
  const result=new Map([[1,[]],[2,[]]]);
  const source=(sheet.cells||[]).map(c=>clean(c.value)).find(text=>/1\s+неделя/i.test(text)&&/2\s+неделя/i.test(text)&&/праздничные\s+неучебные\s+дни/i.test(text));
  if(!source)return result;
  const one=source.match(/1\s+неделя\s*[-–]\s*([\s\S]*?)\s*2\s+неделя/i)?.[1]||'';
  const two=source.match(/2\s+неделя\s*[-–]\s*([\s\S]*?)\s*праздничные\s+неучебные\s+дни/i)?.[1]||'';
  for(const [num,text] of [[1,one],[2,two]]){
    for(const m of text.matchAll(/(\d{1,2})\.(\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})/g)){
      const a=dateObj(year,Number(m[2]),Number(m[1])),b=dateObj(year,Number(m[4]),Number(m[3]));
      if(a&&b&&b>=a)result.get(num).push({start:a,end:b});
    }
  }
  return result;
}
function weekPatternDates(weekWindows,weekNumber,weekday,cutoff,holidays){
  const out=[];
  for(const window of weekWindows.get(weekNumber)||[]){
    for(let d=new Date(window.start);d<=window.end;d=addDays(d,1)){
      const key=dateKey(d);
      if(weekdayIso(d)===weekday&&!holidays.has(key)&&(!cutoff||key<=cutoff))out.push(key);
    }
  }
  return [...new Set(out)];
}

function findGroupHeader(sheet){
  const rows=new Map();for(const c of sheet.cells||[]){if(!rows.has(c.row))rows.set(c.row,[]);rows.get(c.row).push(c);}
  let best=null;for(const [row,cells] of rows){const groups=cells.map(c=>{const code=groupCode(c.value);return code?{code,col:c.col}:null;}).filter(Boolean);if(!best||groups.length>best.groups.length)best={row,groups};}return best;
}
function initialWeekdays(sheet,startRow,endRow){
  const map=new Map(),markers=[];
  for(const c of (sheet.cells||[]).filter(c=>c.col===1)){
    const wd=WEEKDAYS.get(clean(c.value).toLowerCase());if(!wd)continue;
    const merge=mergeContaining(sheet,c.row,1),a=merge?.startRow??c.row,b=merge?.endRow??c.row;
    markers.push({row:a,end:b,weekday:wd});
    for(let row=Math.max(a,startRow);row<=Math.min(b,endRow);row++)map.set(row,wd);
  }
  markers.sort((a,b)=>a.row-b.row);
  for(let i=0;i+1<markers.length;i++){
    const current=markers[i],next=markers[i+1];
    for(let row=Math.max(current.end+1,startRow);row<Math.min(next.row,endRow+1);row++)map.set(row,current.weekday);
  }
  return map;
}
function canonicalSubject(value,subjects){const text=clean(value);return subjectMatches(text,subjects)[0]?.canonical||null;}
function normalizeAssessment(value){const s=clean(value).toLowerCase();if(!s)return null;if(s.includes('экзамен'))return 'экзамен';if(s.includes('с оценкой'))return 'зачет с оценкой';if(s.includes('зач'))return 'зачёт';return clean(value);}
function locationFromReference(text,subject){
  const t=clean(text);if(!t)return '';
  if(/центр онкологии и медицинской радиологии/i.test(t))return 'КОГБУЗ «Центр онкологии и медицинской радиологии», пр. Строителей, 23';
  if(/фок/i.test(t))return 'ФОК, ул. Владимирская, 112';
  if(subject==='Иностранный язык (русский язык)'&&/красноармейская/i.test(t)&&/владимирская/i.test(t))return '1 корпус, ул. Владимирская, 137 / ул. Красноармейская, 35';
  const b=t.match(/([123])\s*корпус/i);if(b)return `${b[1]} корпус, ${BUILDINGS[b[1]].address}`;
  const addr=t.match(/ул\.\s*(Владимирская|Пролетарская|Красноармейская|К\.?\s*Маркса)\s*,?\s*(\d+)/i);if(addr)return `ул. ${addr[1]}, ${addr[2]}`;
  return '';
}

function footerMeta(sheet,footerRow,subjects){
  const meta=new Map(),ranges=footerSubjectRanges(sheet,footerRow);
  for(let row=footerRow+1;row<=footerRow+20;row++){
    const rowText=(sheet.cells||[]).filter(c=>c.row===row).map(c=>clean(c.value)).join(' ');if(/начальник\s+учебного|декан|проректор/i.test(rowText))break;
    for(const range of ranges){
      let subject=null,subjectCol=null;
      for(let col=range.startCol;col<=range.endCol;col++){subject=canonicalSubject(valueAt(sheet,row,col),subjects);if(subject){subjectCol=col;break;}}
      if(!subject)continue;
      // FIO footer places department/base immediately to the right of the subject region,
      // with assessment in the following column(s). Scan only this row.
      const dept=clean(valueAt(sheet,row,range.endCol+1))||clean(valueAt(sheet,row,range.endCol+2));
      const assessment=normalizeAssessment(valueAt(sheet,row,range.endCol+2))||normalizeAssessment(valueAt(sheet,row,range.endCol+3));
      if(!meta.has(subject))meta.set(subject,{assessment,location:locationFromReference(dept,subject)});
    }
  }
  return meta;
}

function tokenizeTail(text,year){
  const combos=[],blocked=[];
  for(const m of text.matchAll(new RegExp(DATE_WITH_TIME_RE.source,'g'))){const d=Number(m[1]),mo=Number(m[2]);if(!validDatePart(d,mo,year))continue;const parsed=correctTimeGroup(m[4]);if(!parsed)continue;const dateStart=m.index,dateEnd=m.index+m[1].length+1+m[2].length;combos.push({kind:'date',start:dateStart,end:dateEnd,raw:`${m[1]}.${m[2]}`,date:iso(year,mo,d),override:parsed.time,propagateBackward:!/[–-]/.test(m[3]),comboSpan:[m.index,m.index+m[0].length]});blocked.push([m.index,m.index+m[0].length]);}
  const timeSpans=[];for(const t of validTimeSequences(text)){const m=clean(t.raw).match(/^(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})$/);if(m&&validDatePart(Number(m[1]),Number(m[2]),year)&&validDatePart(Number(m[3]),Number(m[4]),year))continue;timeSpans.push([t.start,t.end]);}
  const ranges=[];
  for(const m of text.matchAll(new RegExp(DATE_RANGE_RE.source,'g'))){const span=[m.index,m.index+m[0].length];if([...blocked,...timeSpans].some(b=>spansOverlap(span,b)))continue;const [sd,sm,ed,em]=[m[1],m[2],m[3],m[4]].map(Number);if(!validDatePart(sd,sm,year)||!validDatePart(ed,em,year))continue;ranges.push({kind:'range',start:m.index,end:m.index+m[0].length,raw:m[0],startDate:iso(year,sm,sd),endDate:iso(year,em,ed)});}
  const rangeSpans=ranges.map(r=>[r.start,r.end]),dates=[...combos];
  for(const m of text.matchAll(new RegExp(DATE_TOKEN_RE.source,'g'))){const span=[m.index,m.index+m[0].length];if([...blocked,...timeSpans,...rangeSpans].some(b=>spansOverlap(span,b)))continue;const d=Number(m[1]),mo=Number(m[2]);if(validDatePart(d,mo,year))dates.push({kind:'date',start:m.index,end:m.index+m[0].length,raw:m[0],date:iso(year,mo,d),override:null,propagateBackward:false});}
  return {items:[...ranges,...dates].sort((a,b)=>a.start-b.start),times:validTimeSequences(text)};
}
function groupDateItems(text,items){const groups=[];let i=0;while(i<items.length){const group=[items[i]];let j=i+1;while(j<items.length){const previous=group.at(-1),prevEnd=previous.comboSpan?.[1]??previous.end;const between=text.slice(prevEnd,items[j].start);if(/^[\s,()]*$/.test(between)){group.push(items[j]);j++;}else break;}groups.push(group);i=j;}return groups;}
function assignTimes(text,group,times,defaultTime){
  const result=group.map(()=>defaultTime);group.forEach((item,i)=>{if(!item.override)return;result[i]=item.override;const prefix=text.slice(0,item.start),inParens=prefix.lastIndexOf('(')>prefix.lastIndexOf(')');if(item.propagateBackward||inParens){for(let j=i-1;j>=0;j--){if(group[j].kind!=='date')break;const between=text.slice(group[j].end,group[j+1].start);if(!/^[\s,]*$/.test(between))break;result[j]=item.override;}}});
  const start=group[0].start,end=Math.max(...group.map(item=>item.comboSpan?.[1]??item.end));const before=times.filter(t=>t.end<=start).at(-1),after=times.find(t=>t.start>=end);const beforeOk=before&&/^[\s\-–,:;()]*$/.test(text.slice(before.end,start));const afterOk=after&&/^[\s\-–,:()]*$/.test(text.slice(end,after.start));const alt=beforeOk?before.time:(afterOk?after.time:null);if(alt)for(let i=0;i<result.length;i++)if(result[i]===defaultTime)result[i]=alt;return result;
}
function explicitLocations(clause){
  const out=[],full=/(?:(?<b>[123])\s*корпус\s*,?\s*)?аудитори[яи]\s*(?<room>\d{3})\s*,?\s*ул\.\s*(?<street>Владимирская|Пролетарская|Красноармейская)\s*,?\s*(?<num>\d+)/gi;
  for(const m of clause.matchAll(full)){let b=m.groups.b;if(!b){if(m.groups.street.toLowerCase().startsWith('влад')&&m.groups.num==='137')b='1';else if(m.groups.street.toLowerCase().startsWith('пролет')&&m.groups.num==='38')b='2';else if(m.groups.street.toLowerCase().startsWith('влад')&&m.groups.num==='112')b='3';}out.push({start:m.index,end:m.index+m[0].length,kind:'full',location:`${b?`${b} корпус, `:''}аудитория ${m.groups.room}, ул. ${m.groups.street}, ${m.groups.num}`});}
  for(const m of clause.matchAll(/(?<!\d)([123])\s*-\s*(\d{3})(?!\d)/g)){const span=[m.index,m.index+m[0].length];if(out.some(x=>spansOverlap(span,[x.start,x.end])))continue;out.push({start:m.index,end:m.index+m[0].length,kind:'short',location:`${m[1]} корпус, аудитория ${m[2]}, ${BUILDINGS[m[1]].address}`});}return out.sort((a,b)=>a.start-b.start);
}
function attachedLocation(text,item,locations){
  const end=item.comboSpan?.[1]??item.end;
  return locations.find(loc=>loc.start>=end&&/^\s*[-–]\s*$/.test(text.slice(end,loc.start)))?.location||null;
}
function segmentLocationFallback(text,year,fallback){
  const locations=explicitLocations(text);if(!locations.length)return fallback;
  // A fully written room/address is the segment-level default even when a few
  // concrete dates carry compact room overrides such as 03.03-1-406.
  const full=[...new Set(locations.filter(x=>x.kind==='full').map(x=>x.location))];
  if(full.length===1)return full[0];
  const {items}=tokenizeTail(text,year);
  const generic=locations.filter(loc=>!items.some(item=>{const end=item.comboSpan?.[1]??item.end;return loc.start>=end&&/^\s*[-–]\s*$/.test(text.slice(end,loc.start));}));
  const unique=[...new Set(generic.map(x=>x.location))];
  if(unique.length>1)return '';
  return unique.length===1?unique[0]:fallback;
}

function listDateTimeOverrides(text,year){
  const out=[];
  // Example: (27.02, 06.03-8.00-9.30) means the trailing time applies to
  // every concrete date in that comma-separated override list.
  const re=/\(([^()]*?)(\d{1,2})[.]([0-1]\d)\s*[-–]\s*((?:\d{1,2})[.:]\d{2}\s*[-–]\s*(?:\d{1,2})[.:]\d{2})\s*\)/g;
  for(const m of text.matchAll(re)){
    const before=m[1]||'';
    const lastDay=Number(m[2]),lastMonth=Number(m[3]);
    const parsed=correctTimeGroup(m[4]);if(!parsed||!validDatePart(lastDay,lastMonth,year))continue;
    const parts=[...before.matchAll(/(?<!\d)(\d{1,2})[.](\d{2})(?!\d)/g)].map(x=>[Number(x[1]),Number(x[2])]);
    if(!parts.length)continue;
    parts.push([lastDay,lastMonth]);
    for(const [day,month] of parts)if(validDatePart(day,month,year))out.push({date:iso(year,month,day),time:parsed.time,span:[m.index,m.index+m[0].length]});
  }
  return out;
}
function excludedDates(clause,year){
  const set=new Set();
  for(const m of clause.matchAll(/кроме\s+(\d{1,2})\.(\d{2})/gi)){const d=Number(m[1]),mo=Number(m[2]);if(validDatePart(d,mo,year))set.add(iso(year,mo,d));}
  for(const m of clause.matchAll(/((?:\d{1,2}\.\d{2}\s*,\s*)*\d{1,2}\.\d{2})\s*[-–]?\s*лекци[а-яё]*\s+нет/gi)){
    const dates=[...m[1].matchAll(/(\d{1,2})\.(\d{2})/g)];
    const rest=clause.slice(m.index+m[0].length);
    const laterDate=new RegExp(DATE_TOKEN_RE.source).test(rest);
    const affected=dates.length>1&&!laterDate?dates:dates.slice(-1);
    for(const d of affected){const day=Number(d[1]),month=Number(d[2]);if(validDatePart(day,month,year))set.add(iso(year,month,day));}
  }
  return set;
}
function isExcludedOccurrence(clause,item){if(item.kind!=='date')return false;const raw=item.raw.replace('.','\\.');return new RegExp(`(?:кроме\\s+${raw}|${raw}\\s*[-–]?\\s*лекци\\w*\\s+нет)`,'i').test(clause);}
function isControl(clause,item,items){const normalized=clause.toLowerCase().replaceAll('ё','е'),phrase='зачет с оценкой';let pos=normalized.indexOf(phrase);if(pos<0)return false;while(pos>=0){if(pos<=item.start&&item.start-pos<=70&&!items.some(x=>x!==item&&x.start>pos&&x.start<item.start))return true;pos=normalized.indexOf(phrase,pos+1);}if(item===items.at(-1)){pos=normalized.indexOf(phrase);while(pos>=0){if(pos>=item.end&&pos-item.end<=70)return true;pos=normalized.indexOf(phrase,pos+1);}}return false;}
function makeEvent({group,subject,date,start,end,location,assessment,kind,dateMode,sourceCell,sourceRange,note}){const title=kind==='lecture'?`ЛЕКЦ. ${subject.toUpperCase()}`:kind==='control'?`ЗАЧЕТ С ОЦЕНКОЙ — ${subject.toUpperCase()}`:subject;const hash=createHash('sha1').update([group,date,start,end,title,sourceCell,sourceRange].join('|')).digest('hex').slice(0,16);return {id:`kgmu-${group}-${date}-${start.replace(':','')}-${hash}`,group,title,start:toDateTime(date,start),end:toDateTime(date,end),location,assessment:assessment||null,sourceType:'kgmu-xlsx',sourceCell,sourceRange,source:sourceRange,kind,dateMode,note:note||null,subject};}

function parseSegment(segment,{group,weekday,year,windows,weekWindows,holidays,sourceCell,sourceRange,meta}){
  const defaultParsed=correctTimeGroup(segment.timeRaw);if(!defaultParsed)return {events:[],issues:['invalid-default-time']};const tail=clean(segment.raw.slice(segment.tailStart)),clauses=tail.split(';').map(clean).filter(Boolean),events=[],issues=[];let hadDates=false;const exclusions=new Set();const subjectMeta=meta.get(segment.subject)||{},footerFallback=subjectMeta.location||'',fallback=segmentLocationFallback(tail,year,footerFallback);
  for(const clause of clauses){
    for(const d of excludedDates(clause,year))exclusions.add(d);
    const locations=explicitLocations(clause);
    const weekMatches=[...clause.matchAll(/([12])\s+недел[яи]\s+по\s+(\d{1,2})\.(\d{2})/gi)];
    const weekSpans=weekMatches.map(m=>[m.index,m.index+m[0].length]);
    for(const m of weekMatches){
      const cutoff=validDatePart(Number(m[2]),Number(m[3]),year)?iso(year,Number(m[3]),Number(m[2])):null;
      if(!cutoff)continue;
      hadDates=true;
      const kind=segment.lecture?'lecture':'practical';
      for(const d of weekPatternDates(weekWindows,Number(m[1]),weekday,cutoff,holidays)){
        if(exclusions.has(d))continue;
        events.push(makeEvent({group,subject:segment.subject,date:d,start:defaultParsed.time.start,end:defaultParsed.time.end,location:fallback,assessment:subjectMeta.assessment,kind,dateMode:'week-pattern',sourceCell,sourceRange,note:defaultParsed.note}));
      }
    }
    const listOverrides=listDateTimeOverrides(clause,year);
    for(const override of listOverrides){
      hadDates=true;if(exclusions.has(override.date))continue;
      const kind=segment.lecture?'lecture':'practical';
      events.push(makeEvent({group,subject:segment.subject,date:override.date,start:override.time.start,end:override.time.end,location:fallback,assessment:subjectMeta.assessment,kind,dateMode:'explicit-date',sourceCell,sourceRange,note:defaultParsed.note}));
    }
    const tokenized=tokenizeTail(clause,year);
    const items=tokenized.items.filter(item=>!weekSpans.some(span=>spansOverlap([item.start,item.end],span))&&!listOverrides.some(x=>spansOverlap([item.start,item.comboSpan?.[1]??item.end],x.span))&&!isExcludedOccurrence(clause,item));
    if(!items.length)continue;
    hadDates=true;const dateGroups=groupDateItems(clause,items);
    for(const dateGroup of dateGroups){const times=assignTimes(clause,dateGroup,tokenized.times,defaultParsed.time);dateGroup.forEach((item,index)=>{const control=isControl(clause,item,items),kind=segment.lecture?'lecture':(control?'control':'practical'),location=attachedLocation(clause,item,locations)||fallback;let dates=[];if(item.kind==='date')dates=[item.date];else{const a=new Date(`${item.startDate}T12:00:00Z`),b=new Date(`${item.endDate}T12:00:00Z`);dates=rangeDates(a,b,weekday,holidays);}for(const d of dates){if(exclusions.has(d))continue;events.push(makeEvent({group,subject:segment.subject,date:d,start:times[index].start,end:times[index].end,location,assessment:subjectMeta.assessment,kind,dateMode:item.kind==='date'?'explicit-date':'range',sourceCell,sourceRange,note:defaultParsed.note}));}});}
  }
  if(segment.subject==='Час куратора'&&!hadDates){const possible=[];for(const w of windows)possible.push(...rangeDates(w.start,w.end,weekday,holidays));for(const d of possible.filter(d=>!exclusions.has(d)).slice(0,2))events.push(makeEvent({group,subject:'Час куратора',date:d,start:defaultParsed.time.start,end:defaultParsed.time.end,location:'',assessment:null,kind:'curator',dateMode:'derived',sourceCell,sourceRange,note:defaultParsed.note}));}
  else if(!hadDates)issues.push('no-dates');return {events,issues};
}

function inferMissingWeekdays(anchors,weekdays,year,subjects){
  const rows=[...new Set(anchors.filter(a=>!weekdays.has(a.row)).map(a=>a.row))];
  for(const row of rows){const evidence=[];for(const anchor of anchors.filter(a=>a.row===row)){for(const segment of segmentStarts(anchor.text,subjects)){const tail=clean(segment.raw.slice(segment.tailStart)),{items}=tokenizeTail(tail,year);for(const item of items){if(item.kind==='range'){const a=new Date(`${item.startDate}T12:00:00Z`),b=new Date(`${item.endDate}T12:00:00Z`);if(weekdayIso(a)===weekdayIso(b))evidence.push(weekdayIso(a));}else evidence.push(weekdayIso(new Date(`${item.date}T12:00:00Z`)));}}}const unique=[...new Set(evidence)];if(unique.length===1)weekdays.set(row,unique[0]);}
}
function dedupe(events){const seen=new Set();return events.filter(e=>{const key=[e.group,e.start,e.end,e.title,e.location].join('|');if(seen.has(key))return false;seen.add(key);return true;});}
function resolveSameSourceOverrides(events){const explicit=new Set(events.filter(e=>e.dateMode==='explicit-date').map(e=>[e.group,e.start.slice(0,10),e.subject,e.sourceCell].join('|')));return events.filter(e=>!(e.dateMode!=='explicit-date'&&explicit.has([e.group,e.start.slice(0,10),e.subject,e.sourceCell].join('|'))));}
function resolveExplicitCrossSubjectOverrides(events){
  const by=new Map();for(const e of events){const key=`${e.group}|${e.start.slice(0,10)}`;if(!by.has(key))by.set(key,[]);by.get(key).push(e);}const remove=new Set();
  for(const list of by.values()){for(const explicit of list.filter(e=>e.dateMode==='explicit-date')){for(const computed of list.filter(e=>e.dateMode!=='explicit-date'&&e.subject!==explicit.subject)){if(explicit.start<computed.end&&computed.start<explicit.end)remove.add(computed.id);}}}
  return events.filter(e=>!remove.has(e.id));
}
function findOverlaps(events){const by=new Map(),out=[];for(const e of events){const key=`${e.group}|${e.start.slice(0,10)}`;if(!by.has(key))by.set(key,[]);by.get(key).push(e);}for(const list of by.values()){const sorted=[...list].sort((a,b)=>a.start.localeCompare(b.start));for(let i=0;i<sorted.length;i++)for(let j=i+1;j<sorted.length;j++){if(sorted[j].start>=sorted[i].end)break;if(sorted[j].start<sorted[i].end&&sorted[i].start<sorted[j].end)out.push({group:sorted[i].group,date:sorted[i].start.slice(0,10),event1:sorted[i].id,event2:sorted[j].id,source1:sorted[i].sourceCell,source2:sorted[j].sourceCell});}}return out;}
function periodExceptions(events,windows){if(!windows.length)return [];const bounds=windows.map(w=>[dateKey(w.start),dateKey(w.end)]),by=new Map();for(const e of events){const d=e.start.slice(0,10);if(bounds.some(([a,b])=>d>=a&&d<=b))continue;const key=[e.group,e.title,e.sourceRange||e.sourceCell].join('|');if(!by.has(key))by.set(key,{group:e.group,title:e.title,source:e.sourceRange||e.sourceCell,dates:[]});by.get(key).dates.push(d);}return [...by.values()].map(x=>({...x,dates:[...new Set(x.dates)].sort()}));}
function extraLessonExpectations(anchors,subjects){
  const out=[];
  for(const anchor of anchors){
    for(const seg of segmentStarts(anchor.text,subjects)){
      for(const paren of seg.raw.matchAll(/\(([^)]*занят[^)]*)\)/gi)){
        const text=paren[1];
        for(const m of text.matchAll(/(\d+)\s+(?:(?:занят(?:ие|ия|ий)\s+)?(?:в(?:о)?\s*)?)(пн|вт|ср|чт|пт|сб)\.?/gi)){
          for(const group of anchor.groups)out.push({group,subject:seg.subject,count:Number(m[1]),weekday:WEEKDAYS.get(m[2].toLowerCase()),sourceCell:anchor.ref,raw:m[0]});
        }
      }
    }
  }
  return out;
}
function validateExtraLessons(events,expectations){return expectations.map(expected=>{const matches=events.filter(e=>e.group===expected.group&&e.subject===expected.subject&&e.kind==='practical'&&e.dateMode==='explicit-date'&&weekdayIso(new Date(`${e.start.slice(0,10)}T12:00:00Z`))===expected.weekday);return {...expected,actual:matches.length,eventIds:matches.map(e=>e.id)};}).filter(x=>x.actual!==x.count);}
function derivePeriod(sheet){const text=(sheet.cells||[]).map(c=>clean(c.value)).join(' ');const y=text.match(/(20\d{2})\s*[-–/]\s*(20\d{2})/);const academicYear=y?`${y[1]}/${y[2].slice(-2)}`:null;const semester=/втор(?:ое|ой)\s+(?:полугодие|семестр)/i.test(text)?2:(/перв(?:ое|ый)\s+(?:полугодие|семестр)/i.test(text)?1:null);return {academicYear,semester};}
function serviceRow(text){return /1\s+неделя/i.test(text)&&/2\s+неделя/i.test(text)&&/праздничные\s+неучебные\s+дни/i.test(text);}

export function parseForeignRWorkbookGeneric(workbook,{university='kgmu',program='foreign',course=1,academicYear=null,semester=null}={}){
  const sheet=workbook?.sheets?.[0];if(!sheet)throw new Error('Workbook has no sheet');const header=findGroupHeader(sheet);if(!header||header.groups.length<2)throw new Error('Foreign weekly group header not found');
  const footerHeader=(sheet.cells||[]).find(c=>c.col===1&&/^дисциплина(?:\s|\(|$)/i.test(clean(c.value)))?.row;if(!footerHeader)throw new Error('Foreign footer reference not found');
  const subjects=buildSubjects(sheet,footerHeader),startRow=header.row+1,endRow=footerHeader-1,weekdays=initialWeekdays(sheet,startRow,endRow),windows=parsePeriodWindows(sheet),derived=derivePeriod(sheet);const year=windows[0]?.start?.getUTCFullYear()||Number(String(academicYear||derived.academicYear||'2025').slice(0,4))+(Number(semester||derived.semester)===2?1:0),holidays=holidayDates(sheet,year),weekWindows=serviceWeekWindows(sheet,year),meta=footerMeta(sheet,footerHeader,subjects);
  const anchors=[],serviceRows=[];
  for(const c of sheet.cells||[]){if(c.row<startRow||c.row>endRow||!header.groups.some(g=>g.col===c.col))continue;const containing=mergeContaining(sheet,c.row,c.col);if(containing&&(containing.startRow!==c.row||containing.startCol!==c.col))continue;const startCol=containing?.startCol??c.col,endCol=containing?.endCol??c.col,groups=header.groups.filter(g=>g.col>=startCol&&g.col<=endCol).map(g=>g.code);if(!groups.length)continue;const anchor={ref:c.ref,range:containing?.ref||c.ref,row:c.row,col:c.col,groups,text:clean(c.value)};if(serviceRow(anchor.text))serviceRows.push(anchor);else anchors.push(anchor);}
  inferMissingWeekdays(anchors,weekdays,year,subjects);for(const a of anchors)a.weekday=weekdays.get(a.row)||null;
  const events=[],uncovered=[];
  for(const anchor of anchors){if(!anchor.weekday){uncovered.push({source:anchor.range,reason:'weekday-not-found',text:anchor.text});continue;}const segments=segmentStarts(anchor.text,subjects);if(!segments.length){uncovered.push({source:anchor.range,reason:'segments-not-found',text:anchor.text});continue;}let produced=0;for(const group of anchor.groups)for(const segment of segments){const parsed=parseSegment(segment,{group,weekday:anchor.weekday,year,windows,weekWindows,holidays,sourceCell:anchor.ref,sourceRange:anchor.range,meta});events.push(...parsed.events);produced+=parsed.events.length;for(const issue of parsed.issues)uncovered.push({source:anchor.range,reason:issue,subject:segment.subject,text:anchor.text});}if(!produced)uncovered.push({source:anchor.range,reason:'no-events',text:anchor.text});}
  let final=resolveSameSourceOverrides(dedupe(events));final=resolveExplicitCrossSubjectOverrides(final);const expectations=extraLessonExpectations(anchors,subjects),extraLessonFailures=validateExtraLessons(final,expectations),sourceConflicts=findOverlaps(final);
  const byGroup=new Map(header.groups.map(g=>[g.code,[]]));for(const event of final)byGroup.get(event.group)?.push(event);const schedules=header.groups.map(g=>({version:1,university,universityName:'КГМУ',program,course,academicYear:academicYear||derived.academicYear,semester:semester||derived.semester,timezone:'Europe/Moscow',group:{id:`kgmu:${program}:${course}:${g.code}`,code:g.code,displayName:`Группа ${g.code}`},sources:[],events:byGroup.get(g.code).sort((a,b)=>a.start.localeCompare(b.start)||a.title.localeCompare(b.title))}));
  const unresolvedAnchors=new Set(uncovered.map(x=>x.source));
  const qa={status:uncovered.length||extraLessonFailures.length||sourceConflicts.length?'REVIEW_REQUIRED':'PASS',sourceAnchorCount:anchors.length,coveredSourceAnchors:anchors.length-unresolvedAnchors.size,uncovered,extraLessonExpectations:expectations,extraLessonFailures,sourceConflicts,eventCount:final.length,eventCountsByGroup:Object.fromEntries(schedules.map(s=>[s.group.code,s.events.length])),inferredWeekdayRows:[...weekdays.entries()].filter(([row])=>![(sheet.cells||[])].flat().some(c=>c.col===1&&c.row===row&&WEEKDAYS.has(clean(c.value).toLowerCase()))).map(([row,weekday])=>({row,weekday})),serviceRows:serviceRows.map(x=>x.range),holidayDates:[...holidays].sort(),subjectLexicon:subjects.map(x=>x.canonical),sourcePeriodExceptions:periodExceptions(final,windows)};
  return {schedules,qa};
}

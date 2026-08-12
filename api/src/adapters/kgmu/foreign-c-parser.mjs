import { createHash } from "node:crypto";

const MONTHS = new Map([
  ["january",1],["february",2],["march",3],["april",4],["may",5],["june",6],
  ["july",7],["august",8],["september",9],["october",10],["november",11],["december",12],
  ["январ",1],["феврал",2],["март",3],["апрел",4],["май",5],["мая",5],["июн",6],
  ["июл",7],["август",8],["сентябр",9],["октябр",10],["ноябр",11],["декабр",12],
]);
const WEEKDAYS = new Map([
  ["mon",1],["monday",1],["tue",2],["tues",2],["tuesday",2],["wed",3],["wednesday",3],
  ["thu",4],["thur",4],["thurs",4],["thursday",4],["fri",5],["friday",5],["sat",6],["saturday",6],
  ["пн",1],["понедельник",1],["вт",2],["вторник",2],["ср",3],["среда",3],
  ["чт",4],["четверг",4],["пт",5],["пятница",5],["сб",6],["суббота",6],
]);
const VALID_MINUTES = new Set([0,5,10,15,20,25,30,35,40,45,50,55]);

function clean(value){ return String(value ?? "").replace(/\u00a0/g," ").replace(/\s+/g," ").trim(); }
function letters(col){ let n=Number(col), out=""; while(n>0){n-=1;out=String.fromCharCode(65+n%26)+out;n=Math.floor(n/26);} return out; }
function ref(col,row){ return `${letters(col)}${row}`; }
function cellMap(sheet){ return new Map((sheet?.cells||[]).map(cell=>[cell.ref,cell])); }
function styleMap(sheet){ return new Map((sheet?.styledCells||[]).map(cell=>[cell.ref,cell])); }
function mergeAt(sheet,col,row){ return (sheet?.merges||[]).find(m=>m.startCol<=col&&col<=m.endCol&&m.startRow<=row&&row<=m.endRow)||null; }
function effectiveCell(sheet,cells,col,row){
  const direct=cells.get(ref(col,row));
  if(direct) return direct;
  const merge=mergeAt(sheet,col,row);
  return merge ? (cells.get(merge.startRef)||null) : null;
}
function effectiveValue(sheet,cells,col,row){ return effectiveCell(sheet,cells,col,row)?.value ?? ""; }
function effectiveStyle(sheet,styles,col,row){
  const direct=styles.get(ref(col,row));
  if(direct)return direct;
  const merge=mergeAt(sheet,col,row);
  return merge ? (styles.get(merge.startRef)||null) : null;
}
function effectiveFill(sheet,cells,styles,col,row){
  const style=effectiveStyle(sheet,styles,col,row);
  if(Number.isInteger(style?.fillId)&&style.fillId>0)return `fill:${style.fillId}`;
  const cell=effectiveCell(sheet,cells,col,row);
  const color=clean(cell?.fillColor).toLowerCase();
  if(color)return `color:${color}`;
  if(Number.isInteger(cell?.fillId)&&cell.fillId>0)return `fill:${cell.fillId}`;
  return null;
}
function monthNumber(value){ const text=clean(value).toLowerCase(); for(const [name,n] of MONTHS) if(text.includes(name)) return n; return null; }
function normalizedYear(value){
  const m=String(value||"").match(/(20\d{2})\D+(\d{2,4})/); if(!m) return null;
  const start=Number(m[1]); let end=Number(m[2]); if(m[2].length===2){end=Math.floor(start/100)*100+end;if(end<start)end+=100;}
  return end===start+1?{start,end,label:`${start}/${String(end).slice(-2)}`}:null;
}
function workbookText(workbook){ return (workbook?.sheets||[]).flatMap(s=>s.cells||[]).map(c=>clean(c.value)).join("\n"); }
function resolvePeriod(workbook,metadata={}){
  const academicYear=normalizedYear(metadata.academicYear)||normalizedYear(workbookText(workbook));
  const text=workbookText(workbook);
  const semester=[1,2].includes(Number(metadata.semester))?Number(metadata.semester):
    /\b(?:2nd|second|2)\s+semester\b/i.test(text)||/втор(?:ое|ой)\s+(?:полугодие|семестр)/i.test(text)?2:
    /\b(?:1st|first|1)\s+semester\b/i.test(text)||/перв(?:ое|ый)\s+(?:полугодие|семестр)/i.test(text)?1:null;
  if(!academicYear||!semester) throw Object.assign(new Error("Cannot resolve C-FIO academic year/semester"),{code:"KGMU_CFIO_PERIOD_UNKNOWN"});
  return {academicYear,semester,eventYear:semester===1?academicYear.start:academicYear.end};
}
function findCycleSheet(workbook){
  for(const sheet of workbook?.sheets||[]){
    const rows=new Map(); for(const cell of sheet.cells||[]){if(!rows.has(cell.row))rows.set(cell.row,[]);rows.get(cell.row).push(cell);}
    const dateRow=[...rows.entries()].find(([,cells])=>cells.filter(cell=>{const n=Number(cell.value);return Number.isInteger(n)&&n>=1&&n<=31;}).length>=10)?.[0];
    if(dateRow) return {sheet,rows,dateRow};
  }
  throw Object.assign(new Error("C-FIO calendar grid was not found"),{code:"KGMU_CFIO_GRID_NOT_FOUND"});
}
function dateColumns(rows,dateRow,year){
  const monthRows=[...rows.entries()].filter(([r])=>r<dateRow&&r>=dateRow-3).sort((a,b)=>b[0]-a[0]);
  const monthRow=monthRows.find(([,cells])=>cells.some(c=>monthNumber(c.value)))?.[0];
  if(!monthRow) throw Object.assign(new Error("C-FIO month header was not found"),{code:"KGMU_CFIO_MONTH_HEADER_NOT_FOUND"});
  const starts=(rows.get(monthRow)||[]).map(c=>({col:c.col,month:monthNumber(c.value)})).filter(x=>x.month).sort((a,b)=>a.col-b.col);
  const out=new Map();
  for(const cell of rows.get(dateRow)||[]){const day=Number(cell.value);if(!Number.isInteger(day)||day<1||day>31)continue;const month=[...starts].reverse().find(x=>x.col<=cell.col)?.month;if(month)out.set(cell.col,`${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`);}
  return out;
}
function groupCode(value){ const m=clean(value).match(/^(\d{3})\s*([иi])$/i); return m?`${m[1]}и`:null; }
function findGroupRows(sheet,rows,cells,dateRow){
  const result=[];
  for(const [row] of rows){ if(row<=dateRow)continue; for(let col=1;col<=4;col+=1){const code=groupCode(effectiveValue(sheet,cells,col,row));if(code){result.push({row,col,group:code});break;}} }
  return result;
}
function parseTime(value){
  for(const m of String(value||"").matchAll(/(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})/g)){
    const p=[m[1],m[2],m[3],m[4]].map(Number); if(p[0]>23||p[2]>23||p[1]>59||p[3]>59||!VALID_MINUTES.has(p[1])||!VALID_MINUTES.has(p[3]))continue;
    const duration=p[2]*60+p[3]-(p[0]*60+p[1]); if(duration<=0||duration>360)continue;
    return {start:`${String(p[0]).padStart(2,"0")}:${String(p[1]).padStart(2,"0")}`,end:`${String(p[2]).padStart(2,"0")}:${String(p[3]).padStart(2,"0")}`};
  }
  return null;
}
function footerColumns(rows){
  for(const [row,cells] of rows){
    const find=(re)=>cells.find(c=>re.test(clean(c.value)))?.col;
    const discipline=find(/^(?:academic discipline|дисциплина)$/i); if(!discipline)continue;
    const assessment=find(/^(?:form of assessment|форма промежуточной аттестации)$/i);
    const base=find(/^(?:place of practical training|база практической подготовки)$/i);
    const address=find(/^(?:address|адрес)$/i);
    const timing=find(/^(?:timing of classes|время проведения занятий)$/i);
    let shift1=null,shift2=null;
    for(let rr=row;rr<=row+2;rr+=1){for(const cell of rows.get(rr)||[]){const text=clean(cell.value).toLowerCase();if(/^(?:1st part of the day|1\s*смена)$/.test(text))shift1=cell.col;if(/^(?:2nd part of the day|2\s*смена)$/.test(text))shift2=cell.col;}}
    if(!shift1&&timing)shift1=timing;
    return {headerRow:row,discipline,assessment,base,address,shift1,shift2,dataStart:row+2};
  }
  throw Object.assign(new Error("C-FIO footer reference table was not found"),{code:"KGMU_CFIO_FOOTER_NOT_FOUND"});
}
function normalizeLocation(base,address){ return [clean(base),clean(address)].filter(Boolean).join(", "); }
function footerRows(sheet,rows,cells,columns){
  const result=[]; const maxRow=Math.max(...rows.keys());
  for(let row=columns.dataStart;row<=maxRow;row+=1){
    const discipline=clean(effectiveValue(sheet,cells,columns.discipline,row));
    if(!discipline)continue;
    if(/lectures on the disciplines/i.test(discipline))continue;
    result.push({row,discipline,assessment:columns.assessment?clean(effectiveValue(sheet,cells,columns.assessment,row))||null:null,
      base:columns.base?clean(effectiveValue(sheet,cells,columns.base,row)):"",address:columns.address?clean(effectiveValue(sheet,cells,columns.address,row)):"",
      location:normalizeLocation(columns.base?effectiveValue(sheet,cells,columns.base,row):"",columns.address?effectiveValue(sheet,cells,columns.address,row):""),
      shift1:columns.shift1?effectiveValue(sheet,cells,columns.shift1,row):"",shift2:columns.shift2?effectiveValue(sheet,cells,columns.shift2,row):""});
  }
  return result;
}
function footerMatch(value,footer){
  const text=clean(value).toLowerCase();
  if(!text||/^exams?$/i.test(text))return null;
  const exact=footer.find(r=>r.discipline.toLowerCase()===text); if(exact)return exact;
  const aliases=[
    [/^psychiatry\s*,\s*mp$/i,/^psychiatry\s*,\s*medical psychology$/i],
    [/^faculty surgery$/i,/^faculty surgery\s*\(module\)$/i],
    [/^urology$/i,/^urology\s*\(module\)$/i],
    [/^психиатрия\s*,\s*мп$/i,/^психиатрия\s*,\s*медицинская психология$/i],
    [/^факультетская хирургия$/i,/^факультетская хирургия(?:\s*\(раздел\))?$/i],
    [/^урология$/i,/^урология(?:\s*\(раздел\))?$/i],
  ];
  for(const [source,target] of aliases)if(source.test(text))return footer.find(r=>target.test(r.discipline))||null;
  return footer.find(r=>r.discipline.toLowerCase().startsWith(text)||text.startsWith(r.discipline.toLowerCase()))||null;
}
function practiceTime(row){ const t1=parseTime(row.shift1),t2=parseTime(row.shift2); if(t1&&!t2)return t1;if(t2&&!t1)return t2;if(t1&&t2&&t1.start===t2.start&&t1.end===t2.end)return t1;return null; }
function stableId(group,date,start,title,source){ return `kgmu-${group}-${date}-${start.replace(":","")}-${createHash("sha1").update([group,date,start,title,source].join("|")).digest("hex").slice(0,12)}`; }
function makeEvent(group,date,time,row,extra={}){
  const title=row.discipline;
  return {id:stableId(group,date,time.start,title,extra.sourceCell||`footer-${row.row}`),group,title,discipline:title,kind:extra.kind||"practice",
    start:`${date}T${time.start}:00+03:00`,end:`${date}T${time.end}:00+03:00`,location:extra.location??row.location,assessment:row.assessment,
    sourceType:extra.sourceType||"main_grid",source:extra.sourceRange||extra.sourceCell||null,sourceCell:extra.sourceCell||null,sourceRange:extra.sourceRange||null,...extra};
}
function datePart(value){const m=String(value||"").match(/(\d{1,2})\.(\d{2})/);return m?{day:Number(m[1]),month:Number(m[2])}:null;}
function iso(year,p){return `${year}-${String(p.month).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;}
function weekdayScheduleDates(text,year,whitelist){
  const lower=clean(text).toLowerCase(); let weekday=null;
  for(const [name,n] of WEEKDAYS){if(new RegExp(`(?:^|\\s)${name}(?:\\s|$)`,`i`).test(lower)){weekday=n;break;}}
  const range=String(text).match(/(\d{1,2}\.\d{2})\s*[-–]\s*(\d{1,2}\.\d{2})/); const time=parseTime(text);
  if(!weekday||!range||!time)return null; const a=datePart(range[1]),b=datePart(range[2]);if(!a||!b)return null;
  const cursor=new Date(Date.UTC(year,a.month-1,a.day)), last=new Date(Date.UTC(year,b.month-1,b.day)); const dates=[];
  while(cursor<=last){const key=iso(year,{month:cursor.getUTCMonth()+1,day:cursor.getUTCDate()});const wd=cursor.getUTCDay()||7;if(wd===weekday&&whitelist.has(key))dates.push(key);cursor.setUTCDate(cursor.getUTCDate()+1);}
  return {dates,time,weekday};
}
function duplicateReport(events){const seen=new Set(),out=[];for(const e of events){const key=[e.group,e.start,e.end,e.title,e.location].join("|");if(seen.has(key))out.push(e.id);seen.add(key);}return out;}
function overlapReport(events){
  const by=new Map(),allowed=[];for(const e of events){const key=`${e.group}|${e.start.slice(0,10)}`;if(!by.has(key))by.set(key,[]);by.get(key).push(e);}for(const [key,items] of by){const [group,date]=key.split("|");const s=[...items].sort((a,b)=>a.start.localeCompare(b.start));for(let i=0;i<s.length;i++)for(let j=i+1;j<s.length;j++){if(Date.parse(s[j].start)>=Date.parse(s[i].end))break;if(Date.parse(s[i].start)<Date.parse(s[j].end))allowed.push({group,date,first:s[i].id,second:s[j].id,rule:"C13/CF10"});}}
  return allowed;
}

export function parseKgmuForeignCycleWorkbook(workbook,metadata={}){
  const {sheet,rows,dateRow}=findCycleSheet(workbook); const cells=cellMap(sheet); const styles=styleMap(sheet); const period=resolvePeriod(workbook,metadata); const dates=dateColumns(rows,dateRow,period.eventYear); const whitelist=new Set(dates.values());
  const groups=findGroupRows(sheet,rows,cells,dateRow); if(!groups.length)throw Object.assign(new Error("C-FIO group rows were not found"),{code:"KGMU_CFIO_GROUPS_NOT_FOUND"});
  const columns=footerColumns(rows); const footer=footerRows(sheet,rows,cells,columns);
  const footerByFill=new Map(), unhandledBlocks=[]; let sourceBlocks=0;
  const firstDateCol=Math.min(...dates.keys()),lastDateCol=Math.max(...dates.keys());
  for(const {row} of groups){
    for(const cell of rows.get(row)||[]){if(cell.col<firstDateCol||cell.col>lastDateCol)continue;const text=clean(cell.value);if(!text||/^exams?$/i.test(text)||text==="**")continue;sourceBlocks+=1;const match=footerMatch(text,footer);if(!match){unhandledBlocks.push({cell:cell.ref,text,reason:"subject-not-in-footer"});continue;}const fill=effectiveFill(sheet,cells,styles,cell.col,row);if(!fill){unhandledBlocks.push({cell:cell.ref,text,reason:"subject-fill-missing"});continue;}const current=footerByFill.get(fill);if(current&&current.discipline!==match.discipline){unhandledBlocks.push({cell:cell.ref,text,reason:"fill-maps-to-multiple-subjects",fill,subjects:[current.discipline,match.discipline]});continue;}footerByFill.set(fill,match);}
  }
  const events=[],unresolvedStyledDays=[]; const groupSubjectDays={};
  for(const {row,group} of groups){let count=0;for(let col=firstDateCol;col<=lastDateCol;col+=1){if(!dates.has(col))continue;const fill=effectiveFill(sheet,cells,styles,col,row);if(!fill)continue;const footerRow=footerByFill.get(fill);if(!footerRow)continue;const time=practiceTime(footerRow);const sourceCell=effectiveCell(sheet,cells,col,row);const merge=mergeAt(sheet,col,row);if(!time){unresolvedStyledDays.push({group,date:dates.get(col),sourceCell:sourceCell?.ref||ref(col,row),subject:footerRow.discipline,reason:"practice-time-ambiguous"});continue;}events.push(makeEvent(group,dates.get(col),time,footerRow,{sourceCell:sourceCell?.ref||ref(col,row),sourceRange:merge?.ref||sourceCell?.ref||ref(col,row)}));count+=1;}groupSubjectDays[group]=count;}
  const pe=footer.find(r=>/^(?:elective discipline in physical culture and sports|элективные дисциплины(?: \(модули\))? по физической культуре и спорту)$/i.test(r.discipline));
  if(pe){const schedule=weekdayScheduleDates([pe.shift1,pe.shift2].map(clean).filter(Boolean).join(" "),period.eventYear,whitelist);if(schedule){for(const {group} of groups)for(const date of schedule.dates)events.push(makeEvent(group,date,schedule.time,pe,{kind:"physical_education",sourceType:"footer_schedule",sourceCell:`footer-row-${pe.row}`,sourceRange:`footer-row-${pe.row}`,location:pe.location}));}else unhandledBlocks.push({cell:`footer-row-${pe.row}`,text:clean(pe.shift1||pe.shift2),reason:"pe-schedule-unparsed"});}
  const duplicates=duplicateReport(events),allowedOverlaps=overlapReport(events); const groupCounts=Object.fromEntries(groups.map(({group})=>[group,events.filter(e=>e.group===group).length]));
  const qa={passed:sourceBlocks>0&&unhandledBlocks.length===0&&unresolvedStyledDays.length===0&&duplicates.length===0,sourceBlocks,coveredSourceBlocks:sourceBlocks-unhandledBlocks.length,unhandledBlocks,styledSubjectDayCount:Object.values(groupSubjectDays).reduce((a,b)=>a+b,0),groupSubjectDays,unresolvedStyledDays,duplicateCount:duplicates.length,duplicates,allowedOverlapCount:allowedOverlaps.length,allowedOverlaps,remainingOverlaps:[],eventCount:events.length,groupCounts};
  const program=metadata.program||"foreign",course=Number(metadata.course)||4;
  const schedules=groups.map(({group})=>({version:1,university:"kgmu",universityName:"КГМУ",program,course,academicYear:period.academicYear.label,semester:period.semester,timezone:"Europe/Moscow",parserType:"C-FIO",parserQa:{sourceBlocks:qa.sourceBlocks,coveredSourceBlocks:qa.coveredSourceBlocks,styledSubjectDayCount:qa.styledSubjectDayCount,duplicateCount:qa.duplicateCount,allowedOverlapCount:qa.allowedOverlapCount},group:{id:`kgmu:${program}:${course}:${group}`,code:group,displayName:`Группа ${group}`},sources:metadata.sourceUrl?[{url:metadata.sourceUrl,sha256:metadata.sourceSha256||null}]:[],events:events.filter(e=>e.group===group).map(({group:_g,...e})=>e)}));
  return {type:"C",profile:"C-FIO",schedules,qa};
}

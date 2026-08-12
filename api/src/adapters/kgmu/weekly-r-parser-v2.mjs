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
  { canonical:'Общественное здоровье и здравоохранение, экономика здравоохранения', aliases:[/о{1,2}бщественное\s+здоровье\s+и\s+здравоохранение\s*,\s*экономика\s+здравоохранения/i] },
  { canonical:'Патофизиология, клиническая патофизиология. Патофизиология (модуль)', aliases:[/патофизиология\s*,\s*клиническая\s+патофизиология\s*\.\s*патофизиология\s*\(модуль\)/i] },
  { canonical:'Патологическая анатомия, клиническая патологическая анатомия. Патологическая анатомия (модуль)', aliases:[/патологическая\s+анатомия\s*,\s*клиническая\s+патологическая\s+анатомия\s*\.\s*патологическая\s+анатомия\s*\(модуль\)/i] },
  { canonical:'Инклюзивно ориентированная компетентность врача', aliases:[/инклюзивно\s+ориентированная\s+компетент(?:н)?ость\s+врача/i] },
  { canonical:'Организация сестринской помощи (дисциплина по выбору)', aliases:[/организация\s+сестринской\s+помощи\s*\(дисциплина\s+по\s+выбору\)/i] },
  { canonical:'Пропедевтика внутренних болезней', aliases:[/пропедевтика\s+внутренних\s+болезней/i] },
  { canonical:'Лучевая диагностика и терапия', aliases:[/лучевая\s+диагностика\s+и\s+терапия/i] },
  { canonical:'Общая хирургия', aliases:[/общая\s+хирургия/i] },
  { canonical:'Фармакология', aliases:[/фармакология/i] },
  { canonical:'Философия', aliases:[/философия/i] },
  { canonical:'Экономика', aliases:[/экономика/i] },
  { canonical:'Пропедевтическая стоматология', aliases:[/пропедевтическая\s+стоматология/i] },
  { canonical:'Иммунология - клиническая иммунология', aliases:[/им+унология(?:\s*[-–]\s*клиническая\s+иммунология)?/i] },
  { canonical:'Микробиология, вирусология-микробиология полости рта', aliases:[/микробиология\s*,\s*вирусология\s*[-–]\s*микробиология\s+полости\s+рта/i] },
  { canonical:'Патологическая анатомия - патологическая анатомия головы и шеи', aliases:[/патологическая\s+анатомия\s*[-–]\s*патологическая\s+анатомия\s+головы\s+и\s+шеи/i] },
  { canonical:'Патофизиология - патофизиология головы и шеи', aliases:[/патофизиология\s*[-–]\s*патофизиология\s+головы\s+и\s+шеи/i] },
  { canonical:'Топографическая анатомия и оперативная хирургия головы и шеи', aliases:[/топографическая\s+анатомия\s+и\s+оперативная\s+хирургия\s+головы\s+и\s+шеи/i] },
  { canonical:'Учебная практика. Практика по получению первичных профессиональных умений и навыков на должностях среднего медицинского персонала', aliases:[/учебная\s+практика\.\s*практика\s+по\s+получению\s+первичных\s+профессиональных\s+умений\s+и\s+навыков\s+на\s+должностях\s+среднего\s+медицинского\s+персонала/i] },
  { canonical:'Учебная практика. Научно-исследовательская работа (получение первичных навыков научно-исследовательской работы)', aliases:[/учебная\s+практика\.\s*научно-исследовательская\s+работа\s*\(получение\s+первичных\s+навыков\s+научно-исследовательской\s+работы\)/i] },
  { canonical:'Элективные дисциплины по физической культуре и спорту', aliases:[/элективн(?:ая|ые)\s+дисциплин(?:а|ы)\s*(?:\(модули\)\s*)?по\s+физической\s+культуре\s+и\s+спорту/i] },
  { canonical:'Гистология, эмбриология, цитология', aliases:[/гистология\s*,\s*эмбриология\s*,\s*цитология/i] },
  { canonical:'Безопасность жизнедеятельности', aliases:[/безопасность\s+жизнедеятельности/i] },
  { canonical:'Медицинская информатика', aliases:[/медицинская\s+информатика/i] },
  { canonical:'Общая и биоорганическая химия', aliases:[/общая\s+и\s+биоорганическая\s+химия/i,/общая\s+биоорганическая\s+химия/i] },
  { canonical:'Иностранный язык', aliases:[/иностранный\s+язык/i] },
  { canonical:'Латинский язык', aliases:[/латинский\s+язык/i] },
  { canonical:'История медицины', aliases:[/история\s+медицины/i] },
  { canonical:'История России', aliases:[/история\s+россии/i] },
  { canonical:'Правоведение', aliases:[/правоведение/i] },
  { canonical:'Биология', aliases:[/биология/i] },
  { canonical:'Анатомия', aliases:[/анатомия/i] },
  { canonical:'Час куратора', aliases:[/час\s+куратора/i] },
];

const TIME = String.raw`\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}`;
const DATE_RANGE_RE = /(?<!\d)(\d{1,2})\.(\d{2})\s*[-–]\s*(\d{1,2})\.(\d{2})(?!\d)/g;
const DATE_TOKEN_RE = /(?<!\d)(\d{1,2})\.(\d{2})(?!\d)/g;
const DATE_TIME_RE = /(?<!\d)(\d{1,2})\.(\d{2})\s*[-–]{1,2}\s*(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})(?!\d)/g;
const TIME_DATE_RE = new RegExp(String.raw`(?<!\d)(\d{1,2})[.:](\d{2})\s*[-–]\s*(\d{1,2})[.:](\d{2})\s*[-–]{1,2}\s*(\d{1,2})\.(\d{2})(?!\d)`, 'g');

function clean(value){return String(value??'').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();}
function pad(n){return String(n).padStart(2,'0');}
function iso(year,month,day){return `${year}-${pad(month)}-${pad(day)}`;}
function dateObj(year,month,day){const d=new Date(Date.UTC(year,month-1,day)); if(d.getUTCFullYear()!==year||d.getUTCMonth()!==month-1||d.getUTCDate()!==day)return null;return d;}
function validDatePart(day,month,year){return Boolean(dateObj(year,month,day));}
function weekdayIso(date){const n=date.getUTCDay(); return n===0?7:n;}
function parseClock(value){const m=String(value).match(/(\d{1,2})[.:](\d{2})/); if(!m)return null; const h=Number(m[1]),min=Number(m[2]); if(h>23||min>59)return null; return `${pad(h)}:${pad(min)}`;}
function allTimeMatches(value){return [...String(value).matchAll(new RegExp(TIME,'g'))];}
function parseTimeBlock(value){const parts=allTimeMatches(value);if(!parts.length)return null;return {start:parseClock(parts[0][0].split(/[-–]/)[0]),end:parseClock(parts.at(-1)[0].split(/[-–]/)[1])};}
function contiguousTimeBlockBefore(text,endIndex){const before=text.slice(0,endIndex);const times=allTimeMatches(before);if(!times.length)return null;let first=times.length-1;for(let i=times.length-2;i>=0;i--){const prev=times[i],next=times[i+1];const gap=before.slice(prev.index+prev[0].length,next.index);if(!/^[\s,;\-–]*$/.test(gap))break;first=i;}const last=times.at(-1);const start=times[first].index;const end=last.index+last[0].length;return {raw:before.slice(start,end),start,end};}
function ranges(start,end,weekday,holidays){const out=[];let d=new Date(start);const last=new Date(end);while(d<=last){const key=iso(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());if(weekdayIso(d)===weekday&&!holidays.has(key))out.push(key);d.setUTCDate(d.getUTCDate()+1);}return out;}
function overlaps(a,b){return a.start < b.end && b.start < a.end;}
function toDateTime(date,time){return `${date}T${time}:00+03:00`;}
function refFor(col,row){let n=col,s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return `${s}${row}`;}

function subjectMatches(text){
  const out=[];
  for(const subject of SUBJECTS){for(const re of subject.aliases){for(const m of text.matchAll(new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g'))){out.push({index:m.index,end:m.index+m[0].length,raw:m[0],canonical:subject.canonical});}}}
  return out.sort((a,b)=>a.index-b.index||b.end-a.end).filter((m,i,arr)=>!arr.slice(0,i).some(x=>m.index>=x.index&&m.end<=x.end));
}
function segmentStarts(text){
  const subjects=subjectMatches(text);const result=[];let previousBoundary=0;
  for(const sub of subjects){const block=contiguousTimeBlockBefore(text,sub.index);if(!block||block.start<previousBoundary){previousBoundary=sub.end;continue;}const between=text.slice(block.end,sub.index);result.push({start:block.start,subjectStart:sub.index,subjectEnd:sub.end,subject:sub.canonical,lecture:/лекц(?:ия)?/i.test(between),timeRaw:block.raw});previousBoundary=sub.end;}
  return result.map((s,i)=>({...s,end:result[i+1]?.start??text.length,raw:text.slice(s.start,result[i+1]?.start??text.length)}));
}
function maskSpans(text,spans){const chars=[...text];for(const [a,b] of spans){for(let i=a;i<b;i++)chars[i]=' ';}return chars.join('');}
function parseDateTimeExceptions(tail,year){const out=[];for(const m of tail.matchAll(DATE_TIME_RE)){const day=Number(m[1]),month=Number(m[2]);const sh=Number(m[3]),sm=Number(m[4]),eh=Number(m[5]),em=Number(m[6]);if(!validDatePart(day,month,year)||sh>23||eh>23||sm>59||em>59)continue;out.push({date:iso(year,month,day),start:`${pad(sh)}:${pad(sm)}`,end:`${pad(eh)}:${pad(em)}`,index:m.index,endIndex:m.index+m[0].length});}for(const m of tail.matchAll(TIME_DATE_RE)){const sh=Number(m[1]),sm=Number(m[2]),eh=Number(m[3]),em=Number(m[4]),day=Number(m[5]),month=Number(m[6]);if(!validDatePart(day,month,year)||sh>23||eh>23||sm>59||em>59)continue;out.push({date:iso(year,month,day),start:`${pad(sh)}:${pad(sm)}`,end:`${pad(eh)}:${pad(em)}`,index:m.index,endIndex:m.index+m[0].length});}return [...new Map(out.map(x=>[`${x.date}|${x.start}|${x.end}`,x])).values()];}
function parseDateRanges(tail,year,weekday,semesterEnd){const out=[];for(const m of tail.matchAll(DATE_RANGE_RE)){let sd=Number(m[1]),sm=Number(m[2]),ed=Number(m[3]),em=Number(m[4]);if(!validDatePart(sd,sm,year)||!validDatePart(ed,em,year))continue;let start=dateObj(year,sm,sd),end=dateObj(year,em,ed),note=null;if(end<start){const candidates=[];for(let month=sm+1;month<=12;month++){const c=dateObj(year,month,ed);if(c&&c>start&&c<=semesterEnd&&weekdayIso(c)===weekday)candidates.push(c);}if(candidates.length===1){end=candidates[0];em=end.getUTCMonth()+1;note=`R60: исправлено ${pad(sd)}.${pad(sm)}–${pad(ed)}.${pad(Number(m[4]))} → ${pad(sd)}.${pad(sm)}–${pad(ed)}.${pad(em)}`;}else continue;}out.push({start,end,index:m.index,endIndex:m.index+m[0].length,note});}return out;}
function explicitDateTokens(tail,year,mask){const cleaned=maskSpans(tail,mask);const out=[];for(const m of cleaned.matchAll(DATE_TOKEN_RE)){const d=Number(m[1]),mo=Number(m[2]);if(validDatePart(d,mo,year))out.push({date:iso(year,mo,d),index:m.index});}return [...new Map(out.map(x=>[x.date,x])).values()];}
function parseWeekTable(sheet,year){const result={1:[],2:[]};for(const c of sheet.cells){const text=clean(c.value);if(!/1\s*недел[яи]/i.test(text)||!/2\s*недел[яи]/i.test(text))continue;const one=text.match(/1\s*недел[яи]\s*[-–:]?\s*([\s\S]*?)(?=2\s*недел[яи])/i)?.[1]||'';const two=text.match(/2\s*недел[яи]\s*[-–:]?\s*([\s\S]*?)(?=празднич|$)/i)?.[1]||'';for(const [week,body] of [[1,one],[2,two]]){for(const m of body.matchAll(DATE_RANGE_RE)){const a=dateObj(year,Number(m[2]),Number(m[1])),b=dateObj(year,Number(m[4]),Number(m[3]));if(a&&b&&b>=a)result[week].push({start:a,end:b});}}if(result[1].length||result[2].length)break;}return result;}
function parseWeekThrough(tail,year){const out=[];for(const m of tail.matchAll(/\b([12])\s*недел[яи]\s+по\s+(\d{1,2})\.(\d{2})/gi)){const day=Number(m[2]),month=Number(m[3]);if(!validDatePart(day,month,year))continue;out.push({week:Number(m[1]),through:dateObj(year,month,day),index:m.index,endIndex:m.index+m[0].length});}return out;}
function datesForWeek(weekTable,week,weekday,through,holidays){const out=[];for(const part of weekTable[week]||[]){const end=part.end>through?through:part.end;if(end<part.start)continue;out.push(...ranges(part.start,end,weekday,holidays));}return [...new Set(out)].sort();}
function parseFromTimeSwitch(tail,year){const m=tail.match(/\bс\s+(\d{1,2})\.(\d{2})\s+((?:\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2})(?:[\s,;\-–]+(?:\d{1,2}[.:]\d{2}\s*[-–]\s*\d{1,2}[.:]\d{2}))*)/i);if(!m)return null;const day=Number(m[1]),month=Number(m[2]);if(!validDatePart(day,month,year))return null;const time=parseTimeBlock(m[3]);if(!time)return null;return {from:iso(year,month,day),...time,index:m.index,endIndex:m.index+m[0].length};}
function inlineExtraLessons(tail,year){const out=[];for(const m of tail.matchAll(/\((\d+)\s+занят(?:ие|ия)\s+в(?:о)?\s+(пн|вт|ср|чт|пт|сб)\.?\s*([^)]*)\)/gi)){const count=Number(m[1]),weekday=WEEKDAYS.get(m[2].toLowerCase()),body=m[3]||'';const dates=[];for(const d of body.matchAll(DATE_TOKEN_RE)){const day=Number(d[1]),month=Number(d[2]);if(validDatePart(day,month,year))dates.push(iso(year,month,day));}const time=parseTimeBlock(body);out.push({count,weekday,body,dates:[...new Set(dates)],time,index:m.index,endIndex:m.index+m[0].length});}return out;}
function controlNear(segment,index){const left=segment.slice(Math.max(0,index-45),index+45);return /зач[её]т\s+с\s+оценкой/i.test(left);}
function normalizeAssessment(value){const s=clean(value).toLowerCase();if(!s)return null;if(s.includes('экзамен'))return 'экзамен';if(s.includes('с оценкой'))return 'зачет с оценкой';if(s.includes('зач'))return 'зачёт';return clean(value);}
function canonicalByText(value){const s=clean(value);const matches=subjectMatches(s);const full=matches.find(m=>m.index===0&&m.end===s.length);return full?.canonical||s;}

function parseFooter(sheet){
  const byRef=new Map(sheet.cells.map(c=>[c.ref,c.value]));
  const rows=new Map();for(const c of sheet.cells){if(!rows.has(c.row))rows.set(c.row,[]);rows.get(c.row).push(c);}
  let headerRow=null,headers=[];
  for(const [row,cells] of rows){const subjects=cells.filter(c=>/^дисциплина$/i.test(clean(c.value))).sort((a,b)=>a.col-b.col);if(subjects.length>=1){headerRow=row;headers=subjects;break;}}
  const meta=new Map();if(!headerRow)return meta;
  const headerCells=(rows.get(headerRow)||[]).sort((a,b)=>a.col-b.col);
  for(let i=0;i<headers.length;i++){
    const subjectCol=headers[i].col,nextSubjectCol=headers[i+1]?.col??Infinity;
    const section=headerCells.filter(c=>c.col>subjectCol&&c.col<nextSubjectCol);
    const deptCol=section.find(c=>/^кафедра$/i.test(clean(c.value)))?.col??null;
    const baseCol=section.find(c=>/база\s+практической\s+подготовки/i.test(clean(c.value)))?.col??null;
    const assessmentCol=section.find(c=>/форма\s+промежуточной\s+аттестации/i.test(clean(c.value)))?.col??null;
    for(let row=headerRow+1;row<=headerRow+18;row++){
      const raw=byRef.get(refFor(subjectCol,row));if(!raw)continue;
      const subject=canonicalByText(raw);if(!SUBJECTS.some(x=>x.canonical===subject))continue;
      const dept=deptCol?clean(byRef.get(refFor(deptCol,row))):'';
      const base=baseCol?clean(byRef.get(refFor(baseCol,row))):'';
      const assessment=assessmentCol?normalizeAssessment(byRef.get(refFor(assessmentCol,row))):null;
      meta.set(subject,{subject,dept,base,assessment,location:locationFromReference(dept,base,subject)});
    }
  }
  return meta;
}
function locationFromDept(dept,subject){const text=clean(dept);if(subject==='Элективные дисциплины по физической культуре и спорту')return 'ФОК, ул. Владимирская, 112';if(/центр онкологии и медицинской радиологии/i.test(text))return 'КОГБУЗ «Центр онкологии и медицинской радиологии», пр. Строителей, 23';if(/больница скорой медицинской помощи/i.test(text))return 'КОГКБУЗ «Больница скорой медицинской помощи», Октябрьский проспект, 47';if(/ржд медицина/i.test(text))return 'Клиническая больница «РЖД-Медицина», Октябрьский проспект, 151';if(/клиника кировского гму/i.test(text)&&/щорса/i.test(text))return 'Клиника Кировского ГМУ, ул. Щорса, 64';if(/консультативно-диагностическое отделение клиники кировского гму/i.test(text))return 'Консультативно-диагностическое отделение клиники Кировского ГМУ, ул. Никитская, 167';const b=text.match(/([123])\s*корпус/i);const addr=text.match(/ул\.\s*(?:К\.\s*Маркса|Владимирская|Пролетарская|Красноармейская|Никитская|Щорса)\s*,?\s*(\d+)/i);if(b){const info=BUILDINGS[b[1]];return `${info.building}, ${info.address}`;}if(/красноармейск/i.test(text))return 'ул. Красноармейская, 35';if(addr){const street=/пролетар/i.test(text)?'Пролетарская':/красноарм/i.test(text)?'Красноармейская':/никитск/i.test(text)?'Никитская':/щорса/i.test(text)?'Щорса':'Владимирская';return `ул. ${street}, ${addr[1]}`;}return ''}
function locationFromReference(dept,base,subject){const b=clean(base);if(b){const loc=locationFromDept(b,subject);if(loc)return loc;}return locationFromDept(dept,subject);}
function explicitLocation(raw,subject,fallback){const text=clean(raw);let building=null,room=null,address=null,named=null;const short=[...text.matchAll(/(?<!\d)([123])-(\d{3})(?!\d)/g)].at(-1);if(short){building=short[1];room=short[2];}const corp=text.match(/([123])\s*корпус/i);if(corp)building=corp[1];const aud=text.match(/аудитори[яи]\s*(\d{3})/i);if(aud)room=aud[1];const addr=text.match(/ул\.\s*(Владимирская|Пролетарская|Красноармейская|Щорса)\s*,?\s*(\d+)/i);if(addr)address=`ул. ${addr[1]}, ${addr[2]}`;if(/фок/i.test(text))named='ФОК';if(!building&&address){if(/Владимирская, 137/.test(address))building='1';else if(/Пролетарская, 38/.test(address))building='2';else if(/Владимирская, 112/.test(address))building='3';}if(building&&!address)address=BUILDINGS[building]?.address||null;if(named&&address)return `${named}, ${address}`;if(building&&room&&address)return `${BUILDINGS[building]?.building||`${building} корпус`}, аудитория ${room}, ${address}`;if(building&&address)return `${BUILDINGS[building]?.building||`${building} корпус`}, ${address}`;if(room&&address)return `аудитория ${room}, ${address}`;return fallback||'';}
function explicitLocationForDate(raw,date,subject,fallback){const dd=date.slice(8,10),mm=date.slice(5,7);const re=new RegExp(`(?:^|\\D)${dd}\\.${mm}\\s*[-–]\\s*([123])-(\\d{3})(?!\\d)`);const m=clean(raw).match(re);if(m){const info=BUILDINGS[m[1]];return `${info?.building||`${m[1]} корпус`}, аудитория ${m[2]}, ${info?.address||''}`.replace(/,\s*$/,'');}return explicitLocation(raw,subject,fallback);}

function parseSemester(sheet){let year=2026,start=null,end=null;for(const c of sheet.cells){const text=clean(c.value);const m=text.match(/(\d{1,2})\.(\d{2})\.(20\d{2}).*?[-–]\s*(\d{1,2})\.(\d{2})\.(20\d{2})/);if(!m)continue;const a=dateObj(Number(m[3]),Number(m[2]),Number(m[1])),b=dateObj(Number(m[6]),Number(m[5]),Number(m[4]));if(a&&b&&b>a){start=a;end=b;year=Number(m[3]);break;}}if(!start||!end){const y=sheet.cells.map(c=>clean(c.value)).map(t=>t.match(/(20\d{2})\s*[-–/]\s*(20\d{2})/)).find(Boolean);year=y?Number(y[2]):2026;start=dateObj(year,1,1);end=dateObj(year,6,30);}return{year,start,end};}
function parseHolidays(sheet,year){const set=new Set();for(const c of sheet.cells){const text=clean(c.value);if(!/праздничные\s+неучебные\s+дни/i.test(text))continue;const tail=text.slice(text.search(/праздничные/i));for(const m of tail.matchAll(DATE_TOKEN_RE)){const d=Number(m[1]),mo=Number(m[2]);if(validDatePart(d,mo,year))set.add(iso(year,mo,d));}}return set;}
function groupHeader(sheet){const rows=new Map();for(const c of sheet.cells){if(!rows.has(c.row))rows.set(c.row,[]);rows.get(c.row).push(c);}let best=null;for(const [row,cells] of rows){const groups=cells.map(c=>{const m=clean(c.value).match(/^(?:группа|гр\.?)\s*(\d{3})$/i);return m?{code:m[1],col:c.col}:null}).filter(Boolean);if(!best||groups.length>best.groups.length)best={row,groups};}return best;}
function scheduleBoundaryRow(sheet,headerRow){const candidates=[];for(const c of sheet.cells){if(c.row<=headerRow)continue;const text=clean(c.value);if(/^факультативы/i.test(text)||(/1\s*недел[яи]/i.test(text)&&/2\s*недел[яи]/i.test(text)&&/празднич/i.test(text)))candidates.push(c.row);}const rows=new Map();for(const c of sheet.cells){if(c.row<=headerRow)continue;if(!rows.has(c.row))rows.set(c.row,[]);rows.get(c.row).push(c);}for(const [row,cells] of rows){if(cells.filter(c=>/^дисциплина$/i.test(clean(c.value))).length>=1)candidates.push(row);}return candidates.length?Math.min(...candidates):Math.max(...sheet.cells.map(c=>c.row))+1;}
function weekdaysByRow(sheet,startRow,endRow){const map=new Map();for(const c of sheet.cells.filter(c=>c.col===1)){const wd=WEEKDAYS.get(clean(c.value).toLowerCase());if(!wd)continue;const merge=sheet.merges.find(m=>m.startRow===c.row&&m.startCol===1);const a=merge?.startRow??c.row,b=merge?.endRow??c.row;for(let row=Math.max(a,startRow);row<=Math.min(b,endRow);row++)map.set(row,wd);}return map;}
function mergeAtAnchor(sheet,c){return sheet.merges.find(m=>m.startRow===c.row&&m.startCol===c.col)||null;}
function sourceRef(c,merge){return merge?.ref||c.ref;}
function makeEvent({group,subject,date,start,end,location,assessment,source,kind,dateMode,note}){const title=kind==='lecture'?`ЛЕКЦ. ${subject.toUpperCase()}`:kind==='control'?`ЗАЧЕТ С ОЦЕНКОЙ — ${subject.toUpperCase()}`:subject;const sourceCell=source.cell;const sourceRange=source.range||source.cell;const idHash=createHash('sha1').update([group,date,start,end,title,sourceCell,sourceRange].join('|')).digest('hex').slice(0,16);return {id:`kgmu-${group}-${date}-${start.replace(':','')}-${idHash}`,group,title,start:toDateTime(date,start),end:toDateTime(date,end),location,assessment:assessment||null,sourceType:'kgmu-xlsx',sourceCell,sourceRange,source:sourceRange,kind,dateMode,note:note||null};}
function controlAtDate(segment,index){const left=segment.slice(Math.max(0,index-40),index);if(/зач[её]т\s+с\s+оценкой\s*[-—:]?\s*$/i.test(left))return true;const right=segment.slice(index).replace(/^\d{1,2}\.\d{2}/,'');return /^\s*[-–—:]?\s*зач[её]т\s+с\s+оценкой/i.test(right);}
function eventTimeForDate(base,switchTime,date){return switchTime&&date>=switchTime.from?{start:switchTime.start,end:switchTime.end}:base;}
function parseSegment(seg,{weekday,year,semesterEnd,holidays,weekTable,group,source,meta}){
  const time=parseTimeBlock(seg.timeRaw);if(!time)return {events:[],inlineExtraFailures:[]};
  const subject=seg.subject;if(subject==='Час куратора')return {events:[],inlineExtraFailures:[]};
  const subjectMeta=meta.get(subject)||{};const tail=seg.raw.slice(seg.subjectEnd-seg.start);
  const exceptions=parseDateTimeExceptions(tail,year);
  const dateRanges=parseDateRanges(tail,year,weekday,semesterEnd);
  const weekThrough=parseWeekThrough(tail,year);
  const switchTime=parseFromTimeSwitch(tail,year);
  const inlineExtras=inlineExtraLessons(tail,year);
  const mask=[...exceptions.map(x=>[x.index,x.endIndex]),...dateRanges.map(x=>[x.index,x.endIndex]),...weekThrough.map(x=>[x.index,x.endIndex]),...inlineExtras.map(x=>[x.index,x.endIndex])];if(switchTime)mask.push([switchTime.index,switchTime.endIndex]);for(const m of tail.matchAll(new RegExp(TIME,'g')))mask.push([m.index,m.index+m[0].length]);
  const explicit=explicitDateTokens(tail,year,mask);const hasControl=/зач[её]т\s+с\s+оценкой/i.test(tail);
  const baseLocationText=seg.raw.replace(/\([^)]*занят(?:ие|ия)[^)]*\)/gi,' ');const location=explicitLocation(baseLocationText,subject,subjectMeta.location);const kindBase=seg.lecture?'lecture':'practical';const result=[];
  const exceptionDates=new Set(exceptions.map(x=>x.date));
  for(const range of dateRanges){for(const date of ranges(range.start,range.end,weekday,holidays)){if(exceptionDates.has(date))continue;const t=eventTimeForDate(time,switchTime,date);result.push(makeEvent({group,subject,date,start:t.start,end:t.end,location,assessment:subjectMeta.assessment,source,kind:kindBase,dateMode:'range',note:range.note}));}}
  for(const spec of weekThrough){for(const date of datesForWeek(weekTable,spec.week,weekday,spec.through,holidays)){if(exceptionDates.has(date))continue;const t=eventTimeForDate(time,switchTime,date);result.push(makeEvent({group,subject,date,start:t.start,end:t.end,location,assessment:subjectMeta.assessment,source,kind:kindBase,dateMode:`week-${spec.week}`,note:null}));}}
  for(const ex of exceptions){const control=hasControl&&controlNear(tail,ex.index);result.push(makeEvent({group,subject,date:ex.date,start:ex.start,end:ex.end,location:explicitLocationForDate(seg.raw,ex.date,subject,location),assessment:subjectMeta.assessment,source,kind:control?'control':kindBase,dateMode:'explicit',note:null}));}
  const inlineExtraFailures=[];for(const extra of inlineExtras){if(!extra.dates.length)continue;if(extra.dates.length!==extra.count)inlineExtraFailures.push({group,subject,source:source.range,declared:extra.count,actual:extra.dates.length});const extraTime=extra.time||time;const extraLocation=explicitLocation(extra.body,subject,location);for(const date of extra.dates){result.push(makeEvent({group,subject,date,start:extraTime.start,end:extraTime.end,location:extraLocation,assessment:subjectMeta.assessment,source,kind:kindBase,dateMode:'explicit-extra',note:null}));}}
  for(const ex of explicit){if(exceptionDates.has(ex.date))continue;const control=hasControl&&controlAtDate(tail,ex.index);const t=eventTimeForDate(time,switchTime,ex.date);result.push(makeEvent({group,subject,date:ex.date,start:t.start,end:t.end,location:explicitLocationForDate(seg.raw,ex.date,subject,location),assessment:subjectMeta.assessment,source,kind:control?'control':kindBase,dateMode:'explicit',note:null}));}
  return {events:result,inlineExtraFailures};
}
function parseCurator({group,weekday,year,semesterStart,semesterEnd,holidays,time,source}){const dates=ranges(semesterStart,semesterEnd,weekday,holidays).slice(0,2);return dates.map(date=>makeEvent({group,subject:'Час куратора',date,start:time.start,end:time.end,location:'',assessment:null,source,kind:'curator',dateMode:'derived'}));}
function dedupe(events){const seen=new Set();return events.filter(e=>{const k=[e.group,e.start,e.end,e.title,e.location].join('|');if(seen.has(k))return false;seen.add(k);return true;});}
function resolveExplicitOverrides(events){const byKey=new Map();for(const e of events){const key=[e.group,e.start.slice(0,10),e.title].join('|');if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(e);}const remove=new Set();for(const list of byKey.values()){const explicit=list.filter(e=>String(e.dateMode).startsWith('explicit'));if(!explicit.length)continue;for(const e of list){if(!String(e.dateMode).startsWith('explicit'))remove.add(e.id);}}return events.filter(e=>!remove.has(e.id));}
function dateWeekday(date){const d=new Date(`${date}T12:00:00Z`);return weekdayIso(d);}
function extraLessonExpectations(anchors,year){const result=[];for(const anchor of anchors){const text=clean(anchor.cell.value);for(const seg of segmentStarts(text)){for(const m of seg.raw.matchAll(/\((\d+)\s+занят(?:ие|ия)\s+в(?:о)?\s+(пн|вт|ср|чт|пт|сб)\.?\s*([^)]*)\)/gi)){const body=m[3]||'';if([...body.matchAll(DATE_TOKEN_RE)].some(x=>validDatePart(Number(x[1]),Number(x[2]),year)))continue;const weekday=WEEKDAYS.get(m[2].toLowerCase());for(const group of anchor.groups)result.push({group,subject:seg.subject,count:Number(m[1]),weekday,source:anchor.source.range});}}}return result;}
function validateExtraLessons(events,expectations){const failures=[];for(const expected of expectations){const matches=events.filter(e=>e.group===expected.group&&e.title===expected.subject&&e.kind==='practical'&&String(e.dateMode).startsWith('explicit')&&dateWeekday(e.start.slice(0,10))===expected.weekday&&e.sourceRange!==expected.source);if(matches.length!==expected.count)failures.push({...expected,actual:matches.length,eventIds:matches.map(e=>e.id)});}return failures;}
function findOverlaps(events){const byGroup=new Map();for(const e of events){if(!byGroup.has(e.group))byGroup.set(e.group,[]);byGroup.get(e.group).push(e);}const result=[];for(const [group,list] of byGroup){const sorted=[...list].sort((a,b)=>a.start.localeCompare(b.start));for(let i=0;i<sorted.length;i++){for(let j=i+1;j<sorted.length;j++){if(sorted[j].start.slice(0,10)!==sorted[i].start.slice(0,10))break;if(sorted[j].start>=sorted[i].end)break;if(overlaps(sorted[i],sorted[j]))result.push({group,event1:sorted[i].id,event2:sorted[j].id,start1:sorted[i].start,end1:sorted[i].end,start2:sorted[j].start,end2:sorted[j].end});}}}return result;}
function deriveSemester(sheet){const text=sheet.cells.map(c=>clean(c.value)).join(' ').toLowerCase();if(/перв(?:ое|ый)\s+(?:полугодие|семестр)/i.test(text))return 1;if(/втор(?:ое|ой)\s+(?:полугодие|семестр)/i.test(text))return 2;return null;}
function deriveAcademicYear(sheet){for(const c of sheet.cells){const m=clean(c.value).match(/(20\d{2})\s*[-–/]\s*(20\d{2})/);if(m&&Number(m[2])===Number(m[1])+1)return `${m[1]}/${String(m[2]).slice(-2)}`;}return null;}

export function parseWeeklyRWorkbook(workbook,{university='kgmu',program='medicine',course=1,academicYear=null,semester=null,scheduleEndRow=null}={}){
  const sheet=workbook?.sheets?.[0];if(!sheet)throw new Error('Workbook has no sheet');
  const resolvedAcademicYear=academicYear||deriveAcademicYear(sheet);const resolvedSemester=semester||deriveSemester(sheet);const header=groupHeader(sheet);if(!header||header.groups.length<2)throw new Error('Weekly group header not found');
  const semesterInfo=parseSemester(sheet);const holidays=parseHolidays(sheet,semesterInfo.year);const weekTable=parseWeekTable(sheet,semesterInfo.year);const footerRow=scheduleEndRow?Number(scheduleEndRow)+1:scheduleBoundaryRow(sheet,header.row);const startRow=header.row+1,endRow=footerRow-1;const weekdayMap=weekdaysByRow(sheet,startRow,endRow);const meta=parseFooter(sheet);const colToGroup=new Map(header.groups.map(g=>[g.col,g.code]));
  const anchors=[];for(const c of sheet.cells){if(c.row<startRow||c.row>endRow||!colToGroup.has(c.col))continue;const containing=sheet.merges.find(m=>c.row>=m.startRow&&c.row<=m.endRow&&c.col>=m.startCol&&c.col<=m.endCol);if(containing&&(containing.startRow!==c.row||containing.startCol!==c.col))continue;const merge=mergeAtAnchor(sheet,c);const groups=header.groups.filter(g=>g.col>=(merge?.startCol??c.col)&&g.col<=(merge?.endCol??c.col)).map(g=>g.code);if(!groups.length)continue;anchors.push({cell:c,merge,groups,source:{cell:c.ref,range:sourceRef(c,merge)},weekday:weekdayMap.get(c.row)});}
  const expectations=extraLessonExpectations(anchors,semesterInfo.year);const events=[];const uncovered=[];const inlineExtraFailures=[];
  for(const anchor of anchors){if(!anchor.weekday){uncovered.push({source:anchor.source.range,reason:'weekday-not-found'});continue;}const text=clean(anchor.cell.value);const segs=segmentStarts(text);if(!segs.length){uncovered.push({source:anchor.source.range,reason:'segments-not-found',text});continue;}let produced=0;for(const group of anchor.groups){for(const seg of segs){if(seg.subject==='Час куратора'){const time=parseTimeBlock(seg.timeRaw);const ev=parseCurator({group,weekday:anchor.weekday,year:semesterInfo.year,semesterStart:semesterInfo.start,semesterEnd:semesterInfo.end,holidays,time,source:anchor.source});events.push(...ev);produced+=ev.length;}else{const parsed=parseSegment(seg,{weekday:anchor.weekday,year:semesterInfo.year,semesterEnd:semesterInfo.end,holidays,weekTable,group,source:anchor.source,meta});events.push(...parsed.events);inlineExtraFailures.push(...parsed.inlineExtraFailures);produced+=parsed.events.length;}}}if(!produced)uncovered.push({source:anchor.source.range,reason:'no-events',text});}
  const final=resolveExplicitOverrides(dedupe(events));const extraLessonFailures=validateExtraLessons(final,expectations);const remainingOverlaps=findOverlaps(final);const byGroup=new Map(header.groups.map(g=>[g.code,[]]));for(const e of final)byGroup.get(e.group)?.push(e);const schedules=[];for(const g of header.groups){schedules.push({version:1,university,universityName:'КГМУ',program,course,academicYear:resolvedAcademicYear,semester:resolvedSemester,timezone:'Europe/Moscow',group:{id:`kgmu:${program}:${course}:${g.code}`,code:g.code,displayName:`Группа ${g.code}`},sources:[],events:byGroup.get(g.code).sort((a,b)=>a.start.localeCompare(b.start)||a.title.localeCompare(b.title))});}
  const qa={status:uncovered.length||extraLessonFailures.length||inlineExtraFailures.length||remainingOverlaps.length?'REVIEW_REQUIRED':'PASS',sourceAnchorCount:anchors.length,coveredSourceAnchors:anchors.length-uncovered.length,uncovered,extraLessonExpectations:expectations,extraLessonFailures,inlineExtraFailures,remainingOverlaps,holidays:[...holidays].sort(),weekTable:{1:(weekTable[1]||[]).length,2:(weekTable[2]||[]).length},eventCount:final.length,eventCountsByGroup:Object.fromEntries(schedules.map(s=>[s.group.code,s.events.length]))};
  return {schedules,qa};
}

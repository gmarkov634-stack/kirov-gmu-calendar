import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const SOURCES = [
  { language: "ru", url: "https://kirovgma.ru/sites/default/files/files/2026/01/13/2037/6_kurs_fio-13-01-2026-08.xlsx" },
  { language: "en", url: "https://kirovgma.ru/sites/default/files/files/2026/01/12/2037/6_lech._fio_perevod-12-01-2026-10.xlsx" },
];
const UA = "Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";
function clean(v) { return String(v ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim(); }
function groupCode(v) { const m = clean(v).match(/^(\d{3})\s*-?\s*([иi])$/i); return m ? `${m[1]}и` : null; }
function ref(col,row){ let n=col,s=""; while(n>0){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);} return `${s}${row}`; }
function rowsOf(sheet){ const rows=new Map(); for(const c of sheet.cells||[]){if(!rows.has(c.row))rows.set(c.row,[]);rows.get(c.row).push(c);} return rows; }
function monthNumber(v){ const t=clean(v).toLowerCase(); const names=[[1,/январ|january/],[2,/феврал|february/],[3,/март|march/],[4,/апрел|april/],[5,/май|мая|may/],[6,/июн|june/]]; return names.find(([,r])=>r.test(t))?.[0]||null; }
function dateMap(sheet,rows,dateRow){
  const monthRows=[...rows.entries()].filter(([r])=>r<dateRow&&r>=dateRow-3).sort((a,b)=>b[0]-a[0]);
  const monthRow=monthRows.find(([,cs])=>cs.some(c=>monthNumber(c.value)))?.[0];
  const starts=(rows.get(monthRow)||[]).map(c=>({col:c.col,month:monthNumber(c.value)})).filter(x=>x.month).sort((a,b)=>a.col-b.col);
  const out=new Map(); for(const c of rows.get(dateRow)||[]){const d=Number(c.value);if(!Number.isInteger(d)||d<1||d>31)continue;const m=[...starts].reverse().find(x=>x.col<=c.col)?.month;if(m)out.set(c.col,`2026-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`);} return out;
}
function fillAt(styled,row,col){ return styled.get(`${row}|${col}`)?.fillId ?? null; }
function styleAt(styled,row,col){ return styled.get(`${row}|${col}`)?.styleId ?? null; }
function spanFor(styled,row,col,dates){
  const fill=fillAt(styled,row,col); if(!fill)return null;
  let left=col,right=col; while(dates.has(left-1)&&fillAt(styled,row,left-1)===fill)left--; while(dates.has(right+1)&&fillAt(styled,row,right+1)===fill)right++;
  return {fillId:fill,styleId:styleAt(styled,row,col),startCol:left,endCol:right,startDate:dates.get(left),endDate:dates.get(right),days:right-left+1};
}
function inspect(workbook){
  const sheet=workbook.sheets[0], rows=rowsOf(sheet);
  const dateRow=[...rows.entries()].find(([,cs])=>cs.filter(c=>{const n=Number(c.value);return Number.isInteger(n)&&n>=1&&n<=31;}).length>=10)?.[0];
  const dates=dateMap(sheet,rows,dateRow);
  const groupRows=[]; for(const [row,cs] of rows){const hit=cs.find(c=>groupCode(c.value));if(hit)groupRows.push({row,group:groupCode(hit.value)});}
  const groupRowSet=new Set(groupRows.map(x=>x.row));
  const styled=new Map((sheet.styledCells||[]).map(c=>[`${c.row}|${c.col}`,c]));
  const markerRx=/(\*|ДВ\.?\s*\d+|Электив|elective|самостоятель|individual work|^СР$|^ГИА$|final state|^экзамен$|^exam$)/i;
  const markers=[];
  for(const {row,group} of groupRows){
    for(const c of rows.get(row)||[]){const text=clean(c.value);if(!text||!markerRx.test(text))continue;markers.push({group,cell:c.ref,text,date:dates.get(c.col)||null,...(spanFor(styled,row,c.col,dates)||{})});}
  }
  const outsideSpecial=(sheet.cells||[]).filter(c=>!groupRowSet.has(c.row)&&/(\*|три дня|3 days|перв.*смен|first.*part|самостоятель|individual work|ГИА|final state)/i.test(clean(c.value))).map(c=>({cell:c.ref,row:c.row,text:clean(c.value),fillId:fillAt(styled,c.row,c.col),styleId:styleAt(styled,c.row,c.col)}));
  const footerHeader=[...rows.entries()].find(([,cs])=>cs.some(c=>/^(?:дисциплина|academic\s+discipline)$/i.test(clean(c.value))))?.[0];
  const footer=[];
  if(footerHeader){
    for(let row=footerHeader+2;row<=footerHeader+22;row++){
      const cs=rows.get(row)||[]; const discipline=cs.find(c=>c.col>=3&&c.col<18&&clean(c.value))?.value; if(!discipline)continue;
      const dc=cs.find(c=>c.col>=3&&c.col<18&&clean(c.value));
      const times=cs.filter(c=>/(\d{1,2})[.:]\d{2}\s*[-–]\s*(\d{1,2})[.:]\d{2}/.test(clean(c.value))).map(c=>`${c.ref}=${clean(c.value)}`);
      footer.push({row,discipline:clean(discipline),cell:dc?.ref,fillId:dc?fillAt(styled,row,dc.col):null,styleId:dc?styleAt(styled,row,dc.col):null,times});
    }
  }
  const starBlocks=markers.filter(x=>x.text.includes("*"));
  const electiveBlocks=markers.filter(x=>/ДВ|Электив|elective/i.test(x.text));
  const serviceBlocks=markers.filter(x=>/самостоятель|individual work|^СР$|^ГИА$|final state|^экзамен$|^exam$/i.test(x.text));
  return {sheet:sheet.name,groups:groupRows.map(x=>x.group),dateRow,starBlocks,electiveBlocks,serviceBlocks,outsideSpecial,footer};
}
async function probe(source){
  const res=await fetch(source.url,{headers:{"user-agent":UA,referer:"https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya"}}); const buf=Buffer.from(await res.arrayBuffer());
  if(!res.ok||buf[0]!==0x50||buf[1]!==0x4b)throw new Error(`${source.language} invalid XLSX`);
  const workbook=await readKgmuXlsxStructure(buf); return {source:{...source,bytes:buf.length},classification:classifyKgmuWorkbook(workbook),inspection:inspect(workbook)};
}
const results=[]; for(const s of SOURCES)results.push(await probe(s)); console.log(JSON.stringify(results,null,2));

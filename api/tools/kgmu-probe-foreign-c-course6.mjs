import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const SOURCES = [
  { language: "ru", url: "https://kirovgma.ru/sites/default/files/files/2026/01/13/2037/6_kurs_fio-13-01-2026-08.xlsx" },
  { language: "en", url: "https://kirovgma.ru/sites/default/files/files/2026/01/12/2037/6_lech._fio_perevod-12-01-2026-10.xlsx" },
];
const UA="Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";
function clean(v){return String(v??"").replace(/\u00a0/g," ").replace(/\s+/g," ").trim();}
function groupCode(v){const m=clean(v).match(/^(\d{3})\s*-?\s*([иi])$/i);return m?`${m[1]}и`:null;}
function rowsOf(sheet){const m=new Map();for(const c of sheet.cells||[]){if(!m.has(c.row))m.set(c.row,[]);m.get(c.row).push(c);}return m;}
function monthNumber(v){const t=clean(v).toLowerCase();for(const [n,r] of [[1,/январ|january/],[2,/феврал|february/],[3,/март|march/],[4,/апрел|april/],[5,/май|мая|may/],[6,/июн|june/]])if(r.test(t))return n;return null;}
function dateMap(rows,dateRow){const mr=[...rows.entries()].filter(([r])=>r<dateRow&&r>=dateRow-3).sort((a,b)=>b[0]-a[0]).find(([,cs])=>cs.some(c=>monthNumber(c.value)))?.[0];const starts=(rows.get(mr)||[]).map(c=>({col:c.col,m:monthNumber(c.value)})).filter(x=>x.m).sort((a,b)=>a.col-b.col);const out=new Map();for(const c of rows.get(dateRow)||[]){const d=Number(c.value);if(!Number.isInteger(d)||d<1||d>31)continue;const m=[...starts].reverse().find(x=>x.col<=c.col)?.m;if(m)out.set(c.col,`2026-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`);}return out;}
function inspect(workbook){
  const sheet=workbook.sheets[0],rows=rowsOf(sheet),styled=new Map((sheet.styledCells||[]).map(c=>[`${c.row}|${c.col}`,c]));
  const dateRow=[...rows.entries()].find(([,cs])=>cs.filter(c=>{const n=Number(c.value);return Number.isInteger(n)&&n>=1&&n<=31;}).length>=10)?.[0];const dates=dateMap(rows,dateRow);
  const groupRows=[];for(const [row,cs] of rows){const g=cs.find(c=>groupCode(c.value));if(g)groupRows.push({row,group:groupCode(g.value)});}
  const oncology=[];
  for(const {row,group} of groupRows){for(const c of rows.get(row)||[]){if(!/онколог|oncology/i.test(clean(c.value)))continue;const anchor=styled.get(`${row}|${c.col}`);const fill=anchor?.fillId;let l=c.col,r=c.col;while(dates.has(l-1)&&styled.get(`${row}|${l-1}`)?.fillId===fill)l--;while(dates.has(r+1)&&styled.get(`${row}|${r+1}`)?.fillId===fill)r++;const cells=[];for(let col=l;col<=r;col++){const s=styled.get(`${row}|${col}`);cells.push({date:dates.get(col),col,styleId:s?.styleId??null,fillId:s?.fillId??null,text:clean((rows.get(row)||[]).find(x=>x.col===col)?.value)});}oncology.push({group,anchor:c.ref,text:clean(c.value),fillId:fill,startDate:dates.get(l),endDate:dates.get(r),days:r-l+1,cells});}}
  const allSpecial=(sheet.cells||[]).filter(c=>/(\*|три дня|3 days|онколог|oncology)/i.test(clean(c.value))).map(c=>({cell:c.ref,row:c.row,col:c.col,text:clean(c.value),styleId:styled.get(`${c.row}|${c.col}`)?.styleId??null,fillId:styled.get(`${c.row}|${c.col}`)?.fillId??null}));
  const electiveMarkers=[];for(const {row,group} of groupRows){for(const c of rows.get(row)||[]){const t=clean(c.value);if(/ДВ|Электив|elective/i.test(t))electiveMarkers.push({group,cell:c.ref,date:dates.get(c.col),text:t,styleId:styled.get(`${row}|${c.col}`)?.styleId??null,fillId:styled.get(`${row}|${c.col}`)?.fillId??null});}}
  return {sheet:sheet.name,groups:groupRows.map(x=>x.group),oncology,allSpecial,electiveMarkers};
}
async function probe(source){const res=await fetch(source.url,{headers:{"user-agent":UA,referer:"https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya"}});const buf=Buffer.from(await res.arrayBuffer());if(!res.ok||buf[0]!==0x50||buf[1]!==0x4b)throw new Error("invalid XLSX");const wb=await readKgmuXlsxStructure(buf);return {source,classification:classifyKgmuWorkbook(wb),inspection:inspect(wb)};}
const results=[];for(const s of SOURCES)results.push(await probe(s));console.log(JSON.stringify(results,null,2));

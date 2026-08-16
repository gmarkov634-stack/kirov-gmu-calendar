import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';

function arg(name, fallback = null) { const i=process.argv.indexOf(name); return i>=0 ? process.argv[i+1] : fallback; }
const norm=(v)=>String(v??'').replace(/\s+/g,' ').trim();
const inputDir=path.resolve(arg('--input-dir','/tmp/izhgmu-current'));
const report=JSON.parse(await fs.readFile(path.join(inputDir,'download-report.json'),'utf8'));
const source=report.files.find((x)=>x.status==='downloaded'&&x.faculty==='medicine'&&Number(x.course)===3&&x.language==='ru'&&x.term==='spring'&&x.sourceKind==='lecture');
if(!source) throw new Error('medicine-3 lecture source missing');
const buf=await fs.readFile(path.join(inputDir,source.filename));
if(crypto.createHash('sha256').update(buf).digest('hex')!==source.sha256) throw new Error('lecture SHA mismatch');
const structure=await readIzhgmuXlsxStructure(buf);
const fillByStyle=new Map(structure.styles.map((s)=>[s.styleId,s.fillId]));
const sheets=structure.sheets.map((sheet)=>{
  const byRow=new Map();
  for(const cell of sheet.cells){
    const value=norm(cell.value); if(!value) continue;
    if(!byRow.has(cell.row)) byRow.set(cell.row,[]);
    byRow.get(cell.row).push({ref:cell.ref,row:cell.row,col:cell.col,value,styleId:cell.styleId,fillId:cell.styleId==null?null:(fillByStyle.get(cell.styleId)??null)});
  }
  const rowSummaries=[...byRow.entries()]
    .filter(([row])=>row>=6)
    .sort((a,b)=>a[0]-b[0])
    .map(([row,cells])=>({
      row,
      day:cells.find((c)=>c.col===1)?.value||null,
      time:cells.find((c)=>c.col===2)?.value||null,
      discipline:cells.find((c)=>c.col===3)?.value||null,
      location:cells.find((c)=>c.col===4)?.value||null,
      dates:cells.filter((c)=>c.col>=5&&c.col<=22).map((c)=>({ref:c.ref,value:c.value,styleId:c.styleId,fillId:c.fillId})),
      count:cells.find((c)=>c.col===23)?.value||null,
      other:cells.filter((c)=>c.col>23).map((c)=>({ref:c.ref,value:c.value,styleId:c.styleId,fillId:c.fillId})),
    }));
  return {
    name:sheet.name,
    cells:sheet.cells.length,
    merges:sheet.merges.length,
    rowSummaries,
    streamRangeCells:sheet.cells.filter((c)=>/поток|30[1-9]|31[0-9]|32[0-9]/i.test(norm(c.value))).map((c)=>({ref:c.ref,row:c.row,col:c.col,value:norm(c.value),styleId:c.styleId,fillId:c.styleId==null?null:(fillByStyle.get(c.styleId)??null)})),
  };
});
const fillUsage={};
for(const sheet of sheets) for(const row of sheet.rowSummaries) for(const d of row.dates){
  const key=String(d.fillId); fillUsage[key]=(fillUsage[key]||0)+1;
}
const out={version:3,source,styles:structure.styles,fillUsage,sheets};
await fs.writeFile(path.join(inputDir,'medicine3-lecture-diagnostic.json'),`${JSON.stringify(out,null,2)}\n`);
console.log('IZHGMU_MEDICINE3_LECTURE_SOURCE',JSON.stringify({filename:source.filename,sha256:source.sha256,sheets:sheets.map((s)=>s.name),fillUsage}));
for(const s of sheets){
  console.log('SHEET',s.name);
  console.log('STREAM_RANGE_CELLS',JSON.stringify(s.streamRangeCells));
  for(const row of s.rowSummaries) console.log('LECTURE_ROW',JSON.stringify(row));
}

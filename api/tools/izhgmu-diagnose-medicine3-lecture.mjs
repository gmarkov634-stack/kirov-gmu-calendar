import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readIzhgmuXlsxStructure } from '../src/adapters/izhgmu/xlsx-reader.mjs';

const execFileAsync=promisify(execFile);
function arg(name, fallback = null) { const i=process.argv.indexOf(name); return i>=0 ? process.argv[i+1] : fallback; }
const norm=(v)=>String(v??'').replace(/\s+/g,' ').trim();
const attr=(s,n)=>String(s||'').match(new RegExp(`\\b${n}="([^"]*)"`))?.[1]??null;
function parseFillDefinitions(xml){
  const section=String(xml||'').match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/)?.[1]||'';
  return [...section.matchAll(/<fill\b[^>]*>([\s\S]*?)<\/fill>/g)].map((m,fillId)=>{
    const body=m[1];
    const pf=body.match(/<patternFill\b([^>]*)>([\s\S]*?)<\/patternFill>|<patternFill\b([^>]*)\/>/);
    const attrs=pf?.[1]||pf?.[3]||''; const inner=pf?.[2]||'';
    const fg=inner.match(/<fgColor\b([^>]*)\/?\s*>/)?.[1]||'';
    const bg=inner.match(/<bgColor\b([^>]*)\/?\s*>/)?.[1]||'';
    return {fillId,patternType:attr(attrs,'patternType'),fg:{rgb:attr(fg,'rgb'),indexed:attr(fg,'indexed'),theme:attr(fg,'theme'),tint:attr(fg,'tint')},bg:{rgb:attr(bg,'rgb'),indexed:attr(bg,'indexed'),theme:attr(bg,'theme'),tint:attr(bg,'tint')}};
  });
}
const inputDir=path.resolve(arg('--input-dir','/tmp/izhgmu-current'));
const report=JSON.parse(await fs.readFile(path.join(inputDir,'download-report.json'),'utf8'));
const source=report.files.find((x)=>x.status==='downloaded'&&x.faculty==='medicine'&&Number(x.course)===3&&x.language==='ru'&&x.term==='spring'&&x.sourceKind==='lecture');
if(!source) throw new Error('medicine-3 lecture source missing');
const filename=path.join(inputDir,source.filename);
const buf=await fs.readFile(filename);
if(crypto.createHash('sha256').update(buf).digest('hex')!==source.sha256) throw new Error('lecture SHA mismatch');
const structure=await readIzhgmuXlsxStructure(buf);
const {stdout:stylesXml}=await execFileAsync('unzip',['-p',filename,'xl/styles.xml'],{encoding:'utf8',maxBuffer:16*1024*1024});
const fillDefinitions=parseFillDefinitions(stylesXml);
const fillByStyle=new Map(structure.styles.map((s)=>[s.styleId,s.fillId]));
const fillDefById=new Map(fillDefinitions.map((f)=>[f.fillId,f]));
const sheets=structure.sheets.map((sheet)=>{
  const byRow=new Map();
  for(const cell of sheet.cells){
    const value=norm(cell.value); if(!value) continue;
    if(!byRow.has(cell.row)) byRow.set(cell.row,[]);
    const fillId=cell.styleId==null?null:(fillByStyle.get(cell.styleId)??null);
    byRow.get(cell.row).push({ref:cell.ref,row:cell.row,col:cell.col,value,styleId:cell.styleId,fillId,fill:fillId==null?null:(fillDefById.get(fillId)||null)});
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
      dates:cells.filter((c)=>c.col>=5&&c.col<=22).map((c)=>({ref:c.ref,value:c.value,styleId:c.styleId,fillId:c.fillId,fill:c.fill})),
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
for(const sheet of sheets) for(const row of sheet.rowSummaries) for(const d of row.dates){ const key=String(d.fillId); fillUsage[key]=(fillUsage[key]||0)+1; }
const usedFillDefinitions=Object.keys(fillUsage).map(Number).sort((a,b)=>a-b).map((id)=>fillDefById.get(id)||{fillId:id});
const out={version:4,source,styles:structure.styles,fillDefinitions:usedFillDefinitions,fillUsage,sheets};
await fs.writeFile(path.join(inputDir,'medicine3-lecture-diagnostic.json'),`${JSON.stringify(out,null,2)}\n`);
console.log('IZHGMU_MEDICINE3_LECTURE_SOURCE',JSON.stringify({filename:source.filename,sha256:source.sha256,sheets:sheets.map((s)=>s.name),fillUsage,fillDefinitions:usedFillDefinitions}));
for(const s of sheets){
  console.log('SHEET',s.name);
  console.log('STREAM_RANGE_CELLS',JSON.stringify(s.streamRangeCells));
  for(const row of s.rowSummaries) console.log('LECTURE_ROW',JSON.stringify(row));
}

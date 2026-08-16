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
const sheets=structure.sheets.map((sheet)=>({
  name:sheet.name,
  cells:sheet.cells.length,
  merges:sheet.merges.length,
  firstNonEmpty:sheet.cells.filter((c)=>norm(c.value)).slice(0,180).map((c)=>({ref:c.ref,row:c.row,col:c.col,value:norm(c.value)})),
  streamRangeCells:sheet.cells.filter((c)=>/поток|30[1-9]|31[0-9]|32[0-9]/i.test(norm(c.value))).slice(0,100).map((c)=>({ref:c.ref,value:norm(c.value)})),
}));
const out={version:1,source,sheets};
await fs.writeFile(path.join(inputDir,'medicine3-lecture-diagnostic.json'),`${JSON.stringify(out,null,2)}\n`);
console.log('IZHGMU_MEDICINE3_LECTURE_SOURCE',JSON.stringify({filename:source.filename,sha256:source.sha256,sheets:sheets.map((s)=>s.name)}));
for(const s of sheets){ console.log('SHEET',s.name); console.log('STREAM_RANGE_CELLS',JSON.stringify(s.streamRangeCells)); console.log('FIRST_NONEMPTY',JSON.stringify(s.firstNonEmpty)); }

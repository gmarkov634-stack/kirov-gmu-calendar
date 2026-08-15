import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const execFileAsync=promisify(execFile);
const CELL_REF=/^([A-Z]+)(\d+)$/;
function xmlDecode(value){return String(value||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').replace(/&#(\d+);/g,(_,c)=>String.fromCodePoint(Number(c))).replace(/&#x([0-9a-f]+);/gi,(_,c)=>String.fromCodePoint(Number.parseInt(c,16)));}
function attr(source,name){const m=String(source||'').match(new RegExp(`\\b${name}="([^"]*)"`)); return m?xmlDecode(m[1]):null;}
function colNumber(letters){let r=0; for(const ch of String(letters||'')) r=r*26+ch.charCodeAt(0)-64; return r;}
function refParts(ref){const m=String(ref||'').match(CELL_REF); return m?{ref,col:colNumber(m[1]),row:Number(m[2])}:null;}
function textPieces(xml){return [...String(xml||'').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m=>xmlDecode(m[1]));}
function richRuns(inner){
  const runs=[];
  for(const m of String(inner||'').matchAll(/<r\b[^>]*>([\s\S]*?)<\/r>/g)){
    const body=m[1]; const props=body.match(/<rPr\b[^>]*>([\s\S]*?)<\/rPr>/)?.[1]||'';
    const text=textPieces(body).join('');
    if(text) runs.push({text, underline:/<u(?:\s[^>]*)?\/?\s*>/i.test(props), bold:/<b(?:\s[^>]*)?\/?\s*>/i.test(props), italic:/<i(?:\s[^>]*)?\/?\s*>/i.test(props)});
  }
  if(!runs.length){const text=textPieces(inner).join(''); if(text) runs.push({text,underline:false,bold:false,italic:false});}
  return runs;
}
function sharedStrings(xml){if(!xml)return[]; return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map(m=>{const runs=richRuns(m[1]);return {text:runs.map(r=>r.text).join(''),runs};});}
function inlineRich(body){const inner=String(body||'').match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1]||String(body||''); const runs=richRuns(inner);return {text:runs.map(r=>r.text).join(''),runs};}
function cellValue(attributes,body,strings){const type=attr(attributes,'t'); if(type==='inlineStr') return inlineRich(body); const raw=String(body||'').match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]; if(raw==null){const r=inlineRich(body); return r.text?r:{text:'',runs:[]};} const decoded=xmlDecode(raw); if(type==='s') return strings[Number(decoded)]??{text:'',runs:[]}; if(type==='str') return {text:decoded,runs:[{text:decoded,underline:false,bold:false,italic:false}]}; if(type==='b') return {text:decoded==='1'?'TRUE':'FALSE',runs:[]}; return {text:decoded,runs:[]};}
async function unzipText(filename,entry,{maxBuffer=32*1024*1024}={}){try{const {stdout}=await execFileAsync('unzip',['-p',filename,entry],{encoding:'utf8',timeout:15000,maxBuffer});return stdout;}catch(e){if(e?.code===11||/filename not matched/i.test(String(e?.stderr||'')))return'';throw e;}}
function workbookSheetRefs(xml){return [...String(xml||'').matchAll(/<sheet\b([^>]*)\/?\s*>/g)].map(m=>({name:attr(m[1],'name'),relId:attr(m[1],'r:id')})).filter(s=>s.name&&s.relId);}
function workbookRelationships(xml){const out=new Map(); for(const m of String(xml||'').matchAll(/<Relationship\b([^>]*)\/?\s*>/g)){const id=attr(m[1],'Id'),target=attr(m[1],'Target'); if(id&&target)out.set(id,target);} return out;}
function sheetEntry(target){const n=String(target||'').replace(/^\/+/, ''); if(n.startsWith('xl/'))return n; if(n.startsWith('../'))return n.replace(/^\.\.\//,''); return `xl/${n}`;}
function parseSheet(xml,strings,name){const cells=[]; for(const m of String(xml||'').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){const p=refParts(attr(m[1],'r')); if(!p)continue; const rich=cellValue(m[1],m[2]||'',strings); if(!rich.text)continue; cells.push({...p,value:rich.text,runs:rich.runs,styleId:attr(m[1],'s')==null?null:Number(attr(m[1],'s'))});}
 const merges=[]; for(const m of String(xml||'').matchAll(/<mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"[^>]*\/?\s*>/g)){const s=refParts(m[1]),e=refParts(m[2]); if(s&&e)merges.push({ref:`${m[1]}:${m[2]}`,startRef:m[1],endRef:m[2],startRow:s.row,endRow:e.row,startCol:s.col,endCol:e.col});}
 return {name,cells,merges};}

export function parseIzhgmuSharedStringsXml(xml) { return sharedStrings(String(xml || '')); }
export function parseIzhgmuWorksheetXml(xml, strings = [], name = 'sheet') { return parseSheet(String(xml || ''), strings, name); }

export async function readIzhgmuXlsxStructure(buffer){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'izhgmu-xlsx-')); const filename=path.join(dir,`${randomUUID()}.xlsx`); try{await fs.writeFile(filename,buffer); const wb=await unzipText(filename,'xl/workbook.xml'); const rel=await unzipText(filename,'xl/_rels/workbook.xml.rels'); const strings=sharedStrings(await unzipText(filename,'xl/sharedStrings.xml')); const rels=workbookRelationships(rel); const sheets=[]; for(const s of workbookSheetRefs(wb)){const target=rels.get(s.relId);if(!target)continue;const xml=await unzipText(filename,sheetEntry(target));if(xml)sheets.push(parseSheet(xml,strings,s.name));} return {sheets};}finally{await fs.rm(dir,{recursive:true,force:true});}}
if(import.meta.url===`file://${process.argv[1]}`){const buf=await fs.readFile(process.argv[2]); const st=await readIzhgmuXlsxStructure(buf); console.log(JSON.stringify(st.sheets[0].cells.filter(c=>['K10','C24','E28'].includes(c.ref)),null,2));}

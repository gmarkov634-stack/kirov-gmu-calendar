import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);
const CELL_REF = /^([A-Z]+)(\d+)$/;

function xmlDecode(value) {
  return String(value || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, c) => String.fromCodePoint(Number(c)))
    .replace(/&#x([0-9a-f]+);/gi, (_, c) => String.fromCodePoint(Number.parseInt(c, 16)));
}
function attr(source, name) {
  const match = String(source || '').match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? xmlDecode(match[1]) : null;
}
function colNumber(letters) {
  let result = 0;
  for (const ch of String(letters || '')) result = result * 26 + ch.charCodeAt(0) - 64;
  return result;
}
function refParts(ref) {
  const match = String(ref || '').match(CELL_REF);
  return match ? { ref, col: colNumber(match[1]), row: Number(match[2]) } : null;
}
function textPieces(xml) {
  return [...String(xml || '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((match) => xmlDecode(match[1]));
}
function richRuns(inner) {
  const runs = [];
  for (const match of String(inner || '').matchAll(/<r\b[^>]*>([\s\S]*?)<\/r>/g)) {
    const body = match[1];
    const props = body.match(/<rPr\b[^>]*>([\s\S]*?)<\/rPr>/)?.[1] || '';
    const text = textPieces(body).join('');
    if (text) runs.push({
      text,
      underline: /<u(?:\s[^>]*)?\/?\s*>/i.test(props),
      bold: /<b(?:\s[^>]*)?\/?\s*>/i.test(props),
      italic: /<i(?:\s[^>]*)?\/?\s*>/i.test(props),
    });
  }
  if (!runs.length) {
    const text = textPieces(inner).join('');
    if (text) runs.push({ text, underline: false, bold: false, italic: false });
  }
  return runs;
}
function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const runs = richRuns(match[1]);
    return { text: runs.map((run) => run.text).join(''), runs };
  });
}
function inlineRich(body) {
  const inner = String(body || '').match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] || String(body || '');
  const runs = richRuns(inner);
  return { text: runs.map((run) => run.text).join(''), runs };
}
function cellValue(attributes, body, strings) {
  const type = attr(attributes, 't');
  if (type === 'inlineStr') return inlineRich(body);
  const raw = String(body || '').match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (raw == null) {
    const rich = inlineRich(body);
    return rich.text ? rich : { text: '', runs: [] };
  }
  const decoded = xmlDecode(raw);
  if (type === 's') return strings[Number(decoded)] ?? { text: '', runs: [] };
  if (type === 'str') return { text: decoded, runs: [{ text: decoded, underline: false, bold: false, italic: false }] };
  if (type === 'b') return { text: decoded === '1' ? 'TRUE' : 'FALSE', runs: [] };
  return { text: decoded, runs: [] };
}
function styleFillIds(xml) {
  const section = String(xml || '').match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || '';
  return [...section.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map((match, styleId) => ({
    styleId,
    fillId: attr(match[1], 'fillId') == null ? 0 : Number(attr(match[1], 'fillId')),
  }));
}
async function unzipText(filename, entry, { maxBuffer = 32 * 1024 * 1024 } = {}) {
  try {
    const { stdout } = await execFileAsync('unzip', ['-p', filename, entry], { encoding: 'utf8', timeout: 15000, maxBuffer });
    return stdout;
  } catch (error) {
    if (error?.code === 11 || /filename not matched/i.test(String(error?.stderr || ''))) return '';
    throw error;
  }
}
function workbookSheetRefs(xml) {
  return [...String(xml || '').matchAll(/<sheet\b([^>]*)\/?\s*>/g)]
    .map((match) => ({ name: attr(match[1], 'name'), relId: attr(match[1], 'r:id') }))
    .filter((sheet) => sheet.name && sheet.relId);
}
function workbookRelationships(xml) {
  const output = new Map();
  for (const match of String(xml || '').matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const id = attr(match[1], 'Id');
    const target = attr(match[1], 'Target');
    if (id && target) output.set(id, target);
  }
  return output;
}
function sheetEntry(target) {
  const normalized = String(target || '').replace(/^\/+/, '');
  if (normalized.startsWith('xl/')) return normalized;
  if (normalized.startsWith('../')) return normalized.replace(/^\.\.\//, '');
  return `xl/${normalized}`;
}
function parseSheet(xml, strings, name) {
  const cells = [];
  const styledCells = [];
  for (const match of String(xml || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const parts = refParts(attr(match[1], 'r'));
    if (!parts) continue;
    const rawStyle = attr(match[1], 's');
    const styleId = rawStyle == null ? null : Number(rawStyle);
    if (styleId != null) styledCells.push({ ...parts, styleId });
    const rich = cellValue(match[1], match[2] || '', strings);
    if (!rich.text) continue;
    cells.push({ ...parts, value: rich.text, runs: rich.runs, styleId });
  }
  const merges = [];
  for (const match of String(xml || '').matchAll(/<mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"[^>]*\/?\s*>/g)) {
    const start = refParts(match[1]);
    const end = refParts(match[2]);
    if (start && end) merges.push({
      ref: `${match[1]}:${match[2]}`,
      startRef: match[1], endRef: match[2],
      startRow: start.row, endRow: end.row,
      startCol: start.col, endCol: end.col,
    });
  }
  return { name, cells, styledCells, merges };
}

export function parseIzhgmuSharedStringsXml(xml) { return sharedStrings(String(xml || '')); }
export function parseIzhgmuWorksheetXml(xml, strings = [], name = 'sheet') { return parseSheet(String(xml || ''), strings, name); }
export function parseIzhgmuStylesXml(xml) { return styleFillIds(String(xml || '')); }

export async function readIzhgmuXlsxStructure(buffer) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'izhgmu-xlsx-'));
  const filename = path.join(dir, `${randomUUID()}.xlsx`);
  try {
    await fs.writeFile(filename, buffer);
    const workbookXml = await unzipText(filename, 'xl/workbook.xml');
    const relXml = await unzipText(filename, 'xl/_rels/workbook.xml.rels');
    const strings = sharedStrings(await unzipText(filename, 'xl/sharedStrings.xml'));
    const styles = styleFillIds(await unzipText(filename, 'xl/styles.xml'));
    const rels = workbookRelationships(relXml);
    const sheets = [];
    for (const sheet of workbookSheetRefs(workbookXml)) {
      const target = rels.get(sheet.relId);
      if (!target) continue;
      const xml = await unzipText(filename, sheetEntry(target));
      if (xml) sheets.push(parseSheet(xml, strings, sheet.name));
    }
    return { sheets, styles };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const buffer = await fs.readFile(process.argv[2]);
  const structure = await readIzhgmuXlsxStructure(buffer);
  console.log(JSON.stringify({
    cells: structure.sheets[0].cells.filter((cell) => ['K10', 'C24', 'E28'].includes(cell.ref)),
    styles: structure.styles.slice(0, 10),
  }, null, 2));
}

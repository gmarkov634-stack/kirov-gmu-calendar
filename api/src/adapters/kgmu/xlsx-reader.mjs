import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);
const CELL_REF = /^([A-Z]+)(\d+)$/;

function xmlDecode(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function attr(source, name) {
  const match = String(source || "").match(new RegExp(`\\b${name}="([^"]*)"`));
  return match ? xmlDecode(match[1]) : null;
}

function colNumber(letters) {
  let result = 0;
  for (const ch of String(letters || "")) result = result * 26 + ch.charCodeAt(0) - 64;
  return result;
}

function refParts(ref) {
  const match = String(ref || "").match(CELL_REF);
  if (!match) return null;
  return { ref, col: colNumber(match[1]), row: Number(match[2]) };
}

function sharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => {
    const pieces = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => xmlDecode(item[1]));
    return pieces.join("");
  });
}

function inlineString(body) {
  const pieces = [...String(body || "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((item) => xmlDecode(item[1]));
  return pieces.join("");
}

function cellValue(attributes, body, strings) {
  const type = attr(attributes, "t");
  if (type === "inlineStr") return inlineString(body);
  const raw = String(body || "").match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1];
  if (raw == null) return inlineString(body) || "";
  const decoded = xmlDecode(raw);
  if (type === "s") return strings[Number(decoded)] ?? "";
  if (type === "str") return decoded;
  if (type === "b") return decoded === "1";
  if (/^-?\d+(?:\.\d+)?$/.test(decoded)) return Number(decoded);
  return decoded;
}

export function parseStylesXml(xml) {
  const source = String(xml || "");
  const cellXfsBody = source.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || "";
  return [...cellXfsBody.matchAll(/<xf\b([^>]*?)(?:\/>|>[\s\S]*?<\/xf>)/g)].map((match, styleId) => ({
    styleId,
    fillId: Number(attr(match[1], "fillId") || 0),
  }));
}

export function parseWorksheetXml(xml, strings, name, styles = []) {
  const cells = [];
  const styledCells = [];
  // XLSX contains many empty self-closing cells (<c .../>). Matching only
  // <c>...</c> can start at an empty cell and consume the next closing tag,
  // shifting every subsequent value. This expression treats both forms as
  // complete cell records before decoding the value.
  for (const match of String(xml || "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const ref = attr(match[1], "r");
    const parts = refParts(ref);
    if (!parts) continue;
    const value = cellValue(match[1], match[2] || "", strings);
    const rawStyleId = attr(match[1], "s");
    const styleId = rawStyleId == null ? null : Number(rawStyleId);
    const style = Number.isInteger(styleId) ? styles[styleId] : null;
    if (Number.isInteger(styleId) && styleId > 0 && Number(style?.fillId || 0) > 0) {
      styledCells.push({ ...parts, value, styleId, fillId: Number(style.fillId) });
    }
    if (value === "" || value == null) continue;
    cells.push({ ...parts, value });
  }
  const merges = [];
  for (const match of String(xml || "").matchAll(/<mergeCell\b[^>]*ref="([A-Z]+\d+):([A-Z]+\d+)"[^>]*\/?\s*>/g)) {
    const start = refParts(match[1]);
    const end = refParts(match[2]);
    if (!start || !end) continue;
    merges.push({
      ref: `${match[1]}:${match[2]}`,
      startRef: match[1],
      endRef: match[2],
      startRow: start.row,
      endRow: end.row,
      startCol: start.col,
      endCol: end.col,
    });
  }
  return { name, cells, merges, styledCells };
}

async function unzipText(filename, entry, { maxBuffer = 32 * 1024 * 1024 } = {}) {
  try {
    const { stdout } = await execFileAsync("unzip", ["-p", filename, entry], {
      encoding: "utf8",
      timeout: 15000,
      maxBuffer,
    });
    return stdout;
  } catch (error) {
    if (error?.code === 11 || /filename not matched/i.test(String(error?.stderr || ""))) return "";
    throw error;
  }
}

function workbookSheetRefs(xml) {
  return [...String(xml || "").matchAll(/<sheet\b([^>]*)\/?\s*>/g)]
    .map((match) => ({ name: attr(match[1], "name"), relId: attr(match[1], "r:id") }))
    .filter((sheet) => sheet.name && sheet.relId);
}

function workbookRelationships(xml) {
  const result = new Map();
  for (const match of String(xml || "").matchAll(/<Relationship\b([^>]*)\/?\s*>/g)) {
    const id = attr(match[1], "Id");
    const target = attr(match[1], "Target");
    if (id && target) result.set(id, target);
  }
  return result;
}

function sheetEntry(target) {
  const normalized = String(target || "").replace(/^\/+/, "");
  if (normalized.startsWith("xl/")) return normalized;
  if (normalized.startsWith("../")) return normalized.replace(/^\.\.\//, "");
  return `xl/${normalized}`;
}

export async function readKgmuXlsxStructure(buffer, { maxBytes = 25 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buffer)) throw new Error("XLSX source must be a Buffer");
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    const error = new Error("Source is not an XLSX ZIP container");
    error.code = "INVALID_XLSX";
    throw error;
  }
  if (buffer.length > maxBytes) {
    const error = new Error("XLSX source is too large");
    error.code = "XLSX_TOO_LARGE";
    throw error;
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "kgmu-xlsx-"));
  const filename = path.join(directory, `${randomUUID()}.xlsx`);
  try {
    await fs.writeFile(filename, buffer, { mode: 0o600 });
    const workbookXml = await unzipText(filename, "xl/workbook.xml");
    const relsXml = await unzipText(filename, "xl/_rels/workbook.xml.rels");
    if (!workbookXml || !relsXml) {
      const error = new Error("XLSX workbook metadata is missing");
      error.code = "INVALID_XLSX";
      throw error;
    }
    const strings = sharedStrings(await unzipText(filename, "xl/sharedStrings.xml"));
    const styles = parseStylesXml(await unzipText(filename, "xl/styles.xml"));
    const rels = workbookRelationships(relsXml);
    const sheets = [];
    for (const sheet of workbookSheetRefs(workbookXml)) {
      const target = rels.get(sheet.relId);
      if (!target) continue;
      const xml = await unzipText(filename, sheetEntry(target));
      if (!xml) continue;
      sheets.push(parseWorksheetXml(xml, strings, sheet.name, styles));
    }
    if (!sheets.length) {
      const error = new Error("XLSX has no readable worksheets");
      error.code = "INVALID_XLSX";
      throw error;
    }
    return { sheets };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

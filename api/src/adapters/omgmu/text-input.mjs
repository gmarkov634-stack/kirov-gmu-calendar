import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const RUSSIAN_SCHEDULE_RE = /РАСПИСАНИЕ[^\n]*/i;
const RUSSIAN_MARKER_RE = /^\s*ru\s*$/im;
const ENGLISH_SCHEDULE_RE = /\b(?:SCHEDULE|SHEDULE)\b[^\n]*/i;
const ENGLISH_MARKER_RE = /^\s*en\s*$/im;
const RUSSIAN_STRUCTURE_RE = /\b(?:ПОНЕДЕЛЬНИК|ВТОРНИК|СРЕДА|ЧЕТВЕРГ|ПЯТНИЦА|СУББОТА|Дисциплина)\b|К\.\s*дн\.?/i;
const ENGLISH_STRUCTURE_RE = /\b(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|Discipline)\b|N\.\s*of\s*d\.?/i;

function firstMatchIndex(value, expressions) {
  const indexes = expressions
    .map((expression) => String(value).search(expression))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : -1;
}

function russianStartIndex(page) {
  return firstMatchIndex(page, [RUSSIAN_SCHEDULE_RE, RUSSIAN_MARKER_RE]);
}

function hasEnglishStart(page) {
  return firstMatchIndex(page, [ENGLISH_SCHEDULE_RE, ENGLISH_MARKER_RE]) >= 0;
}

export function selectOmgmuRussianSourceText(text) {
  const value = String(text || "");
  if (!value.trim()) throw new Error("Russian ОмГМУ source part not found: empty source");

  const pages = value.split("\f");
  let startPage = -1;
  let startIndex = -1;
  for (let index = 0; index < pages.length; index += 1) {
    const candidate = russianStartIndex(pages[index]);
    if (candidate >= 0) {
      startPage = index;
      startIndex = candidate;
      break;
    }
  }

  if (startPage >= 0) {
    const selected = [];
    for (let index = startPage; index < pages.length; index += 1) {
      const page = index === startPage ? pages[index].slice(startIndex) : pages[index];
      if (index > startPage && hasEnglishStart(page)) break;
      selected.push(page);
    }
    const result = selected.join("\f").trim();
    if (!result) throw new Error("Russian ОмГМУ source part not found: empty selected part");
    return result;
  }

  const hasRussianStructure = RUSSIAN_STRUCTURE_RE.test(value);
  const hasEnglishStructure = ENGLISH_STRUCTURE_RE.test(value) || ENGLISH_SCHEDULE_RE.test(value);
  if (hasRussianStructure && !hasEnglishStructure) return value.trim();

  throw new Error("Russian ОмГМУ source part not found or language boundary is ambiguous");
}

export async function readOmgmuSourceText(input) {
  const filename = path.resolve(input);
  if (path.extname(filename).toLowerCase() !== ".pdf") {
    return fs.readFile(filename, "utf8");
  }
  const { stdout } = await execFileAsync("pdftotext", ["-layout", filename, "-"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

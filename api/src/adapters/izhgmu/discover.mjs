import fs from "node:fs/promises";
import path from "node:path";

export const IZHGMU_SOURCE = "https://igma.ru/component/content/article/647-raspisanie?Itemid=108&catid=132";

function decodeHtml(value = "") {
  return String(value)
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedText(value = "") {
  return decodeHtml(value).toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
}

function filenameFromUrl(url = "") {
  try {
    const pathname = new URL(url).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "");
  } catch {
    return "";
  }
}

export function sourceFormatFromUrl(url = "") {
  const filename = filenameFromUrl(url).toLowerCase();
  if (/\.xlsx$/.test(filename)) return "xlsx";
  if (/\.xls$/.test(filename)) return "xls";
  return null;
}

function normalizeYearPart(value) {
  if (!value) return null;
  return value.length === 2 ? `20${value}` : value;
}

function extractAcademicYear(value = "") {
  const text = normalizedText(value);
  const match = text.match(/(?:^|\D)(20\d{2}|\d{2})\s*[-\/]\s*(20\d{2}|\d{2})(?!\d)/);
  if (!match) return null;
  return `${normalizeYearPart(match[1])}/${normalizeYearPart(match[2])}`;
}

function extractSemester(value = "") {
  const text = normalizedText(value);
  if (/осен|autumn|fall/.test(text)) return "autumn";
  if (/весн|spring/.test(text)) return "spring";
  return null;
}

function periodEvidence(name, value) {
  if (!value) return null;
  const academicYear = extractAcademicYear(value);
  const semester = extractSemester(value);
  if (!academicYear && !semester) return null;
  return { name, academicYear, semester, raw: decodeHtml(value) };
}

function detectPeriodConflicts(evidence) {
  const years = new Set(evidence.map((item) => item.academicYear).filter(Boolean));
  const semesters = new Set(evidence.map((item) => item.semester).filter(Boolean));
  const conflicts = [];
  if (years.size > 1) conflicts.push(`academic-year conflict: ${[...years].join(", ")}`);
  if (semesters.size > 1) conflicts.push(`semester conflict: ${[...semesters].join(", ")}`);
  return conflicts;
}

function classifyProgram(text, url = "") {
  const normalized = normalizedText(`${text} ${filenameFromUrl(url)}`);
  const english = /англ|english|eng(?:lish)?[_ -]?language|иноязыч|foreign/.test(normalized);
  if (english && /леч|medicine|med/.test(normalized)) return { program: "medicine_english", language: "en" };
  if (/педиатр/.test(normalized)) return { program: "pediatrics", language: "ru" };
  if (/стомат/.test(normalized)) return { program: "dentistry", language: "ru" };
  if (/лечеб|леч\.?\s*ф|medicine/.test(normalized)) return { program: "medicine", language: "ru" };
  return { program: null, language: null };
}

function classifyCourse(text, url = "") {
  const normalized = normalizedText(`${text} ${filenameFromUrl(url)}`);
  const explicit = normalized.match(/(?:^|\s)([1-6])\s*(?:курс|к\.)/i)?.[1];
  if (explicit) return Number(explicit);
  const filename = filenameFromUrl(url).toLowerCase();
  const fromFilename = filename.match(/(?:^|[_ -])([1-6])(?:[_ -]?(?:kurs|course|леч|ped|stom|поток)|[_ -])/i)?.[1];
  return fromFilename ? Number(fromFilename) : null;
}

function classifyStream(text, url = "") {
  const normalized = normalizedText(`${text} ${filenameFromUrl(url)}`);
  return normalized.match(/([1-9])\s*(?:поток|пот\.)/)?.[1] || null;
}

function classifyRole(text, url = "") {
  const normalized = normalizedText(`${text} ${filenameFromUrl(url)}`);
  if (/лекц/.test(normalized)) return "lectures";
  if (/занят|расписание групп|практич/.test(normalized)) return "classes";
  return null;
}

function classifyAuxiliaryRole(text, url = "") {
  const normalized = normalizedText(`${text} ${filenameFromUrl(url)}`);
  if (/сроки.*семестр|семестр.*сроки/.test(normalized)) return "semester_dates";
  if (/учебн.*недел/.test(normalized)) return "teaching_weeks";
  return null;
}

export function classifyIzhgmuSource({ label = "", url = "", context = "" } = {}) {
  const combined = `${context} ${label}`;
  const auxiliaryRole = classifyAuxiliaryRole(combined, url);
  const sourceFormat = sourceFormatFromUrl(url);
  const { program, language } = classifyProgram(combined, url);
  const course = classifyCourse(combined, url);
  const stream = classifyStream(label, url);
  const sourceRole = auxiliaryRole ? null : classifyRole(label, url) || classifyRole(context, url);
  const filename = filenameFromUrl(url);
  const evidence = [
    periodEvidence("context", context),
    periodEvidence("link_text", label),
    periodEvidence("filename", filename),
  ].filter(Boolean);

  return {
    program,
    language,
    course,
    stream,
    sourceRole,
    auxiliaryRole,
    sourceFormat,
    filename,
    periodEvidence: evidence,
    periodConflicts: detectPeriodConflicts(evidence),
  };
}

export function extractIzhgmuSources(html, sourceUrl = IZHGMU_SOURCE) {
  const base = new URL(sourceUrl);
  const sources = [];
  const auxiliarySources = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const label = decodeHtml(match[2]);
    if (!label) continue;
    let url;
    try { url = new URL(match[1], base).href; } catch { continue; }
    const classified = classifyIzhgmuSource({ label, url });

    if (classified.auxiliaryRole) {
      auxiliarySources.push({ label, url, ...classified });
      continue;
    }
    if (!classified.sourceFormat) continue;
    if (!classified.sourceRole && !/распис|лекц|занят/i.test(label)) continue;
    sources.push({ label, url, ...classified });
  }

  return { sources, auxiliarySources };
}

export function validateIzhgmuManifest(manifest) {
  const errors = [];
  const seen = new Set();
  for (const item of manifest.sources) {
    if (seen.has(item.url)) errors.push(`duplicate source: ${item.url}`);
    seen.add(item.url);
    if (!item.program) errors.push(`unclassified program: ${item.label}`);
    if (!item.course) errors.push(`unclassified course: ${item.label}`);
    if (!item.sourceRole) errors.push(`unclassified source role: ${item.label}`);
    if (!item.sourceFormat || !["xlsx", "xls"].includes(item.sourceFormat)) {
      errors.push(`unsupported source format: ${item.label}`);
    }
    for (const conflict of item.periodConflicts || []) {
      errors.push(`period metadata conflict for ${item.label}: ${conflict}`);
    }
  }
  return errors;
}

export async function discoverIzhgmuSources({ sourceUrl = IZHGMU_SOURCE, output, fetchFn = fetch } = {}) {
  const response = await fetchFn(sourceUrl, {
    headers: {
      "User-Agent": "MedicalUniversityCalendarBot/1.0 (+schedule source discovery)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Ижевский ГМУ page request failed: ${response.status}`);

  const html = await response.text();
  const { sources, auxiliarySources } = extractIzhgmuSources(html, sourceUrl);
  const manifest = {
    version: 1,
    university: "izhgmu",
    sourcePage: sourceUrl,
    discoveredAt: new Date().toISOString(),
    sourceCount: sources.length,
    auxiliarySourceCount: auxiliarySources.length,
    sources,
    auxiliarySources,
  };
  const errors = validateIzhgmuManifest(manifest);
  manifest.validation = { status: errors.length ? "needs_source_review" : "ok", errors };

  if (output) {
    const filename = path.resolve(output);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return manifest;
}

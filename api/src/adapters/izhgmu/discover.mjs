import fs from "node:fs/promises";
import path from "node:path";

export const IZH_GMU_SOURCE = "https://www.igma.ru/component/content/article/647-raspisanie?Itemid=108&catid=132";

function decodeHtml(value = "") {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAcademicYear(raw) {
  if (!raw) return null;
  const match = raw.match(/(20\d{2})\s*[-/]\s*(20\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}`;
}

function detectTerm(text = "") {
  if (/весенн/i.test(text)) return "spring";
  if (/осенн/i.test(text)) return "autumn";
  return null;
}

export function extractIzhgmuScheduleContext(html) {
  const text = decodeHtml(html);
  const marker = text.toLowerCase().indexOf("лечебный факультет");
  const context = marker >= 0 ? text.slice(marker, marker + 900) : text.slice(0, 1200);
  const academicYear = normalizeAcademicYear(context.match(/20\d{2}\s*[-/]\s*20\d{2}/)?.[0] || null);
  return {
    academicYear,
    term: detectTerm(context),
    dailyChangesNotice: /ежедневн[^.]{0,80}изменен/i.test(text),
  };
}

export function classifyIzhgmuLabel(label) {
  const normalized = String(label || "").toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
  const course = Number(normalized.match(/([1-6])\s*курс/)?.[1] || 0) || null;
  const stream = normalized.match(/([1-9])\s*поток/)?.[1] || null;

  let faculty = null;
  if (/лечебн/.test(normalized)) faculty = "medicine";
  else if (/педиатр/.test(normalized)) faculty = "pediatrics";
  else if (/стоматолог/.test(normalized)) faculty = "dentistry";

  let sourceKind = null;
  if (/лекц/.test(normalized)) sourceKind = "lecture";
  else if (/расписание занят/.test(normalized)) sourceKind = "class";

  const language = /англоязыч/.test(normalized) ? "en" : "ru";
  const rawAcademicYear = normalized.match(/20\d{2}\s*[-/]\s*20\d{2}/)?.[0] || null;
  const academicYear = normalizeAcademicYear(rawAcademicYear);
  const term = detectTerm(normalized);
  const warnings = [];

  if (rawAcademicYear) {
    const [start, end] = academicYear.split("-").map(Number);
    if (end !== start + 1) warnings.push("malformed-academic-year");
  }

  return {
    faculty,
    course,
    stream,
    sourceKind,
    language,
    academicYear,
    term,
    parserProfile: null,
    parserRouting: "fingerprint-required",
    warnings,
  };
}

export function extractIzhgmuSources(html, sourceUrl = IZH_GMU_SOURCE) {
  const base = new URL(sourceUrl);
  const links = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const label = decodeHtml(match[2]);
    if (!label) continue;
    let url;
    try { url = new URL(match[1], base).href; } catch { continue; }
    if (!/\.xlsx(?:$|[?#])/i.test(url)) continue;
    if (!/расписание/i.test(label)) continue;
    links.push({
      label,
      url,
      ...classifyIzhgmuLabel(label),
    });
  }
  return links;
}

export function validateIzhgmuManifest(manifest) {
  const errors = [];
  const warnings = [];
  const seen = new Set();
  const context = manifest.scheduleContext || {};

  for (const item of manifest.sources) {
    if (seen.has(item.url)) errors.push(`duplicate source: ${item.url}`);
    seen.add(item.url);
    if (!item.faculty) errors.push(`unclassified faculty: ${item.label}`);
    if (!item.course) errors.push(`unclassified course: ${item.label}`);
    if (!item.sourceKind) errors.push(`unclassified source kind: ${item.label}`);
    if (!item.academicYear) warnings.push(`missing academic year: ${item.label}`);
    if (!item.term) warnings.push(`missing term: ${item.label}`);
    for (const warning of item.warnings || []) warnings.push(`${warning}: ${item.label}`);
    if (context.academicYear && item.academicYear && item.academicYear !== context.academicYear) {
      warnings.push(`academic year differs from page context: ${item.label}`);
    }
    if (context.term && item.term && item.term !== context.term) {
      warnings.push(`term differs from page context: ${item.label}`);
    }
  }

  return { errors, warnings };
}

export async function discoverIzhgmuSources({ sourceUrl = IZH_GMU_SOURCE, output, fetchFn = fetch } = {}) {
  const response = await fetchFn(sourceUrl, {
    headers: {
      "User-Agent": "MedicalUniversityCalendarBot/1.0 (+schedule source discovery)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`Ижевский ГМУ page request failed: ${response.status}`);

  const html = await response.text();
  const sources = extractIzhgmuSources(html, sourceUrl);
  const manifest = {
    version: 1,
    university: "izhgmu",
    sourcePage: sourceUrl,
    discoveredAt: new Date().toISOString(),
    scheduleContext: extractIzhgmuScheduleContext(html),
    sourceCount: sources.length,
    sources,
  };
  const { errors, warnings } = validateIzhgmuManifest(manifest);
  manifest.validation = {
    status: errors.length ? "needs-review" : "ok",
    errors,
    warnings,
  };

  if (output) {
    const filename = path.resolve(output);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return manifest;
}

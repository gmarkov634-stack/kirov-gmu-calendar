import fs from "node:fs/promises";
import path from "node:path";

export const IZH_GMU_SOURCE = "https://www.igma.ru/component/content/article/647-raspisanie?Itemid=108&catid=132";

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

function normalizeAcademicYear(raw) {
  if (!raw) return null;
  const match = String(raw).match(/(20\d{2})\s*[-/]\s*(20\d{2})/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function isConsecutiveAcademicYear(raw) {
  const academicYear = normalizeAcademicYear(raw);
  if (!academicYear) return false;
  const [start, end] = academicYear.split("-").map(Number);
  return end === start + 1;
}

function detectTerm(text = "") {
  if (/весенн/i.test(text)) return "spring";
  if (/осенн/i.test(text)) return "autumn";
  return null;
}

export function canonicalizeIzhgmuUrl(rawUrl, baseUrl = IZH_GMU_SOURCE) {
  const url = new URL(rawUrl, baseUrl);
  if (url.hostname === "igma.ru" || url.hostname === "www.igma.ru") {
    url.protocol = "https:";
    url.hostname = "www.igma.ru";
    url.port = "";
  }
  return url.href;
}

export function classifyIzhgmuLabel(label) {
  const normalized = String(label || "")
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/\s+/g, " ")
    .trim();

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

  if (academicYear && !isConsecutiveAcademicYear(academicYear)) {
    warnings.push("malformed-academic-year");
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

export function extractIzhgmuScheduleContext(html) {
  const text = decodeHtml(html);
  const facultyMarker = text.toLowerCase().indexOf("лечебный факультет");
  const context = facultyMarker >= 0 ? text.slice(facultyMarker, facultyMarker + 1200) : text.slice(0, 1800);
  const year = context.match(/20\d{2}\s*[-/]\s*20\d{2}/)?.[0] || null;
  return {
    academicYear: normalizeAcademicYear(year),
    term: detectTerm(context),
    dailyChangesNotice: /ежедневн[^.]{0,100}изменен/i.test(text),
  };
}

export function applyIzhgmuScheduleContext(sources, scheduleContext = {}) {
  const contextAcademicYear = normalizeAcademicYear(scheduleContext.academicYear);
  const contextYearIsAuthoritative = isConsecutiveAcademicYear(contextAcademicYear);

  return (sources || []).map((source) => {
    const warnings = [...(source.warnings || [])];
    if (!warnings.includes("malformed-academic-year") || !contextYearIsAuthoritative) return source;

    return {
      ...source,
      labelAcademicYear: source.academicYear,
      academicYear: contextAcademicYear,
      academicYearSource: "schedule-context-recovery",
      warnings: [...new Set([...warnings, "academic-year-recovered-from-schedule-context"])],
    };
  });
}

export function extractIzhgmuSources(html, sourceUrl = IZH_GMU_SOURCE) {
  const links = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const label = decodeHtml(match[2]);
    if (!label || !/расписание/i.test(label)) continue;

    let url;
    try {
      url = canonicalizeIzhgmuUrl(match[1], sourceUrl);
    } catch {
      continue;
    }

    if (!/\.(?:xlsx|xls)(?:$|[?#])/i.test(url)) continue;
    if (new URL(url).hostname !== "www.igma.ru") continue;

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

  for (const item of manifest.sources || []) {
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

  if (!manifest.sources?.length) errors.push("no schedule sources discovered");
  return { errors, warnings };
}

export async function discoverIzhgmuSources({ sourceUrl = IZH_GMU_SOURCE, output, fetchFn = fetch } = {}) {
  const response = await fetchFn(sourceUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "MedicalUniversityCalendarBot/1.0 (+IzhGMU schedule discovery)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`IzhGMU page request failed: HTTP ${response.status}`);

  const html = await response.text();
  const scheduleContext = extractIzhgmuScheduleContext(html);
  const sources = applyIzhgmuScheduleContext(extractIzhgmuSources(html, sourceUrl), scheduleContext);
  const manifest = {
    version: 1,
    university: "izhgmu",
    sourcePage: sourceUrl,
    discoveredAt: new Date().toISOString(),
    scheduleContext,
    sourceCount: sources.length,
    sources,
  };
  const validation = validateIzhgmuManifest(manifest);
  manifest.validation = {
    status: validation.errors.length ? "needs-review" : "ok",
    ...validation,
  };

  if (output) {
    const filename = path.resolve(output);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return manifest;
}

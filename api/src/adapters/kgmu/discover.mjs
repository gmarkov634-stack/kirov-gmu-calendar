import fs from "node:fs/promises";
import path from "node:path";

export const KGMU_SOURCE_PAGES = [
  {
    program: "medicine",
    label: "Лечебное дело",
    url: "https://kirovgma.ru/lechebnyy-fakultet-raspisanie",
  },
  {
    program: "pediatrics",
    label: "Педиатрия",
    url: "https://kirovgma.ru/raspisanie-pediatricheskiy-fakultet",
  },
  {
    program: "dentistry",
    label: "Стоматология",
    url: "https://kirovgma.ru/raspisanie-stomatologicheskiy-fakultet",
  },
];

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

export function normalizeKgmuAcademicYear(value) {
  const match = String(value || "").match(/(20\d{2})\s*[-\/]\s*(20\d{2}|\d{2})/);
  if (!match) return null;
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) {
    end = Math.floor(start / 100) * 100 + end;
    if (end < start) end += 100;
  }
  if (end !== start + 1) return null;
  return `${start}/${end}`;
}

export function classifyKgmuScheduleLabel(label, program) {
  const normalized = decodeHtml(label).toLowerCase().replaceAll("ё", "е");
  const range = normalized.match(/(?:^|\s)(\d{3})\s*[-–—]\s*(\d{3})(?:\s|$)/);
  const single = normalized.match(/(?:^|\s)(\d{3})(?:\s|$)/);
  const groupStart = range ? range[1] : single?.[1] || null;
  const groupEnd = range ? range[2] : single?.[1] || null;
  const course = groupStart ? Number(groupStart[0]) : null;
  const academicYear = normalizeKgmuAcademicYear(normalized);
  const semester = /первое\s+полугодие/.test(normalized)
    ? 1
    : /второе\s+полугодие/.test(normalized)
      ? 2
      : null;

  const groups = [];
  if (groupStart && groupEnd) {
    const start = Number(groupStart);
    const end = Number(groupEnd);
    if (Number.isInteger(start) && Number.isInteger(end) && end >= start && end - start <= 40) {
      for (let group = start; group <= end; group += 1) groups.push(String(group));
    }
  }

  return {
    program,
    course,
    groupStart,
    groupEnd,
    groups,
    academicYear,
    semester,
  };
}

export function extractKgmuSources(html, page) {
  if (!page?.program || !page?.url) throw new Error("Invalid KGMU source page config");
  const base = new URL(page.url);
  const sources = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorPattern)) {
    const label = decodeHtml(match[2]);
    if (!label) continue;
    let url;
    try { url = new URL(match[1], base).href; } catch { continue; }
    if (!/\.xlsx(?:$|[?#])/i.test(url)) continue;

    const classification = classifyKgmuScheduleLabel(label, page.program);
    if (!classification.groupStart) continue;
    sources.push({
      label,
      url,
      pageUrl: page.url,
      pageLabel: page.label || page.program,
      ...classification,
    });
  }
  return sources;
}

export function validateKgmuManifest(manifest) {
  const errors = [];
  const seen = new Set();
  for (const source of manifest.sources || []) {
    if (seen.has(source.url)) errors.push(`duplicate source: ${source.url}`);
    seen.add(source.url);
    if (!source.program) errors.push(`unclassified program: ${source.label}`);
    if (!source.course) errors.push(`unclassified course: ${source.label}`);
    if (!source.groupStart || !source.groupEnd || !source.groups?.length) {
      errors.push(`unclassified groups: ${source.label}`);
    }
    if (!source.academicYear) errors.push(`unclassified academic year: ${source.label}`);
    if (![1, 2].includes(source.semester)) errors.push(`unclassified semester: ${source.label}`);
  }
  return errors;
}

export async function discoverKgmuSources({ pages = KGMU_SOURCE_PAGES, output, fetchFn = fetch } = {}) {
  const sources = [];
  const pageResults = [];

  for (const page of pages) {
    try {
      const response = await fetchFn(page.url, {
        headers: {
          "User-Agent": "MedicalUniversityCalendarBot/1.0 (+schedule source discovery)",
          Accept: "text/html,application/xhtml+xml",
        },
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const html = await response.text();
      const pageSources = extractKgmuSources(html, page);
      sources.push(...pageSources);
      pageResults.push({
        program: page.program,
        label: page.label,
        url: page.url,
        status: "ok",
        sourceCount: pageSources.length,
      });
    } catch (error) {
      pageResults.push({
        program: page.program,
        label: page.label,
        url: page.url,
        status: "failed",
        sourceCount: 0,
        error: error.message,
      });
    }
  }

  const manifest = {
    version: 1,
    university: "kgmu",
    discoveredAt: new Date().toISOString(),
    pages: pageResults,
    sourceCount: sources.length,
    sources,
  };
  const validationErrors = validateKgmuManifest(manifest);
  for (const page of pageResults.filter((item) => item.status === "failed")) {
    validationErrors.push(`page request failed: ${page.program}: ${page.error}`);
  }
  manifest.validation = {
    status: validationErrors.length ? "needs-review" : "ok",
    errors: validationErrors,
  };

  if (output) {
    const filename = path.resolve(output);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return manifest;
}

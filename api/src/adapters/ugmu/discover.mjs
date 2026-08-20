import fs from "node:fs/promises";
import path from "node:path";

import {
  getUgmuSourcePage,
  isTrustedUgmuArtifactUrl,
} from "./source-registry.mjs";

function decodeHtml(value = "") {
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value = "") {
  return String(value)
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[«»“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function streamNumber(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const roman = { I: "1", II: "2", III: "3", IV: "4" };
  return roman[normalized] || (/^[1-4]$/.test(normalized) ? normalized : null);
}

export function classifyUgmuScheduleLabel(label = "") {
  const normalized = normalizeText(label);
  const course = Number(normalized.match(/(?:^|\s)([1-6])\s*курс(?:а|у|ом|е)?(?=\s|$|[,:;])/i)?.[1] || 0) || null;
  const rawStream = normalized.match(/(?:^|\s)(i{1,3}|iv|[1-4])\s*поток(?=\s|$|[,:;])/i)?.[1] || null;

  let part = "combined";
  if (/лекц/.test(normalized)) part = "lectures";
  else if (/практи/.test(normalized)) part = "practice";

  return {
    course,
    stream: streamNumber(rawStream),
    part,
  };
}

function lastCourseContext(value = "") {
  const normalized = normalizeText(decodeHtml(value));
  let result = null;
  for (const match of normalized.matchAll(/(?:^|\s)([1-6])\s*курс(?:а|у|ом|е)?(?=\s|$|[,:;])/g)) {
    result = Number(match[1]);
  }
  return result;
}

function updateSectionState(value, state) {
  const normalized = normalizeText(decodeHtml(value));

  if (normalized.includes("расписание занятий на осенний семестр")) {
    state.area = "classes";
    state.semester = "autumn";
    state.course = null;
  } else if (normalized.includes("расписание занятий на весенний семестр")) {
    state.area = "classes";
    state.semester = "spring";
    state.course = null;
  } else if (
    normalized.includes("расписание зимней сессии") ||
    normalized.includes("расписание летней сессии") ||
    normalized.includes("расписание государственной итоговой аттестации") ||
    normalized.includes("график учебных недель") ||
    normalized.includes("график ликвидации академической задолженности")
  ) {
    state.area = "other";
    state.semester = null;
    state.course = null;
  }

  const course = lastCourseContext(value);
  if (state.area === "classes" && course) state.course = course;
}

export function extractUgmuScheduleSources(html, {
  sourceUrl,
  program = "medicine",
} = {}) {
  const page = getUgmuSourcePage(program);
  const sourcePage = sourceUrl || page?.page;
  if (!sourcePage) throw new Error(`Unknown UGMU program source page: ${program}`);

  const base = new URL(sourcePage);
  const state = { area: "other", semester: null, course: null };
  const result = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let cursor = 0;

  for (const match of html.matchAll(anchorPattern)) {
    updateSectionState(html.slice(cursor, match.index), state);
    cursor = match.index + match[0].length;

    if (state.area !== "classes" || !state.semester) continue;

    const label = decodeHtml(match[2]);
    if (!label) continue;

    let url;
    try {
      url = new URL(match[1], base).href;
    } catch {
      continue;
    }
    if (!isTrustedUgmuArtifactUrl(url)) continue;

    const classified = classifyUgmuScheduleLabel(label);
    const course = classified.course || state.course;
    if (classified.course) state.course = classified.course;

    result.push({
      program,
      semester: state.semester,
      course,
      stream: classified.stream,
      part: classified.part,
      label,
      url,
    });
  }

  return result;
}

export function validateUgmuManifest(manifest) {
  const errors = [];
  const seen = new Set();
  const allowedParts = new Set(["combined", "lectures", "practice"]);
  const allowedSemesters = new Set(["autumn", "spring"]);

  if (manifest?.university !== "ugmu") errors.push("invalid university");
  if (!manifest?.program) errors.push("missing program");

  for (const item of manifest?.sources || []) {
    if (seen.has(item.url)) errors.push(`duplicate source: ${item.url}`);
    seen.add(item.url);

    if (!isTrustedUgmuArtifactUrl(item.url)) errors.push(`untrusted source: ${item.url}`);
    if (!item.program) errors.push(`missing program: ${item.label}`);
    if (!Number.isInteger(item.course) || item.course < 1 || item.course > 6) {
      errors.push(`unclassified course: ${item.label}`);
    }
    if (!allowedSemesters.has(item.semester)) {
      errors.push(`unclassified semester: ${item.label}`);
    }
    if (!allowedParts.has(item.part)) errors.push(`unclassified part: ${item.label}`);
    if (item.stream && !/^[1-4]$/.test(item.stream)) errors.push(`invalid stream: ${item.label}`);
    if (item.course >= 4 && item.part === "combined") {
      errors.push(`senior course part needs review: ${item.label}`);
    }
  }

  return errors;
}

export async function discoverUgmuSources({
  program = "medicine",
  sourceUrl,
  output,
  fetchFn = fetch,
} = {}) {
  const page = getUgmuSourcePage(program);
  const target = sourceUrl || page?.page;
  if (!target) throw new Error(`Unknown UGMU program: ${program}`);

  const response = await fetchFn(target, {
    headers: {
      "User-Agent": "MedicalUniversityCalendarBot/1.0 (+schedule source discovery)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`UGMU page request failed: ${response.status}`);

  const html = await response.text();
  const sources = extractUgmuScheduleSources(html, { sourceUrl: target, program });
  const manifest = {
    version: 1,
    university: "ugmu",
    program,
    sourcePage: target,
    discoveredAt: new Date().toISOString(),
    sourceCount: sources.length,
    sources,
  };
  const errors = validateUgmuManifest(manifest);
  manifest.validation = {
    status: errors.length ? "needs-review" : "ok",
    errors,
  };

  if (output) {
    const filename = path.resolve(output);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }

  return manifest;
}

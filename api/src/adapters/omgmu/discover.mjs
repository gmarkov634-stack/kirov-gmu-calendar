import fs from "node:fs/promises";
import path from "node:path";

export const OMG_MU_SOURCE = "https://omsk-osma.ru/studentam/raspisanie-zanyatiy";

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

export function classifyOmgmuLabel(label) {
  const normalized = label.toLowerCase().replaceAll("ё", "е").replace(/\s+/g, " ").trim();
  const course = Number(normalized.match(/(?:^|\s)([1-6])\s*(?:курс|леч|мед|пед|стом|фарм)/)?.[1] || 0) || null;
  const stream = normalized.match(/([12])\s*поток/)?.[1] || null;

  let part = "combined";
  if (/лекц/.test(normalized)) part = "lectures";
  else if (/цикл/.test(normalized)) part = "cycles";
  else if (/дот|дистанц/.test(normalized)) part = "distance";
  else if (/фронт/.test(normalized)) part = "front";
  else if (/выбор/.test(normalized)) part = "electives";
  else if (/практич/.test(normalized)) part = "practice";

  let program = null;
  if (/иностран/.test(normalized)) program = "medicine-international";
  else if (/леч/.test(normalized)) program = "medicine";
  else if (/мед.*проф/.test(normalized)) program = "preventive-medicine";
  else if (/пед/.test(normalized)) program = "pediatrics";
  else if (/стом/.test(normalized)) program = "dentistry";
  else if (/фарм/.test(normalized)) program = "pharmacy";

  return { program, course, stream, part };
}

export function extractOmgmuSources(html, sourceUrl = OMG_MU_SOURCE) {
  const base = new URL(sourceUrl);
  const links = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const label = decodeHtml(match[2]);
    if (!label) continue;
    let url;
    try { url = new URL(match[1], base).href; } catch { continue; }
    if (!/\.pdf(?:$|[?#])/i.test(url) && !/\/files\//i.test(url)) continue;
    links.push({ label, url, ...classifyOmgmuLabel(label) });
  }
  return links;
}

export function validateOmgmuManifest(manifest) {
  const errors = [];
  const seen = new Set();
  for (const item of manifest.sources) {
    if (seen.has(item.url)) errors.push(`duplicate source: ${item.url}`);
    seen.add(item.url);
    if (!item.program) errors.push(`unclassified program: ${item.label}`);
    if (!item.course) errors.push(`unclassified course: ${item.label}`);
  }
  return errors;
}

export async function discoverOmgmuSources({ sourceUrl = OMG_MU_SOURCE, output, fetchFn = fetch } = {}) {
  const response = await fetchFn(sourceUrl, {
    headers: {
      "User-Agent": "MedicalUniversityCalendarBot/1.0 (+schedule source discovery)",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`ОмГМУ page request failed: ${response.status}`);

  const sources = extractOmgmuSources(await response.text(), sourceUrl);
  const manifest = {
    version: 1,
    university: "omgmu",
    sourcePage: sourceUrl,
    discoveredAt: new Date().toISOString(),
    sourceCount: sources.length,
    sources,
  };
  const errors = validateOmgmuManifest(manifest);
  manifest.validation = { status: errors.length ? "needs-review" : "ok", errors };

  if (output) {
    const filename = path.resolve(output);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  return manifest;
}

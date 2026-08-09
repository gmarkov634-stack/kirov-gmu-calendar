import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_SOURCE = "https://omsk-osma.ru/studentam/raspisanie-zanyatiy";

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

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

function classifyLabel(label) {
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
  else if (/мед/.test(normalized)) program = "preventive-medicine";
  else if (/пед/.test(normalized)) program = "pediatrics";
  else if (/стом/.test(normalized)) program = "dentistry";
  else if (/фарм/.test(normalized)) program = "pharmacy";
  else if (/общественн.*здрав/.test(normalized)) program = "public-health";
  else if (/психолог/.test(normalized)) program = "psychology";

  return { program, course, stream, part };
}

function extractLinks(html, sourceUrl) {
  const base = new URL(sourceUrl);
  const links = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    const label = decodeHtml(match[2]);
    if (!label) continue;
    let url;
    try {
      url = new URL(match[1], base).href;
    } catch {
      continue;
    }
    if (!/\.pdf(?:$|[?#])/i.test(url) && !/\/files\//i.test(url)) continue;
    links.push({ label, url, ...classifyLabel(label) });
  }
  return links;
}

function validateManifest(manifest) {
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

const sourceUrl = readArg("source", DEFAULT_SOURCE);
const output = path.resolve(readArg("output", "data/imports/omgmu-source-manifest.json"));
const response = await fetch(sourceUrl, {
  headers: {
    "User-Agent": "MedicalUniversityCalendarBot/1.0 (+schedule source discovery)",
    Accept: "text/html,application/xhtml+xml",
  },
  redirect: "follow",
});
if (!response.ok) throw new Error(`ОмГМУ page request failed: ${response.status}`);

const html = await response.text();
const sources = extractLinks(html, sourceUrl);
const manifest = {
  version: 1,
  university: "omgmu",
  sourcePage: sourceUrl,
  discoveredAt: new Date().toISOString(),
  sourceCount: sources.length,
  sources,
};
const errors = validateManifest(manifest);
manifest.validation = {
  status: errors.length ? "needs-review" : "ok",
  errors,
};

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Discovered ${sources.length} ОмГМУ schedule files`);
console.log(`Manifest: ${output}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 2;
}

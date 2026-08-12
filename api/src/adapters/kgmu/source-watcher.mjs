import { createHash } from "node:crypto";

const DEFAULT_PAGES = [
  { program: "medicine", url: "https://kirovgma.ru/lechebnyy-fakultet-raspisanie" },
  { program: "pediatrics", url: "https://kirovgma.ru/raspisanie-pediatricheskiy-fakultet" },
  { program: "dentistry", url: "https://kirovgma.ru/raspisanie-stomatologicheskiy-fakultet" },
  { program: "foreign", url: "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya" },
];

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, value) => String.fromCodePoint(Number(value)))
    .replace(/&#x([0-9a-f]+);/gi, (_, value) => String.fromCodePoint(Number.parseInt(value, 16)));
}

function stripTags(value) {
  return clean(decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")));
}

function attribute(attributes, name) {
  const match = String(attributes || "").match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match ? decodeHtml(match[1]) : null;
}

function normalizeAcademicYear(label) {
  const match = String(label || "").match(/(20\d{2})\s*[-–/]\s*(\d{2,4})/);
  if (!match) return null;
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) {
    end = Math.floor(start / 100) * 100 + end;
    if (end < start) end += 100;
  }
  return end === start + 1 ? `${start}/${String(end).slice(-2)}` : null;
}

function semesterFromLabel(label) {
  if (/перв(?:ое|ый)\s+(?:полугодие|семестр)/i.test(label) || /\b(?:1|first)\s+(?:semester|term)\b/i.test(label)) return 1;
  if (/втор(?:ое|ой)\s+(?:полугодие|семестр)/i.test(label) || /\b(?:2|second)\s+(?:semester|term)\b/i.test(label)) return 2;
  return null;
}

function groupRange(label) {
  const match = String(label || "").match(/(?<!\d)(\d{3})([иi])?\s*[-–]\s*(\d{3})([иi])?(?!\d)/i);
  if (!match) return null;
  const suffixes = [match[2], match[4]].filter(Boolean);
  const international = suffixes.length > 0;
  const suffix = international ? "и" : "";
  const locale = suffixes.some((value) => value === "и" || value === "И") ? "ru"
    : suffixes.some((value) => String(value).toLowerCase() === "i") ? "en"
      : null;
  const first = `${match[1]}${suffix}`;
  const last = `${match[3]}${suffix}`;
  return { first, last, label: `${first}-${last}`, locale };
}

function sameOriginUrl(href, pageUrl) {
  try {
    const page = new URL(pageUrl);
    const target = new URL(href, page);
    return target.origin === page.origin ? target.toString() : null;
  } catch {
    return null;
  }
}

export function discoverKgmuScheduleLinks(html, page) {
  const result = [];
  for (const match of String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attribute(match[1], "href");
    if (!href) continue;
    const url = sameOriginUrl(href, page.url);
    if (!url || !/\.xlsx(?:$|[?#])/i.test(url)) continue;
    const label = stripTags(match[2]);
    const range = groupRange(label);
    const academicYear = normalizeAcademicYear(label);
    const semester = semesterFromLabel(label);
    if (!range || !academicYear || !semester) continue;
    const course = Number(range.first[0]);
    if (!Number.isInteger(course) || course < 1 || course > 6) continue;
    result.push({
      program: page.program,
      course,
      groupRange: range.label,
      sourceLocale: range.locale,
      academicYear,
      semester,
      label,
      url,
      sourcePage: page.url,
    });
  }
  return result;
}

function slotKey(source) {
  return [source.program, source.course, source.academicYear, source.semester, source.groupRange].join(":");
}

function sourcePreference(source) {
  if (source.sourceLocale === "ru") return 3;
  if (!source.sourceLocale) return 2;
  return 1;
}

function canonicalSources(sources) {
  const bySlot = new Map();
  for (const source of sources) {
    const key = slotKey(source);
    const current = bySlot.get(key);
    if (!current || sourcePreference(source) > sourcePreference(current)) bySlot.set(key, source);
  }
  return [...bySlot.values()];
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function filenameFromUrl(url) {
  try {
    const value = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) || "schedule.xlsx");
    return value.toLowerCase().endsWith(".xlsx") ? value : "schedule.xlsx";
  } catch {
    return "schedule.xlsx";
  }
}

function targetPages(config) {
  return [
    { program: "medicine", url: config.kgmuMedicineSchedulePage || DEFAULT_PAGES[0].url },
    { program: "pediatrics", url: config.kgmuPediatricsSchedulePage || DEFAULT_PAGES[1].url },
    { program: "dentistry", url: config.kgmuDentistrySchedulePage || DEFAULT_PAGES[2].url },
    { program: "foreign", url: config.kgmuForeignSchedulePage || DEFAULT_PAGES[3].url },
  ];
}

function watchedSemesters(config) {
  const configured = Array.isArray(config.kgmuWatchSemesters)
    ? config.kgmuWatchSemesters.filter((value) => value === 1 || value === 2)
    : [];
  if (configured.length) return [...new Set(configured)].sort();
  const legacy = Number(config.offerSemester);
  return legacy === 1 || legacy === 2 ? [legacy] : [1, 2];
}

function responseSize(response) {
  const value = Number(response.headers?.get?.("content-length"));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function notificationPending(result) {
  return Boolean(result?.reviewId && result?.notification && result.notification.sent === false);
}

export class KgmuSourceWatcher {
  constructor({ config, ingestService, sourceObserver = null, stateStore, fetchFn = fetch }) {
    this.config = config;
    this.ingestService = ingestService;
    this.sourceObserver = sourceObserver;
    this.stateStore = stateStore;
    this.fetch = fetchFn;
    this.running = null;
  }

  async run() {
    if (this.running) return this.running;
    this.running = this.#runOnce().finally(() => { this.running = null; });
    return this.running;
  }

  async #runOnce() {
    const expectedAcademicYear = this.config.offerAcademicYear;
    const expectedSemesters = watchedSemesters(this.config);
    const parserRevision = String(this.config.kgmuParserRevision || "unknown");
    const maxBytes = Number(this.config.kgmuXlsxMaxBytes || 25 * 1024 * 1024);
    const manualNormalization = this.config.kgmuManualNormalization === true;
    const processor = manualNormalization ? this.sourceObserver : this.ingestService;
    const state = await this.stateStore.read();
    const discovered = [];
    const errors = [];

    if (manualNormalization && typeof processor?.observeSource !== "function") {
      throw new Error("KGMU manual source observer is unavailable");
    }

    for (const page of targetPages(this.config)) {
      try {
        const response = await this.fetch(page.url, { redirect: "follow", headers: { "User-Agent": "medical-calendar-api/1.0 KGMU schedule watcher" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const html = await response.text();
        discovered.push(...discoverKgmuScheduleLinks(html, page));
      } catch (error) {
        errors.push({ page: page.url, program: page.program, error: String(error?.message || error).slice(0, 300) });
      }
    }

    const expectedSemesterSet = new Set(expectedSemesters);
    const targets = canonicalSources(discovered.filter((source) =>
      source.academicYear === expectedAcademicYear && expectedSemesterSet.has(source.semester),
    ));
    const results = [];

    for (const source of targets) {
      const key = slotKey(source);
      try {
        const response = await this.fetch(source.url, { redirect: "follow", headers: { "User-Agent": "medical-calendar-api/1.0 KGMU schedule watcher" } });
        if (!response.ok) throw new Error(`XLSX HTTP ${response.status}`);
        const declaredSize = responseSize(response);
        if (declaredSize != null && declaredSize > maxBytes) throw new Error(`XLSX exceeds ${maxBytes} bytes`);
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxBytes) throw new Error(`XLSX exceeds ${maxBytes} bytes`);
        const hash = sha256(buffer);
        const previous = state.slots[key];
        if (previous?.sha256 === hash && previous?.parserRevision === parserRevision) {
          let notificationRetry = null;
          let pending = Boolean(previous.notificationPending);
          if (pending && previous.reviewId && typeof processor?.retryNotification === "function") {
            notificationRetry = await processor.retryNotification(previous.reviewId);
            pending = !notificationRetry?.sent && !notificationRetry?.terminal;
          }
          state.slots[key] = {
            ...previous,
            lastSeenAt: new Date().toISOString(),
            url: source.url,
            label: source.label,
            notificationPending: pending,
            lastNotificationAttemptAt: notificationRetry ? new Date().toISOString() : previous.lastNotificationAttemptAt || null,
          };
          results.push({ slot: key, status: "UNCHANGED", sha256: hash, parserRevision, url: source.url, notificationRetry });
          continue;
        }

        const context = {
          filename: filenameFromUrl(source.url),
          program: source.program,
          course: source.course,
          academicYear: source.academicYear,
          semester: source.semester,
          groupRange: source.groupRange,
          sourceUrl: source.url,
        };
        const processed = manualNormalization
          ? await processor.observeSource(buffer, context)
          : await processor.ingest(buffer, context);
        const pending = notificationPending(processed);
        state.slots[key] = {
          sha256: hash,
          parserRevision,
          url: source.url,
          label: source.label,
          sourceLocale: source.sourceLocale || null,
          program: source.program,
          course: source.course,
          groupRange: source.groupRange,
          academicYear: source.academicYear,
          semester: source.semester,
          lastSeenAt: new Date().toISOString(),
          lastIngestedAt: new Date().toISOString(),
          ingestStatus: processed.status,
          reviewId: processed.reviewId || null,
          parserType: processed.classification?.type || processed.parserType || null,
          notificationPending: pending,
          lastNotificationAttemptAt: processed.notification ? new Date().toISOString() : null,
        };
        results.push({
          slot: key,
          status: manualNormalization ? "OBSERVED" : "INGESTED",
          sha256: hash,
          parserRevision,
          url: source.url,
          ...(manualNormalization ? { observation: processed } : { ingest: processed }),
        });
      } catch (error) {
        errors.push({ url: source.url, program: source.program, course: source.course, groupRange: source.groupRange, error: String(error?.message || error).slice(0, 300) });
      }
    }

    const observedCount = results.filter((item) => item.status === "OBSERVED").length;
    const ingestedCount = results.filter((item) => item.status === "INGESTED").length;
    const summary = {
      status: errors.length ? "PARTIAL" : "OK",
      checkedAt: new Date().toISOString(),
      expectedAcademicYear,
      expectedSemesters,
      parserRevision,
      mode: manualNormalization ? "MANUAL_NORMALIZATION" : "SERVER_PARSER",
      discoveredCount: discovered.length,
      targetCount: targets.length,
      observedCount,
      ingestedCount,
      unchangedCount: results.filter((item) => item.status === "UNCHANGED").length,
      notificationRetryCount: results.filter((item) => item.notificationRetry).length,
      pendingNotificationCount: Object.values(state.slots || {}).filter((item) => item?.notificationPending).length,
      errorCount: errors.length,
    };
    state.lastRunAt = summary.checkedAt;
    state.lastRunSummary = summary;
    await this.stateStore.write(state);
    return { ...summary, results, errors };
  }
}

import { classifyKgmuWorkbook } from "../src/adapters/kgmu/classifier.mjs";
import { parseKgmuForeignCycleWorkbook } from "../src/adapters/kgmu/foreign-c-parser.mjs";
import { readKgmuXlsxStructure } from "../src/adapters/kgmu/xlsx-reader.mjs";

const PAGE_URL = "https://kirovgma.ru/raspisanie-fakultet-inostrannyh-obuchayushchihsya";
const USER_AGENT = "Mozilla/5.0 (compatible; KGMU-calendar-source-probe/1.0; +https://github.com/gmarkov634-stack/kirov-gmu-calendar)";

function clean(value) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtml(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function discoverCourse5EnglishXlsx(html) {
  const anchors = [...String(html || "").matchAll(/<a\b[^>]*href=["']([^"']+\.xlsx(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: decodeHtml(match[1]), label: stripHtml(match[2]) }));
  const preferred = anchors.find(({ label }) => /501\s*i\s*[-–]\s*506\s*i/i.test(label) && /(?:2(?:nd)?\s+semester|second\s+semester)/i.test(label));
  const fallback = anchors.find(({ label }) => /501\s*i\s*[-–]\s*506\s*i/i.test(label));
  const found = preferred || fallback;
  if (!found) {
    const error = new Error("Official page has no English 501i-506i XLSX link");
    error.code = "COURSE5_LINK_NOT_FOUND";
    error.candidates = anchors.map((item) => item.label).filter(Boolean);
    throw error;
  }
  return { ...found, url: new URL(found.href, PAGE_URL).href };
}

async function fetchBuffer(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "user-agent": USER_AGENT,
      accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/octet-stream,*/*;q=0.5",
      referer: PAGE_URL,
    },
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type") || "",
    finalUrl: response.url,
    buffer,
  };
}

function groupCode(value) {
  const match = clean(value).match(/^(\d{3})\s*([иi])$/i);
  return match ? `${match[1]}и` : null;
}

function rowsOf(sheet) {
  const rows = new Map();
  for (const cell of sheet?.cells || []) {
    if (!rows.has(cell.row)) rows.set(cell.row, []);
    rows.get(cell.row).push(cell);
  }
  for (const cells of rows.values()) cells.sort((a, b) => a.col - b.col);
  return rows;
}

function inspectWorkbook(workbook) {
  const sheet = workbook?.sheets?.[0];
  if (!sheet) return { error: "no-sheet" };
  const rows = rowsOf(sheet);
  const styled = new Map((sheet.styledCells || []).map((cell) => [cell.ref, cell]));
  const dateRow = [...rows.entries()].find(([, cells]) => cells.filter((cell) => {
    const n = Number(cell.value);
    return Number.isInteger(n) && n >= 1 && n <= 31;
  }).length >= 10)?.[0] || null;
  const groupRows = [...rows.entries()].flatMap(([row, cells]) => {
    const groupCell = cells.find((cell) => groupCode(cell.value));
    return groupCell ? [{ row, group: groupCode(groupCell.value), groupCell: groupCell.ref }] : [];
  });
  const footerHeaderRow = [...rows.entries()].find(([, cells]) => cells.some((cell) => /^(?:academic\s+discipline|discipline|дисциплина)$/i.test(clean(cell.value))))?.[0] || null;

  const anchorRows = [];
  for (const { row, group } of groupRows) {
    for (const cell of rows.get(row) || []) {
      if (cell.col <= 2) continue;
      const text = clean(cell.value);
      if (!text || /^\d{1,2}$/.test(text)) continue;
      const style = styled.get(cell.ref);
      anchorRows.push({ group, cell: cell.ref, text, fillId: style?.fillId || null, styleId: style?.styleId ?? null });
    }
  }

  const distinctAnchors = [];
  const seenAnchors = new Set();
  for (const item of anchorRows) {
    const key = `${item.text}|${item.fillId ?? ""}`;
    if (seenAnchors.has(key)) continue;
    seenAnchors.add(key);
    distinctAnchors.push(item);
  }

  const footerRows = [];
  if (footerHeaderRow) {
    const maxRow = Math.max(...rows.keys());
    for (let row = footerHeaderRow; row <= Math.min(maxRow, footerHeaderRow + 40); row += 1) {
      const values = (rows.get(row) || []).map((cell) => ({ cell: cell.ref, value: clean(cell.value) })).filter((item) => item.value);
      if (values.length) footerRows.push({ row, values });
    }
  }

  const fillCounts = {};
  for (const { row, group } of groupRows) {
    for (const cell of sheet.styledCells || []) {
      if (cell.row !== row || !cell.fillId) continue;
      const key = `${group}|fill:${cell.fillId}`;
      fillCounts[key] = (fillCounts[key] || 0) + 1;
    }
  }

  const starAnchors = anchorRows.filter((item) => item.text.includes("*"));
  const outsideGridText = (sheet.cells || [])
    .filter((cell) => !groupRows.some((item) => item.row === cell.row) && (!footerHeaderRow || cell.row < footerHeaderRow))
    .map((cell) => ({ cell: cell.ref, value: clean(cell.value) }))
    .filter((item) => item.value && !/^\d{1,2}$/.test(item.value));

  return {
    sheet: sheet.name,
    dateRow,
    groupRows,
    footerHeaderRow,
    distinctAnchors,
    starAnchors,
    fillCounts,
    footerRows,
    outsideGridText,
  };
}

function fail(message, details = {}) {
  console.error(JSON.stringify({ status: "FAIL", message, ...details }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const page = await fetch(PAGE_URL, { headers: { "user-agent": USER_AGENT, accept: "text/html,*/*;q=0.8" } });
  if (!page.ok) {
    fail("Official FIO timetable page download failed", { pageStatus: page.status });
    return;
  }
  const html = await page.text();
  let source;
  try {
    source = discoverCourse5EnglishXlsx(html);
  } catch (error) {
    fail(error.message, { code: error.code, candidates: error.candidates || [] });
    return;
  }
  console.log(JSON.stringify({ stage: "discovery", source }, null, 2));

  const downloaded = await fetchBuffer(source.url);
  console.log(JSON.stringify({
    stage: "download",
    status: downloaded.status,
    contentType: downloaded.contentType,
    bytes: downloaded.buffer.length,
    finalUrl: downloaded.finalUrl,
    signature: downloaded.buffer.subarray(0, 4).toString("hex"),
  }, null, 2));
  if (!downloaded.ok) {
    fail("Course 5 XLSX download failed", { httpStatus: downloaded.status, sourceUrl: source.url });
    return;
  }
  if (downloaded.buffer.length < 4 || downloaded.buffer[0] !== 0x50 || downloaded.buffer[1] !== 0x4b) {
    fail("Course 5 source is not an XLSX ZIP container", {
      sourceUrl: source.url,
      contentType: downloaded.contentType,
      bytes: downloaded.buffer.length,
      prefix: downloaded.buffer.subarray(0, 32).toString("utf8"),
    });
    return;
  }

  let workbook;
  try {
    workbook = await readKgmuXlsxStructure(downloaded.buffer);
  } catch (error) {
    fail("XLSX structure read failed", { code: error.code || null, error: error.message });
    return;
  }
  const classification = classifyKgmuWorkbook(workbook);
  console.log(JSON.stringify({ stage: "classification", classification }, null, 2));
  console.log(JSON.stringify({ stage: "structure-inspection", inspection: inspectWorkbook(workbook) }, null, 2));
  if (classification.type !== "C") {
    fail("Course 5 source is not classified as C", { classification });
    return;
  }

  let parsed;
  try {
    parsed = parseKgmuForeignCycleWorkbook(workbook, {
      program: "foreign",
      course: 5,
      academicYear: "2025/26",
      semester: 2,
      sourceUrl: source.url,
    });
  } catch (error) {
    fail("C-FIO parser threw on course 5", { code: error.code || null, error: error.message });
    return;
  }

  const summary = {
    stage: "parse",
    type: parsed.type,
    profile: parsed.profile,
    groups: parsed.schedules.map((schedule) => schedule.group.code),
    qa: parsed.qa,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!parsed.qa?.passed) {
    fail("Course 5 does not yet pass C-FIO QA", {
      groups: summary.groups,
      unhandledBlocks: parsed.qa?.unhandledBlocks || [],
      missingTimes: parsed.qa?.missingTimes || [],
      remainingOverlaps: parsed.qa?.remainingOverlaps || [],
    });
  }
}

main().catch((error) => fail("Unexpected course 5 probe failure", { error: error?.stack || String(error) }));

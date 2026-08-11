function cellText(cell) {
  return String(cell?.value ?? "").replace(/\s+/g, " ").trim();
}

function sheetText(sheet) {
  return (sheet?.cells || []).map(cellText).filter(Boolean).join("\n");
}

function numericDay(value) {
  if (typeof value === "number") return Number.isInteger(value) && value >= 1 && value <= 31;
  return /^\d{1,2}$/.test(String(value || "").trim()) && Number(value) >= 1 && Number(value) <= 31;
}

function groupCode(value) {
  const text = String(value || "").trim();
  if (!/^\d{3}$/.test(text)) return null;
  if (["202", "205", "206"].includes(text)) return text;
  const number = Number(text);
  return number >= 100 && number <= 699 ? text : null;
}

function workbookFeatures(workbook) {
  const sheets = Array.isArray(workbook?.sheets) ? workbook.sheets : [];
  const allText = sheets.map(sheetText).join("\n");
  const lower = allText.toLowerCase();
  const weekdays = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота"]
    .filter((day) => lower.includes(day));
  const groups = new Set();
  let dateHeaderRows = 0;
  let groupRows = 0;
  let wideHorizontalMerges = 0;

  for (const sheet of sheets) {
    const byRow = new Map();
    for (const cell of sheet.cells || []) {
      if (!byRow.has(cell.row)) byRow.set(cell.row, []);
      byRow.get(cell.row).push(cell);
      const code = groupCode(cell.value);
      if (code) groups.add(code);
    }
    for (const row of byRow.values()) {
      const dayCount = row.filter((cell) => numericDay(cell.value)).length;
      if (dayCount >= 10) dateHeaderRows += 1;
      const earlyGroup = row.some((cell) => cell.col <= 4 && groupCode(cell.value));
      if (earlyGroup) groupRows += 1;
    }
    for (const merge of sheet.merges || []) {
      if (merge.startRow === merge.endRow && merge.endCol - merge.startCol >= 2) wideHorizontalMerges += 1;
    }
  }

  return {
    sheetCount: sheets.length,
    sheetNames: sheets.map((sheet) => sheet.name),
    weekdays,
    groupCodes: [...groups].sort(),
    groupCount: groups.size,
    dateHeaderRows,
    groupRows,
    wideHorizontalMerges,
    hasPropedeuticDentistryCycle: /пропедевтическ\w*\s+стоматолог/i.test(allText),
    hasCycleLanguage: /\bцикл\w*\b|начало учебных занятий|1\s*смена|2\s*смена/i.test(allText),
  };
}

export function classifyKgmuWorkbook(workbook) {
  const features = workbookFeatures(workbook);
  const weekly = features.weekdays.length >= 4 && features.groupCount >= 2;
  const calendarGrid = features.dateHeaderRows >= 1 && features.groupRows >= 4 && features.wideHorizontalMerges >= 4;

  if (weekly && features.hasPropedeuticDentistryCycle) {
    return {
      type: "S",
      confidence: "high",
      reason: "weekly-grid-with-embedded-cycle",
      features,
    };
  }
  if (calendarGrid) {
    return {
      type: "C",
      confidence: "high",
      reason: "group-rows-over-calendar-date-grid",
      features,
    };
  }
  if (weekly) {
    return {
      type: "R",
      confidence: "high",
      reason: "weekly-weekday-group-grid",
      features,
    };
  }
  return {
    type: "UNKNOWN",
    confidence: "low",
    reason: "no-known-kgmu-structure-signature",
    features,
  };
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedYear(value) {
  const match = String(value || "").match(/(20\d{2})\D+(\d{2,4})/);
  if (!match) return null;
  const start = Number(match[1]);
  let end = Number(match[2]);
  if (match[2].length === 2) {
    end = Math.floor(start / 100) * 100 + end;
    if (end < start) end += 100;
  }
  if (end !== start + 1) return null;
  return `${start}/${String(end).slice(-2)}`;
}

export function deriveKgmuPeriod(workbook) {
  const text = (workbook?.sheets || [])
    .flatMap((sheet) => sheet.cells || [])
    .map((cell) => clean(cell.value))
    .join(" ");

  let academicYear = null;
  for (const match of text.matchAll(/(20\d{2})\s*[-–/]\s*(\d{2,4})/g)) {
    academicYear = normalizedYear(match[0]);
    if (academicYear) break;
  }

  const lower = text.toLowerCase();
  let semester = null;
  if (/перв(?:ое|ый)\s+(?:полугодие|семестр)/i.test(lower) || /\b(?:1st|first)\s+(?:semester|term)\b/i.test(lower)) semester = 1;
  if (/втор(?:ое|ой)\s+(?:полугодие|семестр)/i.test(lower) || /\b(?:2nd|second)\s+(?:semester|term)\b/i.test(lower)) semester = 2;

  return { academicYear, semester };
}

export function periodMismatches(metadata, derived) {
  const mismatches = [];
  const suppliedYear = metadata?.academicYear ? normalizedYear(metadata.academicYear) : null;
  if (metadata?.academicYear && !suppliedYear) {
    mismatches.push({ field: "academicYear", supplied: metadata.academicYear, derived: derived.academicYear, reason: "invalid-supplied" });
  }
  if (suppliedYear && derived.academicYear && suppliedYear !== derived.academicYear) {
    mismatches.push({ field: "academicYear", supplied: suppliedYear, derived: derived.academicYear, reason: "source-mismatch" });
  }
  const suppliedSemester = Number(metadata?.semester);
  if (metadata?.semester != null && ![1, 2].includes(suppliedSemester)) {
    mismatches.push({ field: "semester", supplied: metadata.semester, derived: derived.semester, reason: "invalid-supplied" });
  }
  if ([1, 2].includes(suppliedSemester) && derived.semester && suppliedSemester !== derived.semester) {
    mismatches.push({ field: "semester", supplied: suppliedSemester, derived: derived.semester, reason: "source-mismatch" });
  }
  return mismatches;
}

import { parseKgmuForeignCourse5Workbook as parseRawCourse5 } from "./foreign-c-course5-parser.mjs";

function normalizedWorkbook(workbook) {
  return {
    ...workbook,
    sheets: (workbook?.sheets || []).map((sheet) => ({
      ...sheet,
      cells: (sheet.cells || []).map((cell) => {
        if (typeof cell.value !== "string") return cell;
        let value = cell.value.replace(/[’`´]/g, "'");
        if (/^children.*infectious diseases.*$/i.test(value.trim())) {
          value = "Children's Infectious Diseases (module) (CID)";
        }
        return value === cell.value ? cell : { ...cell, value };
      }),
      styledCells: (sheet.styledCells || []).map((cell) => {
        if (typeof cell.value !== "string") return cell;
        let value = cell.value.replace(/[’`´]/g, "'");
        if (/^children.*infectious diseases.*$/i.test(value.trim())) {
          value = "Children's Infectious Diseases (module) (CID)";
        }
        return value === cell.value ? cell : { ...cell, value };
      }),
    })),
  };
}

function isPhysicalCulture(value) {
  return /physical culture and sports/i.test(String(value || "")) || /физическ(?:ой|ая) культуре и спорту/i.test(String(value || ""));
}

export function parseKgmuForeignCourse5Workbook(workbook, metadata = {}) {
  const parsed = parseRawCourse5(normalizedWorkbook(workbook), metadata);
  const mirrorSemanticRisks = (parsed.qa?.mirrorSemanticRisks || [])
    .map((risk) => ({
      ...risk,
      subjects: (risk.subjects || []).filter((subject) => !isPhysicalCulture(subject)),
    }))
    .filter((risk) => risk.subjects.length > 0);

  const qa = {
    ...parsed.qa,
    mirrorSemanticRisks,
  };
  const blocked =
    (qa.unhandledBlocks || []).length ||
    (qa.missingTimes || []).length ||
    mirrorSemanticRisks.length ||
    (qa.duplicates || []).length ||
    (qa.remainingOverlaps || []).length ||
    !qa.mainGridSubjectDays;
  qa.status = blocked ? "REVIEW_REQUIRED" : "PASS";
  qa.passed = !blocked;

  return { ...parsed, qa };
}

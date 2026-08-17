const ID = /^[a-z][a-z0-9-]{1,63}$/;
const PLANS = new Set(["semester", "year"]);

export function offerSku({ university, program } = {}, plan) {
  const normalizedUniversity = String(university || "").trim().toLowerCase();
  const normalizedProgram = String(program || "").trim().toLowerCase();
  const normalizedPlan = String(plan || "").trim().toLowerCase();
  if (!ID.test(normalizedUniversity) || !ID.test(normalizedProgram) || !PLANS.has(normalizedPlan)) return "";
  return `calendar:${normalizedUniversity}:${normalizedProgram}:${normalizedPlan}`;
}

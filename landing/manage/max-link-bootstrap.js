import { bootstrapMaxManagement } from "./max-link.js";

try {
  await bootstrapMaxManagement();
} catch {
  const statusNode = document.querySelector("#management-status");
  if (statusNode) {
    statusNode.textContent = "Не удалось подготовить управление календарём.";
    statusNode.className = "manage-status error";
  }
}

await import("./manage.js");

import { MAX_LINK_PENDING_STORAGE_KEY } from "./max-link.js";

const CREDENTIAL_PATTERN = /^[A-Za-z0-9_-]{32,}$/;

function usesBearerSession(config) {
  return config.managementSessionTransport === "bearer";
}

function apiUrl(config, windowObj, path) {
  return new URL(path, config.apiBase || windowObj.location.origin).toString();
}

function pendingLinkToken(storage) {
  if (!storage) return null;
  try {
    const value = storage.getItem(MAX_LINK_PENDING_STORAGE_KEY);
    if (typeof value === "string" && CREDENTIAL_PATTERN.test(value)) return value;
    if (value !== null) storage.removeItem(MAX_LINK_PENDING_STORAGE_KEY);
  } catch {}
  return null;
}

function setStatus(statusNode, text, kind = "") {
  if (!statusNode) return;
  statusNode.textContent = text;
  statusNode.className = `manage-status${kind ? ` ${kind}` : ""}`;
}

export function installMaxLinkEmailHandoff({
  windowObj = window,
  documentObj = document,
  config = globalThis.KGMU_CALENDAR_CONFIG ?? {},
  fetchImpl = windowObj.fetch.bind(windowObj),
  storage = windowObj.sessionStorage
} = {}) {
  const form = documentObj?.querySelector?.("#management-link-form");
  const emailInput = documentObj?.querySelector?.("#management-email");
  const submit = documentObj?.querySelector?.("#management-link-submit");
  const status = documentObj?.querySelector?.("#management-status");
  if (!form || !emailInput || !submit) return false;

  form.addEventListener("submit", async (event) => {
    const linkToken = pendingLinkToken(storage);
    if (!linkToken) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    if (!config.managementEnabled) {
      setStatus(status, "Управление ещё не включено на production.", "error");
      return;
    }

    submit.disabled = true;
    setStatus(status, "Отправляем одноразовую ссылку…");
    try {
      const response = await fetchImpl(apiUrl(config, windowObj, "/management/max/link-request"), {
        method: "POST",
        mode: "cors",
        credentials: usesBearerSession(config) ? "omit" : "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          linkToken
        })
      });
      if (!response.ok) throw new Error("Не удалось отправить ссылку.");
      setStatus(status, "Если этот email зарегистрирован, одноразовая ссылка отправлена. Проверьте почту.", "success");
    } catch (error) {
      setStatus(status, error instanceof Error ? error.message : "Не удалось отправить ссылку.", "error");
    } finally {
      submit.disabled = false;
    }
  });

  return true;
}

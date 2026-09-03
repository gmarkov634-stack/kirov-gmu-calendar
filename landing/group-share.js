const FACULTY_LABELS = Object.freeze({
  medicine: Object.freeze(["Лечебный факультет", "Лечебное дело"]),
  pediatrics: Object.freeze(["Педиатрический факультет", "Педиатрия"]),
  dentistry: Object.freeze(["Стоматологический факультет", "Стоматология"])
});

const SHARE_SOURCES = Object.freeze({
  max: "max-share",
  vk: "vk-share"
});

const REFERRAL_SOURCES = new Set(Object.values(SHARE_SOURCES));

function positiveInteger(value) {
  if (!/^\d+$/.test(String(value ?? ""))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function normalizedSelection(value) {
  if (!value || typeof value !== "object") return null;
  const faculty = typeof value.faculty === "string" ? value.faculty : "";
  const course = positiveInteger(value.course);
  const group = /^\d+$/.test(String(value.group ?? "")) ? String(value.group) : "";
  if (!Object.hasOwn(FACULTY_LABELS, faculty) || !course || !group) return null;
  return Object.freeze({ faculty, course, group });
}

export function parsePublicSelection(search = "") {
  const params = new URLSearchParams(search);
  return normalizedSelection({
    faculty: params.get("faculty"),
    course: params.get("course"),
    group: params.get("group")
  });
}

export function referralSource(search = "") {
  const source = new URLSearchParams(search).get("src");
  return REFERRAL_SOURCES.has(source) ? source : null;
}

export function buildPublicGroupUrl(baseUrl, selection, source) {
  const safeSelection = normalizedSelection(selection);
  if (!safeSelection) throw new TypeError("Invalid public group selection");
  if (!REFERRAL_SOURCES.has(source)) throw new TypeError("Invalid share source");

  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("faculty", safeSelection.faculty);
  url.searchParams.set("course", String(safeSelection.course));
  url.searchParams.set("group", safeSelection.group);
  url.searchParams.set("src", source);
  return url.toString();
}

export function buildMaxShareUrl(publicUrl, selection) {
  const safeSelection = normalizedSelection(selection);
  if (!safeSelection) throw new TypeError("Invalid public group selection");
  const share = new URL("https://max.ru/:share");
  share.searchParams.set(
    "text",
    `Я подключил расписание нашей группы прямо в календарь телефона. Пары, аудитории и изменения обновляются автоматически. Расписание группы ${safeSelection.group} КГМУ: ${publicUrl}`
  );
  return share.toString();
}

export function buildVkShareUrl(publicUrl) {
  const share = new URL("https://vk.com/share.php");
  share.searchParams.set("url", publicUrl);
  return share.toString();
}

export function findSelectionInCatalog(catalog, groupId) {
  const group = /^\d+$/.test(String(groupId ?? "")) ? String(groupId) : "";
  if (!group || !Array.isArray(catalog?.programs)) return null;

  const matches = [];
  for (const program of catalog.programs) {
    if (!Object.hasOwn(FACULTY_LABELS, program?.programId) || !Array.isArray(program?.courses)) continue;
    for (const course of program.courses) {
      if (!Array.isArray(course?.groupIds)) continue;
      if (course.groupIds.map(String).includes(group)) {
        const selection = normalizedSelection({ faculty: program.programId, course: course.course, group });
        if (selection) matches.push(selection);
      }
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function emitAcquisitionEvent(name, detail) {
  if (typeof window?.dispatchEvent !== "function" || typeof CustomEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(`kgmu:${name}`, {
    detail: Object.freeze({ ...detail })
  }));
}

function injectStyles() {
  if (document.querySelector("style[data-group-share-styles]")) return;
  const style = document.createElement("style");
  style.dataset.groupShareStyles = "";
  style.textContent = `
    .group-share-card{margin-top:18px;padding:18px;border:1px solid rgba(21,89,214,.18);border-radius:18px;background:rgba(21,89,214,.045)}
    .group-share-card h4{margin:0 0 6px;font-size:1.05rem}.group-share-card p{margin:0;color:var(--muted,#596579);line-height:1.5}
    .group-share-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:14px}.group-share-action{text-decoration:none;text-align:center;justify-content:center}
    .subscription-item .group-share-card{margin-top:16px}.group-share-card[data-group-share-pending]{opacity:.72}
  `;
  document.head.append(style);
}

function shareCard(selection, publicBaseUrl) {
  const wrapper = document.createElement("section");
  wrapper.className = "group-share-card";
  wrapper.dataset.groupShare = selection.group;

  const title = document.createElement("h4");
  title.textContent = "Расписание нужно одногруппникам?";
  const copy = document.createElement("p");
  copy.textContent = `Отправьте готовую страницу группы ${selection.group}. В ссылке нет вашей персональной ICS-ссылки или её токена.`;
  const actions = document.createElement("div");
  actions.className = "group-share-actions";

  const maxPublicUrl = buildPublicGroupUrl(publicBaseUrl, selection, SHARE_SOURCES.max);
  const vkPublicUrl = buildPublicGroupUrl(publicBaseUrl, selection, SHARE_SOURCES.vk);

  const max = document.createElement("a");
  max.className = "pay-button group-share-action";
  max.href = buildMaxShareUrl(maxPublicUrl, selection);
  max.target = "_blank";
  max.rel = "noopener noreferrer";
  max.textContent = "Отправить в MAX";
  max.addEventListener("click", () => emitAcquisitionEvent("share-click", {
    platform: "max",
    source: SHARE_SOURCES.max,
    faculty: selection.faculty,
    course: selection.course,
    groupId: selection.group
  }));

  const vk = document.createElement("a");
  vk.className = "secondary-action group-share-action";
  vk.href = buildVkShareUrl(vkPublicUrl);
  vk.target = "_blank";
  vk.rel = "noopener noreferrer";
  vk.textContent = "Отправить ВКонтакте";
  vk.addEventListener("click", () => emitAcquisitionEvent("share-click", {
    platform: "vk",
    source: SHARE_SOURCES.vk,
    faculty: selection.faculty,
    course: selection.course,
    groupId: selection.group
  }));

  actions.append(max, vk);
  wrapper.append(title, copy, actions);
  return wrapper;
}

function facultyFromText(text) {
  const normalized = String(text ?? "").trim();
  for (const [faculty, labels] of Object.entries(FACULTY_LABELS)) {
    if (labels.some((label) => normalized.includes(label))) return faculty;
  }
  return null;
}

function captureLandingSelection() {
  const preview = document.querySelector("#choice-grid .group-preview");
  const title = document.querySelector("#selector-title")?.textContent ?? "";
  const previewTitle = preview?.querySelector(".group-preview-head h3")?.textContent ?? "";
  const faculty = facultyFromText(`${title} ${previewTitle}`);
  const course = /(?:^|·|\s)(\d+)\s*курс/i.exec(title)?.[1] ?? null;
  const group = /группа\s+(\d+)/i.exec(previewTitle)?.[1] ?? /группа\s+(\d+)/i.exec(title)?.[1] ?? null;
  return normalizedSelection({ faculty, course, group });
}

function choiceByText(grid, expected) {
  return [...grid.querySelectorAll("button.choice-card")].find((button) => (
    button.querySelector("strong")?.textContent?.trim() === expected
  )) ?? null;
}

function facultyChoice(grid, faculty) {
  const labels = FACULTY_LABELS[faculty] ?? [];
  return [...grid.querySelectorAll("button.choice-card")].find((button) => {
    const text = button.querySelector("strong")?.textContent?.trim() ?? "";
    return labels.includes(text);
  }) ?? null;
}

function restoreInitialSelector() {
  const back = document.querySelector("#back-button");
  if (!back) return;
  let attempts = 0;
  const rewind = () => {
    attempts += 1;
    if (attempts > 3 || back.hidden) return;
    back.click();
    queueMicrotask(rewind);
  };
  rewind();
}

function installLanding(publicBaseUrl) {
  const grid = document.querySelector("#choice-grid");
  if (!grid) return;

  const requested = parsePublicSelection(window.location.search);
  const requestedSource = referralSource(window.location.search);
  let currentSelection = null;
  let autoStage = requested && !new URLSearchParams(window.location.search).has("payment") ? "faculty" : "done";

  if (requested && requestedSource) {
    emitAcquisitionEvent("referral-visit", {
      source: requestedSource,
      faculty: requested.faculty,
      course: requested.course,
      groupId: requested.group
    });
  }

  function attemptAutoSelection() {
    if (autoStage === "done") return;
    const cards = grid.querySelectorAll("button.choice-card");
    if (!cards.length) return;

    if (autoStage === "faculty") {
      const button = facultyChoice(grid, requested.faculty);
      if (!button) {
        autoStage = "done";
        return;
      }
      autoStage = "course";
      button.click();
      return;
    }

    if (autoStage === "course") {
      const button = choiceByText(grid, `${requested.course} курс`);
      if (!button) {
        autoStage = "done";
        restoreInitialSelector();
        return;
      }
      autoStage = "group";
      button.click();
      return;
    }

    if (autoStage === "group") {
      const button = choiceByText(grid, `Группа ${requested.group}`);
      if (!button) {
        autoStage = "done";
        restoreInitialSelector();
        return;
      }
      autoStage = "done";
      button.click();
      document.querySelector("#selector")?.scrollIntoView({ block: "start", inline: "nearest" });
    }
  }

  function capture() {
    const selection = captureLandingSelection();
    if (selection) currentSelection = selection;
  }

  function ensureShare() {
    const iphone = grid.querySelector('a.calendar-device-action[href^="webcal://"]');
    const resultCard = iphone?.closest(".trial-connect-card");
    if (!iphone || !resultCard || resultCard.querySelector("[data-group-share]")) return;
    capture();
    if (!currentSelection) return;
    const guidance = resultCard.querySelector("[data-iphone-reminder-guidance]");
    const anchor = guidance ?? iphone.closest(".connect-actions");
    anchor?.insertAdjacentElement("afterend", shareCard(currentSelection, publicBaseUrl));
  }

  grid.addEventListener("submit", (event) => {
    if (!requestedSource || !requested) return;
    const id = event.target?.id;
    if (id === "runtime-trial-form") {
      emitAcquisitionEvent("referral-trial", {
        source: requestedSource,
        faculty: requested.faculty,
        course: requested.course,
        groupId: requested.group
      });
    } else if (id === "runtime-checkout-form") {
      emitAcquisitionEvent("referral-checkout", {
        source: requestedSource,
        faculty: requested.faculty,
        course: requested.course,
        groupId: requested.group
      });
    }
  }, { capture: true });

  const observer = new MutationObserver(() => {
    attemptAutoSelection();
    capture();
    ensureShare();
  });
  observer.observe(grid, { childList: true, subtree: true });
  attemptAutoSelection();
  capture();
  ensureShare();
}

function installManagement(publicBaseUrl, siteRoot) {
  const list = document.querySelector("#subscription-list");
  if (!list) return;

  const period = globalThis.KGMU_CALENDAR_CONFIG?.academicPeriodId ?? "2026-2027-semester-1";
  const catalogUrl = new URL(`./catalog/${encodeURIComponent(period)}.json`, siteRoot);
  let catalogPromise = null;

  function loadCatalog() {
    if (!catalogPromise) {
      catalogPromise = fetch(catalogUrl, { cache: "no-store", credentials: "omit" })
        .then((response) => {
          if (!response.ok) throw new Error(`catalog_http_${response.status}`);
          return response.json();
        });
    }
    return catalogPromise;
  }

  function ensureCards() {
    for (const card of list.querySelectorAll(".subscription-item")) {
      if (card.dataset.groupShareState) continue;
      const title = card.querySelector("h3")?.textContent ?? "";
      const groupId = /группа\s+(\d+)/i.exec(title)?.[1];
      if (!groupId) continue;
      card.dataset.groupShareState = "loading";
      loadCatalog()
        .then((catalog) => findSelectionInCatalog(catalog, groupId))
        .then((selection) => {
          if (!selection || card.querySelector("[data-group-share]")) {
            card.dataset.groupShareState = selection ? "ready" : "unavailable";
            return;
          }
          const actions = card.querySelector(".subscription-actions");
          const node = shareCard(selection, publicBaseUrl);
          (actions ?? card.lastElementChild)?.insertAdjacentElement("afterend", node);
          card.dataset.groupShareState = "ready";
        })
        .catch(() => {
          card.dataset.groupShareState = "unavailable";
        });
    }
  }

  const observer = new MutationObserver(ensureCards);
  observer.observe(list, { childList: true, subtree: true });
  ensureCards();
}

function install() {
  injectStyles();
  const siteRoot = new URL("./", import.meta.url);
  const publicBaseUrl = siteRoot.toString();
  installLanding(publicBaseUrl);
  installManagement(publicBaseUrl, siteRoot);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  install();
}

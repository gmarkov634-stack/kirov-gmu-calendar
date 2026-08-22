function ugmuStreamForGroupCode(value) {
  const number = Number(String(value || "").replace(/\D+/g, ""));
  if (number >= 101 && number <= 112) return "1";
  if (number >= 113 && number <= 124) return "2";
  if (number >= 125 && number <= 136) return "3";
  if (number >= 137 && number <= 150) return "4";
  return "1";
}

const ugmuGroups = Object.freeze(
  Array.from({ length: 50 }, (_, index) => {
    const code = `ОЛД ${101 + index}`;
    return Object.freeze({ code, stream: ugmuStreamForGroupCode(code) });
  }),
);

const ugmuProgram = Object.freeze({
  id: "medicine",
  name: "Лечебное дело",
  course: 1,
  get stream() {
    const selected = new URLSearchParams(window.location.search).get("group");
    return ugmuStreamForGroupCode(selected);
  },
});

window.UGMU_CONFIG = Object.freeze({
  university: "ugmu",
  universityName: "УГМУ",
  timezone: "Asia/Yekaterinburg",
  apiBaseUrl: "https://kgmu-calendar-api.containerapps.ru",
  paymentPath: "/api/v2/payments",
  trialPath: "/api/v2/trials",
  trialDays: 7,
  defaultPlan: "semester",
  academicYear: "2026/2027",
  semester: 1,
  period: Object.freeze({ start: "2026-09-01", end: "2027-01-10" }),
  sourceSha256: "34612248bba201096d6566cacb37c53be01d3f84eddc214bda2a594b46fb24f8",
  program: ugmuProgram,
  groups: ugmuGroups,
});

function pinUgmuSelectorAfterGroupChoice() {
  const selector = document.querySelector("#selector");
  if (!selector) return;
  const topbar = document.querySelector(".topbar");
  const topbarHeight = topbar ? topbar.getBoundingClientRect().height : 68;
  const desiredGap = 28;
  const selectorDocumentTop = window.scrollY + selector.getBoundingClientRect().top;
  const targetTop = selectorDocumentTop - topbarHeight - desiredGap;
  window.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
}

function updateUgmuSelectedStreamCopy() {
  const kicker = document.querySelector(".access-card .section-kicker");
  if (!kicker) return;
  const selected = new URLSearchParams(window.location.search).get("group");
  const roman = { "1": "I", "2": "II", "3": "III", "4": "IV" }[ugmuStreamForGroupCode(selected)] || "I";
  kicker.textContent = `Лечебное дело · 1 курс · ${roman} поток`;
}

document.addEventListener("click", (event) => {
  const groupCard = event.target.closest?.(".group-card");
  if (!groupCard) return;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pinUgmuSelectorAfterGroupChoice();
      updateUgmuSelectedStreamCopy();
    });
  });
  setTimeout(() => {
    pinUgmuSelectorAfterGroupChoice();
    updateUgmuSelectedStreamCopy();
  }, 100);
  setTimeout(() => {
    pinUgmuSelectorAfterGroupChoice();
    updateUgmuSelectedStreamCopy();
  }, 260);
}, true);

const apiBase = window.CALENDAR_DATA.apiBase;
const form = document.querySelector("#admin-login");
const tokenInput = document.querySelector("#admin-token");
const message = document.querySelector("#admin-message");
const dashboard = document.querySelector("#admin-dashboard");
const refreshButton = document.querySelector("#admin-refresh");
const emailTestButton = document.querySelector("#email-test");
const summary = document.querySelector("#admin-summary");
const list = document.querySelector("#admin-list");
const reviewSummary = document.querySelector("#review-summary");
const reviewList = document.querySelector("#review-list");

const statusLabels = {
  REVIEW_REQUIRED: "Требуется разбор",
  READY_TO_PUBLISH: "Готово к публикации",
  PUBLISHED: "Опубликовано",
};

const reasonLabels = {
  UNKNOWN_PATTERN: "Неизвестная структура XLSX",
  PERIOD_MISMATCH: "Период в файле не совпадает с ожидаемым",
  MISSING_PUBLICATION_CONTEXT: "Не хватает данных для безопасной публикации",
  PARSER_R_FAILED: "Ошибка парсера R",
  PARSER_C_FAILED: "Ошибка парсера C",
  PARSER_S_FAILED: "Ошибка парсера S",
  PARSER_R_QA_FAILED: "QA парсера R не пройден",
  PARSER_C_QA_FAILED: "QA парсера C не пройден",
  PARSER_S_QA_FAILED: "QA парсера S не пройден",
  PUBLICATION_FAILED: "Ошибка публикации",
  QA_PASS_AWAITING_PUBLISH: "QA пройден, ожидает подтверждения",
  QA_PASS_PUBLISHED: "Проверенная версия опубликована",
};

function headers() {
  return { "X-Admin-Token": tokenInput.value };
}

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

function programName(id) {
  const faculty = (window.CALENDAR_DATA.faculties || []).find((item) => item.id === id);
  return faculty?.short || faculty?.name || id || "—";
}

function localDate(value) {
  return value ? new Date(value).toLocaleString("ru-RU") : "—";
}

function groupsForReview(review) {
  const classified = Array.isArray(review?.classification?.features?.groupCodes)
    ? review.classification.features.groupCodes
    : [];
  const qaCounts = review?.qa?.groupCounts && typeof review.qa.groupCounts === "object"
    ? Object.keys(review.qa.groupCounts)
    : [];
  const eventCounts = review?.qa?.eventCountsByGroup && typeof review.qa.eventCountsByGroup === "object"
    ? Object.keys(review.qa.eventCountsByGroup)
    : [];
  return [...new Set([...classified, ...qaCounts, ...eventCounts])];
}

function appendMeta(container, label, value) {
  const item = document.createElement("span");
  const strong = document.createElement("b");
  strong.textContent = `${label}: `;
  item.append(strong, document.createTextNode(String(value ?? "—")));
  container.append(item);
}

function subscriptionGroup(record) {
  return record.groupCode || record.groupDisplayName || record.group || record.groupId || "—";
}

async function subscriptionAction(record, operation) {
  const label = operation === "revoke"
    ? "Заблокировать ссылку? Календарь станет пустым."
    : "Перевыпустить ссылку? Старая станет пустой, новая появится у покупателя.";
  if (!window.confirm(label)) return;
  const response = await fetch(`${apiBase}/api/v1/admin/subscriptions/${record.tokenHash}/${operation}`, {
    method: "POST",
    headers: headers(),
  });
  if (!response.ok) {
    showMessage("Действие не выполнено. Обновите список и попробуйте снова.");
    return;
  }
  await load();
}

function renderSubscription(record) {
  const card = document.createElement("article");
  card.className = `admin-record${record.suspicious ? " is-suspicious" : ""}`;
  const lastSeen = record.lastSeenAt ? new Date(record.lastSeenAt).toLocaleString("ru-RU") : "Ещё не запрашивался";
  card.innerHTML = `<div><strong>Группа ${subscriptionGroup(record)}</strong><span>${record.suspicious ? "Подозрительная активность" : "Обычная активность"}</span></div><dl><dt>Источников</dt><dd>${record.sourceCount}</dd><dt>Запросов</dt><dd>${record.totalRequests}</dd><dt>Последний</dt><dd>${lastSeen}</dd><dt>Статус</dt><dd>${record.status}</dd></dl><div class="admin-actions"></div>`;
  const actions = card.querySelector(".admin-actions");
  if (record.status === "active") {
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.textContent = "Заблокировать";
    revoke.addEventListener("click", () => subscriptionAction(record, "revoke"));
    actions.append(revoke);
  }
  if (record.orderId) {
    const rotate = document.createElement("button");
    rotate.type = "button";
    rotate.textContent = "Перевыпустить";
    rotate.addEventListener("click", () => subscriptionAction(record, "rotate"));
    actions.append(rotate);
  }
  return card;
}

async function downloadReviewSource(review) {
  const response = await fetch(`${apiBase}/api/v1/admin/parser-reviews/${review.reviewId}/source`, {
    cache: "no-store",
    headers: headers(),
  });
  if (!response.ok) {
    showMessage("Не удалось скачать исходный XLSX для этой проверки.");
    return;
  }
  const blob = await response.blob();
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = review.metadata?.filename || "schedule.xlsx";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

async function publishReview(review) {
  const groups = groupsForReview(review);
  const target = groups.length ? `Группы: ${groups.join(", ")}.` : "";
  if (!window.confirm(`Опубликовать проверенное расписание? ${target} После публикации соответствующие группы станут доступны в каталоге.`)) return;
  const response = await fetch(`${apiBase}/api/v1/admin/parser-reviews/${review.reviewId}/publish`, {
    method: "POST",
    headers: headers(),
  });
  if (!response.ok) {
    if (response.status === 409) {
      showMessage("Публикация заблокирована сервером: эта проверка не имеет статуса READY_TO_PUBLISH.");
    } else {
      showMessage("Не удалось опубликовать расписание. Обновите список и попробуйте снова.");
    }
    return;
  }
  showMessage("Проверенное расписание опубликовано.");
  await load();
}

async function testEmail() {
  emailTestButton.disabled = true;
  showMessage("Отправляю тестовое письмо…");
  try {
    const response = await fetch(`${apiBase}/api/v1/admin/kgmu/email-test`, {
      method: "POST",
      headers: headers(),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      if (data.error === "email_not_configured") {
        showMessage("Email-уведомления ещё не настроены. Добавьте SMTP-параметры и EMAIL_TO в kgmu-calendar-api.");
      } else {
        showMessage("Тест Email не прошёл. Проверьте SMTP-параметры и логи kgmu-calendar-api.");
      }
      return;
    }
    showMessage("Тестовое письмо отправлено.");
  } finally {
    emailTestButton.disabled = false;
  }
}

function renderReview(review) {
  const card = document.createElement("article");
  const statusClass = review.status === "READY_TO_PUBLISH"
    ? " is-ready"
    : review.status === "PUBLISHED"
      ? " is-published"
      : " is-review-required";
  card.className = `admin-record review-record${statusClass}`;

  const head = document.createElement("div");
  head.className = "review-head";
  const title = document.createElement("div");
  const strong = document.createElement("strong");
  strong.textContent = review.metadata?.filename || "Расписание XLSX";
  const id = document.createElement("small");
  id.textContent = `Review ID: ${review.reviewId}`;
  title.append(strong, id);
  const status = document.createElement("span");
  status.className = "review-status";
  status.textContent = statusLabels[review.status] || review.status || "—";
  head.append(title, status);

  const meta = document.createElement("div");
  meta.className = "review-meta";
  appendMeta(meta, "Направление", programName(review.metadata?.program));
  appendMeta(meta, "Курс", review.metadata?.course || "—");
  appendMeta(meta, "Период", `${review.metadata?.academicYear || "—"}, семестр ${review.metadata?.semester || "—"}`);
  appendMeta(meta, "Парсер", review.parserType || review.classification?.type || "UNKNOWN");
  appendMeta(meta, "Причина", reasonLabels[review.reason] || review.reason || "—");
  appendMeta(meta, "Обновлено", localDate(review.updatedAt || review.createdAt));
  const groups = groupsForReview(review);
  if (groups.length) appendMeta(meta, "Группы", groups.join(", "));
  if (review.qa?.eventCount != null) appendMeta(meta, "Событий", review.qa.eventCount);

  const actions = document.createElement("div");
  actions.className = "admin-actions";
  const download = document.createElement("button");
  download.type = "button";
  download.className = "download-review";
  download.textContent = "Скачать исходный XLSX";
  download.addEventListener("click", () => downloadReviewSource(review));
  actions.append(download);

  if (review.status === "READY_TO_PUBLISH") {
    const publish = document.createElement("button");
    publish.type = "button";
    publish.className = "publish-review";
    publish.textContent = "Опубликовать";
    publish.addEventListener("click", () => publishReview(review));
    actions.append(publish);
  }

  const details = document.createElement("details");
  details.className = "review-details";
  const detailsTitle = document.createElement("summary");
  detailsTitle.textContent = "Технические детали";
  const pre = document.createElement("pre");
  pre.textContent = JSON.stringify(review, null, 2);
  details.append(detailsTitle, pre);

  card.append(head, meta, actions, details);
  return card;
}

function sortReviews(reviews) {
  const priority = { REVIEW_REQUIRED: 0, READY_TO_PUBLISH: 1, PUBLISHED: 2 };
  return [...reviews].sort((a, b) => {
    const byStatus = (priority[a.status] ?? 9) - (priority[b.status] ?? 9);
    if (byStatus) return byStatus;
    return String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || ""));
  });
}

async function load() {
  showMessage("");
  const subscriptionResponse = await fetch(`${apiBase}/api/v1/admin/subscriptions`, {
    cache: "no-store",
    headers: headers(),
  });
  if (!subscriptionResponse.ok) {
    dashboard.hidden = true;
    summary.textContent = "";
    list.replaceChildren();
    reviewSummary.textContent = "";
    reviewList.replaceChildren();
    showMessage(subscriptionResponse.status === 403 ? "Неверный ключ администратора." : "Раздел администратора пока не настроен.");
    return;
  }

  const reviewResponse = await fetch(`${apiBase}/api/v1/admin/parser-reviews?limit=100`, {
    cache: "no-store",
    headers: headers(),
  });
  if (!reviewResponse.ok) {
    dashboard.hidden = true;
    showMessage(reviewResponse.status === 403 ? "Неверный ключ администратора." : "Не удалось загрузить проверки расписаний.");
    return;
  }

  const [{ subscriptions }, { reviews }] = await Promise.all([
    subscriptionResponse.json(),
    reviewResponse.json(),
  ]);

  const suspicious = subscriptions.filter((item) => item.suspicious && item.status === "active");
  summary.textContent = `Активных подозрительных ссылок: ${suspicious.length}. Всего отслеживается: ${subscriptions.length}.`;
  list.replaceChildren(...subscriptions
    .sort((a, b) => Number(b.suspicious) - Number(a.suspicious))
    .map(renderSubscription));
  if (!subscriptions.length) summary.textContent = "Обращений к персональным ссылкам пока нет.";

  const required = reviews.filter((item) => item.status === "REVIEW_REQUIRED").length;
  const ready = reviews.filter((item) => item.status === "READY_TO_PUBLISH").length;
  const published = reviews.filter((item) => item.status === "PUBLISHED").length;
  reviewSummary.textContent = `Требуют разбора: ${required}. Готовы к публикации: ${ready}. Опубликовано в последних 100 проверках: ${published}.`;
  reviewList.replaceChildren(...sortReviews(reviews).map(renderReview));
  if (!reviews.length) reviewSummary.textContent = "Новых расписаний на проверке пока нет.";

  dashboard.hidden = false;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  load();
});
refreshButton.addEventListener("click", load);
emailTestButton.addEventListener("click", testEmail);

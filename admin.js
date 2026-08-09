const apiBase = window.CALENDAR_DATA.apiBase;
const form = document.querySelector("#admin-login");
const tokenInput = document.querySelector("#admin-token");
const message = document.querySelector("#admin-message");
const summary = document.querySelector("#admin-summary");
const list = document.querySelector("#admin-list");

function headers() {
  return { "X-Admin-Token": tokenInput.value };
}

function showMessage(text) {
  message.textContent = text;
  message.hidden = !text;
}

async function action(record, operation) {
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

function renderRecord(record) {
  const card = document.createElement("article");
  card.className = `admin-record${record.suspicious ? " is-suspicious" : ""}`;
  const lastSeen = record.lastSeenAt ? new Date(record.lastSeenAt).toLocaleString("ru-RU") : "Ещё не запрашивался";
  card.innerHTML = `<div><strong>Группа ${record.group}</strong><span>${record.suspicious ? "Подозрительная активность" : "Обычная активность"}</span></div><dl><dt>Источников</dt><dd>${record.sourceCount}</dd><dt>Запросов</dt><dd>${record.totalRequests}</dd><dt>Последний</dt><dd>${lastSeen}</dd><dt>Статус</dt><dd>${record.status}</dd></dl><div class="admin-actions"></div>`;
  const actions = card.querySelector(".admin-actions");
  if (record.status === "active") {
    const revoke = document.createElement("button");
    revoke.type = "button";
    revoke.textContent = "Заблокировать";
    revoke.addEventListener("click", () => action(record, "revoke"));
    actions.append(revoke);
  }
  if (record.orderId) {
    const rotate = document.createElement("button");
    rotate.type = "button";
    rotate.textContent = "Перевыпустить";
    rotate.addEventListener("click", () => action(record, "rotate"));
    actions.append(rotate);
  }
  return card;
}

async function load() {
  showMessage("");
  const response = await fetch(`${apiBase}/api/v1/admin/subscriptions`, {
    cache: "no-store",
    headers: headers(),
  });
  if (!response.ok) {
    summary.hidden = true;
    list.replaceChildren();
    showMessage(response.status === 403 ? "Неверный ключ администратора." : "Раздел администратора пока не настроен.");
    return;
  }
  const { subscriptions } = await response.json();
  const suspicious = subscriptions.filter((item) => item.suspicious && item.status === "active");
  summary.textContent = `Активных подозрительных ссылок: ${suspicious.length}. Всего отслеживается: ${subscriptions.length}.`;
  summary.hidden = false;
  list.replaceChildren(...subscriptions
    .sort((a, b) => Number(b.suspicious) - Number(a.suspicious))
    .map(renderRecord));
  if (!subscriptions.length) showMessage("Обращений к персональным ссылкам пока нет.");
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  load();
});

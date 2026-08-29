const PAYMENT_RETURN_CONTEXT_KEY = "kgmu-calendar:pending-checkout";

function readReturnContext() {
  try {
    const raw = sessionStorage.getItem(PAYMENT_RETURN_CONTEXT_KEY);
    sessionStorage.removeItem(PAYMENT_RETURN_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
    return summary ? { summary } : null;
  } catch {
    return null;
  }
}

function saveCheckoutContext(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== "runtime-checkout-form") return;
  const card = form.closest(".trial-connect-card");
  const summary = card?.querySelector("h3")?.textContent?.trim();
  if (!summary) return;
  try {
    sessionStorage.setItem(PAYMENT_RETURN_CONTEXT_KEY, JSON.stringify({ summary }));
  } catch {
    // Checkout must continue even when sessionStorage is unavailable.
  }
}

function createLink(className, href, text) {
  const link = document.createElement("a");
  link.className = className;
  link.href = href;
  link.textContent = text;
  return link;
}

function renderPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("payment") !== "return") return;

  const choiceGrid = document.querySelector("#choice-grid");
  if (!choiceGrid) return;

  const context = readReturnContext();
  const card = document.createElement("section");
  card.className = "trial-connect-card";

  const mark = document.createElement("div");
  mark.className = "trial-mark";
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = "₽";

  const kicker = document.createElement("p");
  kicker.className = "section-kicker";
  kicker.textContent = "Возврат после оплаты";

  const heading = document.createElement("h3");
  heading.textContent = "Проверяем оплату";

  const lead = document.createElement("p");
  lead.textContent = "Возврат со страницы ЮKassa сам по себе не подтверждает оплату. Сервер отдельно проверяет статус платежа у провайдера и только после этого активирует доступ.";

  card.append(mark, kicker, heading);

  if (context?.summary) {
    const summary = document.createElement("p");
    summary.className = "trial-window";
    summary.textContent = context.summary;
    card.append(summary);
  }

  card.append(lead);

  const followup = document.createElement("p");
  followup.textContent = "Если платёж подтверждён, на указанный при покупке email придёт ссылка для управления календарём. Повторно оплачивать тот же тариф не нужно.";
  card.append(followup);

  const actions = document.createElement("div");
  actions.className = "connect-actions";
  actions.append(
    createLink("pay-button", "./manage/", "Открыть управление подпиской"),
    createLink("secondary-action", "./", "Вернуться к выбору группы")
  );
  card.append(actions);

  choiceGrid.replaceChildren(card);

  const selectorTitle = document.querySelector("#selector-title");
  if (selectorTitle) selectorTitle.textContent = "Результат оплаты";
  const stepKicker = document.querySelector("#step-kicker");
  if (stepKicker) stepKicker.textContent = "Оплата";
  const backButton = document.querySelector("#back-button");
  if (backButton) backButton.hidden = true;
}

document.addEventListener("submit", saveCheckoutContext, true);
renderPaymentReturn();

(() => {
  const TOKEN = /^[A-Za-z0-9_-]{43}$/;
  const CALENDAR_SUFFIX = '/calendar.ics';
  const mounted = new WeakSet();

  function subscriptionHttpsUrl(value) {
    try {
      const normalized = String(value || '').replace(/^webcal:/i, 'https:');
      const url = new URL(normalized, window.location.href);
      if (url.protocol !== 'https:' || !url.pathname.endsWith(CALENDAR_SUFFIX)) return null;
      const match = url.pathname.match(/^\/api\/v1\/subscriptions\/([A-Za-z0-9_-]{43})\/calendar\.ics$/);
      if (!match || !TOKEN.test(match[1])) return null;
      return { url, token: match[1] };
    } catch {
      return null;
    }
  }

  function preferencesUrl(subscription) {
    const url = new URL(subscription.url.toString());
    url.pathname = `/api/v1/subscriptions/${subscription.token}/preferences`;
    url.search = '';
    url.hash = '';
    return url.toString();
  }

  function text(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.textContent = value;
    return node;
  }

  function optionNode(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function selectedValue(block) {
    return typeof block?.selected === 'string' ? block.selected : '';
  }

  async function saveSelection(endpoint, blockId, value, status, select) {
    select.disabled = true;
    status.textContent = 'Сохраняем…';
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ electives: { [blockId]: value || null } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error || 'preferences_unavailable');
      const updated = (result.electives || []).find((item) => item.id === blockId);
      if (updated) select.value = selectedValue(updated);
      status.textContent = value
        ? 'Выбор сохранён. Календарь обновится по той же подписной ссылке.'
        : 'Дисциплина убрана. Подписная ссылка осталась прежней.';
    } catch {
      status.textContent = 'Не удалось сохранить выбор. Попробуйте ещё раз.';
    } finally {
      select.disabled = false;
    }
  }

  function renderBlock(container, block, endpoint) {
    const field = document.createElement('label');
    field.className = 'subscription-elective-field';
    field.append(text('span', 'subscription-elective-label', block.label || 'Дисциплина по выбору'));

    const select = document.createElement('select');
    select.className = 'subscription-elective-select';
    select.append(optionNode('', 'Не выбрано — не добавлять в календарь'));
    for (const item of block.options || []) {
      if (!item?.id || !item?.officialDiscipline) continue;
      select.append(optionNode(item.id, item.officialDiscipline));
    }
    select.value = selectedValue(block);
    field.append(select);

    const status = text('span', 'subscription-elective-status', block.state === 'selected'
      ? 'Выбранная дисциплина уже добавлена в эту подписку.'
      : 'Можно оставить без выбора — тогда события ДВ не добавляются.');
    field.append(status);
    select.addEventListener('change', () => {
      void saveSelection(endpoint, block.id, select.value, status, select);
    });
    container.append(field);
  }

  async function mount(anchor) {
    if (mounted.has(anchor)) return;
    mounted.add(anchor);
    const subscription = subscriptionHttpsUrl(anchor.getAttribute('href') || anchor.href);
    if (!subscription) return;
    const endpoint = preferencesUrl(subscription);

    let response;
    let payload;
    try {
      response = await fetch(endpoint, { cache: 'no-store' });
      payload = await response.json();
    } catch {
      return;
    }
    if (!response.ok || !Array.isArray(payload?.electives) || payload.electives.length === 0) return;

    const host = anchor.closest('.trial-connect-card, .result-card, .checkout-card') || anchor.parentElement;
    if (!host || host.querySelector('.subscription-electives')) return;

    const card = document.createElement('section');
    card.className = 'subscription-electives';
    card.append(text('h4', '', 'Добавьте свою дисциплину по выбору'));
    card.append(text('p', 'subscription-electives-copy', 'Выберите только свою дисциплину. Она появится в этом же календаре; ссылку заново подключать не нужно.'));
    for (const block of payload.electives) renderBlock(card, block, endpoint);

    const actions = host.querySelector('.connect-actions');
    if (actions) host.insertBefore(card, actions);
    else host.append(card);
  }

  function subscriptionAnchors(root = document) {
    return [...root.querySelectorAll('a[href]')].filter((anchor) => subscriptionHttpsUrl(anchor.getAttribute('href') || anchor.href));
  }

  function scan(root = document) {
    for (const anchor of subscriptionAnchors(root)) void mount(anchor);
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches?.('a[href]') && subscriptionHttpsUrl(node.getAttribute('href') || node.href)) void mount(node);
        scan(node);
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan(), { once: true });
  } else {
    scan();
  }
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();

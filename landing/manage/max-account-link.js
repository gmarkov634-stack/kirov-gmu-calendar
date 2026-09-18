(() => {
  const config = Object.freeze({
    apiBase: "",
    managementEnabled: false,
    ...(globalThis.KGMU_CALENDAR_CONFIG ?? {})
  });
  const FLOW_KEY = "kgmu-calendar:max-link-rendezvous-v1";
  const CHANNEL_PREFIX = "kgmu-calendar:max-link:";
  const FLOW_TTL_MS = 15 * 60 * 1000;
  const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;
  const nativeFetch = window.fetch.bind(window);

  let pendingLinkToken = null;
  let flowId = null;
  let channel = null;
  let linkInFlight = false;
  let tokenRequestTimer = null;

  function apiUrl(path) {
    return new URL(path, config.apiBase || window.location.origin).toString();
  }

  function setStatus(text, kind = "") {
    const node = document.querySelector("#management-status");
    if (!node) return;
    node.textContent = text;
    node.className = `manage-status${kind ? ` ${kind}` : ""}`;
  }

  function validToken(value) {
    return typeof value === "string" && TOKEN_PATTERN.test(value);
  }

  function now() {
    return Date.now();
  }

  function secureFlowId() {
    if (!globalThis.crypto?.getRandomValues) return null;
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function readFlow() {
    try {
      const raw = localStorage.getItem(FLOW_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (
        !parsed
        || typeof parsed.flowId !== "string"
        || !/^[a-f0-9]{32}$/.test(parsed.flowId)
        || !Number.isFinite(parsed.expiresAt)
        || parsed.expiresAt <= now()
      ) {
        localStorage.removeItem(FLOW_KEY);
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  function writeFlow(nextFlowId) {
    try {
      localStorage.setItem(FLOW_KEY, JSON.stringify({
        flowId: nextFlowId,
        expiresAt: now() + FLOW_TTL_MS
      }));
      return true;
    } catch {
      return false;
    }
  }

  function clearFlow(expectedFlowId = flowId) {
    try {
      const current = readFlow();
      if (!current || !expectedFlowId || current.flowId === expectedFlowId) {
        localStorage.removeItem(FLOW_KEY);
      }
    } catch {
      // The challenge itself never enters storage, so storage failure is safe.
    }
  }

  function closeChannel() {
    if (tokenRequestTimer) {
      clearInterval(tokenRequestTimer);
      tokenRequestTimer = null;
    }
    channel?.close();
    channel = null;
  }

  function finish({ clearToken = true, clearRendezvous = true } = {}) {
    if (clearToken) pendingLinkToken = null;
    if (clearRendezvous) clearFlow();
    closeChannel();
  }

  function stripLinkTokenFromFragment() {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const linkToken = params.get("link_token");
    if (!linkToken) return null;
    params.delete("link_token");
    const nextHash = params.toString();
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${nextHash ? `#${nextHash}` : ""}`
    );
    return linkToken;
  }

  async function linkWithToken(linkToken, { notifyPeer = false } = {}) {
    if (linkInFlight || !validToken(linkToken)) return false;
    linkInFlight = true;
    try {
      const response = await nativeFetch(apiUrl("/management/max/link"), {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkToken })
      });
      if (response.status === 204) {
        if (notifyPeer) channel?.postMessage({ type: "linked", flowId });
        setStatus("MAX подключён к этому аккаунту календаря.", "success");
        finish();
        return true;
      }
      if (response.status === 401) {
        setStatus("Сначала подтвердите email, затем MAX подключится автоматически.");
        return false;
      }
      if (response.status === 400) {
        setStatus("Ссылка подключения MAX недействительна или истекла. Запросите новую ссылку в MAX.", "error");
      } else if (response.status === 409) {
        setStatus("Этот MAX-аккаунт уже связан. Запросите новую ссылку в MAX, если нужно изменить связь.", "error");
      } else if (response.status === 403) {
        setStatus("Страница управления не разрешена для подключения MAX.", "error");
      } else {
        setStatus("Не удалось подключить MAX. Попробуйте ещё раз из новой ссылки в MAX.", "error");
      }
      if ([400, 403, 409].includes(response.status)) {
        if (notifyPeer) channel?.postMessage({ type: "terminal-error", flowId });
        finish();
      }
      return false;
    } catch {
      setStatus("Сеть недоступна. Не закрывайте эту вкладку и повторите подтверждение email.", "error");
      return false;
    } finally {
      linkInFlight = false;
    }
  }

  function installSender(nextFlowId) {
    if (!("BroadcastChannel" in globalThis)) return false;
    channel = new BroadcastChannel(`${CHANNEL_PREFIX}${nextFlowId}`);
    channel.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.flowId !== nextFlowId) return;
      if (message.type === "request-token" && validToken(pendingLinkToken)) {
        channel.postMessage({ type: "token", flowId: nextFlowId, linkToken: pendingLinkToken });
      } else if (message.type === "linked") {
        setStatus("MAX подключён к этому аккаунту календаря.", "success");
        finish();
      } else if (message.type === "terminal-error") {
        setStatus("Ссылка подключения MAX больше не действует. Запросите новую ссылку в MAX.", "error");
        finish();
      }
    });
    return true;
  }

  function installReceiver(savedFlow) {
    if (!("BroadcastChannel" in globalThis)) return false;
    flowId = savedFlow.flowId;
    channel = new BroadcastChannel(`${CHANNEL_PREFIX}${flowId}`);
    channel.addEventListener("message", (event) => {
      const message = event.data;
      if (!message || message.flowId !== flowId || message.type !== "token") return;
      if (!validToken(message.linkToken)) return;
      if (tokenRequestTimer) {
        clearInterval(tokenRequestTimer);
        tokenRequestTimer = null;
      }
      void linkWithToken(message.linkToken, { notifyPeer: true });
    });
    return true;
  }

  function requestTokenFromPeer() {
    if (!channel || pendingLinkToken) return;
    const request = () => channel?.postMessage({ type: "request-token", flowId });
    request();
    if (!tokenRequestTimer) {
      let attempts = 0;
      tokenRequestTimer = setInterval(() => {
        attempts += 1;
        if (!channel || attempts >= 30) {
          clearInterval(tokenRequestTimer);
          tokenRequestTimer = null;
          return;
        }
        request();
      }, 1000);
    }
  }

  function beginFromFragment() {
    const captured = stripLinkTokenFromFragment();
    if (!captured) return;
    if (!validToken(captured)) {
      setStatus("Ссылка подключения MAX имеет неверный формат. Запросите новую ссылку в MAX.", "error");
      return;
    }
    pendingLinkToken = captured;
    flowId = secureFlowId();
    if (flowId && writeFlow(flowId) && installSender(flowId)) {
      setStatus("Подтвердите email ниже. Оставьте эту вкладку открытой и откройте письмо в новой вкладке — MAX подключится автоматически.");
      return;
    }
    clearFlow(flowId);
    flowId = null;
    setStatus("Подтвердите email в этой же вкладке. MAX-ссылка хранится только в памяти и не будет сохранена в браузере.");
  }

  function beginReceiver() {
    if (pendingLinkToken || channel) return;
    const savedFlow = readFlow();
    if (savedFlow) installReceiver(savedFlow);
  }

  window.fetch = async (input, init = {}) => {
    const response = await nativeFetch(input, init);
    let url = null;
    try {
      url = new URL(input instanceof Request ? input.url : input, window.location.href);
    } catch {
      return response;
    }
    const apiOrigin = new URL(config.apiBase || window.location.origin, window.location.origin).origin;
    if (url.origin !== apiOrigin || url.pathname !== "/management/subscriptions" || !response.ok) {
      return response;
    }

    if (pendingLinkToken) {
      queueMicrotask(() => linkWithToken(pendingLinkToken));
    } else {
      beginReceiver();
      queueMicrotask(requestTokenFromPeer);
    }
    return response;
  };

  beginFromFragment();
  beginReceiver();
})();

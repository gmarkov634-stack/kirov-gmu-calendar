import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import {
  bootstrapMaxManagement,
  captureManagementFragments,
  MAX_LINK_PENDING_STORAGE_KEY
} from '../landing/manage/max-link.js';

const API_BASE = 'https://api.example.test';
const PAGE_ORIGIN = 'https://calendar.example.test';
const MAGIC_TOKEN = 'M'.repeat(43);
const LINK_TOKEN = 'L'.repeat(43);
const MANAGEMENT_TOKEN = 'S'.repeat(43);
const transportSource = readFileSync(new URL('../landing/manage/session-transport.js', import.meta.url), 'utf8');

function response(status, payload = null) {
  return new Response(payload === null ? null : JSON.stringify(payload), {
    status,
    headers: payload === null ? undefined : { 'Content-Type': 'application/json' }
  });
}

function storageFixture() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function documentFixture() {
  const status = { textContent: '', className: '' };
  return {
    status,
    querySelector(selector) {
      return selector === '#management-status' ? status : null;
    }
  };
}

function windowFixture(hash = '') {
  const replaced = [];
  return {
    location: {
      origin: PAGE_ORIGIN,
      href: `${PAGE_ORIGIN}/manage/${hash}`,
      pathname: '/manage/',
      search: '',
      hash
    },
    history: {
      replaceState(_state, _title, url) {
        replaced.push(url);
      }
    },
    crypto: { randomUUID: () => 'request-id' },
    replaced
  };
}

function bearerTransportWindow({ hash, nativeFetch }) {
  const windowObj = windowFixture(hash);
  windowObj.fetch = nativeFetch;
  const context = vm.createContext({
    KGMU_CALENDAR_CONFIG: {
      apiBase: API_BASE,
      managementSessionTransport: 'bearer'
    },
    window: windowObj,
    URL,
    Request,
    Headers
  });
  vm.runInContext(transportSource, context);
  return windowObj;
}

test('management fragments distinguish token and link_token and leave neither in the address bar', () => {
  const windowObj = windowFixture(`#token=${MAGIC_TOKEN}&link_token=${LINK_TOKEN}`);
  windowObj.location.search = '?from=max';
  const captured = captureManagementFragments(windowObj);

  assert.deepEqual(captured, { magicToken: MAGIC_TOKEN, linkToken: LINK_TOKEN });
  assert.deepEqual(windowObj.replaced, ['/manage/?from=max']);
});

test('cookie management session is proven before MAX link completion', async () => {
  const calls = [];
  const storage = storageFixture();
  const documentObj = documentFixture();
  const windowObj = windowFixture(`#link_token=${LINK_TOKEN}`);

  const fetchImpl = async (input, init) => {
    const path = new URL(input).pathname;
    calls.push({ path, init });
    if (path === '/management/subscriptions') return response(200, { subscriptions: [] });
    if (path === '/management/max/link') return response(204);
    throw new Error(`unexpected path ${path}`);
  };

  const result = await bootstrapMaxManagement({
    windowObj,
    documentObj,
    config: { apiBase: API_BASE, managementSessionTransport: 'cookie' },
    fetchImpl,
    storage,
    BroadcastChannelImpl: null
  });

  assert.equal(result.maxLink, 'linked');
  assert.deepEqual(calls.map(({ path }) => path), ['/management/subscriptions', '/management/max/link']);
  assert.equal(calls[0].init.credentials, 'include');
  assert.equal(calls[1].init.credentials, 'include');
  assert.equal(new Headers(calls[1].init.headers).has('Authorization'), false);
  assert.deepEqual(JSON.parse(calls[1].init.body), { linkToken: LINK_TOKEN });
  assert.equal(storage.getItem(MAX_LINK_PENDING_STORAGE_KEY), null);
  assert.match(documentObj.status.className, /success/);
});

test('bearer management session from email verification authenticates MAX link, never link_token', async () => {
  const calls = [];
  const nativeFetch = async (input, init = {}) => {
    const path = new URL(input).pathname;
    const headers = new Headers(init.headers);
    calls.push({ path, authorization: headers.get('Authorization'), credentials: init.credentials, body: init.body });
    if (path === '/management/verify') return response(200, { managementToken: MANAGEMENT_TOKEN });
    if (path === '/management/max/link') return response(204);
    throw new Error(`unexpected path ${path}`);
  };
  const windowObj = bearerTransportWindow({
    hash: `#token=${MAGIC_TOKEN}&link_token=${LINK_TOKEN}`,
    nativeFetch
  });
  const documentObj = documentFixture();
  const storage = storageFixture();

  const result = await bootstrapMaxManagement({
    windowObj,
    documentObj,
    config: { apiBase: API_BASE, managementSessionTransport: 'bearer' },
    fetchImpl: windowObj.fetch.bind(windowObj),
    storage,
    BroadcastChannelImpl: null
  });

  assert.equal(result.maxLink, 'linked');
  assert.deepEqual(calls.map(({ path }) => path), ['/management/verify', '/management/max/link']);
  assert.equal(calls[0].authorization, null);
  assert.equal(calls[1].authorization, `Bearer ${MANAGEMENT_TOKEN}`);
  assert.equal(calls[1].credentials, 'omit');
  assert.notEqual(calls[1].authorization, `Bearer ${LINK_TOKEN}`);
  assert.deepEqual(JSON.parse(calls[1].body), { linkToken: LINK_TOKEN });
  assert.equal(storage.getItem(MAX_LINK_PENDING_STORAGE_KEY), null);
});

test('pending MAX link survives an unauthenticated same-tab step and completes after email verification', async () => {
  const storage = storageFixture();
  const firstDocument = documentFixture();
  const firstWindow = windowFixture(`#link_token=${LINK_TOKEN}`);
  const first = await bootstrapMaxManagement({
    windowObj: firstWindow,
    documentObj: firstDocument,
    config: { apiBase: API_BASE, managementSessionTransport: 'bearer' },
    fetchImpl: async (input) => {
      assert.equal(new URL(input).pathname, '/management/subscriptions');
      return response(401, { error: 'management_session_required' });
    },
    storage,
    BroadcastChannelImpl: null
  });

  assert.equal(first.maxLink, 'pending-auth');
  assert.equal(storage.getItem(MAX_LINK_PENDING_STORAGE_KEY), LINK_TOKEN);
  assert.doesNotMatch(firstWindow.replaced[0], /link_token/);

  const secondCalls = [];
  const secondWindow = windowFixture(`#token=${MAGIC_TOKEN}`);
  const second = await bootstrapMaxManagement({
    windowObj: secondWindow,
    documentObj: documentFixture(),
    config: { apiBase: API_BASE, managementSessionTransport: 'bearer' },
    fetchImpl: async (input, init) => {
      const path = new URL(input).pathname;
      secondCalls.push(path);
      if (path === '/management/verify') return response(200, { managementToken: MANAGEMENT_TOKEN });
      if (path === '/management/max/link') {
        assert.deepEqual(JSON.parse(init.body), { linkToken: LINK_TOKEN });
        return response(204);
      }
      throw new Error(`unexpected path ${path}`);
    },
    storage,
    BroadcastChannelImpl: null
  });

  assert.equal(second.maxLink, 'linked');
  assert.deepEqual(secondCalls, ['/management/verify', '/management/max/link']);
  assert.equal(storage.getItem(MAX_LINK_PENDING_STORAGE_KEY), null);
});

test('MAX link maps 401, 400 and 409 without changing subscription contracts', async (t) => {
  for (const fixture of [
    { status: 401, expected: 'pending-auth', retained: true },
    { status: 400, expected: 'expired', retained: false },
    { status: 409, expected: 'conflict', retained: false }
  ]) {
    await t.test(String(fixture.status), async () => {
      const storage = storageFixture();
      const windowObj = windowFixture(`#link_token=${LINK_TOKEN}`);
      const result = await bootstrapMaxManagement({
        windowObj,
        documentObj: documentFixture(),
        config: { apiBase: API_BASE, managementSessionTransport: 'cookie' },
        fetchImpl: async (input) => {
          const path = new URL(input).pathname;
          if (path === '/management/subscriptions') return response(200, { subscriptions: [] });
          if (path === '/management/max/link') return response(fixture.status, { error: 'expected' });
          throw new Error(`unexpected path ${path}`);
        },
        storage,
        BroadcastChannelImpl: null
      });

      assert.equal(result.maxLink, fixture.expected);
      assert.equal(storage.getItem(MAX_LINK_PENDING_STORAGE_KEY) === LINK_TOKEN, fixture.retained);
    });
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { installMaxLinkEmailHandoff } from '../landing/manage/max-link-email-handoff.js';
import { MAX_LINK_PENDING_STORAGE_KEY } from '../landing/manage/max-link.js';

const API_BASE = 'https://api.example.test';
const PAGE_ORIGIN = 'https://calendar.example.test';
const LINK_TOKEN = 'L'.repeat(43);

function storageFixture(value = null) {
  const values = new Map();
  if (value !== null) values.set(MAX_LINK_PENDING_STORAGE_KEY, value);
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, next) => values.set(key, String(next)),
    removeItem: (key) => values.delete(key)
  };
}

function documentFixture(email = 'student@example.com') {
  let submitListener = null;
  const form = {
    addEventListener(type, listener) {
      assert.equal(type, 'submit');
      submitListener = listener;
    }
  };
  const emailInput = { value: email };
  const submit = { disabled: false };
  const status = { textContent: '', className: '' };
  const nodes = new Map([
    ['#management-link-form', form],
    ['#management-email', emailInput],
    ['#management-link-submit', submit],
    ['#management-status', status]
  ]);
  return {
    form,
    emailInput,
    submit,
    status,
    querySelector: (selector) => nodes.get(selector) ?? null,
    listener: () => submitListener
  };
}

function eventFixture() {
  return {
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  };
}

test('pending MAX challenge is sent with the email request without entering the URL', async () => {
  const calls = [];
  const storage = storageFixture(LINK_TOKEN);
  const documentObj = documentFixture(' student@example.com ');
  const windowObj = {
    location: { origin: PAGE_ORIGIN },
    sessionStorage: storage
  };

  const installed = installMaxLinkEmailHandoff({
    windowObj,
    documentObj,
    config: {
      apiBase: API_BASE,
      managementEnabled: true,
      managementSessionTransport: 'cookie'
    },
    storage,
    fetchImpl: async (input, init) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ accepted: true }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  assert.equal(installed, true);
  const event = eventFixture();
  await documentObj.listener()(event);

  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].input);
  assert.equal(url.pathname, '/management/max/link-request');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(calls[0].init.credentials, 'include');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    email: 'student@example.com',
    linkToken: LINK_TOKEN
  });
  assert.equal(documentObj.submit.disabled, false);
  assert.match(documentObj.status.className, /success/);
  assert.equal(documentObj.status.textContent.includes(LINK_TOKEN), false);
});

test('ordinary management email flow is left untouched when there is no pending MAX challenge', async () => {
  let fetched = false;
  const storage = storageFixture();
  const documentObj = documentFixture();
  installMaxLinkEmailHandoff({
    windowObj: { location: { origin: PAGE_ORIGIN }, sessionStorage: storage },
    documentObj,
    config: { apiBase: API_BASE, managementEnabled: true, managementSessionTransport: 'cookie' },
    storage,
    fetchImpl: async () => {
      fetched = true;
      return new Response(null, { status: 202 });
    }
  });

  const event = eventFixture();
  await documentObj.listener()(event);

  assert.equal(event.prevented, false);
  assert.equal(event.stopped, false);
  assert.equal(fetched, false);
});

test('malformed pending MAX challenge is discarded and never submitted', async () => {
  let fetched = false;
  const storage = storageFixture('invalid');
  const documentObj = documentFixture();
  installMaxLinkEmailHandoff({
    windowObj: { location: { origin: PAGE_ORIGIN }, sessionStorage: storage },
    documentObj,
    config: { apiBase: API_BASE, managementEnabled: true, managementSessionTransport: 'bearer' },
    storage,
    fetchImpl: async () => {
      fetched = true;
      return new Response(null, { status: 202 });
    }
  });

  const event = eventFixture();
  await documentObj.listener()(event);

  assert.equal(event.prevented, false);
  assert.equal(fetched, false);
  assert.equal(storage.getItem(MAX_LINK_PENDING_STORAGE_KEY), null);
});

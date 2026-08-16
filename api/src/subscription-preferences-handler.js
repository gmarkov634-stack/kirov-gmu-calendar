import {
  subscriptionPersonalizationView,
  updateSubscriptionElectivePreferences,
} from './subscription-personalization.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

function send(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, limit = 16384) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > limit) throw new Error('request_too_large');
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new Error('invalid_json');
  }
}

function applyCors(request, response, config) {
  const origin = request.headers.origin;
  const allowedOrigins = Array.isArray(config.allowedOrigins)
    ? config.allowedOrigins
    : [config.allowedOrigin].filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function baseScheduleInput(subscription) {
  const copy = { ...subscription };
  delete copy.preferences;
  return copy;
}

export function createSubscriptionPreferencesHandler({ store, config }) {
  return async function subscriptionPreferencesHandler(request, response) {
    applyCors(request, response, config);
    if (request.method === 'OPTIONS') {
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
      return true;
    }

    const url = new URL(request.url, 'http://localhost');
    const match = url.pathname.match(/^\/api\/v1\/subscriptions\/([A-Za-z0-9_-]{43})\/preferences$/);
    if (!match || !TOKEN.test(match[1])) return false;
    if (!['GET', 'PUT'].includes(request.method)) {
      send(response, 405, { error: 'method_not_allowed' });
      return true;
    }

    try {
      const token = match[1];
      const subscription = await store.getSubscription(token);
      if (!subscription) {
        send(response, 404, { error: 'subscription_not_found' });
        return true;
      }
      if (subscription.status !== 'active') {
        send(response, 409, { error: 'subscription_not_active' });
        return true;
      }

      const scheduleInput = baseScheduleInput(subscription);
      const schedule = await store.getSchedule(scheduleInput);
      if (!schedule) {
        send(response, 409, { error: 'schedule_not_published' });
        return true;
      }
      const catalog = await store.getSchedulePersonalization(scheduleInput, schedule);
      if (!catalog) {
        send(response, 200, { electives: [] });
        return true;
      }

      if (request.method === 'GET') {
        send(response, 200, subscriptionPersonalizationView(catalog, subscription));
        return true;
      }

      const input = await readJson(request);
      const updated = updateSubscriptionElectivePreferences(subscription, catalog, input);
      await store.putSubscription(token, updated);
      send(response, 200, subscriptionPersonalizationView(catalog, updated));
      return true;
    } catch (error) {
      if (['invalid_json', 'request_too_large'].includes(error.message)) {
        send(response, 400, { error: error.message });
        return true;
      }
      if ([
        'invalid_subscription_preferences',
        'elective_block_not_available',
        'elective_selection_not_available',
        'subscription_preferences_invalid',
        'schedule_personalization_invalid',
        'schedule_personalization_context_invalid',
      ].includes(error.code)) {
        send(response, 400, { error: error.code });
        return true;
      }
      console.error('Subscription preferences failed', error);
      send(response, 503, { error: 'subscription_preferences_unavailable' });
      return true;
    }
  };
}

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  projectScheduleForSubscription,
  subscriptionPersonalizationView,
  updateSubscriptionElectivePreferences,
} from '../src/subscription-personalization.js';

function event(name, date) {
  return { name, date };
}

function schedule() {
  return {
    version: 1,
    events: [event('Биоэтика', '2026-02-02')],
    personalization: {
      electives: [
        {
          id: 'dv-1',
          label: 'ДВ 1',
          options: [
            {
              id: 'culture',
              officialDiscipline: 'Культурология',
              events: [event('Культурология', '2026-02-03'), event('Культурология', '2026-02-17')],
            },
            {
              id: 'chemistry',
              officialDiscipline: 'Медицинская химия',
              events: [event('Медицинская химия', '2026-02-10')],
            },
          ],
        },
      ],
    },
  };
}

function subscription() {
  return { version: 2, status: 'active', preferences: { electives: {} } };
}

test('unselected elective contributes no events to subscription projection', () => {
  const projected = projectScheduleForSubscription(schedule(), subscription());
  assert.deepEqual(projected.events.map((item) => item.name), ['Биоэтика']);
  assert.deepEqual(projected.subscriptionPersonalization.electives, [
    { id: 'dv-1', state: 'unselected', selected: null },
  ]);
});

test('selected elective appears under its official discipline name', () => {
  const selected = updateSubscriptionElectivePreferences(subscription(), schedule(), {
    electives: { 'dv-1': 'Культурология' },
  });
  const projected = projectScheduleForSubscription(schedule(), selected);
  assert.deepEqual(projected.events.map((item) => item.name), ['Биоэтика', 'Культурология', 'Культурология']);
  const view = subscriptionPersonalizationView(schedule(), selected);
  assert.equal(view.electives[0].selectedOfficialDiscipline, 'Культурология');
});

test('clearing elective selection removes its events from the same subscription', () => {
  const selected = updateSubscriptionElectivePreferences(subscription(), schedule(), {
    electives: { 'dv-1': 'culture' },
  });
  const cleared = updateSubscriptionElectivePreferences(selected, schedule(), {
    electives: { 'dv-1': null },
  });
  assert.deepEqual(projectScheduleForSubscription(schedule(), cleared).events.map((item) => item.name), ['Биоэтика']);
});

test('subscription cannot select an option not present in the published source contract', () => {
  assert.throws(
    () => updateSubscriptionElectivePreferences(subscription(), schedule(), {
      electives: { 'dv-1': 'Несуществующая дисциплина' },
    }),
    (error) => error?.code === 'elective_selection_not_available',
  );
});

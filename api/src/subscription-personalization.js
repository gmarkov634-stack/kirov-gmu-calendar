function normalized(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function key(value) {
  return normalized(value).toLowerCase().replace(/ё/g, 'е');
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function electiveBlocks(schedule) {
  const blocks = schedule?.personalization?.electives;
  if (blocks == null) return [];
  if (!Array.isArray(blocks)) {
    const error = new Error('Schedule elective personalization must be an array');
    error.code = 'schedule_personalization_invalid';
    throw error;
  }
  return blocks;
}

function blockId(block) {
  const id = normalized(block?.id);
  if (!id) {
    const error = new Error('Elective personalization block id is required');
    error.code = 'schedule_personalization_invalid';
    throw error;
  }
  return id;
}

function options(block) {
  if (!Array.isArray(block?.options) || !block.options.length) {
    const error = new Error(`Elective personalization options are required for ${blockId(block)}`);
    error.code = 'schedule_personalization_invalid';
    throw error;
  }
  return block.options;
}

function optionIdentity(option) {
  return normalized(option?.id) || normalized(option?.officialDiscipline);
}

function optionDiscipline(option) {
  return normalized(option?.officialDiscipline);
}

function findOption(block, selection) {
  const target = key(selection);
  const matches = options(block).filter((option) => (
    key(optionIdentity(option)) === target || key(optionDiscipline(option)) === target
  ));
  if (matches.length !== 1) {
    const error = new Error(`Elective selection is not uniquely present in schedule source: ${selection}`);
    error.code = 'elective_selection_not_available';
    error.blockId = blockId(block);
    error.selection = normalized(selection);
    error.available = options(block).map((option) => ({
      id: optionIdentity(option),
      officialDiscipline: optionDiscipline(option),
    }));
    throw error;
  }
  return matches[0];
}

function preferences(subscription) {
  const value = subscription?.preferences?.electives;
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('Subscription elective preferences are invalid');
    error.code = 'subscription_preferences_invalid';
    throw error;
  }
  return value;
}

export function projectScheduleForSubscription(schedule, subscription) {
  const next = clone(schedule);
  const blocks = electiveBlocks(next);
  if (!blocks.length) return next;

  const selected = preferences(subscription);
  const personalizedEvents = [];
  for (const block of blocks) {
    const id = blockId(block);
    const selection = normalized(selected[id]);
    if (!selection) continue;
    const option = findOption(block, selection);
    if (!Array.isArray(option.events)) {
      const error = new Error(`Elective option events are invalid for ${id}`);
      error.code = 'schedule_personalization_invalid';
      throw error;
    }
    personalizedEvents.push(...clone(option.events));
  }

  next.events = [...(Array.isArray(next.events) ? next.events : []), ...personalizedEvents];
  next.subscriptionPersonalization = {
    electives: blocks.map((block) => {
      const id = blockId(block);
      const selection = normalized(selected[id]);
      return {
        id,
        state: selection ? 'selected' : 'unselected',
        selected: selection || null,
      };
    }),
  };
  return next;
}

export function updateSubscriptionElectivePreferences(subscription, schedule, input) {
  const blocks = electiveBlocks(schedule);
  const byId = new Map(blocks.map((block) => [blockId(block), block]));
  const requested = input?.electives;
  if (!requested || typeof requested !== 'object' || Array.isArray(requested)) {
    const error = new Error('electives object is required');
    error.code = 'invalid_subscription_preferences';
    throw error;
  }

  const current = { ...preferences(subscription) };
  for (const [id, value] of Object.entries(requested)) {
    const block = byId.get(normalized(id));
    if (!block) {
      const error = new Error(`Unknown elective block: ${id}`);
      error.code = 'elective_block_not_available';
      error.blockId = normalized(id);
      throw error;
    }
    const selection = normalized(value);
    if (!selection) {
      delete current[id];
      continue;
    }
    const option = findOption(block, selection);
    current[id] = optionIdentity(option);
  }

  return {
    ...clone(subscription),
    preferences: {
      ...(clone(subscription?.preferences) || {}),
      electives: current,
    },
    preferencesUpdatedAt: new Date().toISOString(),
  };
}

export function subscriptionPersonalizationView(schedule, subscription) {
  const selected = preferences(subscription);
  return {
    electives: electiveBlocks(schedule).map((block) => {
      const id = blockId(block);
      const selection = normalized(selected[id]);
      const selectedOption = selection ? findOption(block, selection) : null;
      return {
        id,
        label: normalized(block?.label) || 'Дисциплина по выбору',
        state: selectedOption ? 'selected' : 'unselected',
        selected: selectedOption ? optionIdentity(selectedOption) : null,
        selectedOfficialDiscipline: selectedOption ? optionDiscipline(selectedOption) : null,
        options: options(block).map((option) => ({
          id: optionIdentity(option),
          officialDiscipline: optionDiscipline(option),
        })),
      };
    }),
  };
}

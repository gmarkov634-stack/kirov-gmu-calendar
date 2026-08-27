const OFFSET_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function createKgmuParsingJob({ jobId, academicPeriodId, sourceId, sourceObjectKey, parserRulesVersion, expectedGroupIds, requestedAt }) {
  const values = { jobId, academicPeriodId, sourceId, sourceObjectKey, parserRulesVersion, requestedAt };
  for (const [name, value] of Object.entries(values)) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty string`);
  }
  if (!Array.isArray(expectedGroupIds) || expectedGroupIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    throw new TypeError('expectedGroupIds must be an array of non-empty strings');
  }
  if (new Set(expectedGroupIds).size !== expectedGroupIds.length) throw new TypeError('expectedGroupIds must be unique');
  if (!OFFSET_DATE_TIME.test(requestedAt) || Number.isNaN(Date.parse(requestedAt))) {
    throw new TypeError('requestedAt must be an offset-aware ISO date-time');
  }

  return Object.freeze({
    jobId,
    universityId: 'kirov-gmu',
    academicPeriodId,
    sourceId,
    sourceObjectKey,
    parserRulesVersion,
    expectedGroupIds: Object.freeze([...expectedGroupIds]),
    requestedAt
  });
}

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

const catalogPath = '../config/parsing-configuration-catalog.json';

async function loadCatalogDocuments() {
  const catalog = await readJson(catalogPath);
  const sourceDocuments = await Promise.all(
    catalog.scheduleSources.map(entry => readJson(`../${entry.documentRef}`))
  );
  const profileDocuments = await Promise.all(
    catalog.parsingProfiles.map(entry => readJson(`../${entry.documentRef}`))
  );
  return { catalog, sourceDocuments, profileDocuments };
}

test('KGMU parsing catalog indexes both verified schedule canaries without duplicating their documents', async () => {
  const { catalog, sourceDocuments, profileDocuments } = await loadCatalogDocuments();

  assert.equal(catalog.universityId, 'kirov-gmu');
  assert.deepEqual(catalog.scheduleSources, [
    {
      academicPeriodId: '2026-2027-semester-1',
      sourceId: 'medicine',
      documentRef: 'config/schedule-sources/2026-2027-semester-1/medicine-101-110.json'
    },
    {
      academicPeriodId: '2026-2027-semester-1',
      sourceId: 'dentistry',
      documentRef: 'config/schedule-sources/2026-2027-semester-1/dentistry-291-294.json'
    }
  ]);
  assert.deepEqual(catalog.parsingProfiles, [
    { profileId: 'weekly', documentRef: 'config/parsing-profiles/weekly.json' },
    { profileId: 'mixed', documentRef: 'config/parsing-profiles/mixed.json' }
  ]);

  assert.deepEqual(
    sourceDocuments.map(source => [source.academicPeriodId, source.sourceId]),
    catalog.scheduleSources.map(entry => [entry.academicPeriodId, entry.sourceId])
  );
  assert.deepEqual(
    profileDocuments.map(profile => profile.profileId),
    catalog.parsingProfiles.map(entry => entry.profileId)
  );
});

test('every catalog source references an indexed parsing profile owned by KGMU', async () => {
  const { catalog, sourceDocuments, profileDocuments } = await loadCatalogDocuments();
  const profileIds = new Set(profileDocuments.map(profile => profile.profileId));

  for (const source of sourceDocuments) {
    assert.equal(source.universityId, catalog.universityId);
    assert.equal(profileIds.has(source.parsingProfileId), true, source.parsingProfileId);
  }
  for (const profile of profileDocuments) {
    assert.equal(profile.universityId, catalog.universityId);
  }
});

test('catalog identities and document references are unique', async () => {
  const catalog = await readJson(catalogPath);
  const sourceIdentities = catalog.scheduleSources.map(
    entry => `${entry.academicPeriodId}\u0000${entry.sourceId}`
  );
  const profileIdentities = catalog.parsingProfiles.map(entry => entry.profileId);
  const refs = [
    ...catalog.scheduleSources.map(entry => entry.documentRef),
    ...catalog.parsingProfiles.map(entry => entry.documentRef)
  ];

  assert.equal(new Set(sourceIdentities).size, sourceIdentities.length);
  assert.equal(new Set(profileIdentities).size, profileIdentities.length);
  assert.equal(new Set(refs).size, refs.length);
});

test('university catalog contains no source URL, raw source, provider secret or protected subscription material', async () => {
  const catalog = await readJson(catalogPath);
  const serialized = JSON.stringify(catalog);

  for (const forbidden of [
    'kirovgma.ru',
    'sourceUrl',
    'rawSource',
    'apiKey',
    'credentials',
    'CalendarSubscription',
    'CalendarPreferences',
    'Entitlement',
    'tokenHash',
    'opaqueIcsUrl'
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

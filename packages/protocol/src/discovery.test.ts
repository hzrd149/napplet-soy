import { expect, test } from 'bun:test';
import { finalizeEvent, matchFilter } from 'nostr-tools';
import { aggregateHash, gallerySearchSchema } from './index';
import { matchesDiscoveryTarget, targetedDiscoveryFilters } from './discovery';
import { discoveryFacets, matchesGallery } from './topics';
import { validateManifest } from './manifest';
import { missingDomains } from '../../runtime/src/capabilities';
import { publicNapplet } from '../../backend/src/public-model';
import { galleryPage } from '../../backend/src/gallery';

const key = new Uint8Array(32);
key[31] = 1;
const manifest = (tags: string[][], identifier = 'feed') =>
  finalizeEvent(
    {
      kind: 35129,
      created_at: 1,
      content: 'Read a feed and try something new.',
      tags: [['d', identifier], ['x', 'a'.repeat(64)], ['title', 'A feed viewer'], ...tags],
    },
    key,
  );

test('targeted discovery uses indexable ordinary tags unless intersections are explicitly selected', () => {
  const target = {
    archetypes: ['feed'],
    intents: ['napplet:feed/open'],
    requiredDomains: ['relay', 'theme'],
    optionalDomains: ['media'],
  };
  const standard = targetedDiscoveryFilters(target);
  expect(standard.primary).toEqual(standard.fallback);
  expect(standard.fallback).toEqual([
    {
      kinds: [35129, 15129, 5129],
      limit: 100,
      '#z': ['feed'],
      '#i': ['napplet:feed/open'],
      '#R': ['relay', 'theme'],
      '#O': ['media'],
    },
  ]);
  const intersection = targetedDiscoveryFilters(target, { intersections: true });
  expect(intersection.primary[0]['&R']).toEqual(['relay', 'theme']);
  expect(intersection.primary[0]['#R']).toEqual(['relay', 'theme']);
  expect(intersection.fallback).toEqual(standard.fallback);
  expect(targetedDiscoveryFilters({}).primary).toEqual([
    { kinds: [35129, 15129, 5129], limit: 100 },
  ]);
});

test('relay candidates never substitute intersection membership for complete required-domain compatibility', async () => {
  const relayOnly = manifest([['R', 'relay']]);
  const unsupported = manifest(
    [
      ['R', 'relay'],
      ['R', 'theme'],
      ['R', 'future-unsupported'],
    ],
    'unsupported',
  );
  const optionalUnknown = manifest(
    [
      ['R', 'relay'],
      ['O', 'future-optional'],
    ],
    'optional',
  );
  const filters = targetedDiscoveryFilters(
    { requiredDomains: ['relay', 'theme'] },
    { intersections: true },
  );
  expect(matchFilter(filters.fallback[0], relayOnly)).toBe(true);
  expect(matchFilter(filters.fallback[0], unsupported)).toBe(true);
  expect(matchesDiscoveryTarget(relayOnly, { requiredDomains: ['relay', 'theme'] })).toBe(false);
  expect(matchesDiscoveryTarget(unsupported, { requiredDomains: ['relay', 'theme'] })).toBe(true);
  expect(missingDomains((await validateManifest(relayOnly)).domains)).toEqual([]);
  expect(missingDomains((await validateManifest(unsupported)).domains)).toEqual([
    'future-unsupported',
  ]);
  expect(missingDomains((await validateManifest(optionalUnknown)).domains)).toEqual([]);
  expect((await publicNapplet(unsupported)).availability).toBe('host-required');
  expect((await publicNapplet(optionalUnknown)).availability).toBe('unavailable');
});

test('cold required-domain discovery also retrieves legacy declarations within bounded filters', async () => {
  const raw = 'b'.repeat(64);
  const legacy = (domains: string[], identifier: string) =>
    finalizeEvent(
      {
        kind: 35129,
        created_at: 1,
        content: '',
        tags: [
          ['d', identifier],
          ['path', '/index.html', raw],
          ['description', 'A legacy feed'],
          ['z', 'feed'],
          ['i', 'napplet:feed/open'],
          ...domains.map((domain) => ['requires', domain]),
        ],
      },
      key,
    );
  const event = legacy(['relay'], 'legacy'),
    unsupported = legacy(['relay', 'future-domain'], 'unsupported');
  // Current legacy manifests can omit the aggregate, but including one remains admitted.
  const withAggregate = finalizeEvent(
    {
      ...event,
      tags: [
        ...event.tags,
        ['x', await aggregateHash([{ path: '/index.html', hash: raw }]), 'aggregate'],
      ],
    },
    key,
  );
  const target = {
    requiredDomains: ['relay'],
    archetypes: ['feed'],
    intents: ['napplet:feed/open'],
  };
  const ordinary = targetedDiscoveryFilters(target);
  expect(ordinary.fallback.some((filter) => matchFilter(filter, withAggregate))).toBe(false);
  const filters = targetedDiscoveryFilters(target, { legacyRequirements: true, limit: 300 });
  expect(filters.fallback).toHaveLength(2);
  expect(filters.fallback[1]).toEqual({
    kinds: [35129, 15129, 5129],
    limit: 300,
    '#z': ['feed'],
    '#i': ['napplet:feed/open'],
  });
  expect(filters.fallback.some((filter) => matchFilter(filter, withAggregate))).toBe(true);
  expect(matchesDiscoveryTarget(withAggregate, target)).toBe(true);
  expect(
    matchesGallery(await publicNapplet(withAggregate), { tag: '', q: '', requiredDomain: 'relay' }),
  ).toBe(true);
  expect(filters.fallback.some((filter) => matchFilter(filter, unsupported))).toBe(true);
  expect((await publicNapplet(unsupported)).availability).toBe('host-required');
  expect(
    targetedDiscoveryFilters(
      { ...target, optionalDomains: ['theme'] },
      { legacyRequirements: true },
    ).fallback,
  ).toHaveLength(1);
  expect(
    targetedDiscoveryFilters({ archetypes: ['feed'] }, { legacyRequirements: true }).fallback,
  ).toHaveLength(1);
});

test('URL filters compose with topics and text without turning declarations into grants', async () => {
  const entry = await publicNapplet(
    manifest([
      ['t', 'social'],
      ['z', 'feed'],
      ['i', 'napplet:feed/open', 'relays'],
      ['R', 'relay'],
      ['O', 'theme'],
    ]),
  );
  const search = gallerySearchSchema.parse({
    tag: '#Social',
    q: 'feed',
    archetype: 'feed',
    intent: 'napplet:feed/open',
    requiredDomain: 'relay',
    optionalDomain: 'theme',
  });
  expect(matchesGallery(entry, search)).toBe(true);
  for (const patch of [
    { tag: 'games' },
    { q: 'absent' },
    { archetype: 'profile' },
    { intent: 'napplet:feed/edit' },
    { requiredDomain: 'theme' },
    { optionalDomain: 'relay' },
  ])
    expect(matchesGallery(entry, { ...search, ...patch })).toBe(false);
  expect(
    gallerySearchSchema.parse({ intent: 'napplet:feed/open?relays=x', requiredDomain: 'NAP-RELAY' })
      .intent,
  ).toBeUndefined();
  expect(
    gallerySearchSchema.parse({ intent: 'napplet:feed/open?relays=x', requiredDomain: 'NAP-RELAY' })
      .requiredDomain,
  ).toBeUndefined();
});

test('gallery filters run before pagination and facets count distinct declarations in the loaded collection', async () => {
  const entry = await publicNapplet(
    manifest([
      ['z', 'feed'],
      ['z', 'feed'],
      ['i', 'napplet:feed/open'],
      ['R', 'relay'],
      ['O', 'theme'],
    ]),
  );
  const entries = Array.from({ length: 25 }, (_, i) => ({
    ...entry,
    availability: 'ready' as const,
    revisionId: String(i).padStart(64, '0'),
    archetypes: i === 24 ? ['rare'] : entry.archetypes,
  }));
  const selected = galleryPage(entries, { tag: '', q: '', sort: 'new', archetype: 'rare' });
  expect(selected.matches).toBe(1);
  expect(selected.napplets[0].revisionId).toBe(entries[24].revisionId);
  expect(selected.discovery.archetypes).toEqual([
    { value: 'feed', count: 24 },
    { value: 'rare', count: 1 },
  ]);
  expect(discoveryFacets([entry]).requiredDomains).toEqual([{ value: 'relay', count: 1 }]);
  const bare = { title: 'Legacy', description: '', creator: 'Someone', topics: [] };
  expect(matchesGallery(bare, { tag: '', q: '' })).toBe(true);
  expect(matchesGallery(bare, { tag: '', q: '', archetype: 'feed' })).toBe(false);
});

import { describe, expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import records from '../../backend/data/catalog.json';
import { aggregateHash, sha256, type SignedEvent } from './index';
import {
  legacySnapshotAddress,
  manifestDescription,
  manifestFormat,
  validateManifest,
  validateRelease,
} from './manifest';

const key = new Uint8Array(32);
key[31] = 1;
const artifactHash = await sha256('<!doctype html><p>Standalone manifest</p>');
const oldHash = await aggregateHash([{ path: '/index.html', hash: artifactHash }]);
const description = 'A small standalone napplet. <em>Text stays text.</em>';
const sign = (kind: number, tags: string[][], content = description): SignedEvent =>
  finalizeEvent({ kind, tags, content, created_at: 1 }, key);
const standalone = (kind = 35129, extra: string[][] = [], content = description) =>
  sign(
    kind,
    [...(kind === 35129 ? [['d', 'standalone']] : []), ['x', artifactHash], ...extra],
    content,
  );

describe('NIP-5D standalone manifests with explicit legacy compatibility', () => {
  test('named, root and independent snapshot manifests use the raw artifact identity', async () => {
    for (const kind of [35129, 15129, 5129] as const) {
      const event = standalone(kind);
      const parsed = await validateManifest(event);
      expect(parsed.format).toBe('standalone');
      expect(parsed.artifactHash).toBe(artifactHash);
      expect(parsed.identityHash).toBe(artifactHash);
      expect(parsed.aggregateHash).toBe(oldHash);
      expect(parsed.description).toBe(description);
      expect(parsed.title).toBeNull();
      expect(parsed.identity?.kind ?? null).toBe(kind === 5129 ? null : kind);
      expect(parsed.lineage).toEqual({ parent: null, root: null });
      expect(manifestFormat(event)).toBe('standalone');
      expect(manifestDescription(event)).toBe(description);
      expect(legacySnapshotAddress(event)).toBeNull();
    }
  });

  test('existing signed fixtures retain their aggregate identity and description tags', async () => {
    for (const fixture of records) {
      const current = await validateManifest(fixture.current);
      const snapshot = await validateManifest(fixture.snapshot);
      expect(current.format).toBe('legacy');
      expect(current.identityHash).toBe(current.aggregateHash);
      expect(current.description).toBe(
        fixture.current.tags.find((t) => t[0] === 'description')?.[1] ?? '',
      );
      expect(snapshot.lineage.parent).toBeNull();
      expect(legacySnapshotAddress(fixture.snapshot)).toBe(
        `35129:${fixture.pubkey}:${current.identity!.identifier}`,
      );
      expect((await validateRelease(fixture.current, fixture.snapshot)).format).toBe('legacy');
    }
    const root = sign(15129, [['path', '/index.html', artifactHash]], '');
    expect((await validateManifest(root)).identityHash).toBe(oldHash);
    expect(manifestDescription(root)).toBe('');
  });

  test('legacy snapshot address helper never promotes foreign ancestry to own identity', () => {
    const legacy = sign(
      5129,
      [
        ['path', '/index.html', artifactHash],
        ['x', oldHash, 'aggregate'],
        ['a', `35129:${'a'.repeat(64)}:other-author`],
      ],
      '',
    );
    expect(legacySnapshotAddress(legacy)).toBeNull();
    const modern = standalone(5129, [['a', `35129:${legacy.pubkey}:same-author-parent`]]);
    expect(legacySnapshotAddress(modern)).toBeNull();
  });

  test('exactly one two-element lowercase artifact x is mandatory on all standalone kinds', async () => {
    for (const kind of [35129, 15129, 5129]) {
      for (const x of [
        [],
        [
          ['x', artifactHash],
          ['x', artifactHash],
        ],
        [['x', artifactHash.toUpperCase()]],
        [['x', 'a'.repeat(63)]],
        [['x', 'g'.repeat(64)]],
        [['x', artifactHash, 'unexpected']],
      ]) {
        const event = sign(kind, [...(kind === 35129 ? [['d', 'standalone']] : []), ...x]);
        await expect(validateManifest(event)).rejects.toThrow('exactly one artifact x');
      }
    }
  });

  test('standalone description is required and legacy tags cannot downgrade validation', async () => {
    for (const content of ['', ' \n\t '])
      await expect(validateManifest(standalone(35129, [], content))).rejects.toThrow(
        'nonempty plain-text',
      );
    for (const tag of [
      ['path', '/index.html', artifactHash],
      ['description', 'Legacy'],
      ['requires', 'relay'],
    ])
      await expect(validateManifest(standalone(35129, [tag]))).rejects.toThrow(
        'must not mix legacy',
      );
    await expect(
      validateManifest(standalone(35129, [['x', oldHash, 'aggregate']])),
    ).rejects.toThrow('exactly one artifact x');
    const legacyWithNewRequirement = sign(
      35129,
      [
        ['d', 'legacy'],
        ['path', '/index.html', artifactHash],
        ['R', 'unsupported'],
      ],
      '',
    );
    await expect(validateManifest(legacyWithNewRequirement)).rejects.toThrow(
      'must not mix standalone',
    );
  });

  test('identifier rules remain kind-specific', async () => {
    await expect(validateManifest(sign(35129, [['x', artifactHash]]))).rejects.toThrow(
      'identifier',
    );
    await expect(validateManifest(standalone(35129, [['d', 'duplicate']]))).rejects.toThrow(
      'identifier',
    );
    await expect(validateManifest(standalone(15129, [['d', 'root']]))).rejects.toThrow(
      'identifier',
    );
    await expect(validateManifest(standalone(5129, [['d', 'snapshot']]))).rejects.toThrow(
      'must not contain d',
    );
  });

  test('R and O remain separate complete declarations, without granting capabilities', async () => {
    const parsed = await validateManifest(
      standalone(35129, [
        ['R', 'relay'],
        ['R', 'unknown-future-domain'],
        ['R', 'relay'],
        ['O', 'theme'],
        ['O', 'unknown-optional-domain'],
        ['O', 'theme'],
        ['z', 'relay'],
        ['i', 'napplet:feed/open'],
      ]),
    );
    expect(parsed.domains).toEqual(['relay', 'unknown-future-domain']);
    expect(parsed.optionalDomains).toEqual(['theme', 'unknown-optional-domain']);
    expect(
      (await validateManifest(standalone(5129, [['O', 'unknown-optional-domain']]))).domains,
    ).toEqual([]);
    for (const tag of [['R', 'NAP-RELAY'], ['R'], ['R', 'relay', 'theme'], ['O', 'Bad']])
      await expect(validateManifest(standalone(35129, [tag]))).rejects.toThrow('domain');
  });

  test('archetypes and queryless intents are untrusted optional advertisements', async () => {
    const parsed = await validateManifest(
      standalone(35129, [
        ['z', 'feed'],
        ['z', 'feed'],
        ['z', 'profile'],
        ['z', ''],
        ['z', 'bad\nvalue'],
        ['i', 'napplet:feed/open'],
        ['i', 'napplet:feed/edit', 'filters', 'relays'],
        ['i', 'napplet:feed/edit', 'filters', 'limit'],
        ['i', 'napplet:feed/edit?filters=secret'],
        ['i', 'napplet:feed/edit#fragment'],
        ['i', 'not-an-intent'],
        ['i', 'napplet:feed/bad', 'bad=name'],
      ]),
    );
    expect(parsed.archetypes).toEqual(['feed', 'profile']);
    expect(parsed.intents).toEqual([
      { intent: 'napplet:feed/open', parameters: [] },
      { intent: 'napplet:feed/edit', parameters: ['filters', 'relays', 'limit'] },
    ]);
    expect(parsed.domains).toEqual([]);
    expect(parsed.optionalDomains).toEqual([]);
  });

  test('supported icon claims normalize and every malformed icon falls back without blocking playback', async () => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp'] as const) {
      const parsed = await validateManifest(standalone(35129, [['icon', 'b'.repeat(64), mime]]));
      expect(parsed.icon).toEqual({ hash: 'b'.repeat(64), mime });
      expect(parsed.identityHash).toBe(artifactHash);
    }
    for (const icons of [
      [],
      [['icon']],
      [['icon', 'invalid', 'image/png']],
      [['icon', 'B'.repeat(64), 'image/png']],
      [['icon', 'b'.repeat(64), 'image/svg+xml']],
      [['icon', 'b'.repeat(64), 'image/png', 'extra']],
      [
        ['icon', 'b'.repeat(64), 'image/png'],
        ['icon', 'b'.repeat(64), 'image/png'],
      ],
    ]) {
      const parsed = await validateManifest(standalone(5129, icons));
      expect(parsed.icon).toBeNull();
      expect(parsed.artifactHash).toBe(artifactHash);
    }
  });

  test('standalone snapshot ancestry is optional, cross-author provenance only', async () => {
    const parent = `35129:${'a'.repeat(64)}:parent`;
    const root = `35129:${'b'.repeat(64)}:root`;
    const parsed = await validateManifest(
      standalone(5129, [
        ['a', parent],
        ['A', root],
      ]),
    );
    expect(parsed.lineage).toEqual({ parent, root });
    expect(parsed.identity).toBeNull();
    expect(parsed.naddr).toBeNull();
    expect(parsed.identityHash).toBe(artifactHash);
    const rootAddress = `15129:${'b'.repeat(64)}:`;
    expect((await validateManifest(standalone(5129, [['A', rootAddress]]))).lineage.root).toBe(
      rootAddress,
    );
    for (const kind of [15129, 35129])
      await expect(validateManifest(standalone(kind, [['a', parent]]))).rejects.toThrow(
        'snapshots only',
      );
    for (const tags of [
      [
        ['a', parent],
        ['a', parent],
      ],
      [
        ['A', root],
        ['A', root],
      ],
      [['a', `15129:${'a'.repeat(64)}:invalid-root-identifier`]],
      [['a', 'malformed']],
    ])
      await expect(validateManifest(standalone(5129, tags))).rejects.toThrow('Lineage');
  });

  test('local standalone pairs require matching metadata, not snapshot self-address', async () => {
    const extra = [
      ['R', 'relay'],
      ['title', 'Feed'],
      ['source', 'https://example.com/source'],
    ];
    const current = standalone(35129, extra);
    const snapshot = standalone(5129, [...extra].reverse());
    expect((await validateRelease(current, snapshot)).identityHash).toBe(artifactHash);
    const remixed = standalone(5129, [...extra, ['a', `35129:${'a'.repeat(64)}:parent`]]);
    expect((await validateRelease(current, remixed)).snapshot.id).toBe(remixed.id);
    for (const changed of [
      standalone(5129, extra, 'A different description'),
      standalone(5129, [['R', 'theme'], ...extra.slice(1)]),
      standalone(5129, [['R', 'relay'], ['title', 'Different'], extra[2]]),
      standalone(5129, [...extra, ['source-commit', 'c'.repeat(40)]]),
    ])
      await expect(validateRelease(current, changed)).rejects.toThrow('metadata mismatch');
    await expect(validateRelease(current, records[0].snapshot)).rejects.toThrow();
  });
});

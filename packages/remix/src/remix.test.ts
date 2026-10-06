import { nip19 } from 'nostr-tools';
import { test, expect } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { aggregateHash, sha256 } from '../../protocol/src';
import { remixLineage } from '../../protocol/src/remix';
import { createRemix, loadRemix } from './index';
import { sourceArchive } from './archive';
import { freezeFixture as freezeSource } from '../../publish/src/testing';
import { projectSchema } from '../../publish/src/config';
import { validateManifest } from '../../protocol/src/manifest';

test('remix downloads exact signed archive and makes a fresh project with source and credit intact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-remix-'));
  const artifact = new TextEncoder().encode('<!doctype html><p>Exact old version</p>');
  const pub = await new PrivateKeySigner().getPublicKey();
  const config = {
    schema: 'space-local-project/v1',
    name: 'Original',
    entry: 'dist/index.html',
    previewId: crypto.randomUUID(),
    identifier: 'original',
    license: 'MIT',
    creator: { pubkey: pub, network: 'local' },
    publish: { site: 'http://localhost:8080' },
    preview: { readySelector: 'html[data-napplet-ready]', delayMs: 750 },
  };
  const files = new Map(
    Object.entries({
      'index.html': '<p>Source entry</p>',
      'dist/index.html': new TextDecoder().decode(artifact),
      'src/main.ts': 'export const original = true;',
      LICENSE: 'Original MIT license and credit',
      'napplet.json': JSON.stringify(config),
    }).map(([p, t]) => [p, new TextEncoder().encode(t)]),
  );
  const frozen = await freezeSource(join(root, 'frozen'), files, 1800000000);
  const archive = await Bun.file(join(root, 'frozen/source.tar')).bytes();
  let manifest: any;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => {
      if (request.headers.get('upgrade') === 'websocket' && server.upgrade(request)) return;
      const path = new URL(request.url).pathname;
      if (path.startsWith('/api/')) throw new Error('Unexpected proprietary API request');
      return new Response(path.endsWith(frozen.archiveHash) ? archive : artifact);
    },
    websocket: {
      message(ws, raw) {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') {
          ws.send(JSON.stringify(['EVENT', m[1], manifest]));
          ws.send(JSON.stringify(['EOSE', m[1]]));
        }
      },
    },
  });
  try {
    const hash = await sha256(artifact);
    manifest = await new PrivateKeySigner().signEvent({
      kind: 35129,
      created_at: 1,
      content: '',
      tags: [
        ['d', 'original'],
        ['server', server.url.origin],
        ['path', '/index.html', hash],
        ['x', await aggregateHash([{ path: '/index.html', hash }]), 'aggregate'],
        ['source-archive', `${server.url}${frozen.archiveHash}`],
        ['source-commit', frozen.commit],
      ],
    });
    const loaded = await loadRemix(
      nip19.neventEncode({ id: manifest.id, relays: [server.url.origin.replace('http:', 'ws:')] }),
      'local',
      AbortSignal.timeout(5000),
    );
    const result = await createRemix(root, 'my-remix', loaded);
    const fresh = await Bun.file(join(result.directory, 'napplet.json')).json();
    expect(fresh.creator).toBeUndefined();
    expect(fresh.publish.networks.public.relay).toBe('wss://relay.napplet.soy');
    expect(fresh.publish.networks.local.site).toBe('http://localhost:8080');
    expect(fresh.identifier).not.toBe(config.identifier);
    expect(fresh.previewId).not.toBe(config.previewId);
    expect(fresh.preview).toEqual(config.preview);
    expect(fresh.remix.revision).toBe(manifest.id);
    expect(await Bun.file(join(result.directory, 'src/main.ts')).text()).toBe(
      'export const original = true;',
    );
    expect(await Bun.file(join(result.directory, 'LICENSE')).text()).toBe(
      'Original MIT license and credit',
    );
    expect(await Bun.file(join(result.directory, 'README.md')).text()).toContain(manifest.id);
    expect(await Bun.file(join(result.directory, 'dist/index.html')).bytes()).toEqual(artifact);
    await expect(createRemix(root, 'my-remix', loaded)).rejects.toMatchObject({
      code: 'REMIX_DESTINATION',
    });
    expect(await Bun.file(join(result.directory, 'src/main.ts')).text()).toBe(
      'export const original = true;',
    );
    const malformed = { ...loaded, artifact: new TextEncoder().encode('different version') };
    await expect(createRemix(root, 'wrong-source', malformed)).rejects.toThrow('artifact');
    expect((await remixLineage(manifest)).origin).toBe(`35129:${manifest.pubkey}:original`);
    const snapshot = await new PrivateKeySigner().signEvent({
      ...manifest,
      kind: 5129,
      tags: manifest.tags
        .filter((t: string[]) => t[0] !== 'd')
        .concat([['a', `35129:${manifest.pubkey}:original`]]),
    });
    await expect(remixLineage(snapshot)).rejects.toThrow('parent');
  } finally {
    server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid remix references report an actionable error without reflecting pasted input', async () => {
  for (const reference of [
    'not-an-event',
    'naddr1broken',
    'https://secret@napplet.soy/r/' + 'a'.repeat(64),
    '[https://napplet.soy](https://napplet.soy)',
  ]) {
    await expect(loadRemix(reference, 'public', AbortSignal.timeout(100))).rejects.toMatchObject({
      code: 'REMIX_REFERENCE',
      message:
        'Use a plain napplet /n/naddr or /r/event link, naddr, nevent, note or hexadecimal event ID.',
    });
  }
});

test('standalone snapshot remixes preserve the exact source event without claiming its parent address', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-standalone-remix-'));
  const artifact = new TextEncoder().encode('<!doctype html><p>Independent snapshot</p>');
  const hash = await sha256(artifact),
    signer = new PrivateKeySigner();
  const parent = `35129:${await signer.getPublicKey()}:parent`;
  try {
    for (const [index, lineage] of [
      [],
      [['a', parent]],
      [
        ['a', parent],
        ['A', parent],
      ],
    ].entries()) {
      const manifest = await signer.signEvent({
        kind: 5129,
        created_at: index + 1,
        content: 'Standalone snapshot remix source',
        tags: [['x', hash], ...lineage],
      });
      const result = await createRemix(root, `snapshot-${index}`, {
        manifest,
        artifact,
        files: undefined,
      });
      expect(result.lineage.revision).toBe(manifest.id);
      expect(result.lineage.parent).toBeUndefined();
      expect(result.lineage.origin).toBe(index === 2 ? parent : undefined);
      const project = await Bun.file(join(result.directory, 'napplet.json')).json();
      expect(project.remix.revision).toBe(manifest.id);
      expect(project.remix.parent).toBeUndefined();
      expect(await Bun.file(join(result.directory, 'README.md')).text()).toContain(
        `Original napplet: ${manifest.id}`,
      );
      expect(await Bun.file(join(result.directory, 'index.html')).bytes()).toEqual(artifact);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('third-party optional metadata outside local authoring bounds does not break artifact-only remixes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-remote-metadata-'));
  const artifact = new TextEncoder().encode('<!doctype html><p>Original application</p>');
  const manifest = await new PrivateKeySigner().signEvent({
    kind: 35129,
    created_at: 1,
    content: 'Useful description. '.repeat(60),
    tags: [
      ['d', 'third-party'],
      ['x', await sha256(artifact)],
      ['R', 'storage'],
      ...Array.from({ length: 33 }, (_, i) => ['O', `optional-${i}`]),
      ['z', 'collaborative editor'],
      ['z', 'x'.repeat(81)],
      ['z', 'editor'],
      ...Array.from({ length: 33 }, (_, i) => ['z', `label-${i}`]),
      ['i', 'napplet:track/edit', 'track', 'mode'],
      ['i', 'napplet:track/custom', '$remote'],
      ['i', `napplet:${'x'.repeat(260)}`],
      ['i', 'napplet:track/large', ...Array.from({ length: 14 }, (_, i) => `param${i}`)],
      ['i', 'napplet:track/large', 'more'],
    ],
  });
  const original = JSON.stringify(manifest);
  try {
    const accepted = await validateManifest(manifest);
    expect(accepted.intents.find((i) => i.intent.endsWith('/large'))?.parameters).toHaveLength(15);
    const result = await createRemix(root, 'independent-remix', {
      manifest,
      artifact,
      files: new Map(),
    });
    const config = projectSchema.parse(
      await Bun.file(join(result.directory, 'napplet.json')).json(),
    );
    expect(config.description).toBe(manifest.content.slice(0, 1000));
    expect(config.requires).toEqual(['storage']);
    expect(config.optionalDomains).toHaveLength(32);
    expect(config.archetypes).toHaveLength(32);
    expect(config.archetypes).toContain('editor');
    expect(config.archetypes).not.toContain('collaborative editor');
    expect(config.intents).toEqual([
      { intent: 'napplet:track/edit', parameters: ['track', 'mode'] },
    ]);
    expect(config.remix?.revision).toBe(manifest.id);
    expect(config.remix?.parent).toBe(`35129:${manifest.pubkey}:third-party`);
    expect(await Bun.file(join(result.directory, 'index.html')).bytes()).toEqual(artifact);
    expect(JSON.stringify(manifest)).toBe(original);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('source archive rejects traversal, symlinks, duplicates and invalid checksum before extraction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'napplet-archive-'));
  try {
    await freezeSource(
      root,
      new Map([['index.html', new TextEncoder().encode('<p>hi</p>')]]),
      1800000000,
    );
    const valid = await Bun.file(join(root, 'source.tar')).bytes();
    expect(sourceArchive(valid).has('index.html')).toBe(true);
    // Git's first record is its global pax header, followed by index.html.
    const start = 1024;
    for (const [name, type] of [
      ['../escape', '0'],
      ['index.html', '2'],
      ['.git/config', '0'],
      ['.env', '0'],
    ]) {
      const bytes = valid.slice(),
        header = bytes.subarray(start, start + 512);
      header.fill(0, 0, 100);
      header.set(new TextEncoder().encode(name));
      header[156] = type.charCodeAt(0);
      header.fill(32, 148, 156);
      const sum = [...header].reduce((a, b) => a + b, 0);
      header.set(new TextEncoder().encode(sum.toString(8).padStart(6, '0') + '\0 '), 148);
      expect(() => sourceArchive(bytes)).toThrow();
    }
    const broken = valid.slice();
    broken[start] ^= 1;
    expect(() => sourceArchive(broken)).toThrow('checksum');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import type { EventTemplate } from 'nostr-tools';
import fixtures from '../data/catalog.json';
import { sha256, encodeAddress } from '../../protocol/src';
import { adminResponse } from './admin-response';
import {
  blocked,
  initializePolicy,
  manifestBlocked,
  manifestFeatured,
  readPolicy,
  updatePolicy,
  configuredBackendCreators,
  effectiveBackendCreators,
  type ModerationAction,
} from '../../moderation/src/policy';
import { artifact, gallery, playableManifest, resolveNapplet } from './catalog';
import { ogResponse } from './og';
import { previewResponse } from './previews';

import { DynamicBackends } from '../../dynamic-backends/src/service';
import { authorizationTemplate, PROFILE } from '../../dynamic-backends/src/contracts';

const admin = new PrivateKeySigner(),
  outsider = new PrivateKeySigner();
const actor = await admin.getPublicKey();
const original = { ...process.env };
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'napplet-moderation-'));
  process.env.SPACE_MODERATION_FILE = join(directory, 'policy.json');
  process.env.SPACE_ADMIN_PUBKEYS = actor;
  process.env.SPACE_SITE_ORIGIN = 'https://napplet.example';
  delete process.env.SPACE_INDEX_DIR;
  delete process.env.SPACE_PUBLICDEV;
  initializePolicy(process.env.SPACE_MODERATION_FILE);
});
afterEach(async () => {
  setSystemTime();
  for (const name of [
    'SPACE_MODERATION_FILE',
    'SPACE_ADMIN_PUBKEYS',
    'SPACE_DYNAMIC_CREATORS',
    'SPACE_SITE_ORIGIN',
    'SPACE_INDEX_DIR',
    'SPACE_PUBLICDEV',
  ]) {
    if (original[name] === undefined) delete process.env[name];
    else process.env[name] = original[name];
  }
  await rm(directory, { recursive: true, force: true });
});
const fixture = fixtures[0];
const action = (): ModerationAction => ({
  action: 'block',
  type: 'address',
  target: fixture.naddr,
  reason: 'Test policy',
  revision: readPolicy().revision,
});
async function signed(body?: string, change?: (e: EventTemplate) => void, signer = admin) {
  const event: EventTemplate = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    content: '',
    tags: [
      ['u', 'https://napplet.example/api/admin'],
      ['method', body ? 'POST' : 'GET'],
      ['nonce', crypto.randomUUID()],
    ],
  };
  if (body) event.tags.push(['payload', await sha256(body)]);
  change?.(event);
  return `Nostr ${Buffer.from(JSON.stringify(await signer.signEvent(event))).toString('base64')}`;
}
function request(token?: string, body?: string, url = 'https://napplet.example/api/admin') {
  return new Request(url, {
    method: body ? 'POST' : 'GET',
    headers: { ...(token ? { Authorization: token } : {}), 'Content-Type': 'application/json' },
    body,
  });
}
test('admin access requires an allowlisted signature and binds URL, method, time and payload', async () => {
  // Signing and verification must use the same second at the +30-second boundary.
  setSystemTime(new Date('2026-09-14T12:00:00Z'));
  const body = JSON.stringify(action());
  expect((await adminResponse(request())).status).toBe(401);
  expect((await adminResponse(request(await signed(undefined, undefined, outsider)))).status).toBe(
    403,
  );
  for (const change of [
    (e: EventTemplate) => {
      e.created_at -= 61;
    },
    (e: EventTemplate) => {
      e.created_at += 31;
    },
    (e: EventTemplate) => {
      e.tags[0][1] = 'https://evil.example/api/admin';
    },
    (e: EventTemplate) => {
      e.tags[1][1] = 'DELETE';
    },
    (e: EventTemplate) => {
      e.tags.push(['u', 'https://napplet.example/api/admin']);
    },
  ])
    expect((await adminResponse(request(await signed(body, change), body))).status).toBe(401);
  expect(
    (await adminResponse(request(await signed(body), body.replace('Test policy', 'Tampered'))))
      .status,
  ).toBe(401);
  expect(
    (
      await adminResponse(
        request(await signed(), undefined, 'https://napplet.example/api/admin?extra=1'),
      )
    ).status,
  ).toBe(401);
  const valid = await signed();
  const forged = JSON.parse(Buffer.from(valid.slice(6), 'base64').toString());
  forged.sig = '0'.repeat(128);
  expect(
    (
      await adminResponse(
        request(`Nostr ${Buffer.from(JSON.stringify(forged)).toString('base64')}`),
      )
    ).status,
  ).toBe(401);
  expect(readPolicy().revision).toBe(0);
});
test('signed policy changes survive reload, reject replay/stale updates, and audit reversible blocks', async () => {
  const body = JSON.stringify(action()),
    token = await signed(body);
  expect((await adminResponse(request(token, body))).status).toBe(200);
  expect((await adminResponse(request(token, body))).status).toBe(409);
  expect((await adminResponse(request(await signed(body), body))).status).toBe(409);
  initializePolicy(process.env.SPACE_MODERATION_FILE!);
  const read = await adminResponse(request(await signed()));
  const state = await read.json();
  expect(state.rules).toHaveLength(1);
  expect(state.audit[0]).toMatchObject({ actor, action: 'block', revision: 1 });
  const undo = JSON.stringify({ ...action(), action: 'unblock', reason: 'Reviewed and restored' });
  expect((await adminResponse(request(await signed(undo), undo))).status).toBe(200);
  expect(readPolicy().rules).toHaveLength(0);
  expect(readPolicy().audit).toHaveLength(2);
});

test('Featured is empty by default, signed and independent of blocks; address selections follow releases', async () => {
  // Existing policy files load without a migration or any automatic selections.
  await writeFile(
    process.env.SPACE_MODERATION_FILE!,
    JSON.stringify({ version: 1, revision: 0, rules: [], audit: [], used: [] }),
  );
  expect(readPolicy().featured).toEqual([]);
  expect(manifestFeatured(fixture.current)).toBe(false);
  const body = JSON.stringify({ ...action(), action: 'feature' });
  expect((await adminResponse(request(await signed(body, undefined, outsider), body))).status).toBe(
    403,
  );
  const token = await signed(body);
  const response = await adminResponse(request(token, body));
  expect(response.status).toBe(200);
  expect((await response.json()).featured).toHaveLength(1);
  expect((await adminResponse(request(token, body))).status).toBe(409);
  expect(readPolicy().rules).toHaveLength(0);
  expect(manifestFeatured({ ...fixture.current, id: 'a'.repeat(64) })).toBe(true);
  expect(manifestFeatured(fixture.snapshot)).toBe(true);
  expect(
    manifestFeatured({
      ...fixture.snapshot,
      tags: [
        ['x', fixture.artifactHash],
        ['a', `35129:${fixture.pubkey}:${fixture.identifier}`],
      ],
    }),
  ).toBe(false);
  expect(manifestFeatured({ ...fixture.snapshot, pubkey: await outsider.getPublicKey() })).toBe(
    false,
  );
  updatePolicy(action(), actor, '7'.repeat(64));
  expect(manifestBlocked(fixture.current)).toBe(true);
  updatePolicy({ ...action(), action: 'unfeature' }, actor, '8'.repeat(64));
  expect(manifestFeatured(fixture.current)).toBe(false);
  expect(manifestBlocked(fixture.current)).toBe(true);
  expect(() =>
    updatePolicy(
      { ...action(), action: 'feature', type: 'pubkey', target: fixture.pubkey },
      actor,
      '9'.repeat(64),
    ),
  ).toThrow('Only napplets');
});
test('naddr blocks preserve exact identifiers including trailing whitespace and root identities', () => {
  for (const [kind, identifier] of [
    [35129, 'with space '],
    [15129, ''],
  ] as const) {
    const target = encodeAddress({ kind, pubkey: fixture.pubkey, identifier });
    updatePolicy({ ...action(), target }, actor, String(kind).padStart(64, '0'));
    initializePolicy(process.env.SPACE_MODERATION_FILE!);
    expect(blocked('address', `${kind}:${fixture.pubkey}:${identifier}`)).toBe(true);
  }
});
test('blocking a napplet closes gallery, named/address/snapshot, source, player and cached preview paths', async () => {
  expect(await playableManifest(fixture.current.id)).not.toBeNull();
  const imageURL = `https://napplet.example/api/og/${fixture.snapshot.id}`;
  expect((await ogResponse(fixture.snapshot.id, new Request(imageURL))).status).toBe(200);
  updatePolicy(action(), actor, 'a'.repeat(64));
  expect(
    (await gallery({ tag: '', q: '', sort: 'curated' })).some((n) => n.slug === fixture.slug),
  ).toBe(false);
  for (const lookup of [
    { type: 'named', creator: '@space-lab', slug: fixture.slug },
    { type: 'address', naddr: fixture.naddr },
    { type: 'snapshot', id: fixture.snapshot.id },
  ] as const)
    expect(await resolveNapplet(lookup)).toBeNull();
  expect(await artifact(fixture.artifactHash)).toBeNull();
  expect(await playableManifest(fixture.current.id)).toBeNull();
  expect(await playableManifest(fixture.snapshot.id)).toBeNull();
  expect((await ogResponse(fixture.snapshot.id, new Request(imageURL))).status).toBe(404);
  expect((await previewResponse(fixture.snapshot.id, new Request(imageURL))).status).toBe(404);
  updatePolicy({ ...action(), action: 'unblock' }, actor, 'b'.repeat(64));
  expect(await playableManifest(fixture.current.id)).not.toBeNull();
});
test('blocking one event preserves an unblocked snapshot that shares its artifact', async () => {
  updatePolicy({ ...action(), type: 'event', target: fixture.current.id }, actor, '1'.repeat(64));
  expect(await playableManifest(fixture.current.id)).toBeNull();
  expect(await playableManifest(fixture.snapshot.id)).not.toBeNull();
  expect(await artifact(fixture.artifactHash)).not.toBeNull();
  updatePolicy({ ...action(), type: 'event', target: fixture.snapshot.id }, actor, '2'.repeat(64));
  expect(await artifact(fixture.artifactHash)).toBeNull();
});
test('author and hash rules apply to new manifests, snapshot links are author-bound, unreadable policy fails closed', async () => {
  updatePolicy({ ...action(), type: 'pubkey', target: fixture.pubkey }, actor, 'c'.repeat(64));
  expect(manifestBlocked({ ...fixture.current, id: 'd'.repeat(64) })).toBe(true);
  updatePolicy(
    { ...action(), type: 'pubkey', target: fixture.pubkey, action: 'unblock' },
    actor,
    'd'.repeat(64),
  );
  updatePolicy(action(), actor, 'e'.repeat(64));
  expect(
    manifestBlocked({
      ...fixture.snapshot,
      tags: [
        ['x', fixture.artifactHash],
        ['a', `35129:${fixture.pubkey}:${fixture.identifier}`],
      ],
    }),
  ).toBe(false);
  expect(manifestBlocked({ ...fixture.snapshot, pubkey: await outsider.getPublicKey() })).toBe(
    false,
  );
  updatePolicy({ ...action(), type: 'hash', target: fixture.artifactHash }, actor, 'f'.repeat(64));
  expect(manifestBlocked(fixture.current)).toBe(true);
  await writeFile(process.env.SPACE_MODERATION_FILE!, '{broken');
  expect(() => blocked('hash', fixture.artifactHash)).toThrow('unavailable');
  expect((await adminResponse(request(await signed()))).status).toBe(503);
});

test('admin membership is signed, audited, revocable and cannot remove recovery administrators', async () => {
  const key = await outsider.getPublicKey();
  const add = JSON.stringify({ ...action(), action: 'admin-add', type: 'pubkey', target: key });
  expect((await adminResponse(request(await signed(add, undefined, outsider), add))).status).toBe(
    403,
  );
  const token = await signed(add);
  expect((await adminResponse(request(token, add))).status).toBe(200);
  expect((await adminResponse(request(token, add))).status).toBe(409);
  const response = await adminResponse(request(await signed(undefined, undefined, outsider)));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ admins: [actor, key], recoveryAdmins: [actor] });
  const protect = JSON.stringify({
    ...action(),
    action: 'admin-remove',
    type: 'pubkey',
    target: actor,
  });
  expect(
    (await adminResponse(request(await signed(protect, undefined, outsider), protect))).status,
  ).toBe(409);
  const oldAction = action();
  const remove = JSON.stringify({
    ...action(),
    action: 'admin-remove',
    type: 'pubkey',
    target: key,
  });
  expect((await adminResponse(request(await signed(remove), remove))).status).toBe(200);
  expect((await adminResponse(request(await signed(undefined, undefined, outsider)))).status).toBe(
    403,
  );
  expect(() => updatePolicy(oldAction, key, '6'.repeat(64), undefined, true)).toThrow(
    'not an administrator',
  );
  expect(readPolicy().audit.map((e) => e.action)).toEqual(['admin-add', 'admin-remove']);
});
test('a policy-only administrator cannot remove the final administrator', async () => {
  const key = await outsider.getPublicKey();
  updatePolicy(
    { ...action(), action: 'admin-add', type: 'pubkey', target: key },
    actor,
    '5'.repeat(64),
  );
  delete process.env.SPACE_ADMIN_PUBKEYS;
  expect(() =>
    updatePolicy(
      { ...action(), action: 'admin-remove', type: 'pubkey', target: key },
      key,
      '6'.repeat(64),
    ),
  ).toThrow('at least one');
  expect(readPolicy().admins).toEqual([key]);
});
test('featured order resolves current addresses and pinned releases, skipping blocks and missing entries', async () => {
  const { featuredGallery } = await import('./featured');
  const { publicNapplet } = await import('./public-model');
  const entries = await Promise.all(
    fixtures.map(async (fixture) => ({
      ...(await publicNapplet(fixture.current)),
      availability: 'ready' as const,
    })),
  );
  expect(await featuredGallery(entries)).toEqual([]);
  const change = (
    action: ModerationAction['action'],
    index: number,
    type: 'address' | 'event' = 'address',
  ) =>
    updatePolicy(
      {
        ...actionBase(),
        action,
        type,
        target: type === 'address' ? fixtures[index].naddr : fixtures[index].current.id,
      },
      actor,
      crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
    );
  const actionBase = action;
  change('feature', 0);
  change('feature', 1, 'event');
  change('feature', 2);
  expect((await featuredGallery(entries)).map((e) => e.title)).toEqual(
    fixtures.slice(0, 3).map((e) => e.title),
  );
  change('feature-up', 1, 'event');
  let hero = await featuredGallery(entries);
  expect(hero[0].revisionId).toBe(fixtures[1].current.id);
  expect(hero[0].naddr).toBeNull();
  expect(hero[1].naddr).toBe(fixtures[0].naddr);
  expect(() => change('feature-up', 1, 'event')).toThrow('cannot move');
  change('block', 1, 'event');
  entries[0] = { ...entries[0], availability: 'unavailable' as any };
  hero = await featuredGallery(entries);
  expect(hero.map((e) => e.title)).toEqual([fixtures[2].title]);
  change('unfeature', 2);
  expect(await featuredGallery(entries)).toEqual([]);
});

test('admin navigation hints reveal only current access, fail closed, and never authorize policy reads', async () => {
  const { adminAccessResponse } = await import('./admin-response');
  const hint = (key: string) =>
    adminAccessResponse(new Request(`https://napplet.example/api/admin-access?pubkey=${key}`));
  expect(await hint(actor).json()).toEqual({ authorized: true });
  expect(hint(actor).headers.get('cache-control')).toBe('no-store');
  const outsiderKey = await outsider.getPublicKey();
  expect(await hint(outsiderKey).json()).toEqual({ authorized: false });
  expect(hint('invalid').status).toBe(400);
  expect(
    (
      await adminResponse(
        request(undefined, undefined, `https://napplet.example/api/admin?pubkey=${actor}`),
      )
    ).status,
  ).toBe(401);
  updatePolicy(
    {
      action: 'admin-add',
      type: 'pubkey',
      target: outsiderKey,
      reason: 'Navigation test',
      revision: 0,
    },
    actor,
    '9'.repeat(64),
  );
  expect(await hint(outsiderKey).json()).toEqual({ authorized: true });
  updatePolicy(
    {
      action: 'admin-remove',
      type: 'pubkey',
      target: outsiderKey,
      reason: 'Navigation revoked',
      revision: 1,
    },
    actor,
    '8'.repeat(64),
  );
  expect(await hint(outsiderKey).json()).toEqual({ authorized: false });
  await writeFile(process.env.SPACE_MODERATION_FILE!, 'corrupt');
  expect(hint(actor).status).toBe(503);
  expect(await hint(actor).json()).not.toHaveProperty('authorized', true);
});

test('authorized administration searches known blocked entries without exposing their catalog anonymously', async () => {
  const { IndexStore } = await import('./index-store');
  process.env.SPACE_INDEX_DIR = join(directory, 'index');
  const index = new IndexStore(process.env.SPACE_INDEX_DIR, true);
  index.admit(fixture.current);
  index.close();
  updatePolicy(action(), actor, '7'.repeat(64));
  const denied = await adminResponse(request());
  expect(denied.status).toBe(401);
  expect(await denied.json()).not.toHaveProperty('catalog');
  const data = await (await adminResponse(request(await signed()))).json();
  expect(data.catalog.entries).toHaveLength(1);
  expect(data.catalog.entries[0]).toMatchObject({
    title: fixture.title,
    id: fixture.current.id,
    address: `35129:${fixture.pubkey}:${fixture.identifier}`,
  });
  expect(
    data.catalog.entries[0].hashes.some((f: { hash: string }) => f.hash === fixture.artifactHash),
  ).toBe(true);
  expect(data.rules[0].target).toBe(data.catalog.entries[0].address);
});

test('administration exposes raw artifact targets for all standalone manifest kinds and can block them', async () => {
  const { IndexStore } = await import('./index-store');
  process.env.SPACE_INDEX_DIR = join(directory, 'index');
  const index = new IndexStore(process.env.SPACE_INDEX_DIR, true);
  const hash = 'b'.repeat(64);
  const manifests = await Promise.all(
    [35129, 15129, 5129].map((kind) =>
      admin.signEvent({
        kind,
        created_at: Math.floor(Date.now() / 1000) - 2,
        content: 'A standalone napplet.',
        tags: [
          ...(kind === 35129 ? [['d', 'standalone']] : []),
          ['title', `Standalone ${kind}`],
          ['x', hash],
        ],
      }),
    ),
  );
  for (const event of manifests) expect(index.admit(event)).toBe(true);
  index.close();
  const data = await (await adminResponse(request(await signed()))).json();
  for (const event of manifests) {
    const entry = data.catalog.entries.find((e: { id: string }) => e.id === event.id);
    expect(entry?.hashes).toEqual([{ hash, label: '/index.html' }]);
  }
  const body = JSON.stringify({
    action: 'block',
    type: 'hash',
    target: hash,
    reason: 'Reviewed artifact',
    revision: 0,
  });
  expect((await adminResponse(request(await signed(body), body))).status).toBe(200);
  for (const event of manifests) expect(manifestBlocked(event)).toBe(true);
});

test('signed backend grants reload immediately, preserve worlds on revocation, and fail closed', async () => {
  const creator = await outsider.getPublicKey();
  process.env.SPACE_DYNAMIC_CREATORS = actor;
  const module = {
    napplet: encodeAddress({ kind: 35129, pubkey: creator, identifier: 'admission-test' }),
    name: 'worlds',
  };
  const source = {
    repository: `30617:${creator}:admission-test`,
    cloneUrl: 'https://git.example/test.git',
    commit: 'a'.repeat(40),
    manifest: 'backend/backend.json',
  };
  const files: Record<string, string> = {};
  for (const name of ['backend.json', 'handler.ts', 'schemas.json'])
    files['backend/' + name] = await readFile(
      new URL(`../../dynamic-backends/fixtures/minicraft/${name}`, import.meta.url),
      'utf8',
    );
  let fetches = 0;
  const service = new DynamicBackends({
    provider: actor,
    sign: (event) => admin.signEvent(event),
    admittedCreators: effectiveBackendCreators,
    source: async () => {
      fetches++;
      return { source, files };
    },
  });
  const transport = 'b'.repeat(64);
  async function proof(operation: string, input: Record<string, unknown>) {
    const args = { ...input, requestId: crypto.randomUUID() };
    return {
      ...args,
      authorization: await outsider.signEvent(
        authorizationTemplate(actor, transport, operation, args),
      ),
    };
  }
  async function grant(action: 'backend-allow' | 'backend-revoke', target = creator) {
    const body = JSON.stringify({
      action,
      type: 'pubkey',
      target,
      reason: 'Controlled hosting trial',
      revision: readPolicy().revision,
    });
    return adminResponse(request(await signed(body), body));
  }
  try {
    expect(configuredBackendCreators()).toEqual([actor]);
    expect(readPolicy().backendCreators).toEqual([]);
    await expect(
      service.build(transport, await proof('build', { module, source, buildProfile: PROFILE })),
    ).rejects.toThrow('not admitted');
    expect(fetches).toBe(0);
    const outsiderBody = JSON.stringify({
      action: 'backend-allow',
      type: 'pubkey',
      target: creator,
      reason: 'Self-grant',
      revision: 0,
    });
    expect(
      (await adminResponse(request(await signed(outsiderBody, undefined, outsider), outsiderBody)))
        .status,
    ).toBe(403);
    const allowed = await grant('backend-allow');
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).backendCreators).toContain(creator);
    expect(readPolicy().admins).not.toContain(creator);
    const job = await service.build(
      transport,
      await proof('build', { module, source, buildProfile: PROFILE }),
    );
    let status: any;
    for (let i = 0; i < 100; i++) {
      status = service.buildStatus(transport, { build: job.build });
      if (status.status !== 'building' && status.status !== 'queued') break;
      await Bun.sleep(20);
    }
    expect(status.status, JSON.stringify(status)).toBe('ready');
    const release = status.release;
    service.activate(
      transport,
      await proof('activate', { module, release, expectedActiveRelease: null }),
    );
    const challenge = service.sessionChallenge(transport, { module, account: creator });
    const session = service.sessionBind(transport, {
      challenge: challenge.challenge,
      authorization: await outsider.signEvent(challenge.proof),
    }).session;
    const intent = {
      target: { module, release },
      operation: 'createWorld',
      input: {
        name: 'Kept world',
        seed: 1,
        mode: 'creative',
        visibility: 'public',
        building: 'everyone',
        guestsMayBuild: true,
      },
      requestId: crypto.randomUUID(),
      expiresAt: Math.floor(Date.now() / 1000) + 240,
      session,
    };
    const world = await service.invoke(transport, intent);
    expect((await grant('backend-revoke')).status).toBe(200);
    await expect(
      service.build(transport, await proof('build', { module, source, buildProfile: PROFILE })),
    ).rejects.toThrow('not admitted');
    const activation = await proof('activate', { module, release, expectedActiveRelease: release });
    expect(() => service.activate(transport, activation)).toThrow('not admitted');
    expect(
      (
        await service.invoke(transport, {
          ...intent,
          target: { module, release, instance: world.instance },
          operation: 'readWorld',
          input: {},
          requestId: crypto.randomUUID(),
        })
      ).result,
    ).toHaveProperty('name', 'Kept world');
    const revision = service.describe(transport, { module }).revision;
    service.disable(
      transport,
      await proof('disable', { module, disabled: true, expectedModuleRevision: revision }),
    );
    const enable = await proof('disable', {
      module,
      disabled: false,
      expectedModuleRevision: revision + 1,
    });
    expect(() => service.disable(transport, enable)).toThrow('not admitted');
    expect((await grant('backend-revoke', actor)).status).toBe(409);
    expect(
      readPolicy()
        .audit.slice(-2)
        .map((a) => a.action),
    ).toEqual(['backend-allow', 'backend-revoke']);
    await writeFile(process.env.SPACE_MODERATION_FILE!, '{broken');
    await expect(
      service.build(transport, await proof('build', { module, source, buildProfile: PROFILE })),
    ).rejects.toThrow('unavailable');
  } finally {
    await service.close();
  }
}, 15000);

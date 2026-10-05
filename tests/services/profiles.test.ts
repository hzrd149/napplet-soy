import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, getPublicKey, matchFilters, nip19, type EventTemplate } from 'nostr-tools';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { verifiedEvent, type SignedEvent } from '../../packages/protocol/src';
import fixtures from '../../packages/backend/data/catalog.json';

test('portable profiles, SSR/OG, pagination, kind-0 editing, remembered names and signed genealogy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'napplet-profile-browser-')),
    root = resolve(import.meta.dir, '../..');
  const key = new Uint8Array(32);
  key[31] = 1;
  const pubkey = getPublicKey(key),
    npub = nip19.npubEncode(pubkey),
    now = Math.floor(Date.now() / 1000);
  const profile = finalizeEvent(
    {
      kind: 0,
      created_at: now - 100,
      tags: [['client', 'outside-client']],
      content: JSON.stringify({
        name: 'Ada',
        display_name: 'Ada Makes Worlds',
        about: 'A tiny world at a time.',
        website: 'https://example.com',
        picture: 'legacy-avatar.jpg',
        lud16: 'ada@example.com',
        bot: false,
        lud06: 'LNURL1PRESERVE',
        custom: { keep: true },
      }),
    },
    key,
  );
  const events = new Map<string, SignedEvent>([[profile.id, profile]]);
  const index = new IndexStore(join(directory, 'index'), true);
  const creations: SignedEvent[] = [];
  for (let i = 0; i < 27; i++) {
    const ancestry =
      i === 1 || i === 2
        ? [
            ['a', `35129:${pubkey}:creation-${i - 1}`],
            ['A', `35129:${pubkey}:creation-0`],
            ['remix-version', creations[i - 1].id],
          ]
        : [];
    const e = finalizeEvent(
      {
        ...fixtures[0].current,
        created_at: now - 80 + i,
        tags: [
          ...fixtures[0].current.tags.filter((t) => !['d', 'title', 'a', 'A'].includes(t[0])),
          ['d', `creation-${i}`],
          [
            'title',
            ['Soft orbit original', 'Soft orbit remix', 'Soft orbit grandchild'][i] ??
              `Tiny world ${i}`,
          ],
          ...ancestry,
        ],
      },
      key,
    );
    creations.push(e);
    events.set(e.id, e);
    index.admit(e);
    index.project(
      e.id,
      { ...(await publicNapplet(e)), availability: 'ready' },
      Date.now() + 3600000,
      Date.now() + 3600000,
    );
  }
  await Bun.write(
    join(directory, 'index/artifacts', `${fixtures[0].artifactHash}.html`),
    Bun.file(join(root, 'packages/backend/data/artifacts', `${fixtures[0].artifactHash}.html`)),
  );
  index.close();
  let rejectPublish = false,
    sent: SignedEvent[] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response(
        Bun.file(join(root, 'packages/backend/data/artifacts', `${fixtures[0].artifactHash}.html`)),
        { headers: { 'access-control-allow-origin': '*' } },
      );
    },
    websocket: {
      message(socket, raw) {
        const msg = JSON.parse(String(raw));
        if (msg[0] === 'REQ') {
          for (const e of events.values())
            if (matchFilters(msg.slice(2), e)) socket.send(JSON.stringify(['EVENT', msg[1], e]));
          socket.send(JSON.stringify(['EOSE', msg[1]]));
        } else if (msg[0] === 'EVENT') {
          const e = verifiedEvent(msg[1]);
          sent.push(e);
          if (!rejectPublish) events.set(e.id, e);
          socket.send(
            JSON.stringify([
              'OK',
              e.id,
              !rejectPublish,
              rejectPublish ? 'blocked: test refusal' : '',
            ]),
          );
        }
      },
    },
  });
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() }),
    port = probe.port!;
  await probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_SITE_ORIGIN: origin,
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
      SPACE_INDEX_RELAYS: `ws://127.0.0.1:${relay.port}`,
      SPACE_INDEX_LOCAL_BLOSSOM: `http://127.0.0.1:${relay.port}`,
      SPACE_PUBLICDEV: '0',
    },
    stdout: 'ignore',
    stderr: 'inherit',
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let i = 0; i < 100; i++) {
      if (
        await fetch(`${origin}/api/health`)
          .then((r) => r.ok)
          .catch(() => false)
      )
        break;
      await Bun.sleep(100);
    }
    const html = await (await fetch(`${origin}/p/${npub}`)).text();
    expect(html).toContain('Ada Makes Worlds');
    expect(html).toContain('A tiny world at a time.');
    expect(html).toContain('property="og:type" content="profile"');
    expect(html).toContain(`${origin}/p/${npub}`);
    const og = await fetch(`${origin}/api/profile-og?pubkey=${pubkey}`);
    expect(og.status).toBe(200);
    expect(og.headers.get('content-type')).toBe('image/png');
    expect(
      Buffer.from(await og.arrayBuffer())
        .subarray(0, 8)
        .toString('hex'),
    ).toBe('89504e470d0a1a0a');
    const unknown = 'a'.repeat(64);
    const missing = await (await fetch(`${origin}/p/${unknown}`)).text();
    expect(missing).toContain('No profile found');
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.exposeFunction('testSign', (template: EventTemplate) =>
      finalizeEvent(template, key),
    );
    await page.addInitScript((key) => {
      (window as any).nostr = {
        getPublicKey: async () => key,
        signEvent: (event: unknown) => (window as any).testSign(event),
      };
    }, pubkey);
    await page.goto(`${origin}/p/${pubkey}`);
    await browserExpect(page.getByRole('heading', { name: 'Ada Makes Worlds.' })).toBeVisible();
    expect(await page.locator('.profile-creations .napplet-card').count()).toBe(24);
    await page.getByRole('link', { name: 'Next →', exact: true }).click();
    await browserExpect(page.locator('.profile-creations .napplet-card')).toHaveCount(3);
    await page.getByRole('link', { name: '← Previous', exact: true }).click();
    await browserExpect(page.locator('.profile-creations .napplet-card')).toHaveCount(24);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(root, '.local/profiles-desktop.png'), fullPage: false });
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Extension', exact: true }).click();
    await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
    await browserExpect(page.getByRole('button', { name: 'Edit your profile' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit your profile' }).click();
    await page.getByLabel('Display name', { exact: true }).fill('Ada & the little worlds');
    await page.getByLabel('About you', { exact: true }).fill('Open ideas, shared freely.');
    rejectPublish = true;
    await page.getByRole('button', { name: 'Sign & publish profile' }).click();
    await browserExpect(page.getByRole('button', { name: 'Retry signed update' })).toBeVisible();
    expect(sent.filter((e) => e.kind === 0)).toHaveLength(1);
    rejectPublish = false;
    await page.getByRole('button', { name: 'Retry signed update' }).click();
    await browserExpect(
      page.getByRole('heading', { name: 'Ada & the little worlds.' }),
    ).toBeVisible();
    expect(sent.filter((e) => e.kind === 0).map((e) => e.id)).toEqual([sent[0].id, sent[0].id]);
    expect(JSON.parse(sent[0].content)).toMatchObject({
      custom: { keep: true },
      lud06: 'LNURL1PRESERVE',
      bot: false,
      picture: 'legacy-avatar.jpg',
    });
    expect(sent[0].tags).toEqual(profile.tags);
    await page.reload();
    await browserExpect(page.getByRole('button', { name: 'Edit your profile' })).toBeVisible();
    await page.locator('.connect-button').click();
    await browserExpect(page.locator('.saved-session .creator-name')).toHaveText(
      'Ada & the little worlds',
    );
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(root, '.local/profiles-mobile.png'), fullPage: false });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const child = await publicNapplet(creations[2]);
    await page.goto(`${origin}/n/${child.naddr}`);
    await browserExpect(page.getByRole('heading', { name: 'The family tree' })).toBeVisible();
    await browserExpect(
      page.locator('.genealogy-tree li'),
      await page.locator('.genealogy-section').innerText(),
    ).toHaveCount(3);
    expect(await page.locator('.genealogy-tree h3').allTextContents()).toEqual([
      'Soft orbit original',
      'Soft orbit remix',
      'Soft orbit grandchild',
    ]);
    expect(
      await page.locator('.genealogy-tree .nostr-creator').first().getAttribute('href'),
    ).toContain(`/p/${npub}`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('.genealogy-section').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(root, '.local/genealogy-desktop.png') });
    // Direct profile images still reject private-network destinations.
    const unsafe = finalizeEvent(
      {
        kind: 0,
        created_at: Math.floor(Date.now() / 1000) + 1,
        tags: [],
        content: JSON.stringify({ name: 'Unsafe picture', picture: 'https://127.0.0.1/private' }),
      },
      key,
    );
    events.set(unsafe.id, unsafe);
    const privateRequests: string[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith('https://127.0.0.1')) privateRequests.push(request.url());
    });
    await page.goto(`${origin}/p/${pubkey}`);
    await page.getByRole('heading', { name: 'Unsafe picture.' }).waitFor();
    expect(await page.locator('.profile-avatar img').count()).toBe(0);
    expect(privateRequests).toEqual([]);
    // A creator without a kind-0 profile can publish one without claiming a site handle.
    const newKey = new Uint8Array(32);
    newKey[31] = 2;
    const newPubkey = getPublicKey(newKey),
      newcomer = await browser.newPage();
    await newcomer.exposeFunction('testSign', (template: EventTemplate) =>
      finalizeEvent(template, newKey),
    );
    await newcomer.addInitScript((key) => {
      (window as any).nostr = {
        getPublicKey: async () => key,
        signEvent: (event: unknown) => (window as any).testSign(event),
      };
    }, newPubkey);
    await newcomer.goto(`${origin}/p/${newPubkey}`);
    await newcomer.getByRole('button', { name: 'Connect', exact: true }).click();
    await newcomer.getByRole('button', { name: 'Extension', exact: true }).click();
    await newcomer.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
    await newcomer.getByRole('button', { name: 'Create your profile' }).click();
    await newcomer.getByLabel('Display name', { exact: true }).fill('First little world');
    await newcomer.getByRole('button', { name: 'Sign & publish profile' }).click();
    await browserExpect(
      newcomer.getByRole('heading', { name: 'First little world.' }),
    ).toBeVisible();
    expect(sent.at(-1)?.pubkey).toBe(newPubkey);
    await newcomer.close();
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    server.kill();
    await server.exited;
    await relay.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);

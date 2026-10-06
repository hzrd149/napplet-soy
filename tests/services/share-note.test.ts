import { test, expect } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, getPublicKey, matchFilters } from 'nostr-tools';
import { verifiedEvent, type SignedEvent } from '../../packages/protocol/src';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { IndexStore } from '../../packages/backend/src/index-store';
import fixtures from '../../packages/backend/data/catalog.json';

test('share notes work from gallery and detail with editable parts, exact-event retry and signer consent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-share-note-'));
  const key = new Uint8Array(32);
  key[31] = 1; // Public test key only.
  const clip = 'https://media.example/preview.webm',
    cover = 'https://media.example/cover.png';
  const at = Math.floor(Date.now() / 1000);
  const events = new Map<string, SignedEvent>();
  const entries = [];
  const index = new IndexStore(join(directory, 'index'), true);
  for (const [id, video] of [
    ['clip', true],
    ['image', false],
  ] as const) {
    const descriptor = finalizeEvent(
      {
        kind: 32267,
        created_at: at,
        content: video ? clip : '',
        tags: [
          ['d', id],
          ['image', cover],
          ...(video ? [['imeta', `url ${clip}`, 'm video/webm', `x ${'a'.repeat(64)}`]] : []),
        ],
      },
      key,
    );
    const manifest = finalizeEvent(
      {
        kind: 35129,
        created_at: at,
        content: '',
        tags: [
          ...fixtures[0].current.tags.filter(
            (t) => !['d', 'title', 'description', 'app', 't'].includes(t[0]),
          ),
          ['d', `share-${id}`],
          ['title', `Share ${id} game`],
          ['description', 'Draw a car and try the hills.'],
          ['t', 'game'],
          ['t', 'racing'],
          ['app', `32267:${descriptor.pubkey}:${id}`],
        ],
      },
      key,
    );
    events.set(manifest.id, manifest);
    events.set(descriptor.id, descriptor);
    const entry = {
      ...(await publicNapplet(manifest)),
      metadata: [descriptor],
      availability: 'ready' as const,
    };
    entries.push(entry);
    index.admit(manifest);
    index.project(manifest.id, entry, Date.now() + 3600000, Date.now() + 3600000);
    await Bun.write(
      join(directory, 'index/artifacts', `${entry.artifactHash}.html`),
      Bun.file(join('packages/backend/data/artifacts', `${entry.artifactHash}.html`)),
    );
  }
  index.close();
  let reject = true;
  const attempts: SignedEvent[] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response();
    },
    websocket: {
      message(socket, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] === 'REQ') {
          for (const event of events.values())
            if (matchFilters(message.slice(2), event))
              socket.send(JSON.stringify(['EVENT', message[1], event]));
          socket.send(JSON.stringify(['EOSE', message[1]]));
        } else if (message[0] === 'EVENT') {
          const event = verifiedEvent(message[1]);
          attempts.push(event);
          if (!reject) events.set(event.id, event);
          socket.send(
            JSON.stringify([
              'OK',
              event.id,
              !reject,
              reject ? 'blocked: test relay rejection' : '',
            ]),
          );
        }
      },
    },
  });
  const relayUrl = `ws://127.0.0.1:${relay.port}/`;
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_PUBLICDEV: '0',
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_INDEX_RELAYS: relayUrl,
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const browser = await chromium.launch();
  try {
    let output = '',
      origin = '';
    for await (const chunk of server.stdout) {
      output += new TextDecoder().decode(chunk);
      origin = /listening on (http:\/\/[^\s]+)/.exec(output)?.[1] ?? '';
      if (origin) break;
    }
    expect(origin).not.toBe('');
    origin = new URL(origin).origin;
    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    let signatures = 0,
      refuse = false;
    let signingGate: Promise<void> | undefined;
    await page.exposeFunction('testSign', async (template: Parameters<typeof finalizeEvent>[0]) => {
      signatures++;
      if (refuse) throw new Error('User rejected signing');
      if (signingGate) await signingGate;
      return JSON.parse(JSON.stringify(finalizeEvent(template, key)));
    });
    await context.addInitScript(
      ({ pubkey, relayUrl }) => {
        localStorage.setItem(
          'napplet:network',
          JSON.stringify({ relays: [relayUrl], blossom: [] }),
        );
        (window as any).nostr = {
          getPublicKey: async () => pubkey,
          signEvent: (event: unknown) => (window as any).testSign(event),
        };
      },
      { pubkey: getPublicKey(key), relayUrl },
    );
    await context.route('https://media.example/**', (route) =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGpcAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    );
    await page.goto(origin);
    await ui(page.locator('#identity-button')).toBeEnabled();
    const openShare = async (title: string) => {
      await page
        .getByRole('button', { name: `Share ${title}`, exact: true })
        .first()
        .click();
      await page.getByRole('button', { name: /^Post to Nostr/ }).click();
      await ui(page.getByLabel('Your note', { exact: true })).toBeVisible();
    };
    const detailPath = await page
      .locator('.card-heading')
      .getByRole('link', { name: entries[0].title, exact: true })
      .getAttribute('href');
    await openShare(entries[0].title);
    const textarea = page.getByLabel('Your note', { exact: true });
    const playerUrl = `${origin}${detailPath}/play`;
    const original = await textarea.inputValue();
    expect(original).toContain(clip);
    expect(original).not.toContain(cover);
    expect(original).toContain(playerUrl);
    expect(original).toContain('#nappletsoy #game #racing');
    expect(attempts).toHaveLength(0);
    await page.getByRole('button', { name: 'Sign in to post', exact: true }).click();
    await page.getByRole('button', { name: 'Extension', exact: true }).click();
    await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
    await openShare(entries[0].title);
    expect(await textarea.inputValue()).toBe(original);
    await textarea.fill(original.replace(entries[0].title, 'My new favourite!'));
    await textarea.fill((await textarea.inputValue()) + '\n\nCan you beat me? #NOSTR');
    for (const name of ['Description', 'Preview clip', '#nappletsoy', 'Napplet tags'])
      await page.getByRole('button', { name, exact: true }).click();
    const edited = await textarea.inputValue();
    expect(edited).toContain('My new favourite!');
    expect(edited).toContain('Can you beat me?');
    expect(edited).not.toContain('#nappletsoy');
    expect(edited).not.toContain('#racing');
    expect(edited).not.toContain(clip);
    await page.getByRole('button', { name: 'Preview clip', exact: true }).click();
    const submitted = await textarea.inputValue();
    await mkdir('.local/share-note', { recursive: true });
    await page.screenshot({ path: '.local/share-note/desktop.png', animations: 'disabled' });
    await page.getByRole('button', { name: 'Post to Nostr', exact: true }).click();
    await ui(page.getByRole('button', { name: 'Retry post', exact: true })).toBeVisible();
    expect(
      await page.getByRole('button', { name: 'Retry post', exact: true }).getAttribute('title'),
    ).toContain('test relay rejection');
    expect(signatures).toBe(1);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ kind: 1, pubkey: getPublicKey(key), content: submitted });
    expect(attempts[0].tags.filter((t) => t[0] === 't')).toEqual([['t', 'nostr']]);
    expect(attempts[0].tags.find((t) => t[0] === 'imeta')).toContain(`url ${clip}`);
    expect(await textarea.isDisabled()).toBe(true);
    reject = false;
    await page.getByRole('button', { name: 'Retry post', exact: true }).click();
    await ui(page.getByRole('button', { name: 'Posted to Nostr', exact: true })).toBeVisible();
    expect(signatures).toBe(1);
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(attempts[1]);
    await ui(textarea).not.toBeVisible();
    await ui(
      page.getByRole('button', { name: `Share ${entries[0].title}`, exact: true }).first(),
    ).toBeFocused();
    // No clip: share the main image itself. Phone/dark dialog fits the viewport.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await openShare(entries[1].title);
    expect(await textarea.inputValue()).toContain(cover);
    expect(await textarea.inputValue()).not.toContain(clip);
    await ui(page.getByRole('button', { name: 'Cover image', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: '.local/share-note/mobile-dark.png', animations: 'disabled' });
    await page.keyboard.press('Escape');
    await page.goto(`${origin}/n/${entries[0].naddr}`);
    await ui(page.locator('#identity-button')).toBeEnabled();
    await openShare(entries[0].title);
    expect(await textarea.inputValue()).toContain(clip);
    // Arbitrary text replaces every generated element, without retaining hidden tags.
    await textarea.fill('My entirely custom note. #somethingelse');
    refuse = true;
    await page.getByRole('button', { name: 'Post to Nostr', exact: true }).click();
    await ui(page.getByRole('button', { name: 'Retry post', exact: true })).toBeVisible();
    expect(await textarea.inputValue()).toBe('My entirely custom note. #somethingelse');
    expect(attempts).toHaveLength(2);
    expect(await textarea.isEnabled()).toBe(true);
    refuse = false;
    await page.getByRole('button', { name: 'Retry post', exact: true }).click();
    await ui(page.getByRole('button', { name: 'Posted to Nostr', exact: true })).toBeVisible();
    expect(attempts).toHaveLength(3);
    expect(attempts[2].tags).toEqual([['t', 'somethingelse']]);
    await ui(textarea).not.toBeVisible();
    // Dismissing while an external signer is deciding must not publish its late result.
    await openShare(entries[0].title);
    let release!: () => void;
    signingGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.getByRole('button', { name: 'Post to Nostr', exact: true }).click();
    await ui(page.getByRole('button', { name: 'Signing…', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    release();
    signingGate = undefined;
    await page.waitForTimeout(300);
    expect(attempts).toHaveLength(3);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.kill();
    await server.exited;
    relay.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 45000);

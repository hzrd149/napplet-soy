import { test, expect } from 'bun:test';
import { expect as browserExpect } from '@playwright/test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { PrivateKeySigner } from 'applesauce-signers';
import { matchFilters } from 'nostr-tools';
import { sha256, aggregateHash, type SignedEvent } from '../../packages/protocol/src';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { browserCache, browserEngine } from '../../apps/cli/src/browser';

test('authors can unpublish in the shell, recover after reload, and confirm reactive deletion on mobile', async () => {
  const root = resolve(import.meta.dir, '../..'),
    temp = await mkdtemp(join(tmpdir(), 'soy-lifecycle-browser-'));
  const signer = new PrivateKeySigner(),
    author = await signer.getPublicKey(),
    bytes = new TextEncoder().encode('<!doctype html><p>A game</p>'),
    hash = await sha256(bytes);
  const manifest = (await signer.signEvent({
    kind: 35129,
    created_at: Math.floor(Date.now() / 1000) - 30,
    content: '',
    tags: [
      ['d', 'world'],
      ['title', 'A little world'],
      ['path', '/index.html', hash],
      ['x', await aggregateHash([{ path: '/index.html', hash }]), 'aggregate'],
      ['server', 'https://blossom.example'],
    ],
  })) as SignedEvent;
  const catalog = join(temp, 'catalog');
  await Bun.write(
    join(catalog, 'catalog.json'),
    JSON.stringify({
      version: 2,
      fetchedAt: Date.now(),
      relays: [],
      rejected: 0,
      entries: [{ ...(await publicNapplet(manifest)), availability: 'ready', bytes: bytes.length }],
    }),
  );
  const web = Bun.spawn([process.execPath, join(root, 'apps/web/server.ts')], {
    cwd: temp,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_PUBLICDEV: '1',
      SPACE_PUBLICDEV_DIR: catalog,
      SPACE_COMMUNITY_DIR: join(temp, 'community'),
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= browserCache();
  const { chromium } = await browserEngine();
  const browser = await chromium.launch({ headless: true });
  try {
    const reader = web.stdout.getReader();
    let output = '',
      site = '';
    while (!site) {
      const p = await reader.read();
      if (p.done) throw new Error(output);
      output += new TextDecoder().decode(p.value);
      site = /listening on (http:\/\/127\.0\.0\.1:\d+)/.exec(output)?.[1] ?? '';
    }
    reader.releaseLock();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    let events = [manifest],
      writes = 0,
      deletes = 0,
      removed = false;
    await context.exposeBinding('signFixture', async (_source, t) => signer.signEvent(t));
    await context.addInitScript(
      ({ author }) => {
        localStorage.setItem(
          'napplet:network',
          JSON.stringify({
            relays: ['wss://lifecycle.example'],
            blossom: ['https://blossom.example'],
          }),
        );
        (window as any).nostr = {
          getPublicKey: async () => author,
          signEvent: async (t: any) => (window as any).signFixture(t),
        };
      },
      { author },
    );
    await context.route('https://blossom.example/**', async (route) => {
      const method = route.request().method();
      const headers = {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, DELETE, OPTIONS',
        'access-control-allow-headers': 'Authorization',
      };
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (method === 'DELETE') {
        deletes++;
        removed = true;
        await new Promise((r) => setTimeout(r, 250));
        return route.fulfill({ status: 204, headers });
      }
      return route.fulfill({
        status: removed ? 404 : 200,
        headers,
        body: method === 'HEAD' ? '' : Buffer.from(bytes),
      });
    });
    await context.routeWebSocket('**/*', (ws) =>
      ws.onMessage((raw) => {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') {
          for (const e of events)
            if (matchFilters(m.slice(2), e)) ws.send(JSON.stringify(['EVENT', m[1], e]));
          ws.send(JSON.stringify(['EOSE', m[1]]));
        }
        if (m[0] === 'EVENT') {
          const e = m[1] as SignedEvent;
          writes++;
          if (e.kind === 5)
            events = events.filter(
              (t) =>
                t.pubkey !== e.pubkey ||
                t.created_at > e.created_at ||
                !e.tags.some(
                  (x) =>
                    (x[0] === 'e' && x[1] === t.id) ||
                    (x[0] === 'a' &&
                      x[1] === `${t.kind}:${t.pubkey}:${t.tags.find((z) => z[0] === 'd')?.[1]}`),
                ),
            );
          events.push(e);
          ws.send(JSON.stringify(['OK', e.id, true, 'accepted']));
        }
      }),
    );
    const page = await context.newPage(),
      errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${site}/manage`);
    await page.getByRole('button', { name: 'Sign in to manage your napplets' }).click();
    await page.getByRole('button', { name: 'Extension', exact: true }).click();
    await page.getByRole('button', { name: 'Connect browser extension' }).click();
    await page.getByRole('button', { name: 'Manage publication' }).click();
    await page.getByRole('button', { name: 'Unpublish', exact: true }).click();
    await browserExpect
      .poll(() => page.getByRole('button', { name: 'Confirm unpublish' }).isVisible())
      .toBe(true);
    expect(writes).toBe(0);
    expect(deletes).toBe(0);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Confirm unpublish' }).click();
    await browserExpect
      .poll(() => page.getByRole('status').filter({ hasText: 'Listing unpublished' }).count())
      .toBe(1);
    expect(writes).toBe(1);
    expect(deletes).toBe(0);
    await page.reload();
    await page.getByRole('button', { name: 'Manage publication' }).click();
    await page.getByRole('button', { name: 'Republish', exact: true }).click();
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Republish napplet', exact: true }).click();
    await browserExpect
      .poll(() => page.getByRole('status').filter({ hasText: 'Listing published' }).count())
      .toBe(1);
    expect(writes).toBe(2);
    await page.getByRole('button', { name: 'Delete hosted data', exact: true }).click();
    await browserExpect
      .poll(() => page.getByLabel('Type DELETE to confirm the inventory').isVisible())
      .toBe(true);
    expect(
      await page.getByRole('button', { name: 'Delete selected hosted data' }).isDisabled(),
    ).toBe(true);
    await page.getByLabel('Type DELETE to confirm the inventory').fill('DELETE');
    await page.getByRole('checkbox').check();
    await mkdir(join(root, '.local/lifecycle-review'), { recursive: true });
    await page.screenshot({
      path: join(root, '.local/lifecycle-review/confirmation-mobile.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Delete selected hosted data' }).click();
    await browserExpect.poll(() => deletes).toBe(1);
    await browserExpect.poll(() => page.locator('[data-state="done"]').count()).toBe(2);
    expect(await page.locator('[data-state="done"]').last().textContent()).toContain(
      'no longer served',
    );
    await page.screenshot({
      path: join(root, '.local/lifecycle-review/results-mobile.png'),
      fullPage: true,
    });
    expect(errors).toEqual([]);
    await context.close();
  } finally {
    await browser.close();
    web.kill();
    await web.exited;
    await rm(temp, { recursive: true, force: true });
  }
}, 90000);

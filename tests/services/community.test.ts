import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { finalizeEvent, matchFilters, getPublicKey } from 'nostr-tools';
import { verifiedEvent, type SignedEvent } from '../../packages/protocol/src';
import { directWallet } from '../fixtures/direct-wallet';
import { socialScope, socialView } from '../../packages/protocol/src/social';
import { inspectInvoice } from '../../packages/protocol/src/invoice';
import fixtures from '../../packages/backend/data/catalog.json';

test('production SSR, signed named routes and social actions work through a real local WebSocket relay', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'space-community-browser-')),
    root = resolve(import.meta.dir, '../..');
  const key = new Uint8Array(32);
  key[31] = 1; // Explicit public fixture key, never an account credential.
  const fixture = fixtures[0],
    events = new Map<string, SignedEvent>([
      [fixture.current.id, fixture.current],
      [fixture.snapshot.id, fixture.snapshot],
    ]);
  let rejected = 0,
    failRefresh = false;
  let onPublish: ((event: SignedEvent) => Promise<boolean> | boolean) | undefined;
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response('relay');
    },
    websocket: {
      async message(socket, raw) {
        const message = JSON.parse(String(raw));
        if (message[0] === 'REQ') {
          if (
            failRefresh &&
            message.slice(2).some((f: any) => f.kinds?.includes(1111) && f['#A'])
          ) {
            failRefresh = false;
            socket.send(JSON.stringify(['CLOSED', message[1], 'Read unavailable']));
            return;
          }
          for (const e of events.values())
            if (matchFilters(message.slice(2), e))
              socket.send(JSON.stringify(['EVENT', message[1], e]));
          socket.send(JSON.stringify(['EOSE', message[1]]));
        } else if (message[0] === 'EVENT') {
          try {
            const e = verifiedEvent(message[1]);
            if (onPublish && !(await onPublish(e))) {
              socket.send(JSON.stringify(['OK', e.id, false, 'Test delivery unavailable']));
              return;
            }
            events.set(e.id, e);
            socket.send(JSON.stringify(['OK', e.id, true, '']));
          } catch {
            rejected++;
          }
        }
      },
    },
  });
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  const origin = `http://127.0.0.1:${port}`,
    relayUrl = `ws://127.0.0.1:${relay.port}/`;
  const child = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_SITE_ORIGIN: origin,
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
      SPACE_INDEX_RELAYS: relayUrl,
      SPACE_PUBLICDEV: '0',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin)).ok) break;
      } catch {}
      await Bun.sleep(100);
    }
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
    await page.exposeFunction('testSign', async (template: Parameters<typeof finalizeEvent>[0]) =>
      JSON.parse(JSON.stringify(finalizeEvent(template, key))),
    );
    await page.addInitScript((pubkey) => {
      (window as any).nostr = {
        getPublicKey: async () => pubkey,
        signEvent: (event: unknown) => (window as any).testSign(event),
      };
    }, getPublicKey(key));
    const walletOptions = { plainDescription: true, verification: false };
    const wallet = await directWallet(page, events, key, relayUrl, walletOptions);
    await page.goto(`${origin}/n/${fixture.naddr}`);
    const headerActions = page.locator('.napplet-social-actions');
    await headerActions.getByRole('button', { name: /^Like / }).waitFor();
    expect(await headerActions.getByRole('button', { name: /^Like / }).isDisabled()).toBe(true);
    expect(
      await headerActions.getByRole('button', { name: `Share ${fixture.title}` }).isEnabled(),
    ).toBe(true);
    await page.getByRole('button', { name: 'Connect to comment or like' }).click();
    await page.getByRole('button', { name: 'Extension', exact: true }).click();
    await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
    await page.getByRole('button', { name: 'Named link', exact: true }).click();
    await page.getByLabel('Creator handle').fill('browser-author');
    await page.getByLabel('Napplet slug').fill('first');
    await page.getByRole('button', { name: 'Claim /@handle/slug' }).click();
    await page.getByRole('button', { name: 'Link ready', exact: true }).waitFor();
    const named = await fetch(`${origin}/@browser-author/first`);
    expect(named.status).toBe(200);
    const html = await named.text();
    expect(html).toContain(fixture.title);
    expect(html).toContain(`content="${origin}/@browser-author/first"`);
    await page.keyboard.press('Escape');
    let releasePost!: () => void;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    const commentAttempts: string[] = [];
    onPublish = async (event) => {
      commentAttempts.push(JSON.stringify(event));
      if (commentAttempts.length === 1) {
        await postGate;
        return false;
      }
      failRefresh = true;
      return true;
    };
    await page.getByLabel('Leave a little note').fill('Hello from an independent signed event.');
    await page.getByRole('button', { name: 'Post comment', exact: true }).click();
    const publishing = page
      .locator('.comment-submit')
      .getByRole('button', { name: 'Publishing…', exact: true });
    await publishing.waitFor();
    expect(await publishing.getAttribute('aria-busy')).toBe('true');
    expect(await publishing.locator('.animate-spin').count()).toBe(1);
    expect(await page.locator('.pending-action, .community-status').count()).toBe(0);
    releasePost();
    const retryComment = page.getByRole('button', { name: 'Retry comment', exact: true });
    await retryComment.waitFor();
    expect(await retryComment.getAttribute('title')).toContain('No relay acknowledged');
    expect(await page.getByLabel('Leave a little note').inputValue()).toBe(
      'Hello from an independent signed event.',
    );
    await retryComment.click();
    await page.getByRole('button', { name: 'Posted', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retry refresh', exact: true }).click();
    expect(commentAttempts).toHaveLength(2);
    expect(commentAttempts[0]).toBe(commentAttempts[1]);
    expect(await retryComment.count()).toBe(0);
    onPublish = undefined;
    await page.getByText('Hello from an independent signed event.', { exact: true }).waitFor();
    await headerActions.getByRole('button', { name: /^Like / }).click();
    await page.getByRole('button', { name: '1 like', exact: true }).waitFor();
    expect(
      await headerActions.getByRole('button', { name: /^Unlike / }).getAttribute('aria-pressed'),
    ).toBe('true');
    await page.getByRole('button', { name: '1 like', exact: true }).click();
    await page.getByRole('button', { name: '0 likes', exact: true }).waitFor();
    expect(
      await headerActions.getByRole('button', { name: /^Like / }).getAttribute('aria-pressed'),
    ).toBe('false');
    // Toolbar and discussion share a pending event: retry signs nothing new.
    const attempts: string[] = [];
    onPublish = (event) => {
      attempts.push(event.id);
      return attempts.length !== 1;
    };
    await headerActions.getByRole('button', { name: /^Like / }).click();
    await page
      .locator('.napplet-social-actions')
      .getByRole('button', { name: 'Retry like', exact: true })
      .waitFor();
    expect(
      await page
        .locator('.social-actions')
        .getByRole('button', { name: 'Retry like', exact: true })
        .isEnabled(),
    ).toBe(true);
    expect(await page.locator('.pending-action, .detail-social-feedback').count()).toBe(0);
    await page
      .locator('.napplet-social-actions')
      .getByRole('button', { name: 'Retry like', exact: true })
      .click();
    await page.getByRole('button', { name: '1 like', exact: true }).waitFor();
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toBe(attempts[1]);
    onPublish = undefined;
    const commentLike = page.getByRole('button', { name: /^Like comment by/ }).first();
    await commentLike.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label^="Like comment by"]')?.getAttribute('aria-pressed') ===
        'true',
    );
    expect(await commentLike.textContent()).toContain('1');
    await commentLike.click();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label^="Like comment by"]')?.getAttribute('aria-pressed') ===
        'false',
    );
    await page.getByRole('button', { name: 'Reply', exact: true }).click();
    await page.getByLabel('Your reply').fill('A reply in the same thread.');
    await page.getByRole('button', { name: 'Post reply', exact: true }).click();
    await page.getByText('A reply in the same thread.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Delete', exact: true }).first().click();
    await page.getByText('Comment deleted by its author.').waitFor();
    await page.getByRole('button', { name: 'Remix this', exact: true }).click();
    expect(await page.locator('.remix-command').count()).toBe(2);
    expect(await page.locator('.remix-command').first().textContent()).toContain('sh -s -- remix');
    expect(await page.locator('.remix-command').first().textContent()).toContain('--network local');
    expect(await page.locator('.remix-command').first().textContent()).toContain(
      `/r/${fixture.snapshot.id}`,
    );
    await page.keyboard.press('Escape');
    const state = socialView(
      socialScope(fixture.current),
      [...events.values()],
      new Map([[fixture.current.id, fixture.current]]),
    );
    expect(state.likeCount).toBe(1);
    expect(state.comments).toHaveLength(2);
    expect(state.comments[0].deleted).toBe(true);
    expect([...events.values()].filter((e) => e.kind === 1111)).toHaveLength(2);
    expect([...events.values()].filter((e) => e.kind === 7)).toHaveLength(3);
    expect(rejected).toBe(0);
    // Wallet UI is simulated; no invoice provider or wallet receives a real request.
    await page.exposeFunction('testPay', async (invoice: string) => ({
      preimage: wallet.preimages[wallet.invoices.indexOf(invoice)],
    }));
    await page.evaluate(() => {
      (window as any).testPayments = [];
      (window as any).webln = {
        enable: async () => {},
        sendPayment: async (invoice: string) => {
          (window as any).testPayments.push(invoice);
          return (window as any).testPay(invoice);
        },
      };
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).waitFor();
    await headerActions.getByRole('button', { name: `Zap ${fixture.title}`, exact: true }).click();
    await page.getByLabel('Satoshis', { exact: true }).waitFor();
    expect(wallet.requests.length).toBe(0);
    await page.getByLabel('Note (optional)').fill('derp');
    await page.getByRole('button', { name: 'Create zap invoice', exact: true }).click();
    await page.getByRole('button', { name: 'Pay with browser wallet', exact: true }).waitFor();
    expect(wallet.requests.length).toBe(1);
    expect(inspectInvoice(wallet.invoices[0]).descriptionHash).toBeNull();
    expect(
      await page.getByRole('link', { name: 'Open Lightning wallet' }).getAttribute('href'),
    ).toBe(`lightning:${wallet.invoices[0]}`);
    expect(await page.evaluate(() => (window as any).testPayments.length)).toBe(0);
    await page.getByRole('button', { name: 'Pay with browser wallet', exact: true }).click();
    await page.getByText('Zap sent!', { exact: true }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect(await headerActions.textContent()).toContain('1 · 21 sats');
    expect(await page.getByRole('button', { name: '21 sats zapped', exact: true }).count()).toBe(1);
    expect(await page.evaluate(() => (window as any).testPayments)).toEqual([wallet.invoices[0]]);
    expect([...events.values()].some((e) => e.kind === 9734)).toBe(false);
    wallet.settle(0);
    walletOptions.plainDescription = false;
    await page.getByRole('button', { name: 'Zap comment', exact: true }).click();
    await page.getByLabel('Satoshis', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Create zap invoice', exact: true }).click();
    await page.getByRole('button', { name: 'Pay with browser wallet', exact: true }).waitFor();
    expect(wallet.requests.length).toBe(2);
    expect(inspectInvoice(wallet.invoices[1]).descriptionHash).not.toBeNull();
    expect(wallet.requests[0].pubkey).toBe(fixture.pubkey);
    expect(wallet.requests[1].tags).toContainEqual(['k', '1111']);
    expect(wallet.requests[1].tags.some((t) => t[0] === 'a')).toBe(false);
    expect(await page.evaluate(() => (window as any).testPayments.length)).toBe(1);
    wallet.settle(1);
    await page.getByText('Zap sent!', { exact: true }).waitFor();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect(await headerActions.textContent()).toContain('1 · 21 sats');
    expect(
      await page
        .locator('.comment-tools')
        .getByRole('button', { name: 'Zap comment' })
        .textContent(),
    ).toContain('21 sats');
    await page.keyboard.press('Escape');
    await mkdir(join(root, '.local/community-check'), { recursive: true });
    await page.locator('.social-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(root, '.local/community-check/desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.detail-heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(root, '.local/community-check/mobile-heading.png') });
    await page.locator('.social-panel').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({ path: join(root, '.local/community-check/mobile.png') });
  } finally {
    await browser?.close();
    child.kill();
    await child.exited;
    relay.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);

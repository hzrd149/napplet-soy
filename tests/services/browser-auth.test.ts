import { test, expect } from 'bun:test';
import { chromium } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { matchFilters, type Filter, type NostrEvent } from 'nostr-tools';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { NostrConnectProvider } from 'applesauce-signers/signers/nostr-connect-provider';
import { RelayPool } from 'applesauce-relay';
import type { ServerWebSocket } from 'bun';

test('production sign-in supports memory-only key import, both NIP-46 directions, switching, cancellation and refresh', async () => {
  const root = resolve(import.meta.dir, '../..');
  const directory = await mkdtemp(join(tmpdir(), 'napplet-browser-auth-'));
  const sockets = new Map<ServerWebSocket<unknown>, Map<string, Filter[]>>();
  const events: NostrEvent[] = [];
  const relay = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response()),
    websocket: {
      open(socket) {
        sockets.set(socket, new Map());
      },
      close(socket) {
        sockets.delete(socket);
      },
      message(socket, raw) {
        const [method, value, ...filters] = JSON.parse(String(raw));
        if (method === 'REQ') {
          sockets.get(socket)!.set(value, filters);
          for (const event of events)
            if (matchFilters(filters, event)) socket.send(JSON.stringify(['EVENT', value, event]));
          socket.send(JSON.stringify(['EOSE', value]));
        } else if (method === 'CLOSE') sockets.get(socket)!.delete(value);
        else if (method === 'EVENT') {
          events.push(value);
          socket.send(JSON.stringify(['OK', value.id, true, '']));
          for (const [peer, subs] of sockets)
            for (const [id, filter] of subs)
              if (matchFilters(filter, value)) peer.send(JSON.stringify(['EVENT', id, value]));
        }
      },
    },
  });
  const relayUrl = `ws://127.0.0.1:${relay.port}`;
  const pool = new RelayPool();
  const creator = new PrivateKeySigner();
  const provider = new NostrConnectProvider({ upstream: creator, relays: [relayUrl], pool });
  await provider.start();
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() });
  const port = probe.port;
  probe.stop(true);
  const child = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    cwd: root,
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: String(port),
      SPACE_PUBLICDEV: '0',
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const browser = await chromium.launch();
  try {
    const origin = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(origin)).ok) break;
      } catch {}
      await Bun.sleep(100);
    }
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
    page.setDefaultTimeout(12000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // Bridge only this explicit test host to our local relay, preserving encrypted traffic.
    await page.routeWebSocket(/wss:\/\/(?:relay\.napplet\.soy|signer\.test)\//, (route) => {
      const wire = new WebSocket(relayUrl),
        queued: (string | Buffer)[] = [];
      route.onMessage((message) => {
        if (wire.readyState === 1) wire.send(String(message));
        else queued.push(message);
      });
      wire.onopen = () => queued.splice(0).forEach((message) => wire.send(String(message)));
      wire.onmessage = (event) => route.send(String(event.data));
      route.onClose(() => wire.close());
      wire.onclose = () => route.close();
    });
    await page.goto(origin);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Extension', exact: true }).click();
    await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
    await page.getByText(/Install or unlock a Nostr extension/).waitFor();
    await page.getByRole('button', { name: 'Private key', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Use key for this session' }).isDisabled()).toBe(
      true,
    );
    const imported = new PrivateKeySigner(),
      hex = Buffer.from(imported.key).toString('hex');
    await page.getByLabel('Private key', { exact: true }).fill(hex);
    await page.getByLabel('I understand the risk').check();
    await page.getByRole('button', { name: 'Use key for this session' }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page
      .getByRole('button', { name: `${(await imported.getPublicKey()).slice(0, 6)}…`, exact: true })
      .click();
    await page.getByText('Connected through a key in browser memory').waitFor();
    await page.getByRole('button', { name: 'Private key', exact: true }).click();
    expect(await page.getByLabel('Private key', { exact: true }).inputValue()).toBe('');
    const storage = await page.evaluate(() =>
      JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }),
    );
    expect(storage).not.toContain(hex);
    await page.reload();
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await page.getByRole('button', { name: 'Remote signer', exact: true }).click();
    const first = await page.getByLabel('Connection link', { exact: true }).inputValue();
    expect(new URL(first).searchParams.getAll('relay')).toEqual(['wss://relay.napplet.soy']);
    await page
      .getByRole('img', { name: 'Scan this Nostr Connect pairing code in your signer' })
      .waitFor();
    expect(await page.getByLabel('Bunker URI', { exact: true }).isVisible()).toBe(true);
    expect(await page.getByText(/Saved credentials are encrypted/).count()).toBe(0);
    await page.getByRole('button', { name: 'Change signer relay' }).click();
    await page.getByLabel('Signer relay', { exact: true }).fill('wss://signer.test/');
    await page.getByRole('button', { name: 'Use signer relay' }).click();
    const second = await page.getByLabel('Connection link', { exact: true }).inputValue();
    expect(new URL(first).hostname).not.toBe(new URL(second).hostname);
    expect(new URL(second).searchParams.getAll('relay')).toEqual(['wss://signer.test/']);
    await provider.handleNostrConnectURI(second);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const creatorLabel = `${(await creator.getPublicKey()).slice(0, 6)}…`;
    await page.getByRole('button', { name: creatorLabel, exact: true }).click();
    await page.getByText('Connected through a remote signer').waitFor();
    await page.reload();
    await page.getByRole('button', { name: creatorLabel, exact: true }).click();
    await page.getByText('Connected through a remote signer').waitFor();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await provider.stop();
    provider.client = undefined;
    await provider.start();
    const bunker = new URL(await provider.getBunkerURI());
    bunker.searchParams.delete('relay');
    bunker.searchParams.append('relay', 'wss://signer.test/');
    await page.getByRole('button', { name: 'Remote signer', exact: true }).click();
    await page.getByLabel('Bunker URI', { exact: true }).fill(bunker.href);
    await page.getByRole('button', { name: 'Connect bunker', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: creatorLabel, exact: true }).click();
    await page.getByRole('button', { name: 'Remote signer', exact: true }).click();
    expect(await page.getByLabel('Bunker URI', { exact: true }).inputValue()).toBe('');
    const output = join(root, '.local/identity-check');
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: join(output, 'connected-desktop.png') });
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Private key', exact: true }).click();
    await page.screenshot({ path: join(output, 'private-key-mobile.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    await provider.stop();
    pool.close();
    relay.stop(true);
    child.kill();
    await child.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);

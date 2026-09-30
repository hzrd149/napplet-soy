import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommand } from '../../apps/web/src/lib/creator-commands';
import fixtures from '../../packages/backend/data/catalog.json';
import { matchFilters } from 'nostr-tools';

test('one creator guide retains CLI information and identity opens at its header trigger', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-creator-menu-'));
  const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
    env: {
      PATH: process.env.PATH,
      HOST: '127.0.0.1',
      PORT: '0',
      SPACE_PUBLICDEV: '0',
      SPACE_INDEX_RELAYS: 'wss://relay.example',
      SPACE_COMMUNITY_DIR: join(directory, 'community'),
    },
    stdout: 'pipe',
    stderr: 'inherit',
  });
  const timer = setTimeout(() => server.kill(), 45000);
  const browser = await chromium.launch();
  try {
    let output = '',
      origin = '';
    for await (const chunk of server.stdout) {
      output += new TextDecoder().decode(chunk);
      origin = /listening on (http:\/\/[^\s]+)/.exec(output)?.[1] ?? '';
      if (origin) break;
    }
    origin = new URL(origin).origin;
    const legacy = await fetch(`${origin}/cli?template=tiny-tennis`, { redirect: 'manual' });
    expect(legacy.status).toBe(308);
    const destination = new URL(legacy.headers.get('location')!, origin);
    expect(destination.pathname).toBe('/create');
    expect(destination.searchParams.get('template')).toBe('tiny-tennis');
    const missingDownload = await fetch(`${origin}/cli/download/0.0.0/soyli-darwin-arm64.tar.gz`, {
      redirect: 'manual',
    });
    expect(missingDownload.status).toBe(404);
    expect(missingDownload.headers.has('location')).toBe(false);
    const nojs = await browser.newContext({ javaScriptEnabled: false });
    const staticPage = await nojs.newPage();
    await staticPage.goto(`${origin}/create`);
    for (const text of [
      'No website account needed.',
      'SHA-256 checksum',
      'Node/pnpm',
      'OS credential',
      'Listing',
      'soyli check',
      'eight official Napplet skills',
      'soyli run verify',
      'soyli run test:conformance',
      'soyli skills update',
      '--template',
      'xcode-select --install',
      'Secret Service',
      'D-Bus session',
      'Alpine/musl',
      'libasound2t64',
      'compatibility alias',
      'lib folder',
    ]) {
      await browserExpect(staticPage.locator('.create-page')).toContainText(text);
    }
    expect(await staticPage.locator('.cli-downloads a').count()).toBe(8);
    await staticPage.goto(`${origin}/about`);
    await browserExpect(
      staticPage.getByRole('link', { name: 'napplet.soy on GitHub' }),
    ).toHaveAttribute('href', 'https://github.com/zeSchlausKwab/napplet-soy');
    await nojs.close();

    const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
    page.setDefaultTimeout(8000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${origin}/cli?template=tiny-tennis#downloads`);
    expect(new URL(page.url()).pathname).toBe('/create');
    expect(new URL(page.url()).hash).toBe('#downloads');
    await browserExpect(page.locator('.starter-command code')).toHaveText(
      createCommand('tiny-tennis'),
    );
    const trigger = page.locator('#identity-button');
    await trigger.focus();
    await trigger.press('Enter');
    const menu = page.getByRole('dialog', { name: 'Bring your Nostr identity' });
    await browserExpect(menu).toBeVisible();
    expect(await page.locator('[data-slot="dialog-overlay"]').count()).toBe(0);
    const anchorBox = await trigger.boundingBox(),
      menuBox = await menu.boundingBox();
    expect(menuBox!.y).toBeGreaterThanOrEqual(anchorBox!.y + anchorBox!.height);
    expect(menuBox!.y - anchorBox!.y - anchorBox!.height).toBeLessThan(20);
    expect(Math.abs(menuBox!.x + menuBox!.width - anchorBox!.x - anchorBox!.width)).toBeLessThan(2);
    await mkdir('.local/creator-menu', { recursive: true });
    await page.screenshot({ path: '.local/creator-menu/desktop.png' });
    await page.keyboard.press('Escape');
    await browserExpect(menu).toBeHidden();
    await browserExpect(trigger).toBeFocused();
    await trigger.click();
    await trigger.click();
    await browserExpect(menu).toBeHidden();
    await trigger.click();
    await page.getByRole('button', { name: 'Remote signer', exact: true }).click();
    await page.getByLabel('Bunker URI').fill('bunker://test-only-draft');
    await page.locator('h1').click();
    await browserExpect(menu).toBeHidden();
    await trigger.click();
    await page.getByRole('button', { name: 'Remote signer', exact: true }).click();
    await browserExpect(page.getByLabel('Bunker URI')).toHaveValue('');
    await page.keyboard.press('Escape');

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${origin}/create`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.locator('#downloads').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `.local/creator-menu/downloads-${width}.png` });
      await trigger.click();
      await browserExpect(menu).toBeVisible();
      const box = await menu.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(11);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width - 11);
      expect(box!.y + box!.height).toBeLessThanOrEqual(833);
      await page.screenshot({ path: `.local/creator-menu/menu-${width}.png` });
      await page.keyboard.press('Escape');
    }
    await page.routeWebSocket('wss://**', (socket) =>
      socket.onMessage((raw) => {
        const m = JSON.parse(String(raw));
        if (m[0] === 'REQ') {
          for (const e of [fixtures[0].current, fixtures[0].snapshot])
            if (matchFilters(m.slice(2), e)) socket.send(JSON.stringify(['EVENT', m[1], e]));
          socket.send(JSON.stringify(['EOSE', m[1]]));
        }
      }),
    );
    await page.goto(`${origin}/n/${fixtures[0].naddr}`);
    await page.getByRole('button', { name: 'Connect to comment or like' }).click();
    await browserExpect(menu).toBeVisible();
    expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await trigger.boundingBox())!.y + (await trigger.boundingBox())!.height,
    );
    await page.keyboard.press('Escape');
    await browserExpect(trigger).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    clearTimeout(timer);
    await browser.close();
    server.kill();
    await server.exited;
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);

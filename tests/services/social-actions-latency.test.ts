import { test, expect } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, getPublicKey, matchFilters } from 'nostr-tools';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { directWallet } from '../fixtures/direct-wallet';
import type { SignedEvent } from '../../packages/protocol/src';
import fixtures from '../../packages/backend/data/catalog.json';

// No public relays, accounts or Lightning providers are contacted.
test.each(['composer', 'invoice', 'comment', 'gallery like'] as const)(
  '%s does not wait for unrelated stalled relay work',
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), 'social-actions-latency-'));
    const fixture = fixtures[0];
    const index = new IndexStore(join(directory, 'index'), true);
    index.admit(fixture.current);
    const entry = await publicNapplet(fixture.current, []);
    index.project(
      entry.revisionId,
      { ...entry, availability: 'ready' },
      Date.now() + 60000,
      Date.now() + 60000,
    );
    index.close();
    const server = Bun.spawn([process.execPath, 'apps/web/server.ts'], {
      env: {
        PATH: process.env.PATH,
        HOST: '127.0.0.1',
        PORT: '0',
        SPACE_PUBLICDEV: '0',
        SPACE_INDEX_DIR: join(directory, 'index'),
        SPACE_COMMUNITY_DIR: join(directory, 'community'),
      },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    const guard = setTimeout(() => server.kill(), 20000);
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
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const key = new Uint8Array(32);
      key[31] = 1;
      const events = new Map<string, SignedEvent>([[fixture.current.id, fixture.current]]);
      const wallet = await directWallet(page, events, key, 'wss://fast.example/');
      await page.exposeFunction('testSign', (template: Parameters<typeof finalizeEvent>[0]) =>
        JSON.parse(JSON.stringify(finalizeEvent(template, key))),
      );
      await page.addInitScript((pubkey) => {
        (window as any).nostr = {
          getPublicKey: async () => pubkey,
          signEvent: (template: unknown) => (window as any).testSign(template),
        };
        localStorage.setItem(
          'napplet:network',
          JSON.stringify({
            relays: ['wss://fast.example', 'wss://stalled.example'],
            blossom: [],
          }),
        );
      }, getPublicKey(key));
      let stalled = scenario !== 'comment',
        acceptedAt = 0;
      await page.routeWebSocket(/wss?:\/\//, (route) =>
        route.onMessage((raw) => {
          const m = JSON.parse(String(raw));
          const social =
            m[0] === 'EVENT' ||
            m
              .slice(2)
              .some((f: any) => f.kinds?.some((k: number) => [0, 5, 7, 1111, 9735].includes(k)));
          if (stalled && social && !route.url().includes('fast.example')) return;
          if (m[0] === 'REQ') {
            for (const event of events.values())
              if (matchFilters(m.slice(2), event))
                route.send(JSON.stringify(['EVENT', m[1], event]));
            route.send(JSON.stringify(['EOSE', m[1]]));
          } else if (m[0] === 'EVENT') {
            events.set(m[1].id, m[1]);
            acceptedAt ||= performance.now();
            route.send(JSON.stringify(['OK', m[1].id, true, 'saved']));
          }
        }),
      );
      await page.goto(
        `${new URL(origin).origin}${scenario === 'gallery like' ? '/' : `/r/${fixture.current.id}`}`,
      );
      if (scenario !== 'gallery like')
        await ui(
          page.getByRole('heading', { name: 'Small creation, open conversation.' }),
        ).toBeVisible();
      if (scenario === 'composer') {
        const started = performance.now();
        await ui(page.getByRole('button', { name: 'Connect to comment or like' })).toBeVisible({
          timeout: 1200,
        });
        console.log(
          `Comment composer available in ${Math.round(performance.now() - started)}ms while fallback reads stall.`,
        );
      } else if (scenario === 'invoice') {
        const started = performance.now();
        await page
          .locator('.napplet-social-actions')
          .getByRole('button', { name: `Zap ${fixture.title}`, exact: true })
          .click();
        await ui(page.getByLabel('Satoshis', { exact: true })).toBeVisible({ timeout: 1500 });
        await page
          .getByRole('button', { name: 'Create anonymous zap invoice', exact: true })
          .click();
        await ui.poll(() => wallet.requests.length, { timeout: 1200 }).toBe(1);
        console.log(
          `Invoice requested in ${Math.round(performance.now() - started)}ms while conversation reads stall.`,
        );
      } else if (scenario === 'gallery like') {
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByRole('button', { name: 'Extension', exact: true }).click();
        await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
        const card = page.locator('.napplet-card').first();
        const like = card.getByRole('button', { name: new RegExp(`^Like ${fixture.title}:`) });
        const started = performance.now();
        await like.click();
        await ui.poll(() => acceptedAt, { timeout: 1200 }).toBeGreaterThan(0);
        const unlike = card.getByRole('button', { name: new RegExp(`^Unlike ${fixture.title}:`) });
        await ui(unlike).toHaveAttribute('aria-pressed', 'true', { timeout: 1200 });
        console.log(
          `Gallery like confirmed in ${Math.round(performance.now() - started)}ms while fallback reads and writes stall.`,
        );
        await unlike.click();
        await ui(like).toHaveAttribute('aria-pressed', 'false', { timeout: 1200 });
        expect([...events.values()].filter((e) => e.kind === 7)).toHaveLength(1);
        expect([...events.values()].some((e) => e.kind === 5)).toBe(true);
      } else {
        await page
          .getByRole('button', { name: 'Connect to comment or like' })
          .click({ timeout: 5000 });
        await page.getByRole('button', { name: 'Extension', exact: true }).click();
        await page
          .getByRole('button', { name: 'Connect browser extension', exact: true })
          .click({ timeout: 5000 });
        await page
          .getByLabel('Leave a little note')
          .fill('A fast confirmed comment.', { timeout: 5000 });
        stalled = true;
        await page.getByRole('button', { name: 'Post comment', exact: true }).click();
        await ui.poll(() => acceptedAt, { timeout: 1500 }).toBeGreaterThan(0);
        await ui(
          page.locator('.comment-submit').getByRole('button', { name: 'Posted', exact: true }),
        ).toBeVisible({ timeout: 1200 });
        await ui(page.locator('.comment-list')).toContainText('A fast confirmed comment.', {
          timeout: 1200,
        });
        await ui(page.getByLabel('Leave a little note')).toBeEnabled();
        console.log(
          `Comment confirmed and editable ${Math.round(performance.now() - acceptedAt)}ms after relay acceptance.`,
        );
      }
    } finally {
      await browser.close();
      server.kill();
      await server.exited;
      clearTimeout(guard);
      await rm(directory, { recursive: true, force: true });
    }
  },
  25000,
);

import { test, expect } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, getPublicKey, matchFilters } from 'nostr-tools';
import { IndexStore } from '../../packages/backend/src/index-store';
import { publicNapplet } from '../../packages/backend/src/public-model';
import { sha256 } from '../../packages/protocol/src';
import { freezeFixture } from '../../packages/publish/src/testing';
import fixtures from '../../packages/backend/data/catalog.json';

test.each(['proposals', 'source', 'profile', 'default profile', 'empty proposals'])(
  '%s renders useful relay data without serial stalled-relay deadlines',
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), 'protocol-read-latency-'));
    const key = new Uint8Array(32);
    key[31] = 1;
    const pubkey = getPublicKey(key),
      now = Math.floor(Date.now() / 1000);
    const sign = (kind: number, tags: string[][], content = '', created_at = now) =>
      finalizeEvent({ kind, tags, content, created_at }, key);
    await freezeFixture(
      join(directory, 'frozen'),
      new Map([
        ['README.md', new TextEncoder().encode('# Useful source, immediately')],
        ['src/main.ts', new TextEncoder().encode('export const game = 42;')],
      ]),
      now,
    );
    const archive = await Bun.file(join(directory, 'frozen/source.tar')).bytes();
    const archiveHash = await sha256(archive);
    const repo = sign(30617, [
      ['d', 'quick-repo'],
      ['clone', 'https://git.example/game.git'],
    ]);
    const address = `30617:${pubkey}:quick-repo`;
    const proposal = sign(
      1618,
      [
        ['a', address],
        ['subject', 'Make the game faster'],
        ['c', 'a'.repeat(40)],
        ['clone', 'https://git.example/game.git'],
      ],
      'A useful proposal.',
    );
    const status = sign(1631, [['e', proposal.id, '', 'root']], 'Merged', now + 1);
    const profile = sign(
      0,
      [],
      JSON.stringify({ name: 'Quick Creator', picture: 'https://images.example/creator.png' }),
    );
    const manifest = finalizeEvent(
      {
        ...fixtures[0].current,
        created_at: now,
        tags: [
          ...fixtures[0].current.tags.filter((t) => !['source', 'source-archive'].includes(t[0])),
          ['source', `nostr://${address}`],
          ['source-archive', `https://files.example/${archiveHash}.tar`],
        ],
      },
      key,
    );
    const events =
      scenario === 'empty proposals'
        ? [manifest, repo, profile]
        : [manifest, repo, proposal, status, profile];
    const index = new IndexStore(join(directory, 'index'), true);
    index.admit(manifest);
    index.project(
      manifest.id,
      { ...(await publicNapplet(manifest, [])), availability: 'ready' },
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
    const guard = setTimeout(() => server.kill(), 25000);
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
      if (scenario !== 'default profile')
        await page.addInitScript(() =>
          localStorage.setItem(
            'napplet:network',
            JSON.stringify({
              relays: ['wss://fast.example', 'wss://stalled.example'],
              blossom: [],
            }),
          ),
        );
      if (scenario === 'empty proposals' || scenario === 'default profile')
        await page.addInitScript((pubkey) => {
          (window as any).nostr = {
            getPublicKey: async () => pubkey,
            signEvent: async () => {
              throw new Error('This fixture does not publish.');
            },
          };
        }, pubkey);
      await page.route('https://files.example/**', (route) =>
        route.fulfill({
          body: Buffer.from(archive),
          headers: { 'access-control-allow-origin': '*' },
        }),
      );
      await page.route('https://images.example/creator.png', (route) =>
        route.fulfill({
          body: Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA1kAAAAASUVORK5CYII=',
            'base64',
          ),
          contentType: 'image/png',
        }),
      );
      let proposalRootReads = 0;
      await page.routeWebSocket(/wss?:\/\//, (route) =>
        route.onMessage((raw) => {
          const m = JSON.parse(String(raw));
          if (m[0] !== 'REQ') return;
          // The reported profile is absent from the old defaults. Only an
          // additional general-purpose default has it; the rest complete empty
          // or stall. No saved browser network override can hide this regression.
          if (scenario === 'default profile') {
            if (route.url().includes('relay.nos.social')) {
              if (matchFilters(m.slice(2), profile))
                route.send(JSON.stringify(['EVENT', m[1], profile]));
            } else if (route.url().includes('relay.primal.net')) return;
            route.send(JSON.stringify(['EOSE', m[1]]));
            return;
          }
          if (!route.url().includes('fast.example')) return;
          if (m.slice(2).some((f: any) => f.kinds?.includes(1618))) proposalRootReads++;
          for (const event of events)
            if (matchFilters(m.slice(2), event)) route.send(JSON.stringify(['EVENT', m[1], event]));
          route.send(JSON.stringify(['EOSE', m[1]]));
        }),
      );
      await page.goto(
        new URL(
          scenario === 'proposals'
            ? `/proposals/${proposal.id}`
            : scenario === 'profile'
              ? '/'
              : `/r/${manifest.id}`,
          origin,
        ).href,
      );
      const started = performance.now();
      if (scenario === 'proposals') {
        await ui(page.getByRole('button', { name: /Make the game faster/ })).toBeVisible({
          timeout: 1500,
        });
        await ui(page.getByRole('button', { name: /Make the game faster/ })).toContainText(
          'merged',
          { timeout: 1500 },
        );
      } else if (scenario === 'empty proposals') {
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByRole('button', { name: 'Extension', exact: true }).click();
        await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
        await page.locator('#napplet-comment').fill('Keep this draft through relay hydration.');
        await ui(page.getByText(/No proposals yet\./)).toBeVisible({ timeout: 5000 });
        await ui(page.getByRole('button', { name: 'Refresh proposals' })).toBeEnabled();
        await ui(page.locator('#napplet-comment')).toHaveValue(
          'Keep this draft through relay hydration.',
        );
        expect(proposalRootReads).toBe(1);
      } else if (scenario === 'profile') {
        await ui(
          page.locator('.napplet-card').first().getByText('Quick Creator', { exact: true }),
        ).toBeVisible({ timeout: 1500 });
      } else if (scenario === 'default profile') {
        const creator = page.locator('.detail-heading .nostr-creator');
        await ui(creator).toContainText('Quick Creator', { timeout: 1500 });
        await ui(creator.locator('img')).toHaveAttribute(
          'src',
          'https://images.example/creator.png',
        );
        await page.getByRole('button', { name: 'Connect', exact: true }).click();
        await page.getByRole('button', { name: 'Extension', exact: true }).click();
        await page.getByRole('button', { name: 'Connect browser extension', exact: true }).click();
        await ui(page.locator('#identity-button')).toContainText('Quick Creator');
        await ui(page.locator('#identity-button img')).toHaveAttribute(
          'src',
          'https://images.example/creator.png',
        );
      } else {
        await ui(page.getByRole('link', { name: 'Browse source', exact: true })).toBeVisible();
        const navigation = performance.now();
        await page.getByRole('link', { name: 'Browse source', exact: true }).click();
        await ui(page.getByLabel('Source code for README.md')).toContainText('Useful source', {
          timeout: 4500,
        });
        expect(performance.now() - navigation).toBeLessThan(5000);
        const next = performance.now();
        await page
          .getByRole('navigation', { name: 'Project files' })
          .getByRole('link', { name: 'main.ts', exact: true })
          .click();
        await ui(page.getByLabel('Source code for src/main.ts')).toContainText('game = 42', {
          timeout: 1000,
        });
        expect(performance.now() - next).toBeLessThan(1500);
      }
      console.log(`${scenario} useful content: ${Math.round(performance.now() - started)}ms`);
    } finally {
      clearTimeout(guard);
      await browser.close();
      server.kill();
      await server.exited;
      await rm(directory, { recursive: true, force: true });
    }
  },
  30000,
);

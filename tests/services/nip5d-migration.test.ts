import { expect, test } from 'bun:test';
import { chromium, expect as ui } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrivateKeySigner } from 'applesauce-signers/signers/private-key-signer';
import { buildRelay, relayBinary } from '../../scripts/relay';
import { createBlossom } from '../../services/blossom/server';
import { uploadBlob } from '../../packages/blossom/src/client';
import { PublicationRelays } from '../../packages/publish/src/relay';
import {
  aggregateHash,
  encodeAddress,
  sha256,
  type SignedEvent,
} from '../../packages/protocol/src';
import { IndexStore } from '../../packages/backend/src/index-store';
import sharp from 'sharp';
import { LifecycleTransport } from '../../packages/lifecycle/src/transport';

// Independently authored wire fixtures for dskvr/nips PR 7 at
// 4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51. This checks our deployed bundle,
// not an independent client's support for that newer protocol revision.
test('legacy and standalone wire manifests migrate through relay, Blossom, index and production browser', async () => {
  const root = resolve(import.meta.dir, '../..');
  const directory = await mkdtemp(join(tmpdir(), 'napplet-nip5d-migration-'));
  const children: ReturnType<typeof Bun.spawn>[] = [];
  const relays = new PublicationRelays();
  let blossom: Awaited<ReturnType<typeof createBlossom>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let store: IndexStore | undefined;
  async function service(args: string[], env: Record<string, string>, pattern: RegExp) {
    const child = Bun.spawn(args, {
      cwd: root,
      env: { PATH: process.env.PATH, ...env },
      stdout: 'pipe',
      stderr: 'inherit',
    });
    children.push(child);
    const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
    const reader = child.stdout.getReader();
    let output = '';
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) throw new Error(`Service exited before listening: ${output}`);
        output += new TextDecoder().decode(result.value);
        const match = pattern.exec(output);
        if (match) return match[1];
      }
    } finally {
      clearTimeout(timer);
      reader.releaseLock();
      void (async () => {
        for await (const _ of child.stdout) {
          /* drain */
        }
      })();
    }
  }
  try {
    await buildRelay();
    const relayOrigin = await service(
      [relayBinary],
      {
        SPACE_SERVICE_DATA: join(directory, 'relay'),
        SPACE_SERVICE_BIND: '127.0.0.1:0',
        SPACE_SERVICE_URL: 'http://127.0.0.1/relay',
        SPACE_SERVICE_INSTANCE: 'migration-test',
      },
      /listening on (http:\/\/127\.0\.0\.1:\d+)/,
    );
    const relay = `${relayOrigin.replace('http:', 'ws:')}/relay`;
    blossom = await createBlossom({
      directory: join(directory, 'blossom'),
      origin: 'http://127.0.0.1:19348',
      local: true,
      port: 0,
      instance: 'migration-test',
      build: 'test',
    });
    const origin = `http://127.0.0.1:${blossom.server.port}`;
    const bytes = new TextEncoder().encode(`<!doctype html><title>Wire fixture</title>
      <h1>Wire fixture loaded</h1><output id="saved">Loading</output><button id="save">Save progress</button>
      <script>(async()=>{
        const environment=await napplet.shell.ready();
        document.body.dataset.dataScope=environment.capabilities.appData.scope;
        const read=async()=>{document.querySelector('#saved').textContent=(await napplet.storage.getItem('migration-save'))||'empty';};
        await read(); document.body.dataset.ready='yes';
        document.querySelector('#save').onclick=async()=>{await napplet.storage.setItem('migration-save','saved');await read();};
      })().catch(error=>{document.querySelector('#saved').textContent='ERROR '+error.message});</script>`);
    const hash = await sha256(bytes),
      aggregate = await aggregateHash([{ path: '/index.html', hash }]);
    const signer = new PrivateKeySigner(),
      other = new PrivateKeySigner();
    const author = await signer.getPublicKey(),
      otherAuthor = await other.getPublicKey();
    await uploadBlob({ origin, bytes, type: 'text/html', signer, local: true });
    const iconBytes = await sharp({
      create: { width: 1, height: 1, channels: 4, background: '#f06040' },
    })
      .png()
      .toBuffer();
    const iconHash = await sha256(iconBytes);
    await uploadBlob({ origin, bytes: iconBytes, type: 'image/png', signer, local: true });
    const created = Math.floor(Date.now() / 1000) - 30;
    const oldTags = (title: string) => [
      ['title', title],
      ['description', 'Legacy description'],
      ['path', '/index.html', hash],
      ['x', aggregate, 'aggregate'],
      ['server', origin],
      ['requires', 'storage'],
    ];
    const legacyNamed = await signer.signEvent({
      kind: 35129,
      created_at: created,
      content: '',
      tags: [...oldTags('Legacy named'), ['d', 'migration']],
    });
    const legacyRoot = await other.signEvent({
      kind: 15129,
      created_at: created,
      content: '',
      tags: oldTags('Legacy root'),
    });
    const parentAddress = `35129:${author}:migration`;
    const legacySnapshot = await signer.signEvent({
      kind: 5129,
      created_at: created,
      content: '',
      tags: [...oldTags('Legacy snapshot'), ['a', parentAddress]],
    });
    const description =
      'Plain text <script>window.__manifestMarkupExecuted=true</script> & content';
    const standalone = async (
      kind: 35129 | 15129 | 5129,
      title: string,
      d = '',
      extra: string[][] = [],
      owner = signer,
    ) =>
      owner.signEvent({
        kind,
        created_at: created + 1,
        content: description,
        tags: [
          ['title', title],
          ['x', hash],
          ['server', origin],
          ['R', 'storage'],
          ...(kind === 35129 ? [['d', d]] : []),
          ...extra,
        ],
      });
    const newNamed = await standalone(35129, 'Standalone named', 'migration', [
      ['O', 'connect'],
      ['icon', iconHash, 'image/png'],
    ]);
    const newRoot = await standalone(15129, 'Standalone root', '', [], other);
    const pairedSnapshot = await signer.signEvent({
      ...newNamed,
      kind: 5129,
      tags: newNamed.tags.filter((tag) => tag[0] !== 'd'),
    });
    const freeSnapshot = await standalone(5129, 'Independent snapshot', '', [
      ['z', 'feed'],
      ['i', 'napplet:feed/open'],
    ]);
    const sameAuthorChild = await standalone(5129, 'Same-author descendant', '', [
      ['a', parentAddress],
    ]);
    const foreignChild = await standalone(
      5129,
      'Cross-author descendant',
      '',
      [['a', parentAddress]],
      other,
    );
    const required = await standalone(35129, 'Unsupported required', 'unsupported', [
      ['R', 'connect'],
    ]);
    const badIcon = await standalone(35129, 'Invalid icon fallback', 'bad-icon', [
      ['icon', hash, 'image/png'],
    ]);
    const env = {
      SPACE_INDEX_DIR: join(directory, 'index'),
      SPACE_INDEX_RELAYS: relay,
      SPACE_INDEX_LOCAL_BLOSSOM: origin,
      SPACE_RELEASE_ID: 'migration-test',
    };
    new IndexStore(env.SPACE_INDEX_DIR, true).close();
    store = new IndexStore(env.SPACE_INDEX_DIR);
    for (const event of [legacyNamed, legacyRoot, legacySnapshot])
      await relays.ensure(relay, event);
    const worker = Bun.spawn([process.execPath, 'services/indexer/index.ts'], {
      cwd: root,
      env: { PATH: process.env.PATH, ...env },
      stdout: 'ignore',
      stderr: 'inherit',
    });
    children.push(worker);
    const site = await service(
      [process.execPath, 'apps/web/server.ts'],
      { ...env, PORT: '0', HOST: '127.0.0.1', SPACE_PUBLICDEV: '0' },
      /listening on (http:\/\/127\.0\.0\.1:\d+)/,
    );
    const projected = async (event: SignedEvent, availability = 'ready') => {
      await ui
        .poll(
          () => {
            const row = store!.revision(event.id);
            return row?.projection ? JSON.parse(row.projection).availability : null;
          },
          { timeout: 30000, intervals: [100, 300, 1000] },
        )
        .toBe(availability);
    };
    for (const event of [legacyNamed, legacyRoot, legacySnapshot]) await projected(event);
    const namedPath = `/n/${encodeAddress({ kind: 35129, pubkey: author, identifier: 'migration' }, [relay])}`;
    const rootPath = `/n/${encodeAddress({ kind: 15129, pubkey: otherAuthor, identifier: '' }, [relay])}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1365, height: 1000 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const play = async (path: string, title: string) => {
      await page.goto(site + path);
      try {
        await page.getByRole('button', { name: `Start ${title}`, exact: true }).click();
      } catch (error) {
        const id = path.startsWith('/r/') ? path.slice(3) : undefined;
        console.error(
          'Migration playback failed',
          JSON.stringify({
            path,
            title,
            body: (await page.locator('body').textContent())?.slice(0, 3000),
            archived: id ? store?.revision(id) : undefined,
            manifestAPI: id
              ? await (await fetch(`${site}/api/manifest?reference=${id}`)).text()
              : undefined,
          }),
        );
        throw error;
      }
      const frame = page.frameLocator('iframe');
      await ui(frame.locator('body')).toHaveAttribute('data-ready', 'yes');
      expect(await page.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
      return frame;
    };
    let frame = await play(namedPath, 'Legacy named');
    await frame.getByRole('button', { name: 'Save progress' }).click();
    await ui(frame.locator('#saved')).toHaveText('saved');
    const oldScope = await frame.locator('body').getAttribute('data-data-scope');
    frame = await play(`/r/${legacySnapshot.id}`, 'Legacy snapshot');
    await ui(frame.locator('#saved')).toHaveText('saved');
    frame = await play(rootPath, 'Legacy root');
    await frame.getByRole('button', { name: 'Save progress' }).click();
    await ui(frame.locator('#saved')).toHaveText('saved');
    for (const event of [
      newNamed,
      newRoot,
      pairedSnapshot,
      freeSnapshot,
      sameAuthorChild,
      foreignChild,
      required,
      badIcon,
    ])
      await relays.ensure(relay, event);
    for (const event of [
      newNamed,
      newRoot,
      pairedSnapshot,
      freeSnapshot,
      sameAuthorChild,
      foreignChild,
      badIcon,
    ])
      await projected(event);
    await projected(required, 'host-required');
    frame = await play(namedPath, 'Standalone named');
    await ui(frame.locator('#saved')).toHaveText('saved');
    expect(await frame.locator('body').getAttribute('data-data-scope')).toBe(oldScope);
    expect(await page.evaluate(() => (window as any).__manifestMarkupExecuted)).toBeUndefined();
    expect(await page.locator('body').textContent()).toContain(description);
    frame = await play(rootPath, 'Standalone root');
    await ui(frame.locator('#saved')).toHaveText('saved');
    // An exact named-event link keeps the named backend/state identity too.
    frame = await play(`/r/${newNamed.id}`, 'Standalone named');
    await ui(frame.locator('#saved')).toHaveText('saved');
    // Coalescing identical list presentation never grants the paired snapshot
    // its named release's saved state or stable app-data namespace.
    frame = await play(`/r/${pairedSnapshot.id}`, 'Standalone named');
    await ui(frame.locator('#saved')).toHaveText('empty');
    expect(await frame.locator('body').getAttribute('data-data-scope')).not.toBe(oldScope);
    for (const event of [freeSnapshot, sameAuthorChild, foreignChild]) {
      frame = await play(`/r/${event.id}`, event.tags.find((t) => t[0] === 'title')![1]);
      await ui(frame.locator('#saved')).toHaveText('empty');
      expect(await frame.locator('body').getAttribute('data-data-scope')).not.toBe(oldScope);
    }
    await page.goto(`${site}/r/${required.id}`);
    await ui(page.getByText('This one needs more capabilities.', { exact: true })).toBeVisible();
    expect(await page.locator('iframe').count()).toBe(0);
    frame = await play(`/r/${badIcon.id}`, 'Invalid icon fallback');
    await ui(frame.locator('#saved')).toHaveText('empty');
    await page.goto(site);
    for (const title of [
      'Standalone named',
      'Standalone root',
      'Independent snapshot',
      'Same-author descendant',
      'Cross-author descendant',
      'Invalid icon fallback',
    ])
      await ui(page.locator('.napplet-card').filter({ hasText: title })).toHaveCount(1);
    const goodImage = page
      .locator('.napplet-card')
      .filter({ hasText: 'Standalone named' })
      .locator('img');
    await ui
      .poll(
        () =>
          goodImage.evaluate((image) => ({
            width: (image as HTMLImageElement).naturalWidth,
            source: (image as HTMLImageElement).src,
          })),
        { timeout: 15000 },
      )
      .toMatchObject({ width: 1 });
    expect(await goodImage.getAttribute('src')).toMatch(/^(blob:|\/api\/previews\/)/);
    const fallback = page
      .locator('.napplet-card')
      .filter({ hasText: 'Invalid icon fallback' })
      .locator('img');
    await ui(fallback).toHaveAttribute('src', new RegExp(`/api/og/${badIcon.id}`));
    await page.getByText('More filters', { exact: true }).click();
    for (const label of [
      'What it does',
      'Accepted intent',
      'Required capability',
      'Optional integration',
    ])
      await ui(page.getByRole('combobox', { name: label, exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'What it does', exact: true }).selectOption('feed');
    await ui(page).toHaveURL(/archetype=feed/);
    await ui(page.locator('.napplet-card')).toHaveCount(1);
    await ui(page.locator('.napplet-card')).toContainText('Independent snapshot');
    await page
      .getByRole('combobox', { name: 'Accepted intent', exact: true })
      .selectOption('napplet:feed/open');
    await ui(page).toHaveURL(/intent=napplet%3Afeed%2Fopen/);
    await page.getByRole('button', { name: 'Clear these filters', exact: true }).click();
    await page.getByText('More filters', { exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Optional integration', exact: true })
      .selectOption('connect');
    await ui(page).toHaveURL(/optionalDomain=connect/);
    await ui(page.locator('.napplet-card')).toHaveCount(1);
    await ui(page.locator('.napplet-card')).toContainText('Standalone named');
    expect(errors).toEqual([]);
    expect(await (await fetch(`${origin}/${hash}`)).bytes()).toEqual(bytes);
    expect(await (await fetch(`${origin}/${iconHash}`)).bytes()).toEqual(iconBytes);
    const advanced = await signer.signEvent({
      ...newNamed,
      created_at: created + 2,
      tags: newNamed.tags.map((tag) =>
        tag[0] === 'title' ? ['title', 'Advanced standalone named'] : tag,
      ),
    });
    const advancedSnapshot = await signer.signEvent({
      ...advanced,
      kind: 5129,
      tags: advanced.tags.filter((tag) => tag[0] !== 'd'),
    });
    await relays.ensure(relay, advanced);
    await relays.ensure(relay, advancedSnapshot);
    await projected(advanced);
    await projected(advancedSnapshot);
    const archivedGallery = await (await fetch(site)).text();
    expect(archivedGallery).toContain('>Advanced standalone named</a>');
    expect(archivedGallery).not.toContain('>Standalone named</a>');
    frame = await play(namedPath, 'Advanced standalone named');
    await ui(frame.locator('#saved')).toHaveText('saved');
    frame = await play(`/r/${newNamed.id}`, 'Standalone named');
    await ui(frame.locator('#saved')).toHaveText('saved');
    // A new document has no in-memory manifest cache. Navigate within the SPA
    // after replacement so the relay-pruned revision must come from the signed
    // index response, rather than the initial document's server rendering.
    const freshContext = await browser.newContext({
      storageState: await page.context().storageState(),
      reducedMotion: 'reduce',
    });
    try {
      const fresh = await freshContext.newPage();
      fresh.on('pageerror', (error) => errors.push(error.message));
      await fresh.goto(`${site}/about`);
      await ui(fresh.locator('#identity-button')).toBeEnabled();
      const indexedResponse = fresh.waitForResponse(
        (response) => response.url() === `${site}/api/manifest?reference=${newNamed.id}`,
      );
      await fresh.evaluate((id) => {
        (window as any).__migrationDocument = true;
        window.history.pushState(null, '', `/r/${id}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, newNamed.id);
      expect((await indexedResponse).status()).toBe(200);
      await fresh.getByRole('button', { name: 'Start Standalone named', exact: true }).click();
      const restored = fresh.frameLocator('iframe');
      await ui(restored.locator('body')).toHaveAttribute('data-ready', 'yes');
      await ui(restored.locator('#saved')).toHaveText('saved');
      expect(await restored.locator('body').getAttribute('data-data-scope')).toBe(oldScope);
      expect(await fresh.evaluate(() => (window as any).__migrationDocument)).toBe(true);
    } finally {
      await freshContext.close();
    }
    // A fresh author shell has no publisher journal or saved lifecycle receipt.
    // The reviewed inventory combines current relay pairs with signed retained
    // history, while independent same-author snapshots remain untouched.
    const authorContext = await browser.newContext();
    let signedRemovals = 0;
    await authorContext.exposeBinding('signMigrationFixture', async (_source, template) => {
      if (template.kind === 5) signedRemovals++;
      return signer.signEvent(template);
    });
    await authorContext.addInitScript((pubkey) => {
      (window as any).nostr = {
        getPublicKey: async () => pubkey,
        signEvent: async (template: unknown) => (window as any).signMigrationFixture(template),
      };
    }, author);
    try {
      const authorPage = await authorContext.newPage();
      authorPage.on('pageerror', (error) => errors.push(error.message));
      await authorPage.goto(site + namedPath);
      await authorPage.locator('#identity-button').click();
      await authorPage.getByRole('button', { name: 'Extension', exact: true }).click();
      await authorPage.getByRole('button', { name: 'Connect browser extension' }).click();
      await authorPage.getByRole('button', { name: 'Manage publication' }).click();
      const historyResponse = authorPage.waitForResponse((response) =>
        response.url().includes('/api/lifecycle-history?'),
      );
      await authorPage.getByRole('button', { name: 'Unpublish', exact: true }).click();
      expect((await historyResponse).status()).toBe(200);
      await ui(
        authorPage.getByRole('button', { name: 'Confirm unpublish', exact: true }),
      ).toBeDisabled();
      await authorPage.getByText(/^Selected signed releases/).click();
      await ui(authorPage.locator('code').filter({ hasText: pairedSnapshot.id })).toBeVisible();
      await ui(authorPage.locator('code').filter({ hasText: advancedSnapshot.id })).toBeVisible();
      expect(signedRemovals).toBe(0);
      await authorPage.getByRole('checkbox').check();
      await authorPage.getByRole('button', { name: 'Confirm unpublish', exact: true }).click();
      await ui(
        authorPage.getByRole('status').filter({ hasText: 'Listing unpublished' }),
      ).toBeVisible();
      expect(signedRemovals).toBe(1);
      const inventory = new LifecycleTransport();
      try {
        const remaining = await inventory.read(relay, {
          ids: [
            advanced.id,
            newNamed.id,
            pairedSnapshot.id,
            advancedSnapshot.id,
            freeSnapshot.id,
            sameAuthorChild.id,
          ],
          limit: 20,
        });
        expect(remaining.map((event) => event.id).sort()).toEqual(
          [freeSnapshot.id, sameAuthorChild.id].sort(),
        );
      } finally {
        inventory.close();
      }
      await ui
        .poll(
          () =>
            store!.removed(advanced) &&
            store!.removed(pairedSnapshot) &&
            store!.removed(advancedSnapshot),
        )
        .toBe(true);
      await authorPage.goto(site);
      await ui(
        authorPage.getByRole('link', { name: 'Independent snapshot', exact: true }),
      ).toBeVisible();
      await ui(authorPage.getByRole('link', { name: 'Standalone named', exact: true })).toHaveCount(
        0,
      );
      await ui(
        authorPage.getByRole('link', { name: 'Advanced standalone named', exact: true }),
      ).toHaveCount(0);
    } finally {
      await authorContext.close();
    }
    expect(errors).toEqual([]);
  } finally {
    store?.close();
    relays.close();
    await browser?.close();
    for (const child of children) {
      if (child.exitCode !== null) continue;
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
      await child.exited;
      clearTimeout(timer);
    }
    await blossom?.close(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 180000);

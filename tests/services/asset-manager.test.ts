import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importAsset, readAssets } from '../../packages/assets/src';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';

test('manager saves files and the real sandbox decodes media and data packs through local and remote resource hosts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-manager-browser-'));
  let server: ReturnType<typeof startPreviewServer> | undefined;
  let remote: ReturnType<typeof Bun.serve> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const config = {
      schema: 'space-local-project/v1',
      name: 'Asset playground',
      entry: 'index.html',
      license: 'MIT',
      previewId: crypto.randomUUID(),
      preview: { delayMs: 250 },
    };
    await Bun.write(join(root, 'napplet.json'), JSON.stringify(config));
    await Bun.write(join(root, 'LICENSE'), 'MIT');
    const png = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const wav = Buffer.alloc(44 + 16000);
    wav.write('RIFF');
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24);
    wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write('data', 36);
    wav.writeUInt32LE(16000, 40);
    const fontPath = 'node_modules/@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2';
    const files = [
      ['picture', png],
      ['sound', wav],
      ['typeface', await Bun.file(fontPath).bytes()],
      ['movie', await Bun.file('tests/fixtures/preview.webm').bytes()],
      ['pack', new Uint8Array([83, 83, 82, 67, 0, 1, 255, 128, 10, 42])],
      ['levels', new TextEncoder().encode('{"level":7}')],
      ['dialogue', new TextEncoder().encode('Hello — 你好')],
    ] as const;
    for (const [id, bytes] of files)
      await importAsset(root, { id, bytes, storage: 'external', license: 'fixture' });
    await Bun.write(
      join(root, 'probe.js'),
      `import {assetUrl, assetBlob} from './soy-assets.js';
      window.probe = async () => {
        const image = new Image(); image.src = await assetUrl('picture'); await image.decode();
        const font = new FontFace('ManagedFont', 'url(' + await assetUrl('typeface') + ')'); await font.load(); document.fonts.add(font);
        const audio = new Audio(await assetUrl('sound')); await new Promise((ok,fail)=>{audio.onloadeddata=ok;audio.onerror=fail;audio.load();});
        const video = document.createElement('video'); video.muted=true; video.src=await assetUrl('movie'); await new Promise((ok,fail)=>{video.onloadeddata=ok;video.onerror=fail;video.load();});
        const pack = Array.from(new Uint8Array(await (await assetBlob('pack')).arrayBuffer()));
        const levels = JSON.parse(await (await assetBlob('levels')).text());
        const dialogue = await (await assetBlob('dialogue')).text();
        document.querySelector('output').textContent=JSON.stringify({image:image.naturalWidth,font:font.status,audio:audio.duration,video:video.videoWidth,pack,levels,dialogue});
      };`,
    );
    const built = await Bun.build({
      entrypoints: [join(root, 'probe.js')],
      target: 'browser',
      minify: true,
    });
    expect(built.success).toBe(true);
    const html = `<!doctype html><style>body{background:#e7ecd9;font:24px sans-serif;padding:24px}output{display:block;margin-top:24px}</style><h1>Assets in action</h1><button onclick="probe().catch(e=>document.querySelector('output').textContent=e.message)">Try assets</button><output></output><script>${await built.outputs[0].text()}</script>`;
    await Bun.write(join(root, 'index.html'), html);
    server = startPreviewServer(pathToFileURL(root + '/'), 0, false, await previewAssets(), {
      network: 'local',
    });
    expect((await fetch(new URL('/manager', server.url))).status).toBe(403);
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1320, height: 1000 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url.href);
    const token = await page.locator('meta[name=soyli-token]').getAttribute('content');
    expect(
      (
        await fetch(new URL('/manager', server.url), {
          method: 'POST',
          headers: { Origin: 'https://untrusted.invalid', 'X-Soyli-Token': token! },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await fetch(new URL('/manager', server.url), {
          method: 'POST',
          headers: { Origin: server.url.origin },
          body: '{}',
        })
      ).status,
    ).toBe(403);
    expect((await fetch(new URL('/manager/presentation?file=LICENSE', server.url))).status).toBe(
      404,
    );
    await page.frameLocator('iframe').getByRole('button', { name: 'Try assets' }).click();
    await browserExpect
      .poll(async () => page.frameLocator('iframe').locator('output').textContent())
      .toContain('"font":"loaded"');
    const decoded = JSON.parse(
      (await page.frameLocator('iframe').locator('output').textContent())!,
    );
    expect(decoded).toMatchObject({ image: 1, font: 'loaded', audio: 1 });
    expect(decoded.video).toBeGreaterThan(0);
    expect(decoded.pack).toEqual(Array.from(files[4][1]));
    expect(decoded.levels).toEqual({ level: 7 });
    expect(decoded.dialogue).toBe('Hello — 你好');
    await page.getByRole('button', { name: 'Manage project' }).click();
    await page.getByLabel('Display title', { exact: true }).fill('My little asset laboratory');
    await page.getByRole('button', { name: 'Save project', exact: true }).click();
    await page.getByText('Saved to project files.', { exact: false }).waitFor();
    expect((await Bun.file(join(root, 'napplet.json')).json()).title).toBe(
      'My little asset laboratory',
    );
    await page.getByLabel('Choose a file', { exact: true }).setInputFiles({
      name: 'extra.ssrcpack',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from(files[4][1]),
    });
    await page.getByLabel('Asset name · e.g. jump-sound', { exact: true }).fill('extra');
    await page.getByRole('button', { name: 'Add asset', exact: true }).click();
    const extra = page
      .locator('.asset-card')
      .filter({ has: page.getByRole('heading', { name: 'extra', exact: true }) });
    await extra.getByRole('button', { name: 'Embed instead' }).click();
    await extra.getByRole('button', { name: 'Use Blossom' }).waitFor();
    expect((await readAssets(root)).assets.find((a) => a.id === 'extra')?.storage).toBe('embedded');
    expect((await readAssets(root)).assets.find((a) => a.id === 'extra')?.mime).toBe(
      'application/octet-stream',
    );
    await Bun.write(join(root, 'preview-cover.png'), png);
    await page.getByRole('button', { name: 'Reload from files' }).click();
    // The file write can finish before the browser receives the refreshed form.
    // Keep that interval observable so the next edit cannot race the response.
    await page.route('**/manager', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.continue();
      const action = request.postDataJSON();
      if (action.action !== 'select' || action.kind !== 'image') return route.continue();
      const response = await route.fetch();
      await Bun.sleep(500);
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Use as cover' }).click();
    await browserExpect
      .poll(async () => (await Bun.file(join(root, 'napplet.json')).json()).preview.image)
      .toBe('preview-cover.png');
    await browserExpect(
      page.getByRole('combobox', { name: 'Cover image', exact: true }),
    ).toHaveValue('preview-cover.png');
    await page.getByLabel('Assets · Blossom', { exact: true }).fill('http://127.0.0.1:9234');
    await page.getByRole('button', { name: 'Save destinations' }).click();
    await browserExpect
      .poll(
        async () =>
          (
            await Bun.file(join(root, '.napplet-space/project.json'))
              .json()
              .catch(() => null)
          )?.project.publish.networks.local.blossom,
      )
      .toBe('http://127.0.0.1:9234');
    await mkdir('.local/manager', { recursive: true });
    await page.screenshot({ path: '.local/manager/desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: '.local/manager/mobile.png', fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
    // Same artifact without local managed files: host fetches hashes from a plain Blossom origin.
    const map = new Map<string, Uint8Array>();
    for (const asset of (await readAssets(root)).assets)
      map.set('/' + asset.hash, await Bun.file(join(root, asset.path)).bytes());
    const hits: string[] = [];
    remote = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        hits.push(path);
        return new Response(map.has(path) ? new Uint8Array(map.get(path)!) : null, {
          status: map.has(path) ? 200 : 404,
          headers: { 'Access-Control-Allow-Origin': '*' },
        });
      },
    });
    server.stop(true);
    const remoteRoot = join(root, 'independent');
    await mkdir(remoteRoot);
    await Bun.write(
      join(remoteRoot, 'napplet.json'),
      JSON.stringify({ ...config, servers: [remote.url.origin] }),
    );
    await Bun.write(join(remoteRoot, 'index.html'), html);
    server = startPreviewServer(pathToFileURL(remoteRoot + '/'), 0, false, await previewAssets());
    await page.goto(server.url.href);
    await page.frameLocator('iframe').getByRole('button', { name: 'Try assets' }).click();
    await browserExpect
      .poll(async () => page.frameLocator('iframe').locator('output').textContent())
      .toContain('"font":"loaded"');
    const remoteDecoded = JSON.parse(
      (await page.frameLocator('iframe').locator('output').textContent())!,
    );
    expect(remoteDecoded.pack).toEqual(decoded.pack);
    expect(remoteDecoded.levels).toEqual(decoded.levels);
    expect(remoteDecoded.dialogue).toBe(decoded.dialogue);
    expect(new Set(hits).size).toBe(7);
  } finally {
    await browser?.close();
    server?.stop(true);
    remote?.stop(true);
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

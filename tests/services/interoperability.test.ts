import { test, expect } from 'bun:test';
import { chromium, expect as browserExpect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools';
import { stack } from './publish-stack';
import { Journal } from '../../packages/publish/src/journal';
import { ProtocolClient } from '../../packages/client/src/nostr';
import { loadRemix, createRemix } from '../../packages/remix/src';
import { startPreviewServer } from '../../apps/cli/src/preview/server';
import { previewAssets } from '../../apps/cli/src/preview/assets';
import { sha256 } from '../../packages/protocol/src';
import { readBinding, writeBinding } from '../../packages/publish/src/binding';
import { sourceGit } from '../../packages/grasp/src/client';
import pins from '../fixtures/interoperability/pins.json';

// Explicit external checkouts/packages, kept out of the production dependency graph.
const enabled = process.env.SOY_INTEROP_PAJA && process.env.SOY_INTEROP_UPSTREAM ? test : test.skip;
enabled(
  'Soy artifact runs in pinned legacy Paja; upstream legacy publication runs in Soy; ngit reads the remix remote',
  async () => {
    const pajaPath = resolve(process.env.SOY_INTEROP_PAJA!);
    const upstream = resolve(process.env.SOY_INTEROP_UPSTREAM!);
    expect(await sourceGit(upstream, ['rev-parse', 'HEAD'])).toBe(pins.upstream);
    expect((await Bun.file(join(pajaPath, 'package.json')).json()).version).toBe(pins.paja);
    expect(
      Bun.which('git-remote-nostr'),
      'Install ngit and put git-remote-nostr on PATH',
    ).not.toBeNull();
    const paja = await import(pathToFileURL(join(pajaPath, 'dist/index.js')).href);
    const upstreamManifest = await import(
      pathToFileURL(join(upstream, 'packages/cli/src/manifest.ts')).href
    );
    const services = await stack();
    const root = services.directory;
    const accounts = join(root, 'keys');
    const cli = process.env.SPACE_TEST_CLI
      ? [resolve(process.env.SPACE_TEST_CLI)]
      : [process.execPath, resolve('apps/cli/src/index.ts')];
    async function command(args: string[], cwd = root, isCli = true) {
      const child = Bun.spawn(isCli ? [...cli, ...args, '--network', 'local', '--json'] : args, {
        cwd,
        env: {
          ...process.env,
          SPACE_ACCOUNT_HOME: accounts,
          SOYLI_DANGEROUS_PLAINTEXT_KEYS: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_TERMINAL_PROMPT: '0',
          XDG_CONFIG_HOME: join(root, 'ngit-config'),
          XDG_CACHE_HOME: join(root, 'ngit-cache'),
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
      try {
        const [code, out, err] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(code, out + err).toBe(0);
        return out;
      } finally {
        clearTimeout(timer);
      }
    }
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let external: ReturnType<typeof Bun.serve> | undefined;
    let soy: ReturnType<typeof startPreviewServer> | undefined;
    const client = new ProtocolClient(() => [services.targets.relay]);
    try {
      await command(['new', 'creation', '--template', 'soft-orbit', '--identity', 'later']);
      const project = join(root, 'creation');
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
        'base64',
      );
      await Bun.write(join(root, 'pixel.png'), png);
      await command(
        [
          'assets',
          'add',
          join(root, 'pixel.png'),
          'pixel',
          '--storage',
          'external',
          '--license',
          'CC0',
        ],
        project,
      );
      const imageHash = await sha256(png);
      const schema = {
        type: 'object',
        properties: { message: { type: 'string', default: 'Config works' } },
      };
      const settingsSource = (
        await Bun.file('apps/cli/templates/napplet-settings.ts.txt').text()
      ).replace(/^import .*;\n/gm, '');
      const settings = new Bun.Transpiler({ loader: 'ts' }).transformSync(
        `const config=window.napplet.config; const runtimeHasDomain=d=>!!window.napplet[d]; const settingsSchema=${JSON.stringify(schema)};` +
          settingsSource,
      );
      const html = `<!doctype html><html><head><meta name="napplet-config-schema" content='${JSON.stringify(schema)}'></head><body><h1>Portable toy</h1><output id="result">Waiting</output><script>${settings}</script><script>
(async()=>{ await napplet.shell.ready(); napplet.config.onSchemaError(e=>document.body.dataset.schemaError=JSON.stringify(e)); const blob=await napplet.resource.bytes('blossom:sha256:${imageHash}'); const image=new Image(); image.src=URL.createObjectURL(blob); await image.decode(); document.body.append(image); document.querySelector('#result').textContent='Image '+image.naturalWidth; napplet.config.subscribe(config=>{document.body.dataset.config=JSON.stringify(config)}); })().catch(e=>{document.querySelector('#result').textContent='ERROR '+e.message});
</script></body></html>`;
      await Bun.write(join(project, 'index.html'), html);
      const config = await Bun.file(join(project, 'napplet.json')).json();
      config.requires = ['resource', 'config'];
      config.publish = { networks: { local: services.targets } };
      await Bun.write(join(project, 'napplet.json'), JSON.stringify(config));
      await command(['account', 'create'], project);
      await command(['checkpoint', 'Portable artifact'], project);
      await command(['publish'], project);
      const journal = new Journal(project, 'local');
      const job = await journal.load((await journal.index()).latest!);
      const pointer = nip19.naddrEncode({
        kind: 35129,
        pubkey: job.current!.pubkey,
        identifier: job.plan.identifier,
        relays: [services.targets.relay],
      });
      // Paja 0.16.4 and this upstream builder predate standalone NIP-5D. Retain
      // their useful legacy-reader check by wrapping the freshly published Soy
      // bytes in an explicitly legacy manifest. This is not evidence that this
      // pinned independent client supports the new standalone wire contract.
      const legacyReaderManifest = finalizeEvent(
        await upstreamManifest.createSiteManifestTemplate(
          { target: 'named', dTag: 'legacy-reader-fixture' },
          [{ path: '/index.html', sha256: job.plan.artifactHash }],
          {
            servers: [services.targets.blossom],
            metadataTags: [
              ['requires', 'resource'],
              ['requires', 'config'],
            ],
          },
        ),
        generateSecretKey(),
      );
      await client.publish(legacyReaderManifest, [services.targets.relay]);
      const legacyPointer = nip19.naddrEncode({
        kind: legacyReaderManifest.kind,
        pubkey: legacyReaderManifest.pubkey,
        identifier: 'legacy-reader-fixture',
        relays: [services.targets.relay],
      });
      const pajaConfig = paja.createPajaRuntimeHostConfig({
        pointer: legacyPointer,
        relays: [services.targets.relay],
        blossomServers: [services.targets.blossom],
        maxWaitMs: 5000,
        simulation: { relay: { mode: 'live', urls: [services.targets.relay] } },
      });
      const pajaHtml = paja.renderPajaHtml(pajaConfig);
      external = Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch(request) {
          return new URL(request.url).pathname.endsWith('browser-host.js')
            ? new Response(Bun.file(join(pajaPath, 'dist/browser-host.js')), {
                headers: { 'Content-Type': 'text/javascript' },
              })
            : new Response(pajaHtml, { headers: { 'Content-Type': 'text/html' } });
        },
      });
      browser = await chromium.launch();
      const page = await browser.newPage();
      page.on('pageerror', (e) => console.error('Paja page error', e.message));
      await page.goto(external.url.href);
      const frame = page.frameLocator('iframe').first();
      await browserExpect(frame.locator('#result')).toHaveText('Image 1', { timeout: 20000 });
      await browserExpect(frame.locator('body')).toHaveAttribute('data-config', /Config works/);
      expect(await page.locator('iframe').first().getAttribute('sandbox')).toBe('allow-scripts');
      const evidence = resolve('.local/interoperability/evidence');
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: join(evidence, 'paja.png'), fullPage: true });
      // Independently authored bytes, uploaded with ordinary BUD-02 authorization.
      // Upstream code creates every manifest/aggregate; no Soy source/presentation tags.
      const foreignBytes = await Bun.file('tests/fixtures/interoperability/foreign.html').bytes();
      const foreignHash = await sha256(foreignBytes);
      const foreignKey = generateSecretKey();
      const now = Math.floor(Date.now() / 1000);
      const authorization = finalizeEvent(
        {
          kind: 24242,
          created_at: now,
          content: 'Upload interoperability fixture',
          tags: [
            ['t', 'upload'],
            ['x', foreignHash],
            ['expiration', String(now + 300)],
            ['server', new URL(services.targets.blossom).hostname],
          ],
        },
        foreignKey,
      );
      const upload = await fetch(`${services.targets.blossom}/upload`, {
        method: 'PUT',
        headers: {
          Authorization: `Nostr ${Buffer.from(JSON.stringify(authorization)).toString('base64url')}`,
          'Content-Type': 'text/html',
          'X-SHA-256': foreignHash,
        },
        body: foreignBytes,
      });
      expect(upload.status, await upload.text()).toBe(201);
      const templates = [];
      for (const target of ['root', 'named'])
        templates.push(
          await upstreamManifest.createSiteManifestTemplate(
            { target, dTag: 'from-upstream' },
            [{ path: '/index.html', sha256: foreignHash }],
            { servers: [services.targets.blossom], metadataTags: [['requires', 'config']] },
          ),
        );
      const named = finalizeEvent(templates[1], foreignKey);
      templates.push(
        upstreamManifest.createSnapshotManifestTemplate(templates[1], {
          kind: named.kind,
          pubkey: named.pubkey,
          dTag: 'from-upstream',
        }),
      );
      for (const template of templates) {
        const event = finalizeEvent(template, foreignKey);
        await client.publish(event, [services.targets.relay]);
        const imported = await loadRemix(
          nip19.neventEncode({ id: event.id, relays: [services.targets.relay] }),
          'local',
          AbortSignal.timeout(10000),
        );
        expect(imported).toBeDefined();
        const foreign = await createRemix(root, `foreign-${event.kind}`, imported);
        soy = startPreviewServer(
          pathToFileURL(foreign.directory + '/'),
          0,
          false,
          await previewAssets(),
          { network: 'local' },
        );
        const other = await browser.newPage();
        await other.goto(soy.url.href);
        const otherFrame = other.frameLocator('iframe').first();
        await browserExpect(otherFrame.locator('#result')).toHaveText('Upstream manifest works', {
          timeout: 20000,
        });
        await otherFrame.getByRole('button', { name: 'Count' }).click();
        await browserExpect(otherFrame.locator('#count')).toHaveText('1');
        await other.screenshot({ path: join(evidence, `soy-${event.kind}.png`), fullPage: true });
        await other.close();
        soy.stop(true);
        soy = undefined;
      }
      const invalid = finalizeEvent(
        {
          ...templates[1],
          tags: templates[1].tags.map((tag: string[]) =>
            tag[0] === 'x'
              ? ['x', '0'.repeat(64), 'aggregate']
              : tag[0] === 'd'
                ? ['d', 'invalid-aggregate']
                : tag,
          ),
        },
        foreignKey,
      );
      await client.publish(invalid, [services.targets.relay]);
      await expect(
        loadRemix(
          nip19.neventEncode({ id: invalid.id, relays: [services.targets.relay] }),
          'local',
          AbortSignal.timeout(10000),
        ),
      ).rejects.toThrow('Manifest aggregate hash mismatch');
      // A fresh Git-backed remix must work with the actual installed git-remote-nostr.
      const loaded = await loadRemix(pointer, 'local', AbortSignal.timeout(10000));
      const remix = await createRemix(root, 'contributor', loaded);
      const remote = await sourceGit(remix.directory, ['remote', 'get-url', 'nostr']);
      const refs = await command(['git', 'ls-remote', remote], remix.directory, false);
      expect(refs).toContain(job.commit!);
      await command(['account', 'create', '--new'], remix.directory);
      const selected = JSON.parse(await command(['account', 'show'], remix.directory));
      const binding = (await readBinding(remix.directory))!;
      binding.project.creator = { pubkey: selected.account.pubkey, network: 'local' };
      binding.project.publish = { networks: { local: services.targets } };
      await writeBinding(remix.directory, binding);
      await Bun.write(
        join(remix.directory, 'README.md'),
        '# A contribution from another creator\n',
      );
      await command(['checkpoint', 'Explain the toy'], remix.directory);
      await command(['propose', 'Explain the toy'], remix.directory);
      const proposalRefs = await command(['git', 'ls-remote', remote], remix.directory, false);
      const head = await sourceGit(remix.directory, ['rev-parse', 'HEAD']);
      expect(proposalRefs).toContain(head);
      const observer = join(root, 'ngit-observer');
      await command(['git', 'clone', remote, observer], root, false);
      expect(await sourceGit(observer, ['rev-parse', 'HEAD'])).toBe(job.commit!);
      expect(await sourceGit(observer, ['cat-file', '-t', head])).toBe('commit');
      expect(await sourceGit(observer, ['merge-base', '--is-ancestor', job.commit!, head])).toBe(
        '',
      );
    } finally {
      await browser?.close();
      soy?.stop(true);
      external?.stop(true);
      client.close();
      await services.close();
    }
  },
  180000,
);

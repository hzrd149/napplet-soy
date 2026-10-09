import { expect, test } from 'bun:test';
import { lstat, mkdtemp, mkdir, readlink, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nip19 } from 'nostr-tools';
import { stack } from './publish-stack';
import {
  importAsset,
  validateAssets,
  assetBytes,
  type ManagedAsset,
} from '../../packages/assets/src';
import { Accounts, type Vault } from '../../packages/identity/src/accounts';
import { publishProject } from '../../packages/publish/src';
import { checkpoint } from '../../packages/publish/src/git-source';
import { Journal } from '../../packages/publish/src/journal';
import { loadRemix, createRemix } from '../../packages/remix/src';
import { sourceArchive } from '../../packages/remix/src/archive';
import { sha256, validateRelease } from '../../packages/protocol/src';
import { sourceGit } from '../../packages/grasp/src/client';

test('large sources and a 12 MiB game publish, resume data assets and retain history in a fresh remix', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-publish-data-assets-'));
  const project = join(directory, 'original');
  let services: Awaited<ReturnType<typeof stack>> | undefined;
  let proxy: ReturnType<typeof Bun.serve> | undefined;
  const originals = [
    {
      id: 'game-pack',
      bytes: new Uint8Array([83, 83, 82, 67, 80, 65, 67, 75, 0, 255, 1, 127]),
      mime: 'application/octet-stream',
    },
    {
      id: 'levels',
      bytes: new TextEncoder().encode('{"levels":[{"name":"First","tiles":[1,2,3]}]}\n'),
      mime: 'application/json',
    },
    {
      id: 'dialogue',
      bytes: new TextEncoder().encode('Welcome, traveler.\nFind the blue door.\n'),
      mime: 'text/plain',
    },
  ];
  try {
    await mkdir(project);
    await Bun.write(
      join(project, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Data assets',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        identifier: 'data-assets',
        license: 'MIT',
      }),
    );
    await Bun.write(
      join(project, 'index.html'),
      '<!doctype html><h1>Data asset transport fixture</h1>'.padEnd(12 * 1024 * 1024, ' '),
    );
    await Bun.write(join(project, 'LICENSE'), 'MIT');
    await Bun.write(join(project, '.gitignore'), '.napplet-space/\n');
    await Bun.write(join(project, 'AGENTS.md'), 'Build a game.\n');
    for (let i = 0; i < 140; i++)
      await Bun.write(join(project, `src/level-${i}.ts`), 'export {};\n');
    await symlink('AGENTS.md', join(project, 'CLAUDE.md'));
    await sourceGit(project, ['init']);
    await sourceGit(project, ['add', '.']);
    await sourceGit(project, ['commit', '-m', 'Original guidance alias']);
    const historicalCommit = await sourceGit(project, ['rev-parse', 'HEAD']);
    const imported: ManagedAsset[] = [];
    for (const original of originals) {
      const asset = await importAsset(project, {
        ...original,
        storage: 'external',
        license: 'CC0',
      });
      expect(asset.mime).toBe(original.mime);
      imported.push(asset);
    }

    // Use actual local services; the proxy only records transport requests.
    services = await stack();
    const blossomOrigin = services.targets.blossom;
    const uploads: string[] = [],
      reads: string[] = [];
    proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        if (request.method === 'PUT') uploads.push(request.headers.get('x-sha-256')!);
        if (request.method === 'GET' && /^\/[a-f0-9]{64}$/.test(url.pathname))
          reads.push(url.pathname.slice(1));
        const headers = new Headers(request.headers);
        headers.delete('host');
        return fetch(blossomOrigin + url.pathname + url.search, {
          method: request.method,
          headers,
          redirect: 'error',
          body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
        });
      },
    });
    const values = new Map<string, string>();
    const vault: Vault = {
      get: async (id) => values.get(id) ?? null,
      set: async (id, value) => {
        values.set(id, value);
      },
      delete: async (id) => {
        values.delete(id);
      },
    };
    const accounts = new Accounts('local', join(directory, 'accounts'), vault);
    const creator = await accounts.create();
    await checkpoint(project, 'Keep original data assets', creator.pubkey);
    const releaseCommit = await sourceGit(project, ['rev-parse', 'HEAD']);
    const sourceLink = await sourceGit(project, ['ls-tree', 'HEAD', 'CLAUDE.md']);
    expect(sourceLink).toStartWith('120000 blob');
    const options = {
      snapshot: true, // Retain paired-publication upload/resume coverage.
      directory: project,
      network: 'local' as const,
      accounts,
      targets: { ...services.targets, blossom: proxy.url.origin },
      // Browser decoding is covered independently by the managed-asset sandbox test.
      check: async () => ({ profile: 'integration', browser: 'transport-fixture' }),
    };
    let interrupted = false;
    await expect(
      publishProject({
        ...options,
        dependencies: {
          checkpoint: async (job) => {
            if (!interrupted && imported.every((asset) => job.receipts.assets?.[asset.hash])) {
              interrupted = true;
              throw new Error('Interrupt after the managed data uploads');
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'PUBLISH_FAILED' });
    expect(interrupted).toBe(true);
    const journal = new Journal(project, 'local');
    const frozen = await journal.load((await journal.index()).active!);
    expect(frozen.commit).toBe(releaseCommit);
    expect(frozen.plan.files.length).toBeGreaterThan(128);
    expect(frozen.plan.files.find((file) => file.path === 'index.html')?.size).toBe(
      12 * 1024 * 1024,
    );
    expect(frozen.receipts.snapshot).toBe(false);
    expect(frozen.plan.requires).toContain('resource');
    expect(frozen.plan.servers).toContain(proxy.url.origin);
    for (const [index, asset] of imported.entries()) {
      expect(uploads.filter((hash) => hash === asset.hash)).toHaveLength(1);
      const response = await fetch(`${proxy.url.origin}/${asset.hash}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(originals[index].mime);
      const bytes = await response.bytes();
      expect(bytes).toEqual(originals[index].bytes);
      expect(await sha256(bytes)).toBe(asset.hash);
    }

    // Retain the server's ownership claim but corrupt its disk bytes. Resume must
    // independently verify every asset and repair the damaged one from frozen source.
    const packed = imported[0];
    await Bun.write(
      join(services.directory, 'blobs', 'blobs', packed.hash),
      new Uint8Array(packed.bytes).fill(7),
    );
    await Bun.write(join(project, packed.path), 'Unpublished working-tree changes');
    const uploadsBeforeResume = uploads.length;
    const readsBeforeResume = reads.length;
    const resumed = await publishProject({ ...options, resume: true });
    expect(resumed).toMatchObject({
      status: 'announced_pending_index',
      snapshotId: frozen.snapshot!.id,
      currentId: frozen.current!.id,
    });
    expect(uploads.slice(uploadsBeforeResume)).toEqual([packed.hash]);
    for (const asset of imported) expect(reads.slice(readsBeforeResume)).toContain(asset.hash);
    expect(await (await fetch(`${proxy.url.origin}/${packed.hash}`)).bytes()).toEqual(
      originals[0].bytes,
    );
    const complete = await journal.load((await journal.index()).latest!);
    expect(complete.commit).toBe(releaseCommit);
    expect(complete.archiveHash).toBe(frozen.archiveHash);
    expect(await sourceGit(project, ['rev-parse', 'HEAD'])).toBe(releaseCommit);
    expect(await sourceGit(project, ['ls-tree', 'HEAD', 'CLAUDE.md'])).toBe(sourceLink);
    expect(await readlink(join(project, 'CLAUDE.md'))).toBe('AGENTS.md');
    expect(complete.receipts.assets).toEqual(
      Object.fromEntries(imported.map((asset) => [asset.hash, true])),
    );
    const release = await validateRelease(complete.current, complete.snapshot);
    expect(release.current.tags).toContainEqual(['R', 'resource']);
    const archiveResponse = await fetch(`${proxy.url.origin}/${complete.archiveHash}`);
    expect(archiveResponse.status).toBe(200);
    const archiveBytes = await archiveResponse.bytes();
    expect(await sha256(archiveBytes)).toBe(complete.archiveHash);
    // This reader rejects every link entry: successful extraction verifies that
    // the uploaded source pack materializes aliases as regular source files.
    const archiveFiles = sourceArchive(archiveBytes);
    expect(archiveFiles.get('CLAUDE.md')).toEqual(new TextEncoder().encode('Build a game.\n'));
    expect(archiveFiles.get('CLAUDE.md')).toEqual(archiveFiles.get('AGENTS.md'));

    const loaded = await loadRemix(
      nip19.neventEncode({
        id: complete.current!.id,
        relays: [services.targets.relay],
      }),
      'local',
      AbortSignal.timeout(15000),
    );
    for (const [index, asset] of imported.entries())
      expect(loaded.files?.get(asset.path)).toEqual(originals[index].bytes);
    // Removing the creator workspace makes any ambient asset-cache dependence fail.
    await rm(project, { recursive: true });
    const remix = await createRemix(directory, 'fresh-remix', loaded);
    expect(remix.source).toBe('git');
    expect(await sourceGit(remix.directory, ['rev-parse', 'HEAD'])).toBe(releaseCommit);
    expect(await sourceGit(remix.directory, ['ls-tree', 'HEAD', 'CLAUDE.md'])).toBe(sourceLink);
    expect((await lstat(join(remix.directory, 'CLAUDE.md'))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(remix.directory, 'CLAUDE.md'))).toBe('AGENTS.md');
    expect(Bun.file(join(remix.directory, 'index.html')).size).toBe(12 * 1024 * 1024);
    expect(await sourceGit(remix.directory, ['rev-parse', `${historicalCommit}^{commit}`])).toBe(
      historicalCommit,
    );
    expect(
      await sourceGit(remix.directory, ['ls-tree', historicalCommit, 'CLAUDE.md']),
    ).toStartWith('120000 blob');
    expect(await Bun.file(join(remix.directory, 'CLAUDE.md')).text()).toBe('Build a game.\n');
    expect(await Bun.file(join(remix.directory, 'src/level-139.ts')).text()).toBe('export {};\n');
    expect((await validateAssets(remix.directory)).assets).toEqual(imported);
    for (const [index, asset] of imported.entries()) {
      expect(await assetBytes(remix.directory, asset)).toEqual(originals[index].bytes);
    }
    const archiveRemix = await createRemix(directory, 'archive-remix', {
      ...loaded,
      repository: undefined,
    });
    expect(archiveRemix.source).toBe('archive');
    expect((await lstat(join(archiveRemix.directory, 'CLAUDE.md'))).isFile()).toBe(true);
    expect(await Bun.file(join(archiveRemix.directory, 'CLAUDE.md')).text()).toBe(
      'Build a game.\n',
    );
  } finally {
    proxy?.stop(true);
    await services?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);

// Exact generated files from soyLI 0.23.4 for the fixed external PNG below.
// Keep these independent of the current generator: published/frozen source cannot
// be rewritten merely because a later CLI adds a generated helper API.
const legacyModule = `// Generated by soyLI. Edit napplet.assets.json through soyli assets or the manager.

const assets = {"sprite": {hash: "a003172922ab7880a1d39825fbd2ad48bea3f0f163ca16707364e6298839795c"}};
const urls = new Map();
/** @param {string} id */
export async function assetUrl(id) {
  const entry = Object.hasOwn(assets, id) ? assets[id] : undefined;
  if (!entry) throw new PublishError('ASSET_INVALID', 'Unknown asset: ' + id);
  if (entry.url) return entry.url;
  if (!urls.has(id)) {
    const pending = window.napplet.resource.bytes('blossom:sha256:' + entry.hash).then(blob => URL.createObjectURL(blob));
    urls.set(id, pending);
    pending.catch(() => { if (urls.get(id) === pending) urls.delete(id); });
  }
  return urls.get(id);
}
export function releaseAssetUrls() {
  for (const value of urls.values()) value.then(url => URL.revokeObjectURL(url)).catch(() => {});
  urls.clear();
}
`;
const legacyTypes =
  '// Generated by soyLI.\nexport function assetUrl(id: string): Promise<string>;\nexport function releaseAssetUrls(): void;\n';

test('legacy managed media resumes and remixes without rewriting the old published helper pair', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soy-publish-legacy-assets-'));
  const project = join(directory, 'original');
  let services: Awaited<ReturnType<typeof stack>> | undefined;
  try {
    await mkdir(project);
    await Bun.write(
      join(project, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Legacy media',
        entry: 'index.html',
        previewId: crypto.randomUUID(),
        identifier: 'legacy-media',
        license: 'MIT',
      }),
    );
    await Bun.write(join(project, 'index.html'), '<!doctype html><h1>Legacy media fixture</h1>');
    await Bun.write(join(project, 'LICENSE'), 'MIT');
    await Bun.write(join(project, '.gitignore'), '.napplet-space/\n');
    const png = new Uint8Array(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lS8AAAAASUVORK5CYII=',
        'base64',
      ),
    );
    const asset = await importAsset(project, {
      id: 'sprite',
      bytes: png,
      storage: 'external',
      license: 'CC0',
    });
    await Bun.write(join(project, 'soy-assets.js'), legacyModule);
    await Bun.write(join(project, 'soy-assets.d.ts'), legacyTypes);
    // This is the old source format encountered by an upgraded publisher/remixer.
    expect((await validateAssets(project)).assets).toEqual([asset]);
    services = await stack();
    const values = new Map<string, string>();
    const vault: Vault = {
      get: async (id) => values.get(id) ?? null,
      set: async (id, value) => {
        values.set(id, value);
      },
      delete: async (id) => {
        values.delete(id);
      },
    };
    const accounts = new Accounts('local', join(directory, 'accounts'), vault);
    const creator = await accounts.create();
    await checkpoint(project, 'Legacy generated asset source', creator.pubkey);
    const commit = await sourceGit(project, ['rev-parse', 'HEAD']);
    const options = {
      snapshot: true, // Retain paired-publication upload/resume coverage.
      directory: project,
      network: 'local' as const,
      accounts,
      targets: services.targets,
      check: async () => ({ profile: 'integration', browser: 'legacy-transport-fixture' }),
    };
    let interrupted = false;
    await expect(
      publishProject({
        ...options,
        dependencies: {
          checkpoint: async (job) => {
            if (!interrupted && job.receipts.assets?.[asset.hash]) {
              interrupted = true;
              throw new Error('Interrupt after legacy managed asset upload');
            }
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'PUBLISH_FAILED' });
    expect(interrupted).toBe(true);
    const journal = new Journal(project, 'local');
    const frozen = await journal.load((await journal.index()).active!);
    const frozenRoot = join(journal.directory(frozen.id), 'files');
    const unchanged = async (root: string) => {
      expect(await Bun.file(join(root, 'soy-assets.js')).text()).toBe(legacyModule);
      expect(await Bun.file(join(root, 'soy-assets.d.ts')).text()).toBe(legacyTypes);
      expect(await assetBytes(root, asset)).toEqual(png);
    };
    await unchanged(frozenRoot);
    const archiveHash = await sha256(
      await Bun.file(join(journal.directory(frozen.id), 'source.tar')).bytes(),
    );
    const resumed = await publishProject({ ...options, resume: true });
    expect(resumed).toMatchObject({
      status: 'announced_pending_index',
      currentId: frozen.current!.id,
      snapshotId: frozen.snapshot!.id,
    });
    const complete = await journal.load((await journal.index()).latest!);
    expect(complete.fingerprint).toBe(frozen.fingerprint);
    expect(complete.commit).toBe(commit);
    expect(complete.archiveHash).toBe(archiveHash);
    await unchanged(frozenRoot);
    await unchanged(project);
    expect(await sourceGit(project, ['status', '--porcelain'])).toBe('');
    const loaded = await loadRemix(
      nip19.neventEncode({
        id: complete.current!.id,
        relays: [services.targets.relay],
      }),
      'local',
      AbortSignal.timeout(15000),
    );
    expect(loaded.files).toBeDefined();
    await rm(project, { recursive: true });
    const gitRemix = await createRemix(directory, 'git-remix', loaded);
    expect(gitRemix.source).toBe('git');
    expect(await sourceGit(gitRemix.directory, ['rev-parse', 'HEAD'])).toBe(commit);
    expect(await sourceGit(gitRemix.directory, ['status', '--porcelain'])).toBe('');
    await unchanged(gitRemix.directory);
    const archiveRemix = await createRemix(directory, 'archive-remix', {
      ...loaded,
      repository: undefined,
    });
    expect(archiveRemix.source).toBe('archive');
    await unchanged(archiveRemix.directory);
  } finally {
    await services?.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);

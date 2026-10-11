import { test, expect } from 'bun:test';
import { join, resolve } from 'node:path';
import { mkdir, rename } from 'node:fs/promises';
import { stack } from './publish-stack';
import { sourceGit } from '../../packages/grasp/src/client';
import { Journal } from '../../packages/publish/src/journal';
import { createLifecycleReceipt } from '../../packages/lifecycle/src';
import { LifecycleTransport } from '../../packages/lifecycle/src/transport';

test('real soyLI confirms unpublish, republishes unchanged source, and reports Blossom and GRASP removal', async () => {
  const services = await stack(),
    root = resolve(import.meta.dir, '../..'),
    project = join(services.directory, 'project'),
    accounts = join(services.directory, 'accounts');
  await mkdir(project);
  async function cli(args: string[]) {
    const child = Bun.spawn(
      [
        ...(process.env.SPACE_TEST_CLI_EXECUTABLE
          ? [process.env.SPACE_TEST_CLI_EXECUTABLE]
          : [process.execPath, join(root, 'apps/cli/src/index.ts')]),
        ...args,
        '--network',
        'local',
        '--json',
      ],
      {
        cwd: project,
        env: {
          PATH: process.env.PATH,
          SPACE_ACCOUNT_HOME: accounts,
          SOYLI_DANGEROUS_PLAINTEXT_KEYS: '1',
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      },
    );
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    let data: any;
    try {
      data = JSON.parse(out);
    } catch {
      throw new Error(`Invalid CLI output: ${out}\n${err}`);
    }
    return { code, data, err };
  }
  const io = new LifecycleTransport();
  try {
    await Bun.write(
      join(project, 'napplet.json'),
      JSON.stringify({
        schema: 'space-local-project/v1',
        name: 'Lifecycle fixture',
        previewId: crypto.randomUUID(),
        entry: 'index.html',
        license: 'MIT',
        topics: [],
        requires: [],
        relays: [],
        servers: [],
        publish: services.targets,
      }),
    );
    await Bun.write(
      join(project, 'index.html'),
      '<!doctype html><title>Lifecycle</title><style>body{background:#fdc}h1{font:80px serif}</style><h1>A little world</h1>',
    );
    await Bun.write(join(project, 'LICENSE'), 'MIT');
    await Bun.write(join(project, '.gitignore'), '.napplet-space/\n');
    await sourceGit(project, ['init', '--initial-branch=main']);
    await sourceGit(project, ['add', '.']);
    await sourceGit(project, ['commit', '-m', 'Initial fixture']);
    const original = await cli(['account', 'create']);
    expect(original.code).toBe(0);
    const published = await cli(['publish', '--snapshot']);
    expect(published.code, JSON.stringify(published)).toBe(0);
    const journal = new Journal(project, 'local'),
      job = await journal.load((await journal.index()).latest!);
    const plan = await cli(['unpublish', '--dry-run']);
    expect(plan.code, JSON.stringify(plan)).toBe(0);
    expect(plan.data.receipt.plan.complete, JSON.stringify(plan.data.receipt.plan.warnings)).toBe(
      true,
    );
    await rename(
      join(journal.root, `lifecycle-${job.plan.pubkey}.json`),
      join(journal.root, 'lifecycle.json'),
    );
    expect((await cli(['lifecycle'])).data.receipt.plan.author).toBe(job.plan.pubkey);
    expect((await cli(['account', 'create', '--new'])).code).toBe(0);
    expect((await cli(['status'])).data.status).toBe('not_started');
    expect((await cli(['lifecycle'])).data.error.code).toBe('LIFECYCLE_MISSING');
    expect((await cli(['unpublish', '--dry-run'])).data.error.code).toBe('LIFECYCLE_MISSING');
    expect((await cli(['account', 'use', original.data.account.id])).code).toBe(0);
    expect(
      (await io.read(services.targets.relay, { ids: [job.current!.id], limit: 2 })).length,
    ).toBe(1);
    const noConsent = await cli(['unpublish']);
    expect(noConsent.code).not.toBe(0);
    expect(noConsent.data.error?.code ?? noConsent.data.code).toBe('CONFIRMATION_REQUIRED');
    const revised = await cli(['unpublish', '--dry-run']);
    const removed = await cli(['unpublish', '--confirm', revised.data.confirmation]);
    expect(removed.code, JSON.stringify(removed)).toBe(0);
    expect(
      await io.read(services.targets.relay, { ids: [job.current!.id, job.snapshot!.id], limit: 5 }),
    ).toHaveLength(0);
    expect(
      (await fetch(`${services.targets.blossom}/${job.plan.artifactHash}`, { method: 'HEAD' }))
        .status,
    ).toBe(200);
    const status = await cli(['lifecycle']);
    expect(status.data.receipt.steps.every((s: any) => s.state === 'done')).toBe(true);
    // Exercise a refused relay through the actual CLI/JSON boundary, including redaction.
    const secret = 'fixture-secret-bearer-token';
    const refusing = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response('Relay');
      },
      websocket: {
        message(ws, raw) {
          const m = JSON.parse(String(raw));
          if (m[0] === 'EVENT')
            ws.send(
              JSON.stringify([
                'OK',
                m[1].id,
                false,
                `blocked: fixture policy Authorization: Bearer ${secret}`,
              ]),
            );
        },
      },
    });
    try {
      const failure = createLifecycleReceipt(
        {
          ...removed.data.receipt.plan,
          relays: [services.targets.relay, `ws://127.0.0.1:${refusing.port}`],
        },
        'unpublish',
      );
      await Bun.write(
        join(journal.root, `lifecycle-${failure.plan.author}.json`),
        JSON.stringify(failure),
      );
      const preview = await cli(['unpublish', '--resume', '--dry-run']);
      const refused = await cli(['unpublish', '--confirm', preview.data.confirmation]);
      expect(refused.code).not.toBe(0);
      const failed = refused.data.receipt.steps.find((s: any) => s.state === 'failed');
      expect(failed.message).toContain('fixture policy');
      expect(failed.message).toContain('same signed request');
      expect(JSON.stringify(refused)).not.toContain(secret);
    } finally {
      refusing.stop(true);
    }
    const republish = await cli(['republish', '--dry-run']);
    const restored = await cli(['republish', '--confirm', republish.data.confirmation]);
    expect(restored.code, JSON.stringify(restored)).toBe(0);
    const restoredEvent = restored.data.receipt.events.listing;
    expect(restoredEvent.id).not.toBe(job.current!.id);
    // Ordinary publishing adopts the fresh listing without another independent snapshot.
    const fresh = await cli(['publish']);
    expect(fresh.code, JSON.stringify(fresh)).toBe(0);
    expect(fresh.data.snapshotId).toBeNull();
    expect(fresh.data.currentId).not.toBe(job.current!.id);
    const deletion = await cli(['delete', '--dry-run']);
    expect(deletion.code).toBe(0);
    expect(deletion.data.receipt.plan.repositories.length).toBe(1);
    let destroyed = await cli(['delete', '--confirm', deletion.data.confirmation]);
    // GRASP's cascade is asynchronous. Retrying checks the same signed request.
    for (let attempt = 0; destroyed.code && attempt < 4; attempt++) {
      await Bun.sleep(300);
      destroyed = await cli(['delete', '--confirm', deletion.data.confirmation]);
    }
    expect(destroyed.code, JSON.stringify(destroyed)).toBe(0);
    const steps = destroyed.data.receipt.steps;
    expect(
      steps.filter((s: any) => s.id.startsWith('blob:')).every((s: any) => s.state === 'done'),
    ).toBe(true);
    expect(steps.find((s: any) => s.id.startsWith('repo:')).message).toContain('recovery archive');
    expect(await Bun.file(join(project, 'index.html')).exists()).toBe(true);
  } finally {
    io.close();
    await services.close();
  }
}, 180000);

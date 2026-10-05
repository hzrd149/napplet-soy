import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('a package-manager build refuses soyli update and points doctor at that package manager', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'soyli-packaged-')),
    root = resolve(import.meta.dir, '../..'),
    binary = join(directory, 'soyli');
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () =>
      Response.json({
        tag_name: 'soyli-v99.0.0',
        draft: false,
        prerelease: false,
        assets: ['', '.sha256'].map((suffix) => ({
          name: `soyli-${process.platform}-${process.arch}.tar.gz${suffix}`,
          state: 'uploaded',
          size: 100,
        })),
      }),
  });
  try {
    // Compile in a fresh runtime, matching the release build isolation.
    const build = Bun.spawn(
      [
        process.execPath,
        join(root, 'scripts/cli-compile.ts'),
        binary,
        '0.0.1',
        '--distribution',
        'nix',
      ],
      { cwd: root, stdout: 'pipe', stderr: 'pipe' },
    );
    const [buildCode, buildOut, buildError] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ]);
    expect(buildCode, buildOut + buildError).toBe(0);
    const run = async (args: string[]) => {
      const child = Bun.spawn([binary, ...args], {
        cwd: directory,
        env: {
          PATH: process.env.PATH,
          SPACE_ACCOUNT_HOME: join(directory, 'accounts'),
          PLAYWRIGHT_BROWSERS_PATH: join(directory, 'browsers'),
          SOYLI_RELEASE_API: server.url.href,
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { code, stdout, stderr };
    };
    const refused = await run(['update', '--json']);
    expect(refused.code).toBe(1);
    const { error } = JSON.parse(refused.stdout);
    expect(error.code).toBe('UPDATE_INSTALLATION');
    expect(error.message).toContain('managed by nix');
    expect(error.recovery).toContain('nix flake update');
    const terminal = await run(['update']);
    expect(terminal.code).toBe(1);
    expect(terminal.stderr).toContain('Next: Update the flake input');
    const doctor = await run(['doctor']);
    expect(doctor.code, doctor.stdout + doctor.stderr).toBe(0);
    expect(doctor.stdout).toContain('99.0.0 available; update soyLI through nix');
    expect(doctor.stdout).not.toContain('run soyli update');
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);

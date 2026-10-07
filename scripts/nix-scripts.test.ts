import { expect, test } from 'bun:test';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const oldHash = `sha256-${'A'.repeat(43)}=`;
const newHash = `sha256-${'B'.repeat(43)}=`;
const drv = '/nix/store/example-soyli-node-modules.drv';

async function run(
  script: string,
  scenario = 'current',
  packageText = `  outputHash = "${oldHash}";\n`,
) {
  const root = await mkdtemp(join(tmpdir(), 'soyli-nix-test-'));
  try {
    await mkdir(join(root, 'scripts'));
    await mkdir(join(root, 'nix'));
    await mkdir(join(root, 'bin'));
    for (const name of ['nix-check.sh', 'nix-update-hashes.sh'])
      await copyFile(new URL(name, import.meta.url), join(root, 'scripts', name));
    await writeFile(join(root, 'nix/package.nix'), packageText);
    await writeFile(
      join(root, 'bin/nix'),
      `#!/usr/bin/env bash
set -eu
echo "$PWD|$*" >> "$TEST_ROOT/calls"
if [[ "$1" == eval ]]; then
  printf '%s' '${drv}'
  exit 0
fi
if [[ "$1" == build && "$2" == 'path:.#nodeModules' && "$3" == --no-link ]]; then
  if [[ "$SCENARIO" == failure ]]; then
    echo 'error: registry unavailable (HTTP 503)' >&2
    exit 23
  fi
  if [[ "$SCENARIO" == mismatch || "$SCENARIO" == duplicate || "$SCENARIO" == conflicting || "$SCENARIO" == nested || "$SCENARIO" == cached && "$*" == *--rebuild* ]]; then
    if [[ ! -f "$TEST_ROOT/mismatch-seen" ]]; then
      touch "$TEST_ROOT/mismatch-seen"
      failed_drv='${drv}'
      if [[ "$SCENARIO" == nested ]]; then failed_drv=/nix/store/bun-download.drv; fi
      echo "error: hash mismatch in fixed-output derivation '$failed_drv':" >&2
      echo '         specified: ${oldHash}' >&2
      echo '            got:    ${newHash}' >&2
      if [[ "$SCENARIO" == duplicate ]]; then echo '            got:    ${newHash}' >&2; fi
      if [[ "$SCENARIO" == conflicting ]]; then echo '            got:    ${oldHash}' >&2; fi
      exit 1
    fi
  fi
fi
if [[ "$SCENARIO" == verify-failure && "$1" == flake ]]; then
  echo 'error: KVM unavailable' >&2
  exit 7
fi
`,
      { mode: 0o755 },
    );
    // Invoke outside the checkout to exercise script-relative root resolution.
    const process = Bun.spawn(['bash', join(root, 'scripts', script)], {
      cwd: tmpdir(),
      env: {
        ...globalThis.process.env,
        PATH: `${root}/bin:${globalThis.process.env.PATH}`,
        TEST_ROOT: root,
        SCENARIO: scenario,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [code, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    return {
      code,
      stdout,
      stderr,
      calls: (await readFile(join(root, 'calls'), 'utf8'))
        .replaceAll(root, '<root>')
        .trim()
        .split('\n'),
      packageText: await readFile(join(root, 'nix/package.nix'), 'utf8'),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('Nix check realizes, rebuilds both explicit targets, then runs the flake checks', async () => {
  const result = await run('nix-check.sh');
  expect(result.code).toBe(0);
  expect(result.calls).toEqual([
    '<root>|build path:.#nodeModules path:.#soyli --no-link --print-build-logs',
    '<root>|build path:.#nodeModules path:.#soyli --no-link --rebuild --print-build-logs',
    '<root>|flake check path:. --print-build-logs',
  ]);
});

test('hash updater handles fresh and cached mismatches and verifies the edited package', async () => {
  for (const scenario of ['mismatch', 'cached', 'duplicate']) {
    const result = await run('nix-update-hashes.sh', scenario);
    expect(result.code).toBe(0);
    expect(result.packageText).toContain(newHash);
    expect(result.calls.at(-1)).toBe('<root>|flake check path:. --print-build-logs');
  }
});

test('current hashes are not edited but are rebuilt and fully checked', async () => {
  const result = await run('nix-update-hashes.sh');
  expect(result.code).toBe(0);
  expect(result.packageText).toContain(oldHash);
  expect(result.stdout).toContain('hash is current');
  expect(result.calls[2]).toContain('--rebuild');
});

test('unrelated failures retain the cause and exit status without editing hashes', async () => {
  const result = await run('nix-update-hashes.sh', 'failure');
  expect(result.code).toBe(23);
  expect(result.stderr).toContain('HTTP 503');
  expect(result.stderr).toContain('nix build exit 23');
  expect(result.packageText).toContain(oldHash);
  expect(result.calls).toHaveLength(2);
});

test('a nested fetcher mismatch cannot overwrite nodeModules outputHash', async () => {
  const result = await run('nix-update-hashes.sh', 'nested');
  expect(result.code).toBe(1);
  expect(result.packageText).toContain(oldHash);
  expect(result.stderr).toContain('bun-download.drv');
});

test('ambiguous outputHash assignments are rejected without edits', async () => {
  const text = `outputHash = "${oldHash}";\noutputHash = "${oldHash}";\n`;
  const result = await run('nix-update-hashes.sh', 'mismatch', text);
  expect(result.code).toBe(1);
  expect(result.packageText).toBe(text);
  expect(result.stderr).toContain('found 2');
});

test('conflicting mismatch hashes are rejected without edits', async () => {
  const result = await run('nix-update-hashes.sh', 'conflicting');
  expect(result.code).toBe(1);
  expect(result.packageText).toContain(oldHash);
  expect(result.stderr).toContain('Expected one SHA-256 mismatch');
});

test('verification failures propagate instead of claiming success', async () => {
  const result = await run('nix-update-hashes.sh', 'verify-failure');
  expect(result.code).toBe(7);
  expect(result.stderr).toContain('KVM unavailable');
});

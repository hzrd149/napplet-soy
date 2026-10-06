import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkSource, regularFile } from './project';
import { createSourceFileReader, createSourceLinkResolver } from './source-links';

test('selected public source aliases read the target bytes while strict files still reject links', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-source-links-'));
  try {
    await Bun.write(join(root, 'AGENTS.md'), 'Make a playful game.\n');
    await symlink('AGENTS.md', join(root, 'CLAUDE.md'));
    const read = await createSourceFileReader(root, new Set(['AGENTS.md', 'CLAUDE.md']), {
      regularFile,
      checkSource,
    });
    expect(new TextDecoder().decode(await read('CLAUDE.md', 1024))).toBe('Make a playful game.\n');
    await expect(regularFile(root, 'CLAUDE.md', 1024)).rejects.toMatchObject({
      code: 'SOURCE_PATH',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function sourceTree(links: Record<string, string | Uint8Array>) {
  const entries = new Map<string, 'file' | 'link'>([
    ['AGENTS.md', 'file'],
    ['docs/guidance.md', 'file'],
    ...Object.keys(links).map((path) => [path, 'link'] as const),
  ]);
  const directories = new Set(['docs', 'empty', '.napplet-space']);
  return createSourceLinkResolver({
    entries,
    directories,
    checkSource,
    readLink: async (path) => {
      const value = links[path];
      return typeof value === 'string' ? new TextEncoder().encode(value) : value;
    },
  });
}

test('source aliases resolve nested chains and safe parent traversal within the selected tree', async () => {
  const resolve = sourceTree({
    'CLAUDE.md': './docs/../AGENTS.md',
    'docs/CLAUDE.md': '../CLAUDE.md',
    'docs/other.md': './guidance.md',
  });
  expect(await resolve('CLAUDE.md')).toBe('AGENTS.md');
  expect(await resolve('docs/CLAUDE.md')).toBe('AGENTS.md');
  expect(await resolve('docs/other.md')).toBe('docs/guidance.md');
});

test('source alias targets reject escapes, missing files, private paths, directories and malformed paths', async () => {
  for (const target of [
    '/outside/AGENTS.md',
    'C:/outside/AGENTS.md',
    'C:AGENTS.md',
    '../AGENTS.md',
    'docs/../../AGENTS.md',
    'missing.md',
    'docs',
    'empty',
    '.',
    'docs/..',
    'docs//guidance.md',
    'AGENTS.md/../AGENTS.md',
    'AGENTS.md/.',
    'missing/../AGENTS.md',
    'docs\\guidance.md',
    'AGENTS.md\n',
    'a'.repeat(201),
    new Uint8Array([0xff]),
  ]) {
    const resolve = sourceTree({ 'CLAUDE.md': target });
    await expect(resolve('CLAUDE.md')).rejects.toMatchObject({ code: 'SOURCE_PATH' });
  }
  for (const target of ['.env', '.napplet-space/../AGENTS.md', 'docs/.env/../../AGENTS.md']) {
    const resolve = sourceTree({ 'CLAUDE.md': target });
    await expect(resolve('CLAUDE.md')).rejects.toMatchObject({ code: 'SOURCE_SECRET' });
  }
});

test('source aliases reject cycles and cannot traverse another link as a directory', async () => {
  const resolve = sourceTree({
    'CLAUDE.md': 'other.md',
    'other.md': 'CLAUDE.md',
    'alias-dir': 'docs',
    'indirect.md': 'alias-dir/../AGENTS.md',
  });
  await expect(resolve('CLAUDE.md')).rejects.toThrow('Cyclic');
  await expect(resolve('indirect.md')).rejects.toThrow('non-directory');
  await expect(resolve('alias-dir')).rejects.toThrow('regular file');
});

test('source links scan raw targets without including credentials in diagnostics', async () => {
  const secret = 'nsec1' + 'q'.repeat(58);
  try {
    await sourceTree({ 'CLAUDE.md': secret })('CLAUDE.md');
    throw new Error('Expected a rejected credential');
  } catch (cause) {
    expect(cause).toMatchObject({ code: 'SOURCE_SECRET' });
    expect(String(cause)).not.toContain(secret);
  }
});

test('working aliases require every target in the source selection and scan the resolved contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-source-links-'));
  try {
    await Bun.write(join(root, 'AGENTS.md'), 'Useful public guidance.\n');
    await symlink('AGENTS.md', join(root, 'CLAUDE.md'));
    await symlink('CLAUDE.md', join(root, 'OTHER.md'));
    const omitted = await createSourceFileReader(root, new Set(['CLAUDE.md']), {
      regularFile,
      checkSource,
    });
    await expect(omitted('CLAUDE.md', 1024)).rejects.toThrow('selected public regular file');
    const read = await createSourceFileReader(
      root,
      new Set(['AGENTS.md', 'CLAUDE.md', 'OTHER.md']),
      {
        regularFile,
        checkSource,
      },
    );
    expect(new TextDecoder().decode(await read('OTHER.md', 1024))).toBe(
      'Useful public guidance.\n',
    );
    await expect(read('OTHER.md', 3)).rejects.toMatchObject({ code: 'SOURCE_LIMIT' });
    const secret = 'nsec1' + 'q'.repeat(58);
    await Bun.write(join(root, 'AGENTS.md'), secret);
    await expect(read('OTHER.md', 1024)).rejects.toMatchObject({ code: 'SOURCE_SECRET' });
    await expect(read('not-selected.md', 1024)).rejects.toMatchObject({ code: 'SOURCE_PATH' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('working source does not follow directory links or absolute file aliases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-source-links-'));
  try {
    await mkdir(join(root, 'docs'));
    await Bun.write(join(root, 'docs/AGENTS.md'), 'Public guidance');
    await symlink('docs', join(root, 'linked-docs'));
    await expect(
      createSourceFileReader(root, new Set(['linked-docs/AGENTS.md']), {
        regularFile,
        checkSource,
      }),
    ).rejects.toMatchObject({ code: 'SOURCE_PATH' });
    await symlink(join(root, 'docs/AGENTS.md'), join(root, 'CLAUDE.md'));
    const read = await createSourceFileReader(root, new Set(['docs/AGENTS.md', 'CLAUDE.md']), {
      regularFile,
      checkSource,
    });
    await expect(read('CLAUDE.md', 1024)).rejects.toThrow('relative file path');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('working reader keeps genuine deletions distinguishable from broken file aliases', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-source-links-'));
  try {
    await symlink('deleted.md', join(root, 'CLAUDE.md'));
    const read = await createSourceFileReader(root, new Set(['deleted.md', 'CLAUDE.md']), {
      regularFile,
      checkSource,
    });
    await expect(read('deleted.md', 1024)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(read('CLAUDE.md', 1024)).rejects.toMatchObject({ code: 'SOURCE_PATH' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a disappearing alias target cannot be mistaken for an ordinary tracked deletion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-source-links-'));
  try {
    await Bun.write(join(root, 'AGENTS.md'), 'Public guidance');
    await symlink('AGENTS.md', join(root, 'CLAUDE.md'));
    const read = await createSourceFileReader(root, new Set(['AGENTS.md', 'CLAUDE.md']), {
      regularFile,
      checkSource,
    });
    await rm(join(root, 'AGENTS.md'));
    await expect(read('CLAUDE.md', 1024)).rejects.toMatchObject({ code: 'SOURCE_PATH' });
    await expect(read('AGENTS.md', 1024)).rejects.toMatchObject({ code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a directory swapped to a link after selection cannot be traversed while reading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-source-links-'));
  try {
    await mkdir(join(root, 'docs'));
    await Bun.write(join(root, 'AGENTS.md'), 'Public guidance');
    await symlink('../AGENTS.md', join(root, 'docs/CLAUDE.md'));
    const read = await createSourceFileReader(root, new Set(['AGENTS.md', 'docs/CLAUDE.md']), {
      regularFile,
      checkSource,
    });
    await rm(join(root, 'docs'), { recursive: true });
    await symlink('.', join(root, 'docs'));
    await expect(read('docs/CLAUDE.md', 1024)).rejects.toThrow('directory links');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('working aliases recheck directory steps that a later parent component would erase', async () => {
  const root = await mkdtemp(join(tmpdir(), 'soy-source-links-'));
  try {
    await mkdir(join(root, 'docs'));
    await Bun.write(join(root, 'docs/guidance.md'), 'Public guidance');
    await Bun.write(join(root, 'AGENTS.md'), 'Public guidance');
    await symlink('docs/../AGENTS.md', join(root, 'CLAUDE.md'));
    const read = await createSourceFileReader(
      root,
      new Set(['AGENTS.md', 'CLAUDE.md', 'docs/guidance.md']),
      { regularFile, checkSource },
    );
    await rm(join(root, 'docs'), { recursive: true });
    await symlink('.', join(root, 'docs'));
    await expect(read('CLAUDE.md', 1024)).rejects.toThrow('directory links');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceGit } from '../../grasp/src/client';
import { sourceArchive } from './archive';

test('source archive accepts exactly 1024 files and rejects the 1025th file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'source-archive-count-'));
  try {
    await sourceGit(directory, ['init', '--initial-branch=main']);
    await Promise.all(
      Array.from({ length: 1024 }, (_, i) =>
        Bun.write(
          join(directory, `src/file-${String(i).padStart(4, '0')}.ts`),
          `export const n = ${i};`,
        ),
      ),
    );
    await sourceGit(directory, ['add', 'src']);
    await sourceGit(directory, ['commit', '-m', 'Source at the file limit']);
    const archive = join(directory, 'source.tar');
    await sourceGit(directory, ['archive', '--format=tar', `--output=${archive}`, 'HEAD']);
    const files = sourceArchive(await Bun.file(archive).bytes());
    expect(files.size).toBe(1024);
    expect(new TextDecoder().decode(files.get('src/file-1023.ts'))).toBe('export const n = 1023;');

    await Bun.write(join(directory, 'src/file-1024.ts'), 'export const n = 1024;');
    await sourceGit(directory, ['add', 'src']);
    await sourceGit(directory, ['commit', '-m', 'One file over the limit']);
    await sourceGit(directory, ['archive', '--format=tar', `--output=${archive}`, 'HEAD']);
    const oversized = await Bun.file(archive).bytes();
    expect(() => sourceArchive(oversized)).toThrow('1024 source file limit');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

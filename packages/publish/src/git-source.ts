import { sourceGit } from '../../grasp/src/client';
import { PublishError } from './config';
import { DiagnosticError } from '../../diagnostics/src';
import { isLegacyPublicBackendContext, LEGACY_BACKEND_CONTEXT } from './legacy-backend-context';
import { MAX_SOURCE_FILES } from './limits';

export class SourceHistoryError extends DiagnosticError {
  readonly stage = 'check';
  readonly retryable = false;
}

export async function committedSource(directory: string) {
  const commit = await sourceGit(directory, ['rev-parse', '--verify', 'HEAD']).catch((cause) => {
    throw new PublishError(
      'COMMIT_REQUIRED',
      'Could not read a committed source revision. Check the Git error below; for a new project, save a checkpoint with soyli checkpoint "Describe your changes".',
      'check',
      false,
      cause,
    );
  });
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new PublishError(
      'COMMIT_REQUIRED',
      'Save a source checkpoint first: soyli checkpoint "Describe your changes".',
    );
  const changed = await sourceGit(directory, [
    '-c',
    'core.fsmonitor=false',
    'status',
    '--porcelain',
    '--untracked-files=normal',
  ]);
  if (changed)
    throw new PublishError(
      'SOURCE_DIRTY',
      'Commit your changes before sharing: soyli checkpoint "Describe your changes".',
    );
  return commit;
}

/** Reachable history is published too. Inspect blobs even if deleted from the current tree. */
export async function inspectHistory(directory: string, commit: string) {
  if (!/^[a-f0-9]{40}$/.test(commit))
    throw new PublishError('COMMIT_REQUIRED', 'Invalid source commit.');
  const objects = (await sourceGit(directory, ['rev-list', '--objects', commit])).split('\n');
  if (objects.length > 10000)
    throw new PublishError(
      'HISTORY_LIMIT',
      'This publisher supports up to 10,000 reachable Git objects. Use ordinary Git for larger histories.',
    );
  // rev-list --objects emits only one path for a reused blob. Walk each distinct
  // commit tree too, so an allowed path cannot hide a forbidden alias of that blob.
  const revisions = (await sourceGit(directory, ['log', '--format=%H:%T', commit])).split('\n');
  const trees = new Set<string>(),
    checked = new Set<string>();
  const blobs = new Map<string, { bytes: Uint8Array; size: number }>();
  const legacyPublicContexts: { path: string; object: string; commit: string }[] = [];
  const { checkSource, checkSourceContent } = await import('./project');
  let total = 0,
    legacyInCurrentTree = false;
  const loadBlob = async (id: string) => {
    let blob = blobs.get(id);
    if (!blob) {
      const size = Number(await sourceGit(directory, ['cat-file', '-s', id]));
      total += size;
      if (total > 40 * 1024 * 1024)
        throw new PublishError(
          'HISTORY_LIMIT',
          'Public Git history exceeds the supported 40 MiB total. Keep large assets in Blossom.',
        );
      blob = {
        size,
        bytes: new TextEncoder().encode(
          await sourceGit(directory, ['cat-file', 'blob', id], {}, 40 * 1024 * 1024),
        ),
      };
      blobs.set(id, blob);
    }
    return blob;
  };
  for (const revision of revisions) {
    const [containingCommit, treeId] = revision.split(':');
    if (trees.has(treeId)) continue;
    trees.add(treeId);
    const tree = (await sourceGit(directory, ['ls-tree', '-r', '-z', treeId]))
      .split('\0')
      .filter(Boolean);
    if (containingCommit === commit) {
      if (tree.length > MAX_SOURCE_FILES)
        throw new PublishError(
          'SOURCE_LIMIT',
          `This source tree has ${tree.length} tracked files; soyLI supports up to ${MAX_SOURCE_FILES}. This is a tooling limit, not a creator quota.`,
        );
      legacyInCurrentTree = tree.some((entry) => entry.endsWith(`\t${LEGACY_BACKEND_CONTEXT}`));
    }
    const entries = new Map<string, { mode: string; id: string }>();
    const directories = new Set<string>();
    for (const entry of tree) {
      const match = /^(100644|100755|120000) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
      if (
        !match ||
        match[3].length > 200 ||
        match[3].split('/').some((part) => !part || part === '.' || part === '..') ||
        /[\\\s\u0000-\u001f\u007f]/.test(match[3])
      )
        throw new PublishError(
          'SOURCE_PATH',
          `Git history at commit ${containingCommit} has an unsupported source path or entry. Submodules and special entries are not supported.`,
        );
      const [, mode, id, path] = match;
      entries.set(path, { mode, id });
      const parts = path.split('/');
      while (parts.pop() && parts.length) directories.add(parts.join('/'));
    }
    const resolvedLinks = new Map<string, string>();
    const linkFailure = (path: string, id: string, cause?: PublishError) =>
      new SourceHistoryError(
        cause?.code ?? 'SOURCE_PATH',
        `Git history contains a blocked source link: ${path}.`,
        {
          operation: 'inspect public Git history',
          cause,
          detail: `Blob: ${id}\nContaining commit: ${containingCommit}\nRelease commit: ${commit}`,
          recovery:
            containingCommit === commit
              ? 'Replace this source link with a regular file or remove it, then save a checkpoint. Current release files must be regular files; safe historical in-repository file aliases may remain in earlier commits. No history rewrite is needed for a safe alias.'
              : 'Historical source links must resolve to public regular files within the same committed tree. Absolute, escaping, private, dangling, cyclic and directory links are not supported. Review the recorded commit locally without sharing contents; back up the repository before any explicitly approved history cleanup. soyLI has not rewritten history.',
        },
      );
    const resolveHistoricalLink = async (start: string) => {
      const trail = new Set<string>();
      let path = start;
      for (;;) {
        if (resolvedLinks.has(path)) {
          path = resolvedLinks.get(path)!;
          break;
        }
        if (trail.has(path))
          throw new PublishError('SOURCE_PATH', 'Cyclic historical source link.');
        const entry = entries.get(path);
        if (!entry) throw new PublishError('SOURCE_PATH', 'Dangling or directory source link.');
        checkSource(path, new Uint8Array());
        if (entry.mode !== '120000') break;
        trail.add(path);
        const blob = await loadBlob(entry.id);
        const target = new TextDecoder('utf-8', { fatal: true }).decode(blob.bytes);
        // sourceGit trims text output. Exact byte length prevents that behavior
        // from silently accepting whitespace or malformed bytes in a link target.
        if (
          blob.bytes.length !== blob.size ||
          !target ||
          target.length > 200 ||
          target.startsWith('/') ||
          /^[a-z]:/i.test(target) ||
          /[\\\s\u0000-\u001f\u007f\ufffd]/.test(target)
        )
          throw new PublishError('SOURCE_PATH', 'Unsupported historical source link target.');
        checkSourceContent(blob.bytes);
        const parts = path.split('/').slice(0, -1);
        const targetParts = target.split('/');
        for (const [index, part] of targetParts.entries()) {
          if (!part) throw new PublishError('SOURCE_PATH', 'Empty source link path component.');
          if (part === '.') continue;
          if (part === '..') {
            if (!parts.length)
              throw new PublishError('SOURCE_PATH', 'Source link escapes its tree.');
            parts.pop();
          } else {
            parts.push(part);
            const candidate = parts.join('/');
            checkSource(candidate, new Uint8Array());
            // Only file aliases are admitted. A link cannot stand in for a
            // parent directory, including before a later ../ component.
            if (index < targetParts.length - 1 && !directories.has(candidate))
              throw new PublishError('SOURCE_PATH', 'Source link traverses a non-directory.');
          }
        }
        path = parts.join('/');
        if (path.length > 200)
          throw new PublishError('SOURCE_PATH', 'Historical source link path exceeds its limit.');
      }
      for (const link of trail) resolvedLinks.set(link, path);
    };
    for (const [path, { mode, id }] of entries) {
      if (mode === '120000') {
        if (containingCommit === commit) throw linkFailure(path, id);
        // Resolution depends on the containing tree, even when the exact same
        // target-string blob and source path already passed in a newer commit.
        try {
          await resolveHistoricalLink(path);
        } catch (cause) {
          if (!(cause instanceof PublishError)) throw cause;
          if (cause.code === 'HISTORY_LIMIT') throw cause;
          throw linkFailure(path, id, cause);
        }
      }
      const key = `${id}:${path}`;
      if (checked.has(key)) continue;
      checked.add(key);
      if (checked.size > 10000)
        throw new PublishError(
          'HISTORY_LIMIT',
          'This publisher supports up to 10,000 historical file versions/paths. Use ordinary Git for larger histories.',
        );
      const blob = await loadBlob(id);
      let publicLegacy = false;
      try {
        checkSourceContent(blob.bytes);
        publicLegacy =
          path === LEGACY_BACKEND_CONTEXT && isLegacyPublicBackendContext(blob.bytes, blob.size);
        if (publicLegacy && !legacyInCurrentTree) {
          legacyPublicContexts.push({ path, object: id, commit: containingCommit });
        } else checkSource(path, blob.bytes);
      } catch (cause) {
        if (!(cause instanceof PublishError)) throw cause;
        const legacy = path === LEGACY_BACKEND_CONTEXT;
        throw new SourceHistoryError(cause.code, `Git history contains a blocked file: ${path}.`, {
          operation: 'inspect public Git history',
          detail: `Blob: ${id}\nContaining commit: ${containingCommit}\nRelease commit: ${commit}`,
          recovery:
            publicLegacy && legacyInCurrentTree
              ? 'Remove the generated context from Git tracking, keep .napplet-space/ ignored, and commit napplet.json plus backend module source. Retry soyli publish --dry-run. Local generated files can remain on disk.'
              : `${legacy ? 'This historical file does not match the supported public backend-context format. ' : ''}Changing publish.files or deleting a file from HEAD cannot remove it from Git history. Review it locally without sharing contents; rotate any exposed credentials. Back up the repository before an explicitly approved history cleanup, then retry soyli publish --dry-run. See docs/CLI.md (Historical source checks). soyLI has not rewritten history.`,
        });
      }
    }
  }
  return { commit, legacyPublicContexts };
}

export async function checkpoint(directory: string, message: string, author?: string) {
  if (!message.trim() || message.length > 1000)
    throw new Error('Provide a short checkpoint description.');
  await sourceGit(directory, ['rev-parse', '--git-dir']).catch(async () => {
    await sourceGit(directory, ['init']);
    await sourceGit(directory, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  });
  // Never auto-stage or commit as a side effect of publish/propose. This is explicit.
  const files = (
    await sourceGit(directory, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  )
    .split('\0')
    .filter(Boolean);
  const { regularFile, checkSource } = await import('./project');
  for (const path of files) {
    try {
      checkSource(path, await regularFile(directory, path, 40 * 1024 * 1024));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await sourceGit(directory, ['add', '--all', '--', '.']);
  await sourceGit(
    directory,
    ['commit', '-m', message],
    author
      ? {
          GIT_AUTHOR_NAME: author,
          GIT_AUTHOR_EMAIL: `${author}@nostr`,
          GIT_COMMITTER_NAME: author,
          GIT_COMMITTER_EMAIL: `${author}@nostr`,
        }
      : {},
  );
  return { commit: await committedSource(directory), publicHistory: true };
}

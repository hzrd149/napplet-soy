import { expect, test } from 'bun:test';
import { finalizeEvent } from 'nostr-tools';
import { validateManifest } from './manifest';
import { standalonePresentationKey } from './presentation-pairs';
import { socialScope } from './social';

test('presentation pairs require exact author, time and shared metadata and never share social identity', async () => {
  const author = new Uint8Array(32).fill(1),
    other = new Uint8Array(32).fill(2);
  const current = finalizeEvent(
    {
      kind: 35129,
      created_at: 1,
      content: 'Description',
      tags: [
        ['d', 'app'],
        ['title', 'Title'],
        ['x', 'a'.repeat(64)],
        ['R', 'storage'],
      ],
    },
    author,
  );
  const snapshot = finalizeEvent(
    {
      ...current,
      kind: 5129,
      tags: current.tags.filter((tag) => tag[0] !== 'd'),
    },
    author,
  );
  await validateManifest(current);
  await validateManifest(snapshot);
  expect(standalonePresentationKey(snapshot)).toBe(standalonePresentationKey(current));
  expect(socialScope(snapshot).key).toBe(snapshot.id);
  expect(socialScope(snapshot).key).not.toBe(socialScope(current).key);
  for (const candidate of [
    finalizeEvent({ ...snapshot, created_at: 2 }, author),
    finalizeEvent({ ...snapshot, content: 'Independent description' }, author),
    finalizeEvent({ ...snapshot, tags: [...snapshot.tags, ['O', 'connect']] }, author),
    finalizeEvent({ ...snapshot }, other),
  ]) {
    await validateManifest(candidate);
    expect(standalonePresentationKey(candidate)).not.toBe(standalonePresentationKey(current));
  }
});

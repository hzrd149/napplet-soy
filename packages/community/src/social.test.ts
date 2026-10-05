import { test, expect } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { finalizeEvent, generateSecretKey, getPublicKey, matchFilters } from 'nostr-tools';
import { CommunityStore } from './store';
import { SocialService, type SocialContext } from '../../backend/src/social-service';
import type { SocialRelay } from '../../backend/src/social-relay';
import {
  socialScope,
  commentTemplate,
  likeTemplate,
  deletionTemplate,
  socialView,
  commentLikeTemplate,
} from '../../protocol/src/social';
import { aggregateHash, type SignedEvent } from '../../protocol/src';
const author = generateSecretKey(),
  alice = generateSecretKey(),
  bob = generateSecretKey();
const now = Math.floor(Date.now() / 1000);
async function manifest(identifier = 'first', date = now - 100) {
  const hash = 'b'.repeat(64);
  return finalizeEvent(
    {
      kind: 35129,
      created_at: date,
      content: '',
      tags: [
        ['d', identifier],
        ['path', '/index.html', hash],
        ['x', await aggregateHash([{ path: '/index.html', hash }]), 'aggregate'],
      ],
    },
    author,
  );
}
test('comments, replies, likes and deletions bind to verified authors and one stable napplet thread', async () => {
  const current = await manifest(),
    next = await manifest('first', now - 50),
    other = await manifest('other');
  const scope = socialScope(current),
    first = finalizeEvent(commentTemplate(scope, 'hello', undefined, now - 10), alice),
    reply = finalizeEvent(commentTemplate(scope, 'reply', first, now - 9), bob);
  const like = finalizeEvent(likeTemplate(scope, current, now - 8), alice),
    duplicate = finalizeEvent(likeTemplate(scope, next, now - 7), alice);
  const forgedDelete = finalizeEvent(deletionTemplate([like, first], now - 6), bob),
    deletion = finalizeEvent(deletionTemplate([like], now - 5), alice);
  const commentDelete = finalizeEvent(deletionTemplate([first], now - 4), alice);
  const wrongThread = finalizeEvent(
    commentTemplate(socialScope(other), 'elsewhere', undefined, now - 3),
    bob,
  );
  const map = new Map([current, next, other].map((e) => [e.id, e]));
  let view = socialView(scope, [first, reply, like, duplicate, forgedDelete, wrongThread], map);
  expect(view.comments).toHaveLength(2);
  expect(view.likeCount).toBe(1);
  expect(view.comments[0].deleted).toBe(false);
  view = socialView(
    socialScope(next),
    [first, reply, like, duplicate, deletion, commentDelete],
    map,
  );
  expect(view.likeCount).toBe(1);
  expect(view.likes[0].id).toBe(duplicate.id);
  expect(view.comments[0].deleted).toBe(true);
  expect(view.comments[1].parent).toBe(first.id);
  const badLike = finalizeEvent(
    {
      ...likeTemplate(scope, other),
      tags: [
        ['e', other.id],
        ['p', getPublicKey(author)],
        ['a', scope.key],
      ],
    },
    bob,
  );
  expect(socialView(scope, [badLike], map).likeCount).toBe(0);
  const foreign = finalizeEvent(
    {
      kind: 5129,
      created_at: now,
      content: '',
      tags: [
        ['a', scope.key],
        ['x', 'a'.repeat(64), 'aggregate'],
        ['path', '/index.html', 'b'.repeat(64)],
      ],
    },
    bob,
  );
  expect(socialScope(foreign).key).toBe(foreign.id);
});
test('standalone snapshot ancestry never joins its parent social thread', async () => {
  const current = await manifest(),
    scope = socialScope(current);
  const legacy = finalizeEvent(
    {
      ...current,
      kind: 5129,
      tags: [...current.tags.filter((t) => t[0] !== 'd'), ['a', scope.key]],
    },
    author,
  );
  expect(socialScope(legacy).key).toBe(scope.key);
  for (const key of [author, bob]) {
    const snapshot = finalizeEvent(
      {
        kind: 5129,
        created_at: now,
        content: 'An independent snapshot',
        tags: [
          ['x', 'b'.repeat(64)],
          ['a', scope.key],
          ['A', scope.key],
        ],
      },
      key,
    );
    const own = socialScope(snapshot);
    expect(own.key).toBe(snapshot.id);
    expect(own.address).toBeNull();
    const comment = finalizeEvent(commentTemplate(own, 'snapshot comment'), alice);
    expect(socialView(scope, [comment], new Map([[snapshot.id, snapshot]])).comments).toHaveLength(
      0,
    );
    expect(socialView(own, [comment], new Map([[snapshot.id, snapshot]])).comments).toHaveLength(1);
  }
});
test('social service requires relay acknowledgements, retries exact events and persists per-thread metadata', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'space-social-'));
  const store = new CommunityStore(dir);
  try {
    const current = await manifest(),
      scope = socialScope(current),
      context: SocialContext = { manifest: current, scope, relays: ['wss://example.com'] };
    const events: SignedEvent[] = [current];
    const sent: string[] = [];
    let fail = true;
    const relay: SocialRelay = {
      query: async (_urls, filters) => events.filter((e) => matchFilters(filters, e)),
      publish: async (_urls, event) => {
        sent.push(event.id);
        if (fail) throw new Error('lost ACK');
        events.push(event);
        return ['wss://example.com'];
      },
    };
    const service = new SocialService(store, relay),
      comment = finalizeEvent(commentTemplate(scope, '<script>plain text</script>'), alice);
    await expect(service.write(context, comment)).rejects.toThrow('lost ACK');
    expect((await service.data(context)).comments).toHaveLength(0);
    fail = false;
    await service.write(context, comment);
    await service.write(context, comment);
    expect(new Set(sent).size).toBe(1);
    expect((await service.data(context)).comments).toHaveLength(1);
    const forged = { ...comment, content: 'tampered' };
    await expect(service.write(context, forged)).rejects.toThrow('signature');
    const other = await manifest('other'),
      wrong = finalizeEvent(commentTemplate(socialScope(other), 'no'), bob);
    await expect(service.write(context, wrong)).rejects.toThrow('thread');
    await expect(
      service.write(context, finalizeEvent(deletionTemplate([comment]), bob)),
    ).rejects.toThrow('thread');
    const like = finalizeEvent(likeTemplate(scope, current), alice);
    await service.write(context, like);
    expect((await service.data(context)).likeCount).toBe(1);
    await service.write(context, finalizeEvent(deletionTemplate([like]), alice));
    expect((await service.data(context)).likeCount).toBe(0);
    const commentLike = finalizeEvent(commentLikeTemplate(comment, now + 1), bob);
    await service.write(context, commentLike);
    expect((await service.data(context)).comments[0].likeCount).toBe(1);
    expect((await service.data(context)).likeCount).toBe(0);
    await service.write(context, finalizeEvent(commentLikeTemplate(comment, now + 2), bob));
    expect((await service.data(context)).comments[0].likeCount).toBe(1);
    await expect(
      service.write(context, finalizeEvent(commentLikeTemplate(wrong), alice)),
    ).rejects.toThrow('thread');
    await expect(
      service.write(
        context,
        finalizeEvent(
          {
            ...commentLikeTemplate(comment),
            tags: [
              ['e', comment.id],
              ['p', getPublicKey(author)],
              ['k', '1111'],
            ],
          },
          bob,
        ),
      ),
    ).rejects.toThrow('thread');
    await service.write(context, finalizeEvent(deletionTemplate([commentLike], now + 3), bob));
    expect((await service.data(context)).comments[0].likeCount).toBe(1);
    // A fresh client discovers comment reactions using event filters, not the napplet's #a.
    const freshStore = new CommunityStore(join(dir, 'fresh'));
    try {
      const fresh = new SocialService(freshStore, relay);
      await fresh.refresh(context);
      expect((await fresh.data(context)).comments[0].likeCount).toBe(1);
    } finally {
      freshStore.close();
    }
    await service.write(context, finalizeEvent(deletionTemplate([comment], now + 4), alice));
    await expect(
      service.write(context, finalizeEvent(commentLikeTemplate(comment, now + 5), bob)),
    ).rejects.toThrow('thread');
    const profile = finalizeEvent(
      { kind: 0, created_at: now, content: '{"name":"Alice"}', tags: [] },
      alice,
    );
    store.put(scope.key, [profile]);
    store.put(socialScope(other).key, [profile]);
    expect(store.events(scope.key).some((e) => e.id === profile.id)).toBe(true);
    expect(store.events(socialScope(other).key).some((e) => e.id === profile.id)).toBe(true);
    const restarted = new SocialService(store, relay);
    expect((await restarted.data(context)).comments[0].deleted).toBe(true);
  } finally {
    store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('addressed reactions and root comments survive a pruned replaced event, with or without optional k', async () => {
  const old = await manifest(),
    next = await manifest('first', now - 50),
    other = await manifest('other');
  const scope = socialScope(next),
    map = new Map([[next.id, next]]);
  const like = finalizeEvent(likeTemplate(socialScope(old), old), alice);
  const comment = finalizeEvent(commentTemplate(socialScope(old), 'before the update'), bob);
  const withoutKind = finalizeEvent(
    { ...like, tags: like.tags.filter((t) => t[0] !== 'k') },
    alice,
  );
  expect(socialView(scope, [like, withoutKind, comment], map)).toMatchObject({ likeCount: 1 });
  expect(socialView(scope, [comment], map).comments).toHaveLength(1);
  const wrong = finalizeEvent(
    { ...like, tags: like.tags.map((t) => (t[0] === 'e' ? ['e', other.id] : t)) },
    alice,
  );
  expect(socialView(scope, [wrong], new Map([...map, [other.id, other]])).likeCount).toBe(0);
  const idOnly = finalizeEvent({ ...like, tags: like.tags.filter((t) => t[0] !== 'a') }, alice);
  expect(socialView(scope, [idOnly], map).likeCount).toBe(0);
  const badKind = finalizeEvent(
    { ...like, tags: like.tags.map((t) => (t[0] === 'k' ? ['k', '5129'] : t)) },
    alice,
  );
  expect(socialView(scope, [badKind], map).likeCount).toBe(0);
  const deleted = finalizeEvent(deletionTemplate([like]), alice);
  expect(socialView(scope, [like, deleted], map).likeCount).toBe(0);
});

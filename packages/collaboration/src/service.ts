import { ASSET_LOCK, parseAssets } from '../../assets/src';
import { DiagnosticError } from '../../diagnostics/src';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { nip19 } from 'nostr-tools';
import { join } from 'node:path';
import { ProtocolClient } from '../../client/src/nostr';
import { Accounts, captureAccount } from '../../identity/src/accounts';
import type { Network } from '../../identity/src/signer';
import { sha256, verifiedEvent, type SignedEvent } from '../../protocol/src';
import { defaultTargets, projectSchema, resolveTargets } from '../../publish/src/config';
import { readBinding, effectiveProject } from '../../publish/src/binding';
import { committedSource } from '../../publish/src/git-source';
import { freezeSource, inspectProject } from '../../publish/src/project';
import { executableBytes } from '../../publish/src/artifact';
import { uploadBlob } from '../../blossom/src/client';
import { prepareSource, publishSource, sourceGit, sourceUrls } from '../../grasp/src/client';
import type { PublishOptions } from '../../publish/src';
import { Journal } from '../../publish/src/journal';
import {
  latest,
  proposalId,
  readProposals,
  readRepository,
  repositoryRef,
  tag,
  type Proposal,
  type Repository,
} from './protocol';
import { mergeReviewed, cloneUrl } from './git';

export type CollaborationOptions = {
  directory: string;
  network: Network;
  accounts?: Pick<Accounts, 'current' | 'signer'>;
  onAuth?: (url: string) => Promise<void>;
  signal?: AbortSignal;
};
export async function collaborationContext(options: CollaborationOptions) {
  const binding = await readBinding(options.directory);
  const project = await effectiveProject(
    options.directory,
    projectSchema.parse(await Bun.file(join(options.directory, 'napplet.json')).json()),
  );
  const targets = resolveTargets(project, options.network);
  const account = await (options.accounts ?? new Accounts(options.network)).current();
  const client = new ProtocolClient(() => [
    targets.relay,
    sourceUrls(
      targets.grasp,
      account?.pubkey ?? '0'.repeat(64),
      'project',
      options.network === 'local',
    ).relay,
    ...targets.mirrors,
  ]);
  return { binding, project, targets, account, client };
}
/** The creator's own NIP-34 repository, configured or found among the Git remotes. */
async function linkedRepository(
  options: CollaborationOptions,
  context: Awaited<ReturnType<typeof collaborationContext>>,
) {
  if (!context.account) return null;
  const { selectRepository } = await import('../../publish/src/repository');
  const { projectRepositoryReference } = await import('../../publish/src/config');
  return selectRepository({
    directory: options.directory,
    pubkey: context.account.pubkey,
    configured: projectRepositoryReference(context.project, options.network),
    signal: options.signal,
  });
}
export async function projectRepository(options: CollaborationOptions, client: ProtocolClient) {
  const binding = await readBinding(options.directory);
  if (binding?.upstream) return readRepository(client, binding.upstream.address);
  const context = await collaborationContext(options);
  context.client.close();
  if (!context.account) throw new Error('Select the project creator or open a repository address.');
  const linked = await linkedRepository(options, context);
  if (linked)
    return readRepository(
      client,
      nip19.naddrEncode({
        kind: 30617,
        pubkey: linked.pubkey,
        identifier: linked.identifier,
        relays: linked.relays,
      }),
    );
  const { projectIdentity } = await import('../../publish/src/config');
  return readRepository(
    client,
    sourceUrls(
      context.targets.grasp,
      context.account.pubkey,
      projectIdentity(context.project),
      options.network === 'local',
    ).portable,
  );
}
async function atomic(path: string, value: unknown) {
  await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
  const temp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temp, path);
}
export async function propose(
  options: CollaborationOptions & {
    description: string;
    resume?: boolean;
    check: PublishOptions['check'];
    checkpoint?: (phase: 'source' | 'proposal') => Promise<void>;
  },
) {
  if (!options.resume && (!options.description.trim() || options.description.length > 8000))
    throw new Error('Provide a proposal description of 1–8000 characters.');
  const accounts = await captureAccount(options.accounts ?? new Accounts(options.network));
  const context = await collaborationContext({ ...options, accounts }),
    { client, targets, account, project, binding } = context;
  let signer: Awaited<ReturnType<Accounts['signer']>> | undefined;
  try {
    if (!account) throw new Error('Create or connect a creator identity first.');
    if (!binding?.upstream)
      throw new Error(
        'This project has no Git upstream. Remix a napplet with published Git history first.',
      );
    const repository = await readRepository(client, binding.upstream.address);
    const branch = await sourceGit(options.directory, ['symbolic-ref', '--short', 'HEAD']);
    const key = (
      await sha256(`${repository.address}:${branch}:${account.pubkey}:${binding.project.previewId}`)
    ).slice(0, 16);
    const path = join(options.directory, '.napplet-space', 'proposals', `${key}.json`);
    return await new Journal(options.directory, options.network).lock(async () => {
      let saved: any;
      try {
        saved = JSON.parse(await readFile(path, 'utf8'));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
      if (options.resume && !saved) throw new Error('No saved proposal exists on this branch.');
      signer = await accounts.signer({
        signal: options.signal,
        onAuth: options.onAuth,
        kinds: [5129, 30617, 30618, 24242, 1618, 1619],
      });
      if ((await signer.getPublicKey()) !== account.pubkey)
        throw new Error('Signer identity changed.');
      if (!options.resume) {
        const commit = await committedSource(options.directory);
        if (saved && !saved.done && saved.commit !== commit)
          throw new Error(
            'Finish the saved proposal with soyli propose --resume before proposing new edits.',
          );
        if (!saved || saved.commit !== commit) {
          if (saved?.root) {
            const current = (await readProposals(client, repository, saved.root.id)).find(
              (p) => p.root.id === saved.root.id,
            );
            if (!current || current.revision.id !== saved.event.id)
              throw new Error(
                'The proposal changed remotely. Review its latest revision before updating.',
              );
            if (!['open', 'draft'].includes(current.status))
              throw new Error('Reopen this proposal before updating it.');
          }
          const base = await sourceGit(options.directory, [
            'merge-base',
            binding.upstream!.commit,
            commit,
          ]);
          if (base === commit) throw new Error('There are no changes to propose.');
          const inspected = await inspectProject(
            options.directory,
            options.network,
            account.pubkey,
          );
          const checked = await options.check(inspected.contents);
          if (
            (await committedSource(options.directory)) !== commit ||
            (await inspectProject(options.directory, options.network, account.pubkey))
              .fingerprint !== inspected.fingerprint
          )
            throw new Error('Source or build changed during preview checking.');
          const folder = join(options.directory, '.napplet-space', 'proposals', key, commit);
          await freezeSource(folder, inspected.contents, Math.floor(Date.now() / 1000), {
            directory: options.directory,
            commit,
          });
          const bytes = executableBytes(inspected.contents);
          const put = async (bytes: Uint8Array, type: string) => {
            await uploadBlob({
              origin: targets.blossom,
              bytes,
              type,
              signer: signer!,
              local: options.network === 'local',
              signal: options.signal,
            });
            return `${targets.blossom}/${await sha256(bytes)}`;
          };
          for (const asset of parseAssets(inspected.contents.get(ASSET_LOCK)).assets.filter(
            (a) => a.storage === 'external',
          ))
            await put(inspected.contents.get(asset.path)!, asset.mime);
          await put(bytes, 'text/html');
          if (inspected.plan.icon)
            await put(inspected.contents.get(inspected.plan.icon.file)!, inspected.plan.icon.mime);
          const image = checked.preview ? await put(checked.preview, 'image/png') : undefined;
          const now = Math.max(Math.floor(Date.now() / 1000), (saved?.event.created_at ?? 0) + 1);
          const manifest = await signer!.signEvent({
            kind: 5129,
            created_at: now,
            content: inspected.plan.description,
            tags: [
              ['title', project.title ?? project.name],
              ['x', inspected.plan.artifactHash],
              ['server', targets.blossom],
              ['source-commit', commit],
              ...inspected.plan.requires.map((r) => ['R', r]),
              ...(inspected.plan.optionalDomains ?? []).map((r) => ['O', r]),
              ...(inspected.plan.archetypes ?? []).map((a) => ['z', a]),
              ...(inspected.plan.intents ?? []).map((i) => ['i', i.intent, ...i.parameters]),
              ...(inspected.plan.icon
                ? [['icon', inspected.plan.icon.hash, inspected.plan.icon.mime]]
                : []),
              ...(project.remix?.parent ? [['a', project.remix.parent]] : []),
              ...(project.remix?.origin ? [['A', project.remix.origin]] : []),
              ...(image ? [['image', image]] : []),
            ],
          });
          const descriptor = new TextEncoder().encode(
            JSON.stringify({
              version: 1,
              commit,
              manifest,
              check: { profile: checked.profile, browser: checked.browser },
              ...(image ? { image } : {}),
            }),
          );
          const url = await put(descriptor, 'application/json');
          const identifier = `proposal-${key}`;
          const source = await prepareSource({
            directory: join(folder, 'source'),
            identifier,
            title: project.title ?? project.name,
            origin: targets.grasp,
            signer: signer!,
            local: options.network === 'local',
            createdAt: now,
            releaseRefs: {
              ...saved?.releaseRefs,
              [`refs/tags/release-${commit.slice(0, 16)}`]: commit,
            },
            upstream: repository.address,
          });
          const urls = sourceUrls(
            targets.grasp,
            account.pubkey,
            identifier,
            options.network === 'local',
          );
          const event = verifiedEvent(
            await signer!.signEvent({
              kind: saved ? 1619 : 1618,
              created_at: now,
              content: options.description,
              tags: [
                ['a', repository.address],
                ...(repository.euc ? [['r', repository.euc]] : []),
                ...repository.maintainers.map((p) => ['p', p]),
                ...(saved
                  ? [
                      ['E', saved.root.id],
                      ['P', account.pubkey],
                    ]
                  : [
                      ['subject', options.description.split('\n')[0].slice(0, 160)],
                      ['branch-name', branch],
                    ]),
                ['c', commit],
                ['clone', urls.clone],
                ['merge-base', base],
                ['soy-preview', url, await sha256(descriptor), commit],
              ],
            }),
          );
          saved = {
            version: 1,
            root: saved?.root ?? event,
            event,
            commit,
            base,
            folder,
            source,
            targets,
            repository: repository.address,
            relays: repository.relays,
            previous: saved?.commit ?? null,
            releaseRefs: Object.fromEntries(
              source.state.tags
                .filter((t) => t[0].startsWith('refs/tags/'))
                .map((t) => [t[0], t[1]]),
            ),
            done: false,
          };
          await atomic(path, saved);
        }
      }
      if (saved.event.pubkey !== account.pubkey || saved.repository !== repository.address)
        throw new Error('Saved proposal identity mismatch.');
      // The signed event and real commit survive retries; no duplicate PR or changed preview.
      await publishSource({
        directory: join(saved.folder, 'source'),
        origin: saved.targets.grasp,
        publication: saved.source,
        local: options.network === 'local',
        expectedCommit: saved.previous,
      });
      await options.checkpoint?.('source');
      await client.publish(verifiedEvent(saved.event), saved.relays);
      // GRASP-01 holds a PR in purgatory until its c commit is available in the
      // target repository. Push only the immutable event ref, never a maintainer branch.
      const pushFailures: Error[] = [];
      for (const clone of repository.clones.slice(0, 4)) {
        try {
          await sourceGit(join(saved.folder, 'source'), [
            'push',
            '--no-verify',
            cloneUrl(clone, options.network === 'local'),
            `${saved.commit}:refs/nostr/${saved.event.id}`,
          ]);
          break;
        } catch (cause) {
          pushFailures.push(
            new DiagnosticError('GIT_PROPOSAL_PUSH', 'Proposal ref push failed.', {
              target: clone,
              cause,
            }),
          );
        }
      }
      const inbox = new ProtocolClient(() =>
        repository.relays.length ? repository.relays : client.relays(),
      );
      try {
        const visible = await inbox.query([{ ids: [saved.event.id], limit: 1 }], repository.relays);
        if (!visible.some((e) => e.id === saved.event.id))
          throw new Error(
            'The upstream relay has not made this proposal queryable. Retry with propose --resume.',
          );
      } catch (cause) {
        throw new DiagnosticError(
          'PROPOSAL_UNCONFIRMED',
          'Could not confirm the proposal in the upstream inbox.',
          {
            operation: 'publish proposal',
            recovery:
              'Address the relay or Git error, then run soyli propose --resume to resend the saved proposal.',
            cause: new AggregateError([cause, ...pushFailures], 'Proposal confirmation failed.'),
          },
        );
      } finally {
        inbox.close();
      }
      await options.checkpoint?.('proposal');
      saved.done = true;
      await atomic(path, saved);
      return {
        proposal: saved.root.id,
        revision: saved.event.id,
        head: saved.commit,
        base: saved.base,
        repository: saved.repository,
        preview: tag(saved.event, 'soy-preview'),
        status: 'proposed',
        sourcePublished: true,
        nappletReleased: false,
      };
    });
  } finally {
    await signer?.close();
    client.close();
  }
}
export async function proposalAction(
  options: CollaborationOptions & {
    proposal: string;
    action: 'merge' | 'close' | 'reopen' | 'comment';
    revision?: string;
    target?: string;
    text?: string;
  },
) {
  options = {
    ...options,
    accounts: await captureAccount(options.accounts ?? new Accounts(options.network)),
  };
  const context = await collaborationContext(options),
    { client, account } = context;
  let signer: Awaited<ReturnType<Accounts['signer']>> | undefined;
  try {
    const id = proposalId(options.proposal),
      root = (await client.query([{ ids: [id], kinds: [1618, 1617], limit: 1 }]))[0];
    if (!root) throw new Error('Proposal unavailable.');
    const repository = await readRepository(client, tag(root, 'a') ?? '');
    const proposal = (await readProposals(client, repository, id)).find((p) => p.root.id === id);
    if (!proposal) throw new Error('Proposal unavailable.');
    if (!account) throw new Error('Sign in with soyli account connect or create.');
    const maintainer = repository.maintainers.includes(account.pubkey);
    if (options.action === 'merge') {
      if (!maintainer)
        throw new Error('Only an announced repository maintainer can accept changes.');
      if (
        !options.revision ||
        !options.target ||
        options.revision !== proposal.revision.id ||
        !proposal.head
      )
        throw new Error(
          'Pin the reviewed revision and target with --revision and --target; review again if either changed.',
        );
      if (!['open', 'draft'].includes(proposal.status))
        throw new Error('This proposal is no longer open.');
      if (proposal.patch) throw new Error('Use ngit to apply this external patch series.');
      if (repository.euc)
        await sourceGit(options.directory, [
          'merge-base',
          '--is-ancestor',
          repository.euc,
          options.target,
        ]);
      const remote = latest(
        await client.query(
          [
            {
              kinds: [30618],
              authors: [repository.pubkey],
              '#d': [repository.identifier],
              limit: 5,
            },
          ],
          repository.relays,
        ),
      )[0];
      const remoteHead = remote && tag(remote, 'refs/heads/main');
      if (remoteHead)
        await sourceGit(options.directory, [
          'merge-base',
          '--is-ancestor',
          remoteHead,
          options.target,
        ]).catch((cause) => {
          const advanced = cause instanceof DiagnosticError && cause.context.exitCode === 1;
          throw new DiagnosticError(
            advanced ? 'GIT_UPSTREAM_ADVANCED' : 'GIT_ANCESTRY_CHECK',
            advanced
              ? 'The upstream branch advanced. Fetch and review the new target before merging.'
              : 'Could not check the upstream branch before merging.',
            { operation: 'check proposal ancestry', cause },
          );
        });
      return mergeReviewed(options.directory, {
        head: proposal.head,
        target: options.target,
        revision: proposal.revision.id,
        clones: proposal.clones,
        author: account.pubkey,
        local: options.network === 'local',
      });
    }
    if (options.action !== 'comment' && !maintainer && root.pubkey !== account.pubkey)
      throw new Error('Only the proposer or maintainers can change its status.');
    signer = await (options.accounts ?? new Accounts(options.network)).signer({
      signal: options.signal,
      onAuth: options.onAuth,
      kinds: [1111, 1630, 1631, 1632, 30617, 30618],
    });
    const comment = options.action === 'comment';
    const template = {
      kind: comment ? 1111 : options.action === 'close' ? 1632 : 1630,
      created_at: Math.max(
        Math.floor(Date.now() / 1000),
        (proposal.statusEvent?.created_at ?? root.created_at) + 1,
      ),
      content: options.text ?? '',
      tags: comment
        ? [
            ['E', root.id],
            ['K', String(root.kind)],
            ['P', root.pubkey],
            ['e', root.id],
            ['k', String(root.kind)],
            ['p', root.pubkey],
          ]
        : [
            ['e', root.id, '', 'root'],
            ['a', repository.address],
            ['p', root.pubkey],
            ['p', repository.pubkey],
          ],
    };
    const key = await sha256(
      JSON.stringify({
        proposal: root.id,
        action: options.action,
        text: template.content,
        pubkey: account.pubkey,
      }),
    );
    const outbox = join(options.directory, '.napplet-space', 'review-outbox', `${key}.json`);
    let event: SignedEvent;
    try {
      event = verifiedEvent(JSON.parse(await readFile(outbox, 'utf8')));
      if (
        !comment &&
        proposal.statusEvent &&
        proposal.statusEvent.id !== event.id &&
        proposal.statusEvent.created_at >= event.created_at
      ) {
        event = verifiedEvent(await signer.signEvent(template));
        await atomic(outbox, event);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      event = verifiedEvent(await signer.signEvent(template));
      await atomic(outbox, event);
    }
    if (
      event.pubkey !== account.pubkey ||
      event.kind !== template.kind ||
      event.content !== template.content ||
      JSON.stringify(event.tags) !== JSON.stringify(template.tags)
    )
      throw new Error('Saved review action changed.');
    await client.publish(event, repository.relays);
    return { event: event.id, status: options.action };
  } finally {
    await signer?.close();
    client.close();
  }
}

/** Publish a reviewed Git merge without releasing a new napplet. */
export async function pushSource(options: CollaborationOptions) {
  options = {
    ...options,
    accounts: await captureAccount(options.accounts ?? new Accounts(options.network)),
  };
  const context = await collaborationContext(options);
  const { client, account, targets } = context;
  let signer: Awaited<ReturnType<Accounts['signer']>> | undefined;
  try {
    const linked = await linkedRepository(options, context);
    if (linked)
      throw new DiagnosticError(
        'SOURCE_LINKED',
        'This project’s source lives in your own repository; soyLI does not push to it.',
        {
          operation: 'push source',
          target: linked.address,
          recovery: `Push with git or ngit to ${linked.origin === 'publish.repository' ? 'that repository' : linked.origin.replace(/^remote /, 'the remote ')}.`,
        },
      );
    const repository = await projectRepository(options, client);
    if (!account || account.pubkey !== repository.pubkey)
      throw new Error(
        'soyli push currently signs the repository owner’s state. Other maintainers can push with ngit.',
      );
    const commit = await committedSource(options.directory);
    const { inspectHistory } = await import('../../publish/src/git-source');
    await inspectHistory(options.directory, commit);
    const previous = latest(
      await client.query(
        [{ kinds: [30618], authors: [repository.pubkey], '#d': [repository.identifier], limit: 5 }],
        repository.relays,
      ),
    )[0];
    if (
      previous?.tags.some(
        (t) =>
          t[0].startsWith('refs/') &&
          t[0] !== 'refs/heads/main' &&
          !/^refs\/tags\/release-[a-f0-9]{16}$/.test(t[0]),
      )
    )
      throw new Error('This repository has additional refs; use ngit. soyLI will not remove them.');
    const parent = previous && tag(previous, 'refs/heads/main');
    if (parent) await sourceGit(options.directory, ['merge-base', '--is-ancestor', parent, commit]);
    signer = await (options.accounts ?? new Accounts(options.network)).signer({
      signal: options.signal,
      onAuth: options.onAuth,
      kinds: [1111, 1630, 1631, 1632, 30617, 30618],
    });
    const clone = repository.clones.find((url) => url.startsWith(targets.grasp + '/'));
    if (!clone)
      throw new Error('Configure this repository’s GRASP origin before pushing, or use git/ngit.');
    const publication = await prepareSource({
      directory: options.directory,
      identifier: repository.identifier,
      title: tag(repository.event, 'name') ?? repository.identifier,
      origin: targets.grasp,
      signer,
      local: options.network === 'local',
      createdAt: Math.max(
        Math.floor(Date.now() / 1000),
        repository.event.created_at + 1,
        (previous?.created_at ?? 0) + 1,
      ),
      releaseRefs: Object.fromEntries(
        (previous?.tags ?? [])
          .filter((t) => t[0].startsWith('refs/tags/'))
          .map((t) => [t[0], t[1]]),
      ),
    });
    // Keep the repository announcement (including its maintainer set and clone URLs) intact.
    publication.announcement = repository.event;
    await publishSource({
      directory: options.directory,
      origin: targets.grasp,
      publication,
      local: options.network === 'local',
      expectedCommit: parent ?? null,
    });
    const proposals = await readProposals(client, repository);
    for (const proposal of proposals.filter((p) => p.status === 'open' && p.head)) {
      const included = await sourceGit(options.directory, [
        'merge-base',
        '--is-ancestor',
        proposal.head!,
        commit,
      ]).then(
        () => true,
        () => false,
      );
      if (!included) continue;
      const event = await signer.signEvent({
        kind: 1631,
        created_at: Math.max(
          Math.floor(Date.now() / 1000),
          (proposal.statusEvent?.created_at ?? proposal.revision.created_at) + 1,
        ),
        content: 'Merged and published in Git.',
        tags: [
          ['e', proposal.root.id, '', 'root'],
          ['e', proposal.revision.id, '', 'reply'],
          ['a', repository.address],
          ['p', proposal.root.pubkey],
          ['p', repository.pubkey],
          ['merge-commit', commit],
          ['r', commit],
        ],
      });
      await client.publish(event, repository.relays);
    }
    return { state: 'git_published', commit, nappletReleased: false };
  } finally {
    await signer?.close();
    client.close();
  }
}

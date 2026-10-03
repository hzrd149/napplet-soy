# Public Git collaboration with soyLI

The same working copy supports a personal napplet and changes proposed upstream.
Code and the pushed commit ancestry are open source by default. Editing or making a
local checkpoint does not upload anything. New projects use MIT; remixes keep their
existing license. A website account is unnecessary: the CLI uses your Nostr signer.

`soyli new` saves the generated scaffold and agent guidance in an initial local
commit before development begins. This checkpoint needs no creator identity and
uploads nothing. Git-backed remixes retain the exact published commit and ancestry;
existing work is never automatically checkpointed by setup or skill updates.

soyLI 0.16.3 retains both Git output streams in failure diagnostics, including
conflicting filenames emitted by `merge-tree` on stdout. Merge preflight needs
Git 2.38 or newer. Conflicts leave the checkout unchanged; the diagnostic explains
how to resolve with ordinary Git and how to abort that manual attempt. Tool errors
(including an unsupported Git option) remain distinct from merge conflicts.

```sh
soyli remix <napplet-link> my-idea
cd my-idea
soyli setup
# Make a change with your editor or agent; run its relevant checks.
soyli checkpoint "Add a new idea"
soyli propose "Add a new idea"
# Optional, before or after proposing:
soyli publish
```

A Git-backed remix fetches the exact signed `source-commit` from the source's
NIP-34 clone servers, preserves its ancestry, and starts `pr/my-changes`. `upstream`
is the HTTP Git remote; `nostr` is the portable remote for git-remote-nostr/ngit.
It does not rewrite the original title, README, license or creator in tracked files.
Run `soyli skills update` explicitly if you want to update inherited agent guides.
Archive/HTML-only remixes remain available, but cannot invent a Git upstream for PRs.
If an advertised Git source is unavailable, retry it rather than silently losing ancestry.

The ignored `.napplet-space/project.json` is the visible local publication binding:
creator, independent identifier, upstream, targets and backend provider. `soyli config`
shows its path and effective destinations; `config init` materializes editable targets
there. `napplet.json` remains portable source metadata and configuration. Preserve both
Git and the ignored binding/journals when moving a working copy between machines.

`checkpoint` explicitly stages the working tree and creates a normal Git commit after
source checks. Ordinary `git add`/`git commit` work equally well. Inspect your diff first;
keep unrelated work out of the checkout. `publish` and `propose` require a clean committed
tree, and their CLI entry points build `dist/index.html` projects before sandbox checks.
New projects without separate builds use committed `index.html`. Source archives contain
the actual Git tree; ignored build outputs are separate Blossom artifacts.

## Proposing and retrying

`propose` checks the built HTML in the host, captures a screenshot, uploads preview
artifacts directly to the configured Blossom server and pushes the real Git tip to a
contributor-owned GRASP repository. It publishes an ordinary NIP-34 PR (1618), or an
update (1619) to the existing proposal for this working copy/branch. It does not release
a named napplet. Repeating a completed tip reuses its event; `propose --resume` finishes
an interrupted signed submission. A different pending tip must finish before new edits
can be proposed. External updates and closed proposals stop automatic updates.

The repository announcement carries the upstream `u` relationship. Existing Git
clients can fetch the PR's `clone` URL and `c` commit; ngit can read its NIP-34 events.
soyLI pushes the proposal commit to the target’s standard `refs/nostr/<event-id>`
ref when supported, then requires relay read-back; a GRASP acknowledgement while
the proposal is held pending Git objects does not count as success.
No proprietary PR server is involved. The initial adapter uses an ordinary hosted
contributor repository, not optional GRASP-06 transient PR hosting.

## Reviewing and accepting

In soyLI 0.14.0, `soyli dev` → **Manage project → Proposals** embeds this same
review interface. Changes/checkpoints and publishing have their own workshop
sections. Opening review runs the supplied checked HTML, not contributor build
scripts. Merging remains a local Git operation; the GUI does not silently push,
publish, install dependencies or solve conflicts. The reviewed revision remains
pinned, and a changed maintainer identity or target requires a refreshed review.
See [workshop controls and limits](CLI.md#local-workshop--0140).

```sh
soyli review                         # proposal inbox for this project's upstream
soyli review <proposal-event-id>      # open one proposal
soyli proposals --json
soyli review <proposal-event-id> --json --no-open
soyli comment <proposal-event-id> "Please adjust the controls"
soyli close <proposal-event-id> "Not a fit for this version"
soyli reopen <proposal-event-id>
```

The loopback review app lists proposals/revisions, plays Original or Proposed, shows
the Git diff and public NIP-22 discussion, and offers local merge/close/reopen actions.
Refresh never silently replaces the selected revision. Mutations require a random
session token and same-origin request; no public review-control service is exposed.
Opening a proposal never installs dependencies or executes its build scripts.

`soyli review <id> --rebuild` explicitly opts into setup/build of that selected source
in a temporary checkout. Use it to compare source and supplied preview; it is not a
reproducibility attestation or a general-purpose code-execution sandbox. The resulting
artifact runs in the ordinary napplet sandbox with a local backend where configured.
Prebuilt previews have isolated player state and no original creator credentials.
Website previews use a guest session and require the usual consent for custom backends.

An agent can merge the exact reviewed revision and target:

```sh
soyli merge <proposal-id> --revision <reviewed-event-id> --target <reviewed-local-HEAD>
soyli push       # publish Git state and merged status, without a napplet release
soyli publish    # deliberately release the merged napplet
```

Merging does not delete the proposal, its revisions or discussion. `soyli push`
announces a separate NIP-34 merged-status event for included open proposals.
A local or ordinary Git merge alone does not announce that relay status.

Merge requires a maintainer signer, current proposal revision, unchanged clean local
HEAD and an upstream state already integrated into that target. A Git conflict stops
before changing the checkout; resolve using ordinary Git/ngit. Git authorship and
ancestry are retained. `push` currently supports the repository owner and the managed
main/release-tag layout; other maintainer/branch layouts use ngit. A relay's “merged”
status is an authorized claim, not independent proof of integration into a Git branch.

The shell's **Proposed changes** section queries Nostr directly. `/proposals/<event-id>`
is a shareable observer view with revision selection, discussion and opt-in playback.
The local-review command appears only after selecting a proposal; the empty inbox
shows contribution guidance. Long commands wrap visually and copy as one command.
External proposals without Soy metadata remain visible, with a local-review command.
External patch roots (1617) can be read; applying/revising patch series uses ngit.

## Optional runnable preview attachment

NIP-34 is pinned to `6d2979b3f503a8539c983efbcdcf901bbcf9ed23` for this adapter.
The authoritative NIP-5D pin remains unchanged. The only new Soy extension is an
optional tag on the signed PR/update:

```text
["soy-preview", "https://blossom.example/<descriptor-sha256>", "<descriptor-sha256>", "<git-c-commit>"]
```

The bounded (64 KiB) JSON descriptor contains `version: 1`, `commit`, a signed
NIP-5D snapshot `manifest`, `check: {profile, browser}`, and optional `image` URL.
Its snapshot is an attachment, not a published gallery listing. The reader verifies
the descriptor hash, author, exact source commit and ordinary manifest/artifact hashes.
Updates need their own bound attachment; a prior revision's preview is never substituted.
A signed preview proves attribution and bytes, not that its source reproduces those bytes.
Missing, unsupported, stale or inaccessible attachments do not hide a valid proposal.

Bounds: up to 100 recent proposal roots plus an explicitly requested root, and 500
related events per query; current Git profile
supports 1,024 regular source files, 40 MiB of reachable blobs and 10,000 reachable objects.
The file count is a tooling safety budget, not a Nostr quota. Current source and
archives require regular files; safe historical aliases to public regular files
inside the same committed tree may remain after replacement or removal at HEAD.
Unsafe links, submodules, credential files and Git attributes/modules remain blocked.
Playable previews use the 25 MiB HTML limit; the public website, indexer and runtime
must deploy that limit before admitting larger artifacts. Managed resources still
have their separate 10 MiB limit. Git-backed automatic setup/build/publish currently
expects a valid `napplet.json` and the supported entry/toolchain layout; foreign source can
still be inspected with Git/ngit and adapted explicitly. This does not affect reading
external proposals or playing their standard napplet manifests. No automatic history rewrite or legacy journal adoption is
performed. Existing synthetic source journals need an explicit migration or a fresh
publication identity; do not reset or force-push over them to bypass a conflict.

Implementation is local until explicitly deployed. Native tests exercise two independent
creators, real relay/Blossom/GRASP services and an independent Git reader. See the test
results recorded with the change; no external ngit version is bundled by soyLI.

# Creator identity and recovery

Implemented 2026-09-13. Creator identity is a Nostr public key backed by either a locally stored private key or an existing NIP-46 remote signer. The same signing adapter works with NIP-34 Git authorization, Blossom upload authorization and NIP-5D napplet manifests. It does not expose signing to the running napplet or hold creator keys on our servers.

## First use and reuse

```sh
bun run soyli new my-experiment
bun run soyli account show
bun run soyli account check
```

Interactive project creation offers **create**, **connect existing**, or **set up later**. A selected account is reused. Local creators also get an automatic private-key backup; an existing valid backup is reused without unlocking the keystore, while saving a missing backup requires access to the stored key. Remote signers are not contacted just to scaffold a project. Noninteractive `new` reuses an existing selection, or leaves identity unset; `--identity create` explicitly enables first-use provisioning, and `--identity later` bypasses account setup entirely. If setup fails after scaffolding, the generated preview remains usable; finish setup with the account commands rather than recreating the directory.

`account create` is idempotent: it reuses the selected account. To generate a different private key, use `account create --new`. This adds and selects a new local identity, saves its own private backup, and retains all previous identities and backups. `new`/`remix` onboarding continues to reuse the selected creator; `--new` is only valid with `account create`.

```sh
bun run soyli account create --new
bun run soyli account list
bun run soyli account use <previous-account-id>
```

`account import`, `account connect` and `account pair` add and select an identity while retaining earlier entries. `account list` displays public keys, types, status and account IDs. `account use <account-id>` verifies the stored signer before selecting it. An npub is also accepted; use the account ID when multiple sessions represent the same public key.

In the 2026-09-23 source, the selected account controls the next publication, including projects scaffolded with another identity. The ignored `.napplet-space/project.json` creator reference is a public build hint, not an account lock. Sharing updates that reference and generated backend context. Cloning/remixing must never select someone else's credentials. The local `previewId` and browser-extension identity remain independent of the publishing signer.

Each sharing operation captures the selected account ID before building/checking and uses that account until it finishes. A later account switch affects subsequent operations; the running operation never resets the global choice or falls back to another signer. If its selected credential fails, the operation reports the failure.

Publication journals are scoped by public key within the project/network. Switching from a local key to a remote signer for the **same public key** continues the same listing. A **different public key** publishes a separate Nostr address and Git repository; the original listing, assets, releases and pending jobs are preserved. Switching back continues that author's history. `status`, `publish --resume` and lifecycle commands refer to the selected author's releases. Legacy single-author journals are read without moving or deleting releases. Backend boards use the selected author's namespace, so switching public keys starts separate boards rather than transferring scores.

Agents must respect the user's selected account. They must not run account-selection or provisioning commands to restore a saved project creator or bypass a publication error unless the user requested that identity change. Reviewed local-manager actions still require a new check when the author changes before an action starts.

## Where credentials live

Local private keys use [Bun's native Secrets API](https://bun.sh/docs/runtime/secrets), through a small `Vault` interface. In the 2026-09-23 source, **new NIP-46 connections default to private session files**, with optional OS-vault storage. Existing remote accounts retain their storage until explicitly migrated. Plain account metadata lives at `${XDG_CONFIG_HOME:-~/.config}/napplet-space/accounts/<network>/accounts.json`. `SPACE_ACCOUNT_HOME` overrides the `napplet-space` directory, but account state and recovery destinations are rejected inside Git trees, including symlinked paths.

| State                                                        | Location                                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Local creator private key                                    | OS credential store, `space.napplet.creator.<network>` service, random credential ID                          |
| Portable local private-key backup                            | `<public-key>.nsec` beside account JSON, mode 0600, outside Git projects                                      |
| New remote client key, signer pubkey and relay hints         | `accounts/<network>/remote-sessions/<account-id>.json`, mode 0600 in a mode-0700 directory; OS vault optional |
| Existing remote sessions created before this change          | Original OS vault until `account storage file` migrates them                                                  |
| Public keys, credential IDs, type, selection, pending status | Account JSON, mode 0600 in a mode-0700 directory                                                              |
| Process ownership                                            | SQLite lock beside the account JSON; automatically released after process exit                                |
| Project creator reference                                    | Public key and network only                                                                                   |

Missing, locked or unavailable native storage produces an actionable error. There is no automatic fallback. Linux needs a running, unlocked Secret Service such as GNOME Keyring or KWallet for local private keys and remote sessions explicitly stored there. Remote file sessions need no desktop keyring. The explicit development option below uses a separate plaintext vault for local keys. The VPS services have separate service identities and do not need a creator account. Native macOS behavior is tested; Linux and Windows credential stores are not yet validated here.

A public pending reservation is flushed before storing a credential. Activation happens only after reading that credential back. If the process dies between those steps, `account create` without `--new` recovers the reserved identity instead of silently generating a replacement. A pending reservation with no stored credential can be discarded safely because it was never activated or published. Missing keys for an already selected account never trigger key rotation. Damaged metadata is reported and preserved. Previously selected identities remain available when creating/importing/connecting fails before activation.

The OS credential store protects the signing credential at rest. The portable nsec backup is unencrypted, protected by owner-only filesystem permissions; preserve a private copy. JavaScript must still hold key material temporarily to sign or export; strings and OS/runtime memory cannot be guaranteed fully erased. No private key is passed to Git, a build command, a generated preview bundle, SSR, or project configuration.

### Remote session storage choices

```sh
soyli account pair                                # private session file by default
soyli account connect --session-storage keychain  # optional OS-vault storage
soyli account show                                # reports storage without unlocking it
soyli account storage file                        # migrate the selected remote account
soyli account storage keychain                    # move it back to the OS vault
```

`--session-storage file|keychain` applies to both `pair` and `connect`. The choice
is saved per account. `account show` and `account list` expose only public metadata
and the storage choice. Local private keys keep their existing OS-vault policy;
`account storage` rejects a selected local-key account.

The file contains the **client private key** identifying this approved connection,
the signer transport pubkey and relays. It never contains the remote user's Nostr
private key or a consumed pairing secret. It is unencrypted: owner-only permissions
do not protect it from software running as the same OS user. Someone holding this
credential can send requests as that paired client, subject to the remote signer's
permissions and approval policy. Keep it outside projects, archives and Git; only
the public creator reference belongs in `napplet.json`.

Migration preserves the account ID, approved client key, creator key and selection.
It needs access to the old store once (macOS may prompt to read and remove its item),
but does not contact the remote signer or re-pair. The destination is written,
flushed and read back before switching metadata and removing the old copy. Failed
writes leave the old selection usable. Interrupted/failed cleanup is recorded and
reported; retry the same `account storage` command to remove the old copy. If the
destination has disappeared or become unsafe, cleanup refuses to delete the
recovery copy. File sessions never silently fall back to the OS vault.

File credentials reject permissive modes, symlinks, hard links and Git-tree paths.
This behavior is implemented and tested in source, not yet a downloadable release.
Older CLI versions cannot read account metadata containing the new storage fields;
use the updated CLI consistently after connecting or migrating.

## Existing remote identity

```sh
bun run soyli account connect
```

Paste a `bunker://` link at the hidden prompt. Do not put it in command arguments: it can contain an authorization secret. The connection uses Applesauce 6.2.2 and [NIP-46](https://github.com/nostr-protocol/nips/blob/master/46.md), with encrypted kind-24133 relay traffic. The client queries `get_public_key` separately from the bunker transport pubkey and verifies the user key again whenever the session is reopened. A changed key requires an explicit account connection.

2026-09-23 source supports **1–8 distinct signer relays**, consistently across
bunker parsing, client-generated pairing and saved CLI/browser sessions. This is
a client connection budget, not a NIP-46 three-relay restriction. Links remain
bounded to 4096 characters, relay URLs to 400 and the optional secret to 256.
Validation identifies the failing constraint without printing the link or secret.
Requests fan out to all supplied relays and proceed after the first positive relay
acknowledgment; a valid response from the remote signer is still required. Silent
relay hints no longer delay an already received reply until all ACK deadlines pass.

Released soyLI **0.18.2** still has the older three-relay limit. Until this fix is
released, pass a local copy containing at most three of the signer's supplied relay
parameters, keeping its pubkey and secret unchanged. A rejected link has not
contacted the signer or changed the selected account.

The client requests `get_public_key` and signing permission for kinds 30617, 30618, 24242, 32267, 35129, 15129 and 5129. It verifies every returned signature, author and exact requested event contents. Other event kinds are rejected. Signer denial, cancellation and a 60-second response timeout close the session. The wrapper also clears outstanding RPC promises because the pinned SDK does not do this on close. SDK logging of plaintext RPC parameters is disabled for these sessions.

Signer-provided authorization links are displayed only in an interactive terminal; they are validated HTTP(S) URLs and are not opened automatically. JSON/noninteractive mode reports that authorization must be completed in the signer. WSS relays are accepted in public mode. `--network local` accepts only literal-loopback WS relays, never public fallback destinations.

Client-generated pairing is available in CLI 0.5.0:

```sh
soyli account pair
# Optional signer transport override and native app opening:
soyli account pair --signer-relay wss://relay.napplet.soy --open
soyli account check
```

The command displays a `nostrconnect://` URI and a terminal QR. Scan, paste, or open
it in a NIP-46 signer and approve the connection within 120 seconds. `--timeout`
accepts 1–600 seconds; Ctrl+C cancels without selecting an account. A retry creates
a fresh client key and secret. Keep the one-time URI private. `--json` emits a
pairing progress record containing that URI, then the final account or error;
redirected text output omits the terminal QR. `--open` is opt-in and unavailable
in JSON mode. The URI is intentionally supplied to the OS URL opener only when
requested; no creator private key is passed to a process.

The pairing secret is required before accepting the signer transport pubkey.
A bare `ack` cannot claim a client-initiated session. New bunker connections discard
the consumed secret after authorization; persisted client keys authenticate later
sessions. Existing saved credentials remain readable. `account check` reconnects
with the stored client key, and validates the same user before any publication.
A revoked client must pair again in the signer application.

Signer transport defaults to `wss://relay.napplet.soy` (local mode:
`ws://127.0.0.1:19347`). In the updated source, `--signer-relay` supports up to eight distinct relays.
It does not change `napplet.json` or publication relay/Blossom/Git destinations.
Automatic relay negotiation, remote session revocation management and a wider
external-signer compatibility matrix remain follow-ups. Remote identities are
backed up in their signer application, not exported as local creator keys.

## Website sign-in

The header identity button resolves the selected account's Nostr display name and
avatar through the shared profile cache. Missing names fall back to the shortened
public key; missing or failed images show an initial. Long names truncate to fit
the header, and a signer that needs reconnecting keeps its warning indicator.

Presentation revision (deployed 2026-09-15 in `20260915084016730-23084`): the identity button
opens a non-modal popup anchored directly beneath it. It contains the same saved
accounts, profile link, extension/NIP-46/private-key methods, key creation and recovery.
There is no page-dimming overlay. Escape, the close button, a second trigger click,
or clicking outside dismiss it and cancel pending connection/key work. Explicit close
returns keyboard focus to the trigger. Other sign-in prompts first reveal the header
button and open that same popup. It fits the viewport and scrolls internally on phones.
Form semantics remain a labeled dialog for assistive technology rather than a menu
of commands; the presentation is an anchored popup. Session and key handling are unchanged.

The shell and social prompts open the same account chooser. Choose a NIP-07
extension, a NIP-46 remote signer, or a private-key flow. After a method is selected,
the chooser hides its general guidance and shows only the controls needed for that
method. Selecting a remote signer immediately creates a connection QR and link using
`wss://relay.napplet.soy`; an optional secondary control changes the signer relay and
regenerates the one-time connection. Switching methods and returning to the remote
signer keeps the selected relay. A signer-provided `bunker://` URI can be pasted
below the QR as an alternative. Importing an nsec/hex private key still requires an
explicit risk acknowledgment. The selected account signs
comments, likes, identified zaps, profile editing, named links and admin authentication.
The website also signs explicitly composed kind-1 share notes (2026-09-24 source).
Existing remote signers may request approval for `sign_event:1`; refusal preserves
the draft. The bounded `websiteKinds` scope in `packages/identity/src/signer.ts`
also covers supported COMMON/LISTS, app-data and lifecycle actions; creator
publishing retains its separate scope. NIP-46 auth challenges are
shown as validated links in the chooser, including during later signing requests.

**Browser connection labels — 2026-10-05 source, not yet deployed:** New remote
connections identify the browser and device format, for example
`napplet.soy · Firefox · Desktop · 7c91ab42` or
`napplet.soy · Safari · Mobile · a830cd19`. Tablet detection includes iPads using
the desktop Safari user agent. A generic label is used when the browser does not
identify itself. No raw user-agent string, screen dimensions or private key is
included. The suffix comes from that connection's **public client key**, so
independent connections differ and reconnecting the saved credential keeps its
suffix. A new pairing generates a new client key as before.

The label travels in the QR/link `name` field and in the fourth, JSON metadata
parameter of a pasted bunker connection's encrypted `connect` request, as described
by [NIP-46 client metadata](https://github.com/nostr-protocol/nips/blob/master/46.md#client-metadata).
Our pinned Applesauce signer lacks that fourth-parameter API; a small adapter uses
its encrypted request transport, response registry and cancellation handling.
These are display hints: remote signers may ignore them. Authorization still uses
the full client key and approved permissions; names do not identify or transfer
an account. Existing signer-side labels change only if that signer accepts updated
metadata on reconnect.

The original release was memory-only. **The 2026-09-15 deployed revision adds
remembered accounts using `applesauce-accounts@6.2.0`.** The
[official AccountManager API](https://github.com/hzrd149/applesauce/blob/ec51f7d4ecfd3db6099e786e8eec0062255588d4/apps/docs/apps/accounts/manager.md)
and custom `BaseAccount` adapter own selection, serialization and queued signing.
This is the user-confirmed package; no `applesauce/session` export is used. It is
compatible with our pinned core 6.2.0 and signers 6.2.2.

**Remember this connection** defaults on for extensions and NIP-46. During QR or
bunker pairing the choice remains editable; its value when the signer connects
determines whether the session is saved. Changing it does not regenerate the QR or
restart approval. An unchecked connection is visit-only and is not restored after
reload. **Remember this private key** defaults off for imported/generated keys and has an explicit device
risk explanation. Without it, keys stay in the current tab's memory. The chooser
lists up to eight accounts and allows selection or forgetting; connecting a different
account retains the current one until the new signer verifies. Each remembered
session expires thirty days after connection, rather than being silently renewed
on every page load. Reconnect explicitly after expiry.

Stored credentials and account metadata are encrypted together using AES-GCM with
a random IV and origin-bound additional data. IndexedDB `napplet-sessions-v1` holds
the envelope and a non-exportable AES-256 CryptoKey; there is no plaintext key in
localStorage/sessionStorage. NIP-46 stores only the approved client key, signer
transport pubkey and relay hints, not consumed pairing secrets or the user's remote
private key. Nothing is copied to the server or napplet frames. The relay carries
encrypted kind-24133 envelopes. At-rest encryption is not a separate unlock factor:
same-origin code or someone using an unlocked browser profile can access/sign with
saved credentials. Use a trusted device; external signers keep user keys outside
this website. Browser storage is not a backup.

Reload restores the active selection and checks the signer's public key again.
Locked or revoked signers retain a selected/reconnect state; a changed signer key
cannot silently assume the saved identity. A cancelled/failed signing prompt no
longer logs out the account: retry reopens that same signer and checks the exact
requested event, identity and allowed kind. Explicit connection cancellation,
switching and sign-out still reject late approvals/signatures and close transports.

**Sign out** stops the active signer and persists a null selection. Remembered
accounts remain available; visit-only keys are dropped. **Forget** removes one
account from the vault and stops it if active. BroadcastChannel and focus refresh
synchronize account changes; atomic revision checks reject stale writes from other
tabs. Restore/reconnect does not rewrite the vault or trigger cross-tab login loops.
Storage errors show a warning and permit use in this tab. If forgetting cannot be
saved, clear this site's browser data on a shared device. Retrying a revoked NIP-46
client may require pairing again in the signer; forgetting here does not revoke the
client in that external application. Owned key bytes are wiped where possible;
JavaScript strings/runtime copies cannot be guaranteed erased.

Browsing is anonymous; signed-out visitors can still request anonymous zap invoices.
Anonymous zaps use a separate ephemeral key per invoice, never the selected signer.
These sessions are separate from CLI OS-keystore accounts and multiplayer rooms.

## Recovery and automation

### Browser key generation and recovery

Deployed and verified on 2026-09-14 in `20260914192251320-98168`; see the
[release record](DEPLOYMENT.md#onboarding-about-and-key-recovery-release--2026-09-14).
Live generation, encrypted backup and same-key recovery were checked using a temporary
browser identity. In the login chooser, **Create
identity** generates a key using the browser's cryptographic random source. Only
its public identity is shown. The new key does not replace a connected account
until the user prepares a recovery backup, saves the file or encrypted text,
acknowledges preserving it and its passphrase, and chooses Continue. Closing the
popup discards an unused draft and cancels its cryptographic work.

**Back up private key** in a connected browser-key session exports that same key
again. It is unavailable for extensions and remote signers: back those up through
their signer applications. No private-key export permission is requested from them.

Backups are standard passphrase-encrypted [NIP-49](https://github.com/nostr-protocol/nips/blob/master/49.md)
`ncryptsec` text files. They use scrypt logN 16 and security byte 0 (the key has been
handled by a web application). The passphrase is 12–1024 characters and must be
confirmed. A download link appears after encryption; the browser cannot prove the
file was saved, so the creation flow explicitly asks the user to confirm that.
Encrypted text is also available for manual preservation. Keep the passphrase and
file separately; losing either may mean losing the identity.

Restore through **Private key → Recovery file**, or paste the encrypted text and
enter its passphrase. Existing nsec/hex import still works. The CLI's existing NIP-49
import can restore these backups too. Parsing checks checksum, version, length and
scrypt work factor (10–18) before decryption. Wrong passphrases and corrupt files
return generic errors. Encryption and decryption run in a cancellable worker with
a 30-second timeout, so the login stays responsive.

Keys and passphrases never go to our server or napplet frames. Remembered active keys
use the encrypted device vault described above; backup passphrases are never saved.
The recovery file is downloaded locally; its temporary object URL is revoked when
the backup view closes. Draft/active key bytes are wiped on disposal where possible;
JavaScript cannot guarantee erasure of all runtime copies. Backup does not itself
persist a login; the separate Remember choice controls device sessions. The website
sign-in section above records the local account-session implementation; deployment
status is recorded in [deployment history](DEPLOYMENT.md).

Verification: key-format interoperability/bounds tests and the production browser
integration cover generation, required backup acknowledgement, repeat export,
same-key restore, wrong passphrases, canceled work, refresh/disconnect and absence
from requests/localStorage/sessionStorage. The existing extension and NIP-46 browser
checks remain required regressions. All tests use disposable identities.

### CLI backups

`new` and `account create` automatically save a local creator's key to
`${XDG_CONFIG_HOME:-~/.config}/napplet-space/accounts/<network>/<public-key>.nsec`
and report its absolute path. `SPACE_ACCOUNT_HOME` changes the base directory.
This file stays outside Git trees and all project source/artifacts. It is written
atomically with mode 0600. Existing files are validated against the creator's
public key and reused; damaged files, mismatched keys, symlinks and hard links
are refused without overwrite. A backup failure leaves the selected identity
intact: fix the destination and retry `account backup`.

Existing local identities can create or locate their backup explicitly:

```sh
bun run soyli account backup
bun run soyli account import --stdin < /path/to/key.nsec
```

The second command restores the same identity into the OS credential store.
Remote keys remain with the signer, which owns their backup workflow.
An encrypted export is also available:

```sh
bun run soyli account export "$HOME/napplet-recovery.ncryptsec"
bun run soyli account import
```

Export prompts twice for a passphrase of at least 12 characters and writes an encrypted [NIP-49](https://github.com/nostr-protocol/nips/blob/master/49.md) `ncryptsec` recovery key to a new mode-0600 file outside Git projects. It refuses overwrite. Keep the file and passphrase separately. Import accepts that encrypted value and passphrase, or an nsec at the hidden prompt. No routine command displays private keys.

The recovery parser checks the Bech32 checksum, format and scrypt cost before decryption. It accepts logN 10–18 and exports at logN 16; larger-cost backups must be handled with another trusted recovery tool. Wrong passphrases and invalid keys produce a generic error without echoing input. The bundled public fixture key cannot become a public creator identity.

`--json` reports public account data or `{error: {code, message}}`. Successful local `new` and `account create` include `backupFile`; `account backup` returns `{backupFile, format: "nsec"}`. Only paths are reported, never private keys. For automation, `account connect --stdin` reads a bunker URL. `account import --stdin` reads the recovery value on line 1 and, for an encrypted value, its passphrase on line 2. `account export <path> --passphrase-stdin` reads a passphrase. Input is bounded; do not place secrets in shell arguments or command history. Both public and local profiles use the same code with separate metadata and credential namespaces.

## Verification and remaining publication work

```sh
bun run check
bun run test:identity
# Opt-in: creates and deletes temporary credentials in the native OS store.
bun run test:identity:native
```

Tests cover reuse, independent process access, two generated projects, encrypted recovery, missing/unavailable storage, interrupted setup, concurrent setup, path isolation, identity substitution, encrypted NIP-46 pairing/reopening, remote denial, altered events, timeouts and cancellation. The native test uses temporary account metadata and removes only its own random credential IDs; it never accesses the user's default account selection.

The service integration test uses one reopened creator to publish source through native ngit-grasp, upload HTML through Blossom, and sign a standard manifest on Khatru. An independent Git clone and relay/Blossom reader recover the expected source and playable bytes. All test services and signing traffic are loopback-only.

The [resumable publisher](PUBLISHING.md) now uses these components. The standalone installer, gallery indexing and named routes are implemented; release evidence and remaining compatibility work are tracked in [deployment history](DEPLOYMENT.md) and the relevant feature documents.

### Account-session verification — 2026-09-15

The subsequent A13 slice adds kind-0 signing for explicit [profile editing](PROFILES.md)
and public names/avatars in the saved-account chooser. Existing remote signers may
need to approve the added `sign_event:0` permission when reconnecting. Profile
publication stays optional; generated key recovery and account storage behavior do
not change. The profile browser test covers acknowledged editing, exact-event retry,
and session restoration alongside the existing identity regressions. This is
deployed in `20260915084016730-23084`.

Local verification passed typecheck and production build; 195 repository tests plus
the added Forget-failure regression (eight focused account-session tests); seven
production-browser integrations for admin/Featured, extension/NIP-46, encrypted
IndexedDB, key generation/recovery, onboarding and social behavior. A separate
running-frame check confirms account changes retire pending prompts and isolate
storage/files without restarting the napplet. No production events or payments
were sent, and this revision has not been deployed.

## Explicit dangerous development file vault

When the OS credential store is unavailable, opt in for the current terminal:

```sh
export SOYLI_DANGEROUS_PLAINTEXT_KEYS=1
soyli account create
soyli account check
```

This stores **unencrypted** local keys (and legacy NIP-46 client credentials) in
`~/.config/napplet-space/plaintext-accounts/<network>/credentials/`, with files
restricted to 0600 and the directory to 0700. `SPACE_ACCOUNT_HOME` and
`XDG_CONFIG_HOME` still apply. Every invocation warns on stderr; JSON stdout
remains machine-readable. Git trees, symlink credential files, hard links and
credentials accessible to other users are rejected. Filesystem permissions do
not protect against software running as your user or someone with disk access.
New remote connections do not need this switch. When it is enabled, their default
session files live in `remote-sessions/` beside this separate namespace's account
index; their explicit `--session-storage keychain` option still means the OS vault.

This vault has a separate account index and selection. It never copies, replaces
or silently recovers Keychain accounts. To retain an existing identity, explicitly
import its private backup instead of creating a new identity:

```sh
soyli account import --stdin < /absolute/private/path/to/backup.nsec
```

Do not paste keys into command arguments or project files. Normal commands such
as `soyli publish` use the file vault while the environment variable is set.
`unset SOYLI_DANGEROUS_PLAINTEXT_KEYS` returns to the native vault's selection;
it does not delete the plaintext files. The opt-in is not passed into the private
Node/pnpm build environment. This is an explicit development escape hatch, not
an encrypted replacement for the OS keychain.

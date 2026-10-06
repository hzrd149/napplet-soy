# Nostr creator profiles

Implemented, verified and deployed on **2026-09-15** in `20260915084016730-23084`. The
website requires no new service, secret, or dependency. The existing persistent
`SPACE_COMMUNITY_DIR` database receives an additive `profiles` table; include it in
the normal SQLite backup. No private key is stored there.

## Browsing and identity

`/p/<npub>` is the portable creator page. Hexadecimal public keys also resolve, with
the npub URL used for canonical/OG metadata. A page shows the latest known signed
kind-0 name, avatar, banner, bio, website, Lightning address, and Nostr address.
NIP-05 addresses are explicitly **unverified**; this slice does not resolve proofs.
Names are display labels, not unique identifiers. The full npub remains visible
and copyable. A missing or malformed profile falls back to the public key.

The creator’s collection contains this client’s discovered napplets, selected by
author public key across the configured relays (with index/publicdev data for SSR), independent of site
handles. Pagination uses 24 entries, newest first. Unavailable creations are hidden
by default with an explicit inclusion control. Moderation/deletions still apply.
This is not a claim to know every creation on every relay. `/@handle` continues to
show site aliases and links to the owner’s Nostr profile; those concepts stay separate.

Gallery/detail/featured/comment creator labels link to profiles. Saved accounts
show names and avatars with the npub as their identifying tooltip. Profile lookups
are direct relay reads, batched (32 keys, two queries at a time) and cached for a
minute in this browser. SSR retains a separate bounded latest-profile cache.
The expanded default network uses Soy plus six public relays, including five
that supplied the reported creator's signed metadata in the 2026-10-06 review.
Server-side profile reads now use up to eight configured destinations, matching
the browser settings limit. Explicit custom networks remain authoritative. The
new defaults were deployed on 2026-10-06 in `20261006111729495-77355`, and
existing creator projects keep saved relay lists. Fresh public desktop/390px
checks resolve the affected creator in both the detail heading and account menu.
See [relay defaults and dated verification](RELAY-DEFAULTS.md).
SSR includes profile text, canonical metadata, and a generated 1200×630 PNG share
card. The OG renderer receives escaped text, never an arbitrary remote resource.

## Creating and editing

Connect the creator’s identity, then use **View & edit your profile** in the account
menu, or **Create/Edit your profile** on its page. A fresh relay read establishes
the edit base. The form edits `name`, `display_name`, `about`, `website`, `picture`,
`banner`, `lud16`, and `nip05`; unrelated fields (including `lud06`, nested extension
values, bot/birthday information) and existing tags survive. Untouched legacy values
also survive, including HTTP image URLs or names longer than our authoring limits;
validation applies to changed fields. Non-string foreign values are preserved.
A malformed latest JSON object must be repaired in
another client before this editor can modify it.

**Sign & publish profile** asks the selected Applesauce account to sign kind 0.
The browser checks the exact returned event and pubkey, preserves unrelated fields
and tags, validates edits, and queries the latest profile again before publishing.
A stale edit is refused with its draft retained and an explicit Reload option.
This is optimistic concurrency against configured relays, not a global Nostr lock.

Destinations are visible in the editor and come from the browser's Network settings
or operator defaults. Success requires at least one positive relay `OK`; uncertain
delivery retains the same signed event for retry. Spinners, success and errors stay
in the action button. There is no profile REST read or publication endpoint.

Profile publication is optional. Creating a key, publishing a profile, claiming a
site handle, and provisioning a Lightning wallet are separate actions. The form
does not create a wallet or account with an address provider. Browsing, creating,
remixing and publishing napplets do not require a website account or kind-0 profile.

## Media and protocol limits

Avatars and banners use their original HTTPS URLs, without a proxy. Obvious private
addresses and credentials are refused; native browser image rules apply. Optional
images fall back to an initial avatar or an omitted banner on error. Profile text
renders as React text, links use noreferrer, and media never loads in the napplet
sandbox. The server may normalize images separately for its generated OG card.

Kind-0 events are limited to 16 KiB and up to sixty seconds in the future on read;
writes allow thirty seconds ahead and require a recent timestamp newer than the
edit base. Replacement ordering is timestamp descending, then event ID ascending.
Selection precedes JSON parsing: unreadable newest metadata never revives an older
name or wallet. The shared social reader consumes the same cached winner.

Reviewed against NIP-01 and NIP-24 at
[`a2494f4f81d46684e5814a9bf35e2b1df978f955`](https://github.com/nostr-protocol/nips/tree/a2494f4f81d46684e5814a9bf35e2b1df978f955),
alongside existing NIP-19 routing, NIP-46 signers and NIP-57 Lightning metadata.
No profile field or Space API becomes a napplet playback requirement.

Follow/unfollow, profile-specific relay discovery/preferences, verified NIP-05,
mutes/reports and broader client basics are explicit follow-up work. Current reads
and edit conflict checks cannot observe newer metadata hosted only on unknown relays.
They do not claim global completeness or immutable preservation of profile history.

## Verification

`profiles.test.ts` covers signatures, replacement/tie rules, malformed winners,
unknown fields/tags, stale updates, outage handling, idempotent retry and validation.
The production-build `tests/services/profiles.test.ts` uses a real temporary Nostr
WebSocket relay and mocked browser extension to cover profile SSR/OG, missing
profiles, 27 creations over two pages, edit/rejection/retry, reload restoration,
creator links, private-network image rejection, responsive layouts and genealogy.
Community, gallery social, admin and encrypted-session browser regressions pass.
No production accounts, public events or payments were used.

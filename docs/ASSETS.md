# Assets in a napplet

The managed workflow was introduced in **soyLI 0.13.0** and is available in the
published **0.14.1** release (2026-09-20), including the integrated local workshop.
Runtime resources and presentation covers/clips remain separate.
Binary/JSON/text import and the Blob helper are added in soyLI **0.23.6**.

## Managed assets: CLI and local workshop

Run `soyli dev` and choose **Manage project** to import media, fonts, JSON, text or
binary data packs. Supply its name and license/credit, choose **embedded** or **Blossom**,
and inspect its preview, hash, size and destination. The same operations are available
to an agent:

```sh
soyli assets add ./jump.ogg jump-sound --storage external --license CC0
soyli assets list
soyli assets remove jump-sound
soyli assets sync
```

Import creates a content-addressed original under `assets/`, a tracked
`napplet.assets.json` inventory and generated `soy-assets.js` / `soy-assets.d.ts`.
Use the generated helper from `src/main.ts`:

```ts
import { assetUrl } from '../soy-assets.js';
const jump = new Audio(await assetUrl('jump-sound'));
// Call jump.play() from a user gesture.
```

`assetUrl` resolves to an embedded data URL or a Blob URL returned through the
standard `napplet.resource.bytes('blossom:sha256:…')` capability. External references
contain hashes, not a Soy API URL. The host uses manifest Blossom hints, validates
bytes, and applies ordinary resource policy. External resources declare `resource`
as a required capability. The inventory/helper are authoring conventions; playback
on another host does not require parsing our lockfile or contacting napplet.soy.
Use `releaseAssetUrls()` when a long-lived app no longer needs cached Blob URLs.

### Data packs, maps and other non-media assets

The managed importer also accepts hash-verified binary data, JSON and plain text.
There is no filename-extension allowlist: a custom pack such as `.ssrcpack` is
stored byte-for-byte under its content hash, with `.bin`, `.json` or `.txt` chosen
from the bytes. A separate `nak` upload or media disguise is unnecessary.

```sh
soyli assets add ./game.ssrcpack game-pack --storage external --license MIT
```

Use the generated Blob helper to read data inside the sandbox:

```ts
import { assetBlob } from '../soy-assets.js';
const pack = new Uint8Array(await (await assetBlob('game-pack')).arrayBuffer());
// Pass pack to your application's decoder.
const levels = JSON.parse(await (await assetBlob('levels')).text());
```

Use the actual license/attribution for your assets. `assets add` imports locally;
`soyli publish` or `soyli propose` uploads external assets using the selected creator
and configured Blossom, then verifies the downloaded bytes. `assets sync` regenerates
helpers; it does not upload. In existing projects run `soyli update`, then
`soyli skills update` and `soyli assets sync`, rebuild, test and publish.

Both storage modes support `assetBlob`. Do not use `fetch(await assetUrl(...))`:
the sandbox blocks direct fetch, including Blob URLs. The helper obtains external
Blobs through NAP-RESOURCE and decodes embedded data URLs locally. This adds no
network permission or server proxy, and requires no new public host capability.

The upstream Vite single-file build handles embedded imports. Rebuild after inventory
changes. Local preview serves only registered, hash-verified originals through the
same resource host. Publish freezes, uploads and verifies external files at the
configured Blossom target before announcing the manifest. Retry retains saved targets
and verifies existing uploads. Playable proposal previews upload their external
resources too. Git/source archives retain originals; fresh remixes validate them
without relying on the creator's asset cache. Removing an inventory entry preserves
original files and previously published blobs; update source calls explicitly.

Current admission: PNG, JPEG, WebP, GIF, WAV, Ogg, MP3, WOFF/WOFF2, MP4, WebM,
JSON, plain text and opaque binary data. Signatures identify types; names and
upstream Content-Type headers do not override this. The existing runtime policy
still refuses raw HTML, SVG/XML and active-document markers, including those
within the first 4 KiB of an otherwise opaque pack. Credential checks remain in
place. Packs are not unpacked or converted; use a bundled decoder and exercise
the real data, including any dependencies or expanded size. Import acceptance
does not certify a particular pack format or Flash runtime.

Codec support still depends on the browser. Exercise actual
image decoding, sound playback, font loading and video playback in the host. Asset
registration does not convert formats, stream indefinitely or certify every scene.

Limits: **32 assets, 10 MiB per file, 32 MiB total managed bytes**. Originals still
count towards the **40 MiB / 1,024-file source budget**. Embedded bytes additionally
count towards the **25 MiB HTML limit**, including encoding overhead. These are
client/tooling constraints, not a purchased or free hosting allowance. Third-party
provider quotas are unknown; provider rejection is authoritative. Choose a custom
Blossom in Manage project or the local publishing binding. Changing providers does
not relax runtime validation or source limits. No billing or new server caps are
introduced by this workflow.

Larger original libraries, original files stored outside Git, general transcoding,
streaming and provider quota discovery are not implemented. Keep those limits in
mind when choosing which assets to embed. Ordinary imported small assets remain valid:

## Small assets: keep them in the project and import them

Use an ordinary source directory, for example:

```text
src/
  main.ts
  style.css
  assets/
    images/player.png
    sounds/jump.ogg
    fonts/display.woff2
    videos/intro.webm
```

From `src/main.ts`, import assets explicitly so the upstream Vite build sees them:

```ts
import playerUrl from './assets/images/player.png?url';
import jumpUrl from './assets/sounds/jump.ogg?url';
import introUrl from './assets/videos/intro.webm?url';
import './style.css';

const player = document.createElement('img');
player.src = playerUrl;
const jump = new Audio(jumpUrl); // Call jump.play() from a user gesture.
const intro = document.createElement('video');
intro.src = introUrl;
intro.controls = true;
```

From `src/style.css`:

```css
@font-face {
  font-family: 'Display';
  src: url('./assets/fonts/display.woff2') format('woff2');
}
```

The maintained boilerplate uses `artifactMode: 'single-file'`. In plugin 0.11.2,
that sets an effectively unlimited Vite `assetsInlineLimit`, disables CSS splitting,
and inlines entry scripts/styles into `dist/index.html`. Imported media/font URLs
become embedded data URLs. The napplet's runtime file is this **one HTML document**,
not a website served from its source directory. Browser codec support still applies;
embedding a file does not prove a browser can decode or play it.

Do not rely on `public/`, `/assets/sound.ogg`, or strings such as
`'./src/assets/player.png'` being served after publication. Copied `public/` files
normally fail the plugin's check for leftover output files. Dynamically constructed
paths may escape a build-time check and still fail inside the sandbox. Explicit
imports/CSS URLs are the supported path. Avoid `?no-inline` and separate chunks.

Run `soyli build`, then `soyli dev` and exercise every scene that
loads media. Use the listing preview to check name, description and cover, and run
`soyli check` before publishing. The smoke check verifies startup, not every
possible asset, interaction, scene or codec. A successful build alone is insufficient.

## Audio and host media sessions

The [NAP-MEDIA proposal](https://github.com/napplet/naps/pull/10) defines a separate
host capability for media sessions, including shell-owned playback: the napplet gives
the host a source and requests playback/control; the host owns the player and policy.
This is different from embedded sound effects or Web Audio inside the sandbox.

The shared host implements shell-owned audio in **soyLI 0.8.0 and later** and
the corresponding website deployment. The 0.8.0 release is now published;
older 0.7.0 hosts lack this domain. Check runtime support; on other clients an optional
media feature should report unavailability or offer a user-confirmed external link.
A successful relay lookup only proves station metadata is readable; it does not
prove playback. See [the audio contract](MEDIA.md) for exact operations and limits.

Do not substitute direct remote `<audio src>` URLs or loosen the sandbox CSP.
`resource.bytes` downloads a bounded complete resource; its 10 MiB/20-second limits
make it unsuitable for an indefinite live radio stream. The new media host instead
streams directly from its original HTTPS URL in the trusted host, with source policy, user activation,
supported actions, state/errors and lifecycle cleanup shared by CLI and web.
Refreshing skills or reinstalling the same old CLI does not update runtime support.

## Where the bytes go

- **Runtime:** embedded media goes inside the hash-addressed HTML uploaded to the
  configured Blossom target. The HTML has a **25 MiB** limit, including base64's size
  overhead. Each managed asset and host resource remains limited to **10 MiB**.
  Keep videos especially small.
- **Editable originals:** for a built boilerplate project, the publisher selects
  Git-tracked and unignored files by default. Commit required original assets so
  the Git release and its hash-addressed source archive retain them for a remix.
  `publish.files` adds release inputs; it cannot exclude tracked files or history.
  Source permits **1,024 files / 40 MiB total**, including built HTML and preview
  inputs in the selected count, with a **50 MiB tar** ceiling.
  Files must pass the source path, regular-file and credential checks. Asset licensing
  and original attribution belong in the source too.
- **Gallery cover:** `napplet.json` preview settings and the screenshot workflow
  produce a separate image, referenced by the signed listing metadata. A runtime
  image or video does not automatically become a cover. See [previews](PREVIEWS.md).
- **Destinations:** The local `.napplet-space/project.json` binding chooses relay, Blossom,
  Git/GRASP and site, with `napplet.json` as the portable fallback. CLI target flags override it. Runtime Blossom `servers` hints
  are a separate configuration, not the upload target. See [publishing](PUBLISHING.md).

## Verification

`tests/services/asset-manager.test.ts` decodes real image/audio/font/video resources
through the shared sandbox against local originals and a separate Blossom fixture;
it also checks manager saves and hostile-origin/token rejection. Publisher tests
cover interrupted uploads, verified resume and a fresh source-archive remix.
The standalone managed-asset test exercises the upstream Vite build and a new Git
checkout with both embedded and external resources. No public event or upload is
needed for these checks.

Implementation: [inventory/helper](../packages/assets/src/index.ts),
[project manager](../apps/cli/src/manager.ts), [publisher](../packages/publish/src/index.ts),
[resource policy](../packages/client/src/resource-mime.ts), [previews](PREVIEWS.md).

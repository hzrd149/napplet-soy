# Napplet user settings

Released on **2026-09-14** for agenda A11 in CLI **0.5.0** and website release
`20260914142718446-76864`. Local harness, production builds and public browser
settings/fullscreen/reload/identity checks pass. The implementation follows
[NAP-CONFIG at 448013e](https://github.com/napplet/naps/blob/448013e6d8cb8c75dce49576b3e7c0d46d960eac/naps/NAP-CONFIG.md).
See [COMPATIBILITY.md](COMPATIBILITY.md) for upstream runner limitations.

## Creator flow

New boilerplate projects include `config.schema.json` and a small
`src/napplet-settings.ts` example imported by `src/main.ts`. The upstream Vite plugin
already discovers this filename and embeds JSON in a `napplet-config-schema` meta
element in the built HTML. No new Nostr event tag or Space descriptor is required.
The schema is covered by the same artifact signature/hash as the app.

From soyLI **0.14.1**, the example also checks `config.schema` before subscribing.
If the host has not loaded the embedded declaration, it awaits the standard
`config.registerSchema` call with that same JSON file. This covers hosts such as
Paja 0.16.4, which require runtime registration for this path. An existing host
schema is preserved. No second schema or private protocol message is introduced.

The example changes text size, control height and text selection with the upstream
SDK's `config.subscribe`. Its CSS defaults keep the app usable without the optional
domain or when an optional operation fails. Replace these settings with properties
relevant to the creation. Declare a hard `config` requirement only if the core app
cannot function without it. Keep the existing Vite plugin and lockfile.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$version": 1,
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "speed": {
      "type": "number",
      "title": "Animation speed",
      "minimum": 0.25,
      "maximum": 3,
      "default": 1,
      "x-napplet-section": "Motion"
    }
  }
}
```

Build, then open `soyli dev`. **Settings** opens the same form used beside
the website player controls, including in fullscreen. The Listing tab reports the
static schema's property count/version; Settings also remains available there.
Edits and Reset defaults are drafts until **Save settings**. Cancel discards them.
The running app receives the saved snapshot immediately.

Publication destinations still live in `napplet.json`; `soyli config`
continues to show relay, Blossom, Git and site settings. User settings do not change
publishing destinations, creator identity, multiplayer provider policy or game rules.

Existing projects can add the schema file and an SDK subscription themselves.
`skills update` updates guidance, preserves edited files, and never edits app source
or installs this example into an existing project. Rebuild after changing a schema.
The publisher and local listing validate the built schema as well as the plugin's
checks; malformed/duplicate declarations or forbidden constructs fail publication
with `CONFIG_SCHEMA` before starting the check browser.

## Runtime contract

The shared host accepts `registerSchema`, `get`, `subscribe`, `unsubscribe` and
`openSettings`. Registration returns a correlated positive/negative acknowledgement;
get returns `config.values` with its request ID. Subscribe/unsubscribe and settings
opening use the proposal's ID-less messages. Subscriptions receive initial values
after schema/default resolution and subsequent snapshots after saves or account
changes. The host ignores writes and caller-supplied identity/scope fields.

Static declarations are parsed from inert markup only after artifact verification.
Invalid static schemas leave playback available but the settings control explains
the problem. Runtime registration is the escape hatch for dynamic schemas; rejection
retains the last valid schema and emits the specified error/acknowledgement. A
subscription before any schema receives `no-schema` and waits for registration.
The iframe can ask to open settings only while focused, at most once per two seconds.
Unknown sections fall back to the full form.

The pinned shim handles wire correlation/subscriptions. The host supplies the static
`config.schema` snapshot before creator code and preserves the shim's runtime
registration getter. Returned schemas are copies. The shim's error-unsubscribe
function also exposes `close()`, matching the proposal's subscription shape while
retaining compatibility with the pinned SDK. No private wire message is added.

## Validation and persistence

The validator handles typed fields, homogeneous primitive arrays, nested objects,
required fields, enum choices, literal defaults, numeric/string/list bounds and
the documented annotations. `format` is a hint, not a validation rule. Unknown
`x-*` annotations are retained without granting capabilities. Descriptions render
as text. References (including local refs), regex patterns, tuple arrays,
combinators and conditionals are rejected; validation never runs creator code.

Limits: 64 KiB JSON, 128 schema nodes, four object levels including the root, 256
array items and 120 configuration envelopes/minute per frame. Prototype-sensitive
property names are rejected. Supported draft declarations are draft-07, 2019-09
and 2020-12; the core subset remains the same. Omitted `additionalProperties` acts
as false; even explicitly permitted extra values are pruned before persistence
and delivery because the proposal requires dropping undeclared properties.

Settings use a host-owned key containing verified creator/address/build and
viewer pubkey (or guest). Current and creator-signed pinned links for the same
build share the verified identity. Different creators, remixes and builds get
different scopes. Local preview uses its project preview ID and artifact hash.
A new build starts fresh; `$version` is not an implicit cross-hash migration.
Within a running build, decreasing a known schema version is rejected.

Valid explicit user inputs take precedence over field defaults, then ancestor
defaults; invalid and orphaned inputs are discarded. Defaults are not persisted
as user choices. Browser storage holds only non-secret inputs. `x-napplet-secret`
strings use password fields, cannot declare defaults, and are delivered only after
an explicit save. They remain in memory for the running account/session and are
discarded on restart, account change, reset or removal from the schema. The napplet
does receive these user-supplied values; creator signing keys never enter this flow.
Unavailable browser storage falls back to memory and the dialog says so.

The proposal combines required-field validation with omission of unset fields and
unset secrets. This implementation prioritizes the latter for initial snapshots:
required fields are enforced when the user saves; absent initial fields stay absent.
Object-enum constraints that cannot yet yield a valid snapshot wait for a valid
choice (up to 64 pending get IDs); an upstream SDK get can time out while waiting.
Record these interpretation points for the wider cross-client review, rather than
claiming every schema edge case has independent conformance coverage.

## Evidence and repeat checks

- `packages/runtime/src/config.test.ts`: defaults, errors, schema bounds, wire
  correlation, read-only access, persistence, secret provenance and scope changes.
- `packages/publish/src/configuration.test.ts`: static metadata/entity decoding,
  duplicate schemas and forbidden constructs.
- `tests/services/config-preview.test.ts`: real pinned shim, static and runtime
  schemas, live form edits, mobile layout, reloads, account/build isolation and
  optional testing of a built maintained starter through `SPACE_TEST_CONFIG_PROJECT`.
- `tests/browser/runtime.spec.ts`: website settings in fullscreen, draft cancellation,
  same-build restart, plus existing host identity/resource/file lifecycle checks.
- `tests/services/boilerplate.test.ts`: standalone CLI starter verification and
  settings behavior; opt-in executable/toolchain test.

This checkpoint passed type checking, 171 repository tests, a production build,
five website browser tests, five local service/browser tests and two standalone
CLI tests with Bun/Node absent from PATH. The maintained starter passed
guidance/type/build and the CLI frozen-artifact check.
The unmodified upstream conformance runner passed five boot/degradation checks and
skipped five manifest/wire/lifecycle checks; it does not validate configuration.
The [2026-09-20 independent-client check](INTEROPERABILITY.md) now covers starter
registration/defaults in Paja and runtime registration through upstream-generated
manifests in Soy. Required-but-unset and schema edge cases remain unqualified across
hosts; this evidence does not establish full configuration conformance.

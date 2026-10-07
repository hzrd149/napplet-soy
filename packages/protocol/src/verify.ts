import { verifiedSymbol, verifyEvent, type NostrEvent } from 'nostr-tools';

type Verifier = (event: NostrEvent) => boolean;

let backend: Verifier = verifyEvent;
let enabling: Promise<void> | undefined;

/** Checks the event id and schnorr signature once; later calls reuse the cached result. */
export function verifySignature(event: NostrEvent): boolean {
  const cached = (event as { [verifiedSymbol]?: unknown })[verifiedSymbol];
  if (typeof cached === 'boolean') return cached;
  const valid = backend(event);
  if (valid) event[verifiedSymbol] = true;
  return valid;
}

/**
 * Switches verification to libsecp256k1-WASM. Verification stays on the JS
 * implementation until the module has loaded, and remains there if it fails.
 */
export function enableWasmVerification() {
  enabling ??= import('nostr-wasm/gzipped')
    .then(({ initNostrWasm }) => initNostrWasm())
    .then((wasm) => {
      backend = (event) => {
        try {
          wasm.verifyEvent(event);
          return true;
        } catch {
          return false;
        }
      };
    })
    .catch((error: unknown) => {
      console.warn('WASM signature verification unavailable; using JavaScript verification.', {
        cause: error instanceof Error ? error.message : String(error),
      });
    });
  return enabling;
}

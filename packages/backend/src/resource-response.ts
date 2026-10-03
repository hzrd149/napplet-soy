import { blocked } from '../../moderation/src/policy';
import { z } from 'zod';
import { fetchPublicBytes, fetchPublicBlob, publicResourceUrl } from './blossom';
import { sha256 } from '../../protocol/src/artifact';
import { MAX_RESOURCE_BYTES } from '../../client/src/resource-limits';
import { readBytes } from '../../client/src/bytes';

export const resourceInput = z
  .object({
    manifest: z.string().regex(/^[a-f0-9]{64}$/),
    url: z.string().max(4096),
    servers: z.array(z.string().max(2048)).max(8).optional(),
  })
  .strict();

import { resourceMime } from '../../client/src/resource-mime';
export { resourceMime } from '../../client/src/resource-mime';

export async function resolveResource(
  input: { url: string; servers?: string[] },
  defaults: string[],
  signal: AbortSignal,
) {
  let bytes: Uint8Array;
  const digest = /^blossom:sha256:([a-f0-9]{64})$/.exec(input.url)?.[1];
  if (digest && blocked('hash', digest)) throw new Error('blocked-by-policy');
  if (digest) {
    let found: Uint8Array | undefined;
    for (const server of [...new Set([...(input.servers ?? []), ...defaults])].slice(0, 8)) {
      try {
        const data = await fetchPublicBlob(
          server,
          digest,
          AbortSignal.any([signal, AbortSignal.timeout(8000)]),
          MAX_RESOURCE_BYTES,
        );
        if ((await sha256(data)) === digest) {
          found = data;
          break;
        }
      } catch {}
      if (signal.aborted) throw new Error('timeout');
    }
    if (!found) throw new Error('network-error');
    bytes = found;
  } else if (input.url.startsWith('https:')) {
    bytes = await fetchPublicBytes(publicResourceUrl(input.url), signal, MAX_RESOURCE_BYTES);
  } else if (input.url.startsWith('data:')) {
    // Normally decoded by the upstream shim. Keep raw envelope clients within the same policy.
    const response = await fetch(input.url, { signal });
    bytes = await readBytes(response, MAX_RESOURCE_BYTES);
  } else throw new Error('unsupported-scheme');
  if (bytes.length > MAX_RESOURCE_BYTES) throw new Error('too-large');
  if (blocked('hash', await sha256(bytes))) throw new Error('blocked-by-policy');
  return { bytes, mime: resourceMime(bytes, !!digest) };
}

/** Both hosted and local preview deployments use this policy; only revision lookup differs. */
export function createResourceResponder(
  admit: (manifest: string) => Promise<{ servers: string[] } | null | undefined>,
  hostOrigin?: () => string,
) {
  let active = 0;
  const budgets = new Map<string, { start: number; count: number; active: number }>();
  return async function resourceResponse(request: Request) {
    const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
    // Only the first-party host can fetch on behalf of its opaque frame. No cookie credentials are forwarded.
    if (
      request.headers.get('Origin') !== (hostOrigin?.() ?? new URL(request.url).origin) ||
      request.headers.get('X-Space-Host') !== '1'
    )
      return fail('blocked-by-policy', 403);
    let input: z.infer<typeof resourceInput>;
    try {
      if (!request.body) return fail('invalid-request', 400);
      const reader = request.body.getReader();
      let text = '',
        size = 0;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 24000) return fail('too-large', 413);
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        await reader.cancel().catch(() => {});
      }
      input = resourceInput.parse(JSON.parse(text));
    } catch {
      return fail('invalid-request', 400);
    }
    const entry = await admit(input.manifest);
    if (!entry) return fail('not-found', 404);
    const now = Date.now();
    for (const [key, budget] of budgets)
      if (!budget.active && now - budget.start > 60000) budgets.delete(key);
    let budget = budgets.get(input.manifest);
    if (!budget) {
      budget = { start: now, count: 0, active: 0 };
      budgets.set(input.manifest, budget);
    }
    if (now - budget.start > 60000) {
      budget.start = now;
      budget.count = 0;
    }
    if (active >= 8 || budget.active >= 4 || budget.count >= 60) return fail('quota-exceeded', 429);
    active++;
    budget.active++;
    budget.count++;
    try {
      const { bytes, mime } = await resolveResource(
        input,
        entry.servers,
        AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
      );
      return new Response(new Uint8Array(bytes).buffer, {
        headers: {
          ...headers,
          'Content-Type': mime,
          'Content-Security-Policy': "default-src 'none'; sandbox",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      return fail(
        ['blocked-by-policy', 'too-large', 'timeout', 'unsupported-scheme'].includes(message)
          ? message
          : 'network-error',
        422,
      );
    } finally {
      active--;
      budget.active--;
    }
  };
}

import type { SignedEvent } from './index';
import { manifestFormat } from './manifest';

/**
 * Presentation-only equality for already validated standalone manifests. The
 * same publisher, exact timestamp and every shared signed field must agree.
 * This is never an app identity, storage scope, backend grant or social scope.
 */
export function standalonePresentationKey(event: SignedEvent): string | null {
  if (![35129, 15129, 5129].includes(event.kind) || manifestFormat(event) !== 'standalone')
    return null;
  return JSON.stringify({
    author: event.pubkey,
    createdAt: event.created_at,
    content: event.content,
    tags: event.tags
      .filter((tag) => !['d', 'a', 'A'].includes(tag[0]))
      .map((tag) => JSON.stringify(tag))
      .sort(),
  });
}

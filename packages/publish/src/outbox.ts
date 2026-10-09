import { DiagnosticError, diagnose, type Diagnostic } from '../../diagnostics/src';
import type { Network } from '../../identity/src/signer';
import type { SignedEvent } from '../../protocol/src';
import discoveryRelays from '../../nostr/discovery-relays.json';
import { checkedEndpoint, type Targets } from './config';
import { MAX_OUTBOX_RELAYS } from './limits';
import { newer, type PublicationRelays } from './relay';

// A relay-list indexer is read for kind 10002 only; it never receives publications.
const RELAY_LIST_INDEXERS = ['wss://purplepag.es'];

export type OutboxLookup = {
  source: 'nip65' | 'none' | 'unavailable';
  eventId?: string;
  relays: string[];
  // Listed write relays outside the selected network's endpoint policy, or over the cap.
  ignored: number;
  error?: Diagnostic;
};

function lookupRelays(targets: Targets, network: Network) {
  const urls = [
    targets.relay,
    ...targets.mirrors,
    ...(network === 'public' ? [...discoveryRelays, ...RELAY_LIST_INDEXERS] : []),
  ].flatMap((url) => {
    try {
      return [checkedEndpoint(url, network, true)];
    } catch {
      return [];
    }
  });
  return [...new Set(urls)];
}

/**
 * Reads the creator's newest NIP-65 relay list and selects its write relays as
 * best-effort copies. Primary and mirror destinations are not repeated.
 */
export async function resolveOutbox(
  read: PublicationRelays['read'],
  pubkey: string,
  targets: Targets,
  network: Network,
  timeoutMs = 4000,
): Promise<OutboxLookup> {
  const urls = lookupRelays(targets, network);
  const settled = await Promise.allSettled(
    urls.map((url) => read(url, { kinds: [10002], authors: [pubkey], limit: 4 }, timeoutMs)),
  );
  const failures: Error[] = [];
  let latest: SignedEvent | null = null;
  settled.forEach((outcome, i) => {
    if (outcome.status === 'rejected')
      failures.push(
        new DiagnosticError('RELAY_READ', 'Relay list query failed.', {
          target: urls[i],
          cause: outcome.reason,
        }),
      );
    else
      for (const event of outcome.value)
        if (event.pubkey === pubkey && event.kind === 10002 && (!latest || newer(event, latest)))
          latest = event;
  });
  const found = latest as SignedEvent | null;
  if (!found) {
    const error = failures.length
      ? diagnose(
          new DiagnosticError(
            'OUTBOX_LOOKUP',
            failures.length === urls.length
              ? 'Could not read the creator relay list (NIP-65) from any lookup relay.'
              : `No creator relay list (NIP-65) was found; ${failures.length} of ${urls.length} lookup relays failed.`,
            {
              operation: 'look up creator outbox relays',
              recovery:
                'The primary publication is unaffected. Rerun soyli publish with unchanged source to retry the lookup and copy the same signed release.',
              cause: new AggregateError(failures, 'Relay list lookups failed.'),
            },
          ),
        )
      : undefined;
    return {
      source: failures.length === urls.length ? 'unavailable' : 'none',
      relays: [],
      ignored: 0,
      ...(error ? { error } : {}),
    };
  }
  const covered = new Set([targets.relay, ...targets.mirrors]);
  const relays = new Set<string>();
  let ignored = 0;
  for (const tag of found.tags) {
    if (tag[0] !== 'r' || typeof tag[1] !== 'string' || (tag[2] && tag[2] !== 'write')) continue;
    let url: string;
    try {
      url = checkedEndpoint(tag[1], network, true);
    } catch {
      ignored++;
      continue;
    }
    if (covered.has(url) || relays.has(url)) continue;
    if (relays.size >= MAX_OUTBOX_RELAYS) ignored++;
    else relays.add(url);
  }
  return { source: 'nip65', eventId: found.id, relays: [...relays], ignored };
}

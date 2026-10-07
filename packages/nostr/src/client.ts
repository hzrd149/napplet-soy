import { EventStore } from 'applesauce-core';
import { RelayPool } from 'applesauce-relay';
import { verifiedEvent, verifySignature, type SignedEvent } from '../../protocol/src';

/** One store per browser app or server request; never share signer state between requests. */
export function createNostrClient(events: SignedEvent[] = []) {
  const store = new EventStore({ verifyEvent: verifySignature });
  for (const event of events) store.add(verifiedEvent(event));
  let pool: RelayPool | undefined;
  return {
    store,
    connect(relays: string[], onError: (error: unknown) => void = () => {}) {
      if (pool) throw new Error('Client already connected');
      pool = new RelayPool();
      const subscription = relays.length
        ? pool.subscription(relays, { kinds: [35129, 15129, 5129], limit: 100 }).subscribe({
            next: (event) => {
              try {
                store.add(verifiedEvent(event));
              } catch (error) {
                onError(error);
              }
            },
            error: onError,
          })
        : undefined;
      return () => {
        subscription?.unsubscribe();
        pool?.close();
        pool = undefined;
      };
    },
  };
}

import { buildGenealogy, hasAncestry } from '../../../../packages/client/src/genealogy';
import { findManifest } from '@/lib/protocol-catalog';
import { manifestAllowed, blocked } from '@/lib/network';
import { useEffect, useState } from 'react';
import { GitFork, ArrowUpRight } from 'lucide-react';
import { Button } from './ui/button';
import { CreatorLink } from './creator-link';
import type { SignedEvent } from '../../../../packages/protocol/src';
import type { Genealogy as Tree } from '../../../../packages/backend/src/genealogy';
export function Genealogy({ manifest }: { manifest: SignedEvent }) {
  const hasParents = hasAncestry(manifest);
  const [tree, setTree] = useState<Tree | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!hasParents) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setTree(null);
    void buildGenealogy(manifest, findManifest, { hidden: (e) => !manifestAllowed(e), blocked })
      .then((value) => {
        if (!controller.signal.aborted) setTree(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Could not load the family tree.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [manifest.id, hasParents, attempt]);
  if (!hasParents || (!loading && !error && !tree)) return null;
  return (
    <section className="genealogy-section" aria-label="Napplet genealogy">
      <div className="genealogy-heading">
        <GitFork size={23} />
        <div>
          <span className="eyebrow">IDEAS HAVE ANCESTORS</span>
          <h2>The family tree</h2>
        </div>
      </div>
      <p className="muted">
        Follow the trail of remixes. Relationships come from the creators’ signed releases.
      </p>
      {loading && <p role="status">Following the branches…</p>}
      {error && (
        <p role="status">
          {error}{' '}
          <Button variant="outline" size="sm" onClick={() => setAttempt(attempt + 1)}>
            Try again
          </Button>
        </p>
      )}
      {tree && (
        <>
          {tree.gap && <p className="genealogy-gap">{tree.gap}</p>}
          {tree.origin && (
            <p className="genealogy-origin">
              Declared origin ·{' '}
              <a href={tree.origin.path}>
                Open original napplet <ArrowUpRight size={13} />
              </a>
              <small>Intermediate generations may be missing.</small>
            </p>
          )}
          <ol className="genealogy-tree">
            {[...tree.nodes].reverse().map((node) => (
              <li key={node.id} className={node.relation === 'viewed' ? 'genealogy-current' : ''}>
                <span className="genealogy-dot" aria-hidden="true" />
                <div className="genealogy-node">
                  <div>
                    <span className="eyebrow">
                      {node.relation === 'viewed'
                        ? 'YOU ARE HERE'
                        : node.relation === 'exact'
                          ? 'PINNED PARENT RELEASE'
                          : 'PARENT · CURRENT RELEASE'}
                    </span>
                    {node.relation === 'viewed' ? (
                      <h3>{node.title}</h3>
                    ) : (
                      <h3>
                        <a href={node.path}>
                          {node.title}
                          <ArrowUpRight size={16} />
                        </a>
                      </h3>
                    )}
                    <CreatorLink pubkey={node.pubkey} />
                  </div>
                  <code title={node.id}>{node.id.slice(0, 8)}</code>
                </div>
              </li>
            ))}
          </ol>
          {tree.nodes.some((n) => n.relation === 'current') && (
            <p className="muted genealogy-footnote">
              Some parents were linked by name. Their current release may have changed since this
              remix was made.
            </p>
          )}
        </>
      )}
    </section>
  );
}

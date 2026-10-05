import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowUpRight, Asterisk, Code2, GitFork, Play, Radio } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getProjectLinks } from '@/lib/about.functions';
import { AboutFaq } from '@/components/about-faq';
import { siteHead } from '@/lib/site-head';

const description =
  'How napplet.soy works: play tiny creations, inspect their source, remix them and share through Nostr.';
export const Route = createFileRoute('/about')({
  loader: () => getProjectLinks(),
  head: ({ match }) =>
    siteHead(match.context.clientPolicy.siteOrigin, '/about', 'About — napplet.soy', description),
  component: About,
});
const resources = [
  ['Napplet', 'The project and its open ecosystem.', 'https://github.com/napplet'],
  ['napplet.run', 'Explore the wider Napplet world.', 'https://napplet.run/'],
  [
    'NAPs',
    'The contracts between a napplet and the client that runs it.',
    'https://github.com/napplet/naps',
  ],
  [
    'Boilerplate',
    'The creator-maintained starting point for new napplets.',
    'https://github.com/napplet/boilerplate',
  ],
  [
    'ngit & Gitworkshop',
    'Git repositories and collaboration over Nostr.',
    'https://gitworkshop.dev/',
  ],
  [
    'Blossom',
    'Content-addressed file storage for the Nostr ecosystem.',
    'https://github.com/hzrd149/blossom',
  ],
  [
    'Applesauce',
    'The Nostr libraries behind our discovery and signing.',
    'https://applesauce.build/',
  ],
  [
    'ContextVM',
    'Services over Nostr for shared scores and matchmaking.',
    'https://github.com/ContextVM',
  ],
];
function About() {
  const repositories = Route.useLoaderData();
  return (
    <article className="about-page">
      <header className="about-intro">
        <div>
          <span className="eyebrow">A LITTLE ABOUT THIS PLACE</span>
          <h1>
            Small code.
            <br />
            Open possibilities<span className="coral">.</span>
          </h1>
          <p>A playground for things people made because they wondered what would happen.</p>
          <div className="about-actions">
            <Button asChild>
              <Link to="/">
                Find something to play <Play size={15} />
              </Link>
            </Button>
            <Link to="/create">
              Make it yours <ArrowUpRight size={15} />
            </Link>
            <Link to="/docs">
              soyLI documentation <ArrowUpRight size={15} />
            </Link>
          </div>
        </div>
        <aside className="about-note">
          <Asterisk size={44} strokeWidth={1.5} aria-hidden="true" />
          <p>
            A little of the demo scene.
            <br />A little of the old web.
            <br />
            <strong>Room for your kind of weird.</strong>
          </p>
          <span className="eyebrow">PLAY · PEEK · PASS IT ON</span>
        </aside>
      </header>
      <section className="about-section" aria-labelledby="about-flow">
        <div className="about-section-heading">
          <span className="eyebrow">01 / THE IDEA</span>
          <h2 id="about-flow">Curiosity goes both ways.</h2>
        </div>
        <div className="about-steps">
          <div>
            <Play size={22} aria-hidden="true" />
            <h3>Play a little</h3>
            <p>
              Browse games, visual experiments, toys and digital memes. Pick one to start it, or
              open its player for a bigger view. Browsing needs no account.
            </p>
          </div>
          <div>
            <Code2 size={22} aria-hidden="true" />
            <h3>Look inside</h3>
            <p>
              Browse a creation’s original files when its author shares a source archive. Otherwise,
              inspect the verified built HTML and follow its source link. Check its license before
              reusing it.
            </p>
          </div>
          <div>
            <GitFork size={22} aria-hidden="true" />
            <h3>Follow a tangent</h3>
            <p>
              Remix a creation or start from the Napplet boilerplate. Our CLI prepares the project
              and skills for the coding agent you already use. Check the listing preview, publish,
              and share your link.
            </p>
          </div>
        </div>
      </section>
      <section className="about-section" aria-labelledby="about-network">
        <div className="about-section-heading">
          <span className="eyebrow">02 / THE CONNECTIONS</span>
          <h2 id="about-network">Your creation has a life beyond this site.</h2>
        </div>
        <div className="about-columns">
          <div>
            <p>
              A napplet is a signed publication on{' '}
              <a href="https://github.com/nostr-protocol/nostr" target="_blank" rel="noreferrer">
                Nostr
              </a>
              . Relays carry its listing; our publishing tools use Blossom for files and Git for
              source. Other compatible clients can discover the same publication. A readable site
              link is a convenience; its Nostr address travels with it.
            </p>
            <p>
              Our CLI uses this site’s infrastructure by default. Creators can inspect and change
              relay, Blossom and Git destinations with <code>soyli config</code>. The{' '}
              <Link to="/docs" hash="destinations">
                documentation
              </Link>{' '}
              explains the local overrides.
            </p>
          </div>
          <dl className="about-glossary">
            <div>
              <dt>
                <Radio size={15} /> Relays
              </dt>
              <dd>Discover signed creations and their conversations.</dd>
            </div>
            <div>
              <dt>Blossom</dt>
              <dd>Retrieve files by the hash that identifies their bytes.</dd>
            </div>
            <div>
              <dt>Git + ngit</dt>
              <dd>Keep source history and make a remix from a published revision.</dd>
            </div>
          </dl>
        </div>
      </section>
      <section className="about-section" aria-labelledby="about-trust">
        <div className="about-section-heading">
          <span className="eyebrow">03 / YOUR SIDE OF THE SCREEN</span>
          <h2 id="about-trust">You choose when to play. You choose how to sign.</h2>
        </div>
        <div className="about-columns">
          <div>
            <h3>A boundary around each creation</h3>
            <p>
              Before playback, this client verifies the signed manifest and downloaded files. Each
              napplet runs in a sandbox, with requests handled through the capabilities this client
              supports. It cannot read the surrounding page or your signing keys.
            </p>
            <p>
              Some napplets need capabilities we do not support yet. Those stay visible through the
              gallery’s availability filter. Supported capabilities include shared scores and
              matchmaking through ContextVM, with peer connections through NAP-WEBRTC.
            </p>
          </div>
          <div>
            <h3>An identity you can bring along</h3>
            <p>
              Connect an extension or remote signer, or import or create a private key and save an
              encrypted backup. Remembered connections survive reloads on this device. Private keys
              are remembered only when you choose to save them here; use a trusted browser.
            </p>
            <p>
              Sign in to like or comment. Anyone can share a link or send an anonymous zap when the
              creator has a compatible Lightning wallet. Counts reflect the activity this client has
              found on its relays.
            </p>
            <p>
              Site administrators can hide content here. That does not erase copies from other
              clients or relays.
            </p>
          </div>
        </div>
      </section>
      <AboutFaq />
      <section className="about-section" aria-labelledby="about-resources">
        <div className="about-section-heading">
          <span className="eyebrow">05 / KEEP EXPLORING</span>
          <h2 id="about-resources">Built with others. Open to more.</h2>
        </div>
        <p className="about-stack">
          This client uses <a href="https://bun.sh/">Bun</a>, <a href="https://react.dev/">React</a>
          , <a href="https://tanstack.com/start/latest">TanStack Start and Router</a>,{' '}
          <a href="https://ui.shadcn.com/">shadcn/ui</a> and{' '}
          <a href="https://applesauce.build/">Applesauce</a>. It follows the{' '}
          <a href="https://github.com/dskvr/nips/blob/4d0fb2e9fa1fdca71be09b17a4c5f382fbca5d51/5D.md">
            NIP-5D proposal
          </a>{' '}
          and supported NAP capability contracts.
        </p>
        {repositories.length > 0 && (
          <div className="about-repositories">
            <h3>Source for this client</h3>
            {repositories.map((repo) => (
              <a key={repo.href} href={repo.href} target="_blank" rel="noreferrer">
                napplet.soy on {repo.label} <ArrowUpRight size={15} />
              </a>
            ))}
          </div>
        )}
        <div className="about-resources">
          {resources.map(([name, detail, href]) => (
            <a href={href} key={href} target="_blank" rel="noreferrer">
              <div>
                <h3>{name}</h3>
                <p>{detail}</p>
              </div>
              <ArrowUpRight size={19} aria-hidden="true" />
            </a>
          ))}
        </div>
      </section>
      <div className="about-end">
        <Asterisk size={22} aria-hidden="true" />
        <p>An idea is enough to get started.</p>
        <Link to="/create">
          Make a little something <ArrowUpRight size={16} />
        </Link>
      </div>
    </article>
  );
}

import { validatedVideo } from '../../protocol/src/preview-video';
import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifiedEvent, type SignedEvent } from '../../protocol/src';
import { publicNapplet, type PublicNapplet } from './public-model';
import { validatedPreview } from '../../protocol/src/preview';
import { missingDomains } from '../../runtime/src/capabilities';
import { publicationKey } from '../../protocol/src/publication-order';

// NIP-01 replacement comes before NIP-5D package admission. An invalid new
// package still replaces the old package; duplicate/missing d tags cannot revive it.
export function manifestKey(event: SignedEvent) {
  if (event.kind === 5129) return event.id;
  if (event.kind === 15129) return `15129:${event.pubkey}:`;
  if (event.kind === 35129)
    return `35129:${event.pubkey}:${event.tags.find((t) => t[0] === 'd')?.[1] ?? ''}`;
  throw new Error('Not a napplet manifest');
}
export const newerManifest = (a: SignedEvent, b: SignedEvent) =>
  a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id);
export type IndexRow = {
  key: string;
  id: string;
  event: string;
  projection: string | null;
  retry_at: number;
  preview_at: number;
};

/** One durable projection shared by the worker and read-only web processes. */
export class IndexStore {
  private db: Database;
  constructor(
    readonly directory: string,
    readonly writable = false,
  ) {
    if (writable) mkdirSync(directory, { recursive: true });
    this.db = new Database(join(directory, 'catalog.sqlite'), {
      readonly: !writable,
      create: writable,
      strict: true,
    });
    this.db.exec('PRAGMA busy_timeout=5000');
    if (writable) {
      this.db.exec(`PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS records (
          key TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, event TEXT NOT NULL,
          projection TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
          preview_at INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deletions (target TEXT NOT NULL, author TEXT NOT NULL,
          at INTEGER NOT NULL, PRIMARY KEY(target, author));
        CREATE INDEX IF NOT EXISTS artifact_hash ON records(json_extract(projection, '$.artifactHash'));
        CREATE TABLE IF NOT EXISTS revisions (
          key TEXT NOT NULL, id TEXT PRIMARY KEY, event TEXT NOT NULL,
          projection TEXT, retry_at INTEGER NOT NULL DEFAULT 0,
          preview_at INTEGER NOT NULL DEFAULT 0);
        CREATE INDEX IF NOT EXISTS revision_artifact_hash ON revisions(json_extract(projection, '$.artifactHash'));`);
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS first_publications (key TEXT PRIMARY KEY, at INTEGER NOT NULL)',
      );
      // Recover original dates from retained legacy snapshots and archived named
      // revisions when upgrading an existing deployment, before accepting updates.
      this.db.transaction(() => {
        for (const row of this.allRows()) {
          const event = JSON.parse(row.event) as SignedEvent;
          if (event.kind !== 5129 || row.projection) this.recordPublication(event);
        }
      })();
    } else if (
      !this.db.query('PRAGMA table_info(revisions)').all().length ||
      !this.db.query('PRAGMA table_info(first_publications)').all().length
    ) {
      // The independently started writer owns schema migration. The web's
      // indexStore wrapper retries opening after it becomes ready.
      this.db.close();
      throw new Error('Index schema is waiting for the worker migration');
    }
  }
  close() {
    this.db.close();
  }
  private recordPublication(event: SignedEvent) {
    let key: string;
    try {
      key = publicationKey(event);
    } catch {
      return;
    } // Invalid identifiers cannot establish a creation date.
    this.db.run(
      'INSERT INTO first_publications VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET at=min(at, excluded.at)',
      [key, event.created_at],
    );
  }
  firstPublishedAt(event: SignedEvent) {
    let key: string;
    try {
      key = publicationKey(event);
    } catch {
      return event.created_at;
    }
    return (
      this.db
        .query<{ at: number }, [string]>('SELECT at FROM first_publications WHERE key=?')
        .get(key)?.at ?? event.created_at
    );
  }
  rows() {
    return this.db.query<IndexRow, []>('SELECT * FROM records').all();
  }
  /** Retained signed revisions are available by ID, never additional gallery entries. */
  allRows() {
    return this.db
      .query<IndexRow, []>('SELECT * FROM records UNION ALL SELECT * FROM revisions')
      .all();
  }
  administrationRows() {
    return this.db
      .query<IndexRow, []>(
        `SELECT * FROM records
      ORDER BY json_extract(event, '$.created_at') DESC, id ASC LIMIT 2000`,
      )
      .all();
  }
  recent() {
    return this.db
      .query<IndexRow, []>(
        `SELECT * FROM records
    ORDER BY json_extract(event, '$.created_at') DESC, id ASC LIMIT 200`,
      )
      .all();
  }
  artifactRows(hash: string) {
    return this.db
      .query<IndexRow, [string, string]>(
        `SELECT * FROM records
      WHERE json_extract(projection, '$.artifactHash')=?
      UNION ALL SELECT * FROM revisions WHERE json_extract(projection, '$.artifactHash')=?`,
      )
      .all(hash, hash);
  }
  due(now: number) {
    return this.db
      .query<IndexRow, [number, number]>(
        `SELECT * FROM (SELECT * FROM records UNION ALL SELECT * FROM revisions)
      WHERE retry_at<=? OR preview_at<=? ORDER BY retry_at, id LIMIT 12`,
      )
      .all(now, now);
  }
  references() {
    return this.db
      .query<{ hash: string | null; preview: string | null; video: string | null }, []>(
        `SELECT
      json_extract(projection, '$.artifactHash') AS hash,
      json_extract(projection, '$.preview.hash') AS preview, json_extract(projection, '$.video.hash') AS video
      FROM (SELECT projection FROM records UNION ALL SELECT projection FROM revisions)`,
      )
      .all();
  }
  invalidate() {
    this.db.exec('UPDATE records SET retry_at=0, preview_at=0');
    this.db.exec('UPDATE revisions SET retry_at=0, preview_at=0');
  }
  removed(event: SignedEvent) {
    const expiry = event.tags.find((t) => t[0] === 'expiration')?.[1];
    if (expiry && /^\d+$/.test(expiry) && Number(expiry) <= Date.now() / 1000) return true;
    return !!this.db
      .query<{ target: string }, [string, string, string, number]>(
        'SELECT target FROM deletions WHERE (target=? OR target=?) AND author=? AND at>=? LIMIT 1',
      )
      .get(event.id, manifestKey(event), event.pubkey, event.created_at);
  }
  row(key: string) {
    return this.db.query<IndexRow, [string]>('SELECT * FROM records WHERE key=?').get(key);
  }
  revision(id: string) {
    return this.db
      .query<IndexRow, [string, string]>(
        'SELECT * FROM records WHERE id=? UNION ALL SELECT * FROM revisions WHERE id=? LIMIT 1',
      )
      .get(id, id);
  }
  state<T>(key: string): T | null {
    const row = this.db
      .query<{ value: string }, [string]>('SELECT value FROM state WHERE key=?')
      .get(key);
    return row ? (JSON.parse(row.value) as T) : null;
  }
  setState(key: string, value: unknown) {
    this.db.run('INSERT OR REPLACE INTO state VALUES (?, ?)', [key, JSON.stringify(value)]);
  }
  admit(input: unknown, now = Date.now()) {
    const event = verifiedEvent(input);
    if (event.created_at > now / 1000 + 600) throw new Error('Future event');
    if (event.kind === 5) {
      // Authenticated deletion markers are retained even when their target arrives later.
      const targets = [
        ...new Set(
          event.tags
            .filter(
              (t) =>
                (t[0] === 'e' && /^[a-f0-9]{64}$/.test(t[1])) ||
                (t[0] === 'a' && t[1]?.startsWith(`35129:${event.pubkey}:`)) ||
                (t[0] === 'a' && t[1] === `15129:${event.pubkey}:`),
            )
            .map((t) => t[1]),
        ),
      ];
      this.db.transaction(() => {
        for (const target of targets)
          this.db.run(
            `INSERT INTO deletions VALUES (?, ?, ?)
          ON CONFLICT(target, author) DO UPDATE SET at=max(at, excluded.at)`,
            [target, event.pubkey, event.created_at],
          );
        // Drop serving/cache references immediately; the worker prunes unreferenced bytes.
        for (const row of this.allRows()) {
          if (this.removed(JSON.parse(row.event))) this.project(row.id, null, 0, 0);
        }
        if (
          this.db.query<{ n: number }, []>('SELECT count(*) AS n FROM deletions').get()!.n > 10000
        )
          throw new Error('Index deletion capacity reached (10000)');
      })();
      return targets.length > 0;
    }
    const key = manifestKey(event);
    return this.db.transaction(() => {
      if (event.kind !== 5129) this.recordPublication(event);
      const old = this.row(key);
      if (old?.id === event.id || this.revision(event.id)) return false;
      if (old && !newerManifest(event, JSON.parse(old.event))) {
        this.archive({
          key,
          id: event.id,
          event: JSON.stringify(event),
          projection: null,
          retry_at: 0,
          preview_at: 0,
        });
        return true;
      }
      if (
        !old &&
        this.db.query<{ n: number }, []>('SELECT count(*) AS n FROM records').get()!.n >= 10000
      )
        throw new Error(
          'Index event capacity reached (10000); increase capacity before continuing',
        );
      if (old) this.archive(old);
      this.db.run(
        `INSERT INTO records (key, id, event) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET id=excluded.id, event=excluded.event,
        projection=NULL, retry_at=0, preview_at=0`,
        [key, event.id, JSON.stringify(event)],
      );
      return true;
    })();
  }
  private archive(row: IndexRow) {
    if (this.db.query<{ n: number }, []>('SELECT count(*) AS n FROM revisions').get()!.n >= 10000)
      throw new Error(
        'Index revision capacity reached (10000); increase capacity before continuing',
      );
    this.db.run(
      'INSERT INTO revisions (key, id, event, projection, retry_at, preview_at) VALUES (?, ?, ?, ?, ?, ?)',
      [row.key, row.id, row.event, row.projection, row.retry_at, row.preview_at],
    );
  }
  project(id: string, entry: PublicNapplet | null, retryAt: number, previewAt: number) {
    const row = this.revision(id);
    if (!row || this.removed(JSON.parse(row.event))) entry = null;
    if (entry) this.recordPublication(entry.manifest);
    for (const table of ['records', 'revisions'])
      this.db.run(`UPDATE ${table} SET projection=?, retry_at=?, preview_at=? WHERE id=?`, [
        entry ? JSON.stringify(entry) : null,
        retryAt,
        previewAt,
        id,
      ]);
  }
}

// Re-derive signed data at the trust boundary. Disk metadata cannot change the
// author, artifact, capability requirements, or linked preview descriptor.
export async function indexedProjection(
  row: IndexRow,
  relays: string[],
  firstPublishedAt?: number,
) {
  try {
    const entry = await publicNapplet(JSON.parse(row.event), relays);
    if (firstPublishedAt !== undefined)
      entry.firstPublishedAt = Math.min(firstPublishedAt, entry.manifest.created_at);
    if (row.id !== entry.revisionId || row.key !== manifestKey(entry.manifest)) return null;
    const saved = row.projection ? (JSON.parse(row.projection) as PublicNapplet) : null;
    if (saved?.revisionId === entry.revisionId && saved.artifactHash === entry.artifactHash) {
      entry.bytes = saved.bytes;
      entry.metadata = saved.metadata;
      entry.video = validatedVideo(entry.manifest, saved.video);
      entry.preview = validatedPreview(entry.manifest, saved.preview);
      entry.availability = missingDomains(entry.domains).length
        ? 'host-required'
        : saved.availability === 'ready'
          ? 'ready'
          : 'unavailable';
    }
    return entry;
  } catch {
    return null;
  }
}

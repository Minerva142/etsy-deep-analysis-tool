import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache } from '../src/etsy/cache.js';
import { RateLimiter } from '../src/etsy/rate-limiter.js';
import { EtsyClient } from '../src/etsy/client.js';
import {
  runNicheSnapshot,
  upsertNiche,
  type Niche,
} from '../src/ingest/niche-snapshot.js';

const niche: Niche = {
  nicheId: 'mug',
  name: 'Seramik kupa',
  keywords: 'mug',
  taxonomyId: null,
  minPrice: null,
  maxPrice: null,
};

describe('runNicheSnapshot', () => {
  let db: Db;
  let client: EtsyClient;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    client = new EtsyClient({
      config: loadConfig({ ETSY_MODE: 'fixture' }),
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
      sleep: async () => {},
    });
    await upsertNiche(db, niche);
  });

  it("fixture verisini uçtan uca DB’ye yazar", async () => {
    const result = await runNicheSnapshot({ db, client, niche });

    expect(result.listingCount).toBe(2);
    expect(result.status).toBe('complete');

    const listings = await db.query<{ n: string }>('select count(*) as n from listings');
    expect(Number(listings[0]?.n)).toBe(2);

    const observations = await db.query<{ n: string }>(
      'select count(*) as n from listing_observations',
    );
    expect(Number(observations[0]?.n)).toBe(2);

    const tags = await db.query<{ n: string }>('select count(*) as n from listing_tags');
    expect(Number(tags[0]?.n)).toBe(5);
  });

  it('snapshot kaydını complete olarak kapatır', async () => {
    const result = await runNicheSnapshot({ db, client, niche });
    const rows = await db.query<{
      status: string;
      listing_count: string;
      finished_at: string | null;
    }>('select status, listing_count, finished_at from snapshots where snapshot_id = $id', {
      id: result.snapshotId,
    });
    expect(rows[0]?.status).toBe('complete');
    expect(Number(rows[0]?.listing_count)).toBe(2);
    expect(rows[0]?.finished_at).not.toBeNull();
  });

  it("ikinci snapshot first_seen_at’i korur, last_seen_at’i günceller", async () => {
    let clock = new Date('2026-09-16T10:00:00Z');
    await runNicheSnapshot({ db, client, niche, now: () => clock });

    clock = new Date('2026-09-17T10:00:00Z');
    await runNicheSnapshot({ db, client, niche, now: () => clock });

    const rows = await db.query<{ first_seen_at: string; last_seen_at: string }>(
      'select first_seen_at, last_seen_at from listings where listing_id = 1234567890',
    );
    expect(rows[0]?.first_seen_at).toContain('2026-09-16');
    expect(rows[0]?.last_seen_at).toContain('2026-09-17');
  });

  it('her snapshot için ayrı gözlem satırı yazar', async () => {
    let clock = new Date('2026-09-16T10:00:00Z');
    await runNicheSnapshot({ db, client, niche, now: () => clock });
    clock = new Date('2026-09-17T10:00:00Z');
    await runNicheSnapshot({ db, client, niche, now: () => clock });

    const rows = await db.query<{ n: string }>(
      'select count(*) as n from listing_observations where listing_id = 1234567890',
    );
    expect(Number(rows[0]?.n)).toBe(2);
  });

  it('etiketleri tekrar yazarken çoğaltmaz', async () => {
    await runNicheSnapshot({ db, client, niche });
    await runNicheSnapshot({ db, client, niche });
    const rows = await db.query<{ n: string }>(
      'select count(*) as n from listing_tags where listing_id = 1234567890',
    );
    expect(Number(rows[0]?.n)).toBe(3);
  });
});

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
import { enrichShops } from '../src/ingest/shop-enrich.js';

const niche: Niche = {
  nicheId: 'mug',
  name: 'Seramik kupa',
  keywords: 'mug',
  taxonomyId: null,
  minPrice: null,
  maxPrice: null,
};

describe('enrichShops', () => {
  let db: Db;
  let client: EtsyClient;
  let snapshotId: string;

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
    snapshotId = (await runNicheSnapshot({ db, client, niche })).snapshotId;
  });

  it("snapshot’taki satıcıları shops tablosuna yazar", async () => {
    const result = await enrichShops({ db, client, snapshotId });

    expect(result.shopCount).toBe(2);
    expect(result.apiCalls).toBe(2);

    const rows = await db.query<{ shop_id: string; shop_name: string }>(
      'select shop_id, shop_name from shops order by shop_id',
    );
    expect(rows.map((r) => r.shop_name)).toEqual(['CozyCeramics', 'MinimalMugs']);
  });

  it('shop_observations satırını snapshot ile ilişkilendirir', async () => {
    await enrichShops({ db, client, snapshotId });

    const rows = await db.query<{
      review_average: number;
      listing_active_count: string;
    }>(
      'select review_average, listing_active_count from shop_observations where shop_id = 11111',
    );
    expect(Number(rows[0]?.review_average)).toBeCloseTo(4.8);
    expect(Number(rows[0]?.listing_active_count)).toBe(48);
  });

  it('maxShops sınırına uyar', async () => {
    const result = await enrichShops({ db, client, snapshotId, maxShops: 1 });
    expect(result.shopCount).toBe(1);
    expect(result.apiCalls).toBe(1);
  });

  it("ikinci çalıştırmada shops satırını çoğaltmaz, first_seen_at’i korur", async () => {
    let clock = new Date('2026-09-16T10:00:00Z');
    await enrichShops({ db, client, snapshotId, now: () => clock });
    clock = new Date('2026-09-17T10:00:00Z');
    await enrichShops({ db, client, snapshotId, now: () => clock });

    const count = await db.query<{ n: string }>('select count(*) as n from shops');
    expect(Number(count[0]?.n)).toBe(2);

    const rows = await db.query<{ first_seen_at: string; last_seen_at: string }>(
      'select first_seen_at, last_seen_at from shops where shop_id = 11111',
    );
    expect(rows[0]?.first_seen_at).toContain('2026-09-16');
    expect(rows[0]?.last_seen_at).toContain('2026-09-17');
  });
});

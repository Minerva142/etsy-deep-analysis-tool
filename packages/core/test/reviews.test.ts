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
import { buildReviewId, ingestReviews } from '../src/ingest/reviews.js';

const niche: Niche = {
  nicheId: 'mug',
  name: 'Seramik kupa',
  keywords: 'mug',
  taxonomyId: null,
  minPrice: null,
  maxPrice: null,
  sortOn: 'score',
};

describe('buildReviewId', () => {
  it('aynı yorum için aynı anahtarı üretir', () => {
    const review = { rating: 5, review: 'nice', create_timestamp: 1756684800 };
    expect(buildReviewId(1, review)).toBe(buildReviewId(1, review));
  });

  it('farklı metin için farklı anahtar üretir', () => {
    const a = buildReviewId(1, { rating: 5, review: 'nice', create_timestamp: 1756684800 });
    const b = buildReviewId(1, { rating: 5, review: 'bad', create_timestamp: 1756684800 });
    expect(a).not.toBe(b);
  });

  it('listing_id ile başlar', () => {
    const id = buildReviewId(42, { rating: 5, review: 'x', create_timestamp: 1756684800 });
    expect(id.startsWith('42:')).toBe(true);
  });
});

describe('ingestReviews', () => {
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

  it('yorumları reviews tablosuna yazar', async () => {
    const result = await ingestReviews({ db, client, snapshotId });

    expect(result.reviewCount).toBe(2);
    expect(result.apiCalls).toBe(2);

    const rows = await db.query<{ rating: string }>(
      'select rating from reviews order by rating',
    );
    expect(rows.map((r) => Number(r.rating))).toEqual([2, 5]);
  });

  it('en çok favorilenen listing ile başlar', async () => {
    const result = await ingestReviews({ db, client, snapshotId, maxListings: 1 });
    expect(result.apiCalls).toBe(1);
    expect(result.reviewCount).toBe(2);
  });

  it('ikinci çalıştırmada yorumları çoğaltmaz', async () => {
    await ingestReviews({ db, client, snapshotId });
    await ingestReviews({ db, client, snapshotId });

    const rows = await db.query<{ n: string }>('select count(*) as n from reviews');
    expect(Number(rows[0]?.n)).toBe(2);
  });

  it('yorum metnini ve puanı birlikte saklar', async () => {
    await ingestReviews({ db, client, snapshotId });
    const rows = await db.query<{ review_text: string }>(
      'select review_text from reviews where rating = 2',
    );
    expect(rows[0]?.review_text).toContain('chipped');
  });
});

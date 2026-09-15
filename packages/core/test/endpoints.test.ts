import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache } from '../src/etsy/cache.js';
import { RateLimiter } from '../src/etsy/rate-limiter.js';
import { EtsyClient } from '../src/etsy/client.js';
import {
  etsyListingSchema,
  fetchAllActiveListings,
} from '../src/etsy/endpoints/listings.js';

const sampleListing = (listingId: number): Record<string, unknown> => ({
  listing_id: listingId,
  shop_id: 1,
  title: 't',
  state: 'active',
  url: 'https://example.com',
  num_favorers: 0,
  taxonomy_id: 1,
  tags: [],
  created_timestamp: 1735689600,
  price: { amount: 100, divisor: 100, currency_code: 'USD' },
});

const fullPage = {
  count: 10000,
  results: Array.from({ length: 100 }, (_, index) => sampleListing(index + 1)),
};

describe('etsyListingSchema', () => {
  it("geçerli listing’i kabul eder", () => {
    const parsed = etsyListingSchema.parse(sampleListing(1));
    expect(parsed.listing_id).toBe(1);
  });

  it('listing_id eksikse reddeder', () => {
    expect(() => etsyListingSchema.parse({ title: 'x' })).toThrow();
  });
});

describe('fetchAllActiveListings', () => {
  let db: Db;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
  });

  const fixtureClient = () =>
    new EtsyClient({
      config: loadConfig({ ETSY_MODE: 'fixture' }),
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
      sleep: async () => {},
    });

  it("fixture’tan listing’leri okur ve sayfalamayı sonlandırır", async () => {
    const result = await fetchAllActiveListings(fixtureClient(), { keywords: 'mug' });
    expect(result.listings).toHaveLength(2);
    expect(result.listings[0]?.listing_id).toBe(1234567890);
    expect(result.apiCalls).toBe(1);
  });

  it("dolu sayfadan sonra bir sonraki offset’i ister", async () => {
    const requested: number[] = [];
    const client = {
      request: vi.fn(async (req: { params?: Record<string, unknown> }) => {
        const offset = Number(req.params?.offset ?? 0);
        requested.push(offset);
        return offset === 0 ? fullPage : { count: 10000, results: [] };
      }),
    } as unknown as EtsyClient;

    const result = await fetchAllActiveListings(client, { keywords: 'mug' });

    expect(requested).toEqual([0, 100]);
    expect(result.listings).toHaveLength(100);
    expect(result.apiCalls).toBe(2);
  });

  it('maxPages sınırına uyar', async () => {
    const client = {
      request: vi.fn(async () => fullPage),
    } as unknown as EtsyClient;

    const result = await fetchAllActiveListings(client, { keywords: 'mug' }, { maxPages: 3 });

    expect(result.apiCalls).toBe(3);
    expect(result.listings).toHaveLength(300);
  });
});

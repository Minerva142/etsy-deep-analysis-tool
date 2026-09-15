import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache, buildCacheKey, TTL_SECONDS } from '../src/etsy/cache.js';

describe('HttpCache', () => {
  let db: Db;
  let clock: Date;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    clock = new Date('2026-09-16T10:00:00Z');
  });

  const cache = () => new HttpCache(db, () => clock);

  it('yazılan değeri geri okur', async () => {
    await cache().set('k1', { count: 3 }, 60);
    expect(await cache().get('k1')).toEqual({ count: 3 });
  });

  it('bilinmeyen anahtar için null döner', async () => {
    expect(await cache().get('yok')).toBeNull();
  });

  it('TTL dolduğunda null döner', async () => {
    await cache().set('k1', { count: 3 }, 60);
    clock = new Date('2026-09-16T10:01:01Z');
    expect(await cache().get('k1')).toBeNull();
  });

  it('aynı anahtara ikinci yazma değeri günceller', async () => {
    await cache().set('k1', { count: 1 }, 60);
    await cache().set('k1', { count: 2 }, 60);
    expect(await cache().get('k1')).toEqual({ count: 2 });
  });

  it('cache anahtarı parametre sırasından bağımsızdır', () => {
    const a = buildCacheKey('/listings/active', { keywords: 'mug', limit: 100 });
    const b = buildCacheKey('/listings/active', { limit: 100, keywords: 'mug' });
    expect(a).toBe(b);
  });

  it('tanımsız parametreleri anahtara katmaz', () => {
    const a = buildCacheKey('/listings/active', { keywords: 'mug', offset: undefined });
    const b = buildCacheKey('/listings/active', { keywords: 'mug' });
    expect(a).toBe(b);
  });

  it("spec’teki TTL değerlerini taşır", () => {
    expect(TTL_SECONDS.taxonomy).toBe(30 * 24 * 3600);
    expect(TTL_SECONDS.listingDetail).toBe(24 * 3600);
    expect(TTL_SECONDS.listingSearch).toBe(6 * 3600);
    expect(TTL_SECONDS.reviews).toBe(24 * 3600);
  });
});

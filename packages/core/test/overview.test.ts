import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import {
  getFreshness,
  getMarketOverview,
  getReviewStats,
} from '../src/analysis/overview.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('pazar görünümü', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('son snapshot’taki listing ve satıcı sayısını verir', async () => {
    const o = await getMarketOverview(db, nicheId);
    expect(o?.listingCount).toBe(4);
    expect(o?.sellerCount).toBe(3);
  });

  it('fiyat medyanını ve çeyrekliklerini hesaplar', async () => {
    const o = await getMarketOverview(db, nicheId);
    // Fiyatlar 10, 20, 30, 40
    expect(o?.medianPrice).toBeCloseTo(25);
    expect(o?.p25Price).toBeCloseTo(17.5);
    expect(o?.p75Price).toBeCloseTo(32.5);
  });

  it('ortalama hızı yalnızca ölçülebilen listing’ler üzerinden alır', async () => {
    const o = await getMarketOverview(db, nicheId);
    // L1=10, L2=1, L3=0 -> 11/3. L4'ün hızı NULL, hesaba girmez.
    expect(o?.avgVelocity).toBeCloseTo(11 / 3);
  });

  it('bilinmeyen niş için null döner', async () => {
    expect(await getMarketOverview(db, 'yok')).toBeNull();
  });

  it('tazeliği orijinal oluşturma tarihinden hesaplar', async () => {
    const f = await getFreshness(db, nicheId);
    // L4 (2026-09-05), son snapshot 2026-09-11 -> 30 gün içinde 1 tane.
    expect(f?.newLast30Days).toBe(1);
    // L3 (2026-06-20, 83 gün önce) da dahil -> 90 gün içinde 2 tane.
    expect(f?.newLast90Days).toBe(2);
  });

  it('yorum puan dağılımını verir', async () => {
    const s = await getReviewStats(db, nicheId);
    expect(s.ratingDistribution).toEqual([
      { rating: 2, count: 1 },
      { rating: 3, count: 1 },
      { rating: 5, count: 1 },
    ]);
  });

  it('düşük puanlı yorumları metniyle listeler', async () => {
    const s = await getReviewStats(db, nicheId);
    expect(s.lowRated).toHaveLength(2);
    expect(s.lowRated.map((r) => r.text)).toContain('Kulpu kırık geldi');
  });
});

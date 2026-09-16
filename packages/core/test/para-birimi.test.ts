import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, toDbTimestamp, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { getMarketOverview } from '../src/analysis/overview.js';
import {
  getGapMatrix,
  getPriceDemandCurve,
  getPriceHistogram,
} from '../src/analysis/pricing.js';
import { seedTwoSnapshots } from './helpers/seed.js';

/*
 * Etsy fiyatları satıcının para biriminde döndürüyor. Bunları toplamak
 * sessizce yanlış sayı üretiyordu: gerçek veride ceramic-mug nişinin
 * karışık medyanı 29.00, yalnız USD gözlemlerin medyanı 21.10 çıkıyordu.
 * Aşağıdaki testler, yabancı birimdeki satırların fiyat istatistiklerine
 * hiç girmediğini ve ekranın hangi birimi gösterdiğini bildiğini sabitler.
 */
describe('fiyat istatistikleri tek para biriminde', () => {
  let db: Db;
  let nicheId: string;
  let snapshotB: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId, snapshotB } = await seedTwoSnapshots(db));
  });

  /** Baskın birimi bozacak kadar ucuz, ama sayıca az bir TRY listing'i ekler. */
  async function tryListingEkle(): Promise<void> {
    await db.runStatement(
      `insert into listings (listing_id, shop_id, title, url, first_seen_at, last_seen_at)
       values (99, 1, 'TRY kupa', 'https://example.com/99', $t::TIMESTAMP, $t::TIMESTAMP)`,
      { t: toDbTimestamp(new Date('2026-09-15T10:00:00Z')) },
    );
    await db.runStatement(
      `insert into listing_observations
         (snapshot_id, listing_id, price_amount, currency_code,
          num_favorers, quantity, state, observed_at)
       values ($snapshot, 99, 9000, 'TRY', 5, 1, 'active', $t::TIMESTAMP)`,
      { snapshot: snapshotB, t: toDbTimestamp(new Date('2026-09-16T10:00:00Z')) },
    );
  }

  it('baskın para birimini ve kapsadığı listing sayısını bildirir', async () => {
    const o = await getMarketOverview(db, nicheId);
    expect(o?.priceCurrency).toBe('USD');
    expect(o?.pricedCount).toBe(4);
  });

  it('yabancı birimdeki fiyatı medyana katmaz', async () => {
    const once = await getMarketOverview(db, nicheId);
    await tryListingEkle();
    const sonra = await getMarketOverview(db, nicheId);

    // 9000 TRY medyanı yukarı çekseydi 25 olamazdı.
    expect(sonra?.medianPrice).toBeCloseTo(once?.medianPrice ?? -1);
    expect(sonra?.medianPrice).toBeCloseTo(25);
    expect(sonra?.priceCurrency).toBe('USD');
    // Listing sayımı yine de toplam: sadece FİYAT istatistikleri kısıtlı.
    expect(sonra?.listingCount).toBe((once?.listingCount ?? 0) + 1);
    expect(sonra?.pricedCount).toBe(4);
  });

  it('fiyat bantlarına yabancı birimdeki listing girmez', async () => {
    await tryListingEkle();
    const bantlar = await getPriceDemandCurve(db, nicheId, 4);

    expect(bantlar.every((b) => b.currency === 'USD')).toBe(true);
    expect(bantlar.reduce((t, b) => t + b.supply, 0)).toBe(4);
    expect(Math.max(...bantlar.map((b) => b.maxPrice))).toBeCloseTo(40);
  });

  it('histogram yabancı birimi dışarıda bırakır ve eşit genişlikte kova kurar', async () => {
    await tryListingEkle();
    const kovalar = await getPriceHistogram(db, nicheId, 4);

    expect(kovalar.every((k) => k.currency === 'USD')).toBe(true);
    expect(kovalar.reduce((t, k) => t + k.count, 0)).toBe(4);

    // Bant grafiğinden farkı: aralık sabit, adet değişken.
    const genislikler = kovalar.map((k) => k.to - k.from);
    for (const g of genislikler) {
      expect(g).toBeCloseTo(genislikler[0] ?? 0, 6);
    }
  });

  it('boşluk matrisi de tek para biriminde kalır', async () => {
    await tryListingEkle();
    const hucreler = await getGapMatrix(db, nicheId, 2);

    expect(hucreler.every((h) => h.currency === 'USD')).toBe(true);
    expect(hucreler.reduce((t, h) => t + h.supply, 0)).toBe(4);
  });
});

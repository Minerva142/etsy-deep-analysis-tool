import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { getConcentration, getSellerTable } from '../src/analysis/sellers.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('satıcı analizi', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('satıcıları listing sayısına göre sıralar', async () => {
    const saticilar = await getSellerTable(db, nicheId);
    expect(saticilar[0]?.shopId).toBe(1);
    expect(saticilar[0]?.listingCount).toBe(2);
  });

  it('satıcı adını ve yorum ortalamasını taşır', async () => {
    const saticilar = await getSellerTable(db, nicheId);
    expect(saticilar[0]?.shopName).toBe('Shop Bir');
    expect(saticilar[0]?.reviewAverage).toBeCloseTo(4.9);
  });

  it('satıcı bazında ortalama hızı hesaplar', async () => {
    const saticilar = await getSellerTable(db, nicheId);
    // Shop 1: L1 (10/gün) ve L2 (1/gün)
    expect(saticilar[0]?.avgVelocity).toBeCloseTo(5.5);
  });

  it('konsantrasyonu hesaplar', async () => {
    const k = await getConcentration(db, nicheId);
    expect(k?.sellerCount).toBe(3);
    // Paylar 2/4, 1/4, 1/4 -> 0.25 + 0.0625 + 0.0625
    expect(k?.hhi).toBeCloseTo(0.375);
  });

  it('az satıcıda top-10 payı tam 1 olur', async () => {
    const k = await getConcentration(db, nicheId);
    expect(k?.top10Share).toBeCloseTo(1);
  });

  it('bilinmeyen niş için null döner', async () => {
    expect(await getConcentration(db, 'yok')).toBeNull();
  });
});

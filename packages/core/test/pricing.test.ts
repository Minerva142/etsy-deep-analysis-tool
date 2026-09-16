import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { getGapMatrix, getPriceDemandCurve } from '../src/analysis/pricing.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('fiyat–talep eğrisi', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('istenen sayıda bant üretir', async () => {
    const bantlar = await getPriceDemandCurve(db, nicheId, 2);
    expect(bantlar).toHaveLength(2);
    expect(bantlar[0]?.supply).toBe(2);
    expect(bantlar[1]?.supply).toBe(2);
  });

  it('bant sınırlarını doğru verir', async () => {
    const bantlar = await getPriceDemandCurve(db, nicheId, 2);
    expect(bantlar[0]?.minPrice).toBeCloseTo(10);
    expect(bantlar[0]?.maxPrice).toBeCloseTo(20);
    expect(bantlar[1]?.minPrice).toBeCloseTo(30);
  });

  it('talebi bandaki favori hızlarının toplamı sayar', async () => {
    const bantlar = await getPriceDemandCurve(db, nicheId, 2);
    // Alt bant: L1 (10/gün) + L2 (1/gün)
    expect(bantlar[0]?.demand).toBeCloseTo(11);
    // Üst bant: L3 (0) + L4 (ölçülemez -> 0)
    expect(bantlar[1]?.demand).toBeCloseTo(0);
  });

  it('listing başına talebi hesaplar', async () => {
    const bantlar = await getPriceDemandCurve(db, nicheId, 2);
    expect(bantlar[0]?.demandPerListing).toBeCloseTo(5.5);
  });

  it('boş niş için boş dizi döner', async () => {
    expect(await getPriceDemandCurve(db, 'yok', 2)).toEqual([]);
  });
});

describe('boşluk matrisi', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('kategori × bant hücreleri üretir', async () => {
    const hucreler = await getGapMatrix(db, nicheId, 2);
    expect(hucreler.length).toBeGreaterThan(0);
    for (const h of hucreler) {
      expect(h.supply).toBeGreaterThan(0);
      expect(Number.isFinite(h.ratio)).toBe(true);
    }
  });

  it('oranı azalan sırada verir', async () => {
    const oranlar = (await getGapMatrix(db, nicheId, 2)).map((h) => h.ratio);
    expect([...oranlar].sort((a, b) => b - a)).toEqual(oranlar);
  });
});

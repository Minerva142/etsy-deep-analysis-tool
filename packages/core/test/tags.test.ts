import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { getTagQuadrant } from '../src/analysis/tags.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('etiket fırsat kadranı', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('gürültü filtresini uygular', async () => {
    // Seed'de hiçbir etiket 5 listing'de geçmiyor.
    expect(await getTagQuadrant(db, nicheId, 5)).toEqual([]);
  });

  it('eşik düşürülünce etiketleri döndürür', async () => {
    const etiketler = await getTagQuadrant(db, nicheId, 1);
    expect(etiketler.map((t) => t.tag).sort()).toEqual(['a', 'b', 'c']);
  });

  it('etiket başına ortalama hızı hesaplar', async () => {
    const etiketler = await getTagQuadrant(db, nicheId, 1);
    // 'a' -> L1 (10/gün) ve L2 (1/gün)
    expect(etiketler.find((t) => t.tag === 'a')?.avgVelocity).toBeCloseTo(5.5);
    // 'b' -> yalnızca L1
    expect(etiketler.find((t) => t.tag === 'b')?.avgVelocity).toBeCloseTo(10);
  });

  it('kullanım sayısını verir', async () => {
    const etiketler = await getTagQuadrant(db, nicheId, 1);
    expect(etiketler.find((t) => t.tag === 'a')?.usageCount).toBe(2);
    expect(etiketler.find((t) => t.tag === 'c')?.usageCount).toBe(2);
  });

  it('her etikete geçerli bir kadran atar', async () => {
    const etiketler = await getTagQuadrant(db, nicheId, 1);
    const gecerli = ['firsat', 'doymus', 'dusuk-getiri', 'nis'];
    for (const t of etiketler) expect(gecerli).toContain(t.quadrant);
  });

  it('hıza göre azalan sıralar', async () => {
    const hizlar = (await getTagQuadrant(db, nicheId, 1)).map((t) => t.avgVelocity);
    expect([...hizlar].sort((a, b) => b - a)).toEqual(hizlar);
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { getTopRisers, getVelocitySeries } from '../src/analysis/demand.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('talep hızı', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('snapshot başına bir zaman serisi noktası üretir', async () => {
    expect(await getVelocitySeries(db, nicheId)).toHaveLength(2);
  });

  it('ilk snapshot’ın ortalama hızı ölçülemez', async () => {
    const seri = await getVelocitySeries(db, nicheId);
    expect(seri[0]?.avgVelocity).toBeNull();
  });

  it('ikinci snapshot’ın ortalama hızını hesaplar', async () => {
    const seri = await getVelocitySeries(db, nicheId);
    expect(seri[1]?.avgVelocity).toBeCloseTo(11 / 3);
  });

  it('en hızlı yükselenleri sıralar', async () => {
    const yukselenler = await getTopRisers(db, nicheId);
    expect(yukselenler.map((r) => r.listingId)).toEqual([1, 2, 3]);
    expect(yukselenler[0]?.velocity).toBeCloseTo(10);
  });

  it('hızı ölçülemeyen listing’i dışarıda bırakır', async () => {
    const yukselenler = await getTopRisers(db, nicheId);
    expect(yukselenler.map((r) => r.listingId)).not.toContain(4);
  });

  it('limit parametresine uyar', async () => {
    expect(await getTopRisers(db, nicheId, 1)).toHaveLength(1);
  });
});

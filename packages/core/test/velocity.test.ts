import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, toDbTimestamp, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { countSnapshots, getLatestSnapshotId } from '../src/analysis/velocity.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('favori hızı view’ı', () => {
  let db: Db;
  let nicheId: string;
  let snapshotB: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId, snapshotB } = await seedTwoSnapshots(db));
  });

  it('10 günde 100 favori artışını günde 10 olarak hesaplar', async () => {
    const rows = await db.query<{ favorite_velocity: number }>(
      `select favorite_velocity from v_listing_velocity
        where listing_id = 1 and snapshot_id = $s`,
      { s: snapshotB },
    );
    expect(Number(rows[0]?.favorite_velocity)).toBeCloseTo(10);
  });

  it('değişmeyen favoriyi sıfır hız sayar', async () => {
    const rows = await db.query<{ favorite_velocity: number }>(
      `select favorite_velocity from v_listing_velocity
        where listing_id = 3 and snapshot_id = $s`,
      { s: snapshotB },
    );
    expect(Number(rows[0]?.favorite_velocity)).toBe(0);
  });

  it('ilk gözlemde hız NULL olur', async () => {
    const rows = await db.query<{ favorite_velocity: number | null }>(
      'select favorite_velocity from v_listing_velocity where listing_id = 4',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.favorite_velocity).toBeNull();
  });

  it('çok yakın ek çekim, eldeki ölçümü körleştirmez', async () => {
    // Hız artık bir önceki SATIRLA değil, en az 1 saat öncesindeki en yakın
    // gözlemle karşılaştırılıyor. Böylece art arda alınan fazladan bir çekim
    // geçerli ölçümü yok etmiyor.
    const yakinAn = new Date('2026-09-11T00:05:00Z');
    await db.runStatement(
      `insert into snapshots (snapshot_id, niche_id, started_at, finished_at, status)
       values ('snap-c', $niche, $t::TIMESTAMP, $t::TIMESTAMP, 'complete')`,
      { niche: nicheId, t: toDbTimestamp(yakinAn) },
    );
    await db.runStatement(
      `insert into listing_observations
         (snapshot_id, listing_id, price_amount, currency_code,
          num_favorers, quantity, state, observed_at)
       values ('snap-c', 1, 10, 'USD', 201, 1, 'active', $t::TIMESTAMP)`,
      { t: toDbTimestamp(yakinAn) },
    );

    const rows = await db.query<{ favorite_velocity: number | null }>(
      `select favorite_velocity from v_listing_velocity
        where listing_id = 1 and snapshot_id = 'snap-c'`,
    );
    // snap-b 5 dakika önce (çerçeve dışı), snap-a 10 gün önce:
    // (201 - 100) / 10.0035 gün ≈ 10.1
    expect(Number(rows[0]?.favorite_velocity)).toBeCloseTo(10.1, 1);
  });

  it('son snapshot’ı bulur', async () => {
    expect(await getLatestSnapshotId(db, nicheId)).toBe(snapshotB);
  });

  it('bilinmeyen niş için null döner', async () => {
    expect(await getLatestSnapshotId(db, 'yok')).toBeNull();
  });

  it('snapshot sayısını verir', async () => {
    expect(await countSnapshots(db, nicheId)).toBe(2);
  });
});

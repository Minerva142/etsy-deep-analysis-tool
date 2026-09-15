import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

describe('veritabanı', () => {
  it('şemayı uygular ve beklenen tabloları oluşturur', async () => {
    const db = await openDb(':memory:');
    await migrate(db);

    const rows = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'main' order by table_name`,
    );
    const names = rows.map((r) => r.table_name);

    expect(names).toEqual([
      'ai_insights',
      'http_cache',
      'listing_observations',
      'listing_tags',
      'listings',
      'niches',
      'rate_limit_state',
      'reviews',
      'shop_observations',
      'shops',
      'snapshots',
      'taxonomy_nodes',
    ]);
    await db.close();
  });

  it('migrate iki kez çalıştırılabilir', async () => {
    const db = await openDb(':memory:');
    await migrate(db);
    await expect(migrate(db)).resolves.toBeUndefined();
    await db.close();
  });

  it('büyük listing_id değerini kayıpsız saklar', async () => {
    const db = await openDb(':memory:');
    await migrate(db);
    await db.runStatement(
      `insert into listings (listing_id, shop_id, title, first_seen_at, last_seen_at)
       values (4123456789, 1, 'test', now(), now())`,
    );
    const rows = await db.query<{ listing_id: string }>(
      'select listing_id from listings',
    );
    expect(rows[0]?.listing_id).toBe('4123456789');
    await db.close();
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache } from '../src/etsy/cache.js';
import { RateLimiter } from '../src/etsy/rate-limiter.js';
import { EtsyClient } from '../src/etsy/client.js';
import type { SellerTaxonomyNode } from '../src/etsy/types.js';
import { flattenTaxonomy, ingestTaxonomy } from '../src/ingest/taxonomy.js';

const tree: SellerTaxonomyNode[] = [
  {
    id: 1,
    level: 1,
    name: 'Home & Living',
    parent_id: null,
    full_path_taxonomy_ids: [1],
    children: [
      {
        id: 66,
        level: 2,
        name: 'Kitchen & Dining',
        parent_id: 1,
        full_path_taxonomy_ids: [1, 66],
        children: [],
      },
    ],
  },
];

describe('flattenTaxonomy', () => {
  it('iç içe ağacı düz listeye çevirir', () => {
    expect(flattenTaxonomy(tree)).toHaveLength(2);
  });

  it('full_path alanını ad zinciri olarak üretir', () => {
    const rows = flattenTaxonomy(tree);
    const child = rows.find((row) => row.taxonomy_id === 66);
    expect(child?.full_path).toBe('Home & Living > Kitchen & Dining');
  });

  it('kök düğümün full_path alanı kendi adıdır', () => {
    const rows = flattenTaxonomy(tree);
    expect(rows.find((row) => row.taxonomy_id === 1)?.full_path).toBe('Home & Living');
  });
});

describe('ingestTaxonomy', () => {
  let db: Db;
  let client: EtsyClient;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    client = new EtsyClient({
      config: loadConfig({ ETSY_MODE: 'fixture' }),
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
      sleep: async () => {},
    });
  });

  it('üç seviyeli ağacı taxonomy_nodes tablosuna yazar', async () => {
    const result = await ingestTaxonomy({ db, client });
    expect(result.nodeCount).toBe(3);

    const rows = await db.query<{ full_path: string }>(
      'select full_path from taxonomy_nodes where taxonomy_id = 1633',
    );
    expect(rows[0]?.full_path).toBe('Home & Living > Kitchen & Dining > Drinkware');
  });

  it('ikinci çalıştırmada satırları çoğaltmaz', async () => {
    await ingestTaxonomy({ db, client });
    await ingestTaxonomy({ db, client });
    const rows = await db.query<{ n: string }>('select count(*) as n from taxonomy_nodes');
    expect(Number(rows[0]?.n)).toBe(3);
  });
});

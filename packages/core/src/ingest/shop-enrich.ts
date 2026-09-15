import { toDbTimestamp, type Db } from '../db/connection.js';
import type { EtsyClient } from '../etsy/client.js';
import { fetchShop } from '../etsy/endpoints/shops.js';

/**
 * Bir nişte yüzlerce satıcı olabilir ve her biri ayrı bir API çağrısı demek.
 * Bu yüzden yalnızca snapshot'ta en çok listing'i olan ilk N satıcı çekilir.
 */
const DEFAULT_MAX_SHOPS = 50;

export async function enrichShops(options: {
  db: Db;
  client: EtsyClient;
  snapshotId: string;
  now?: () => Date;
  maxShops?: number;
}): Promise<{ shopCount: number; apiCalls: number }> {
  const { db, client, snapshotId } = options;
  const now = options.now ?? (() => new Date());
  const maxShops = options.maxShops ?? DEFAULT_MAX_SHOPS;

  const candidates = await db.query<{ shop_id: string }>(
    `select l.shop_id as shop_id, count(*) as listing_count
       from listing_observations o
       join listings l on l.listing_id = o.listing_id
      where o.snapshot_id = $snapshotId and l.shop_id is not null
      group by l.shop_id
      order by listing_count desc, l.shop_id
      limit $maxShops`,
    { snapshotId, maxShops },
  );

  const observedAt = toDbTimestamp(now());
  let apiCalls = 0;

  for (const candidate of candidates) {
    const shopId = Number(candidate.shop_id);
    const shop = await fetchShop(client, shopId);
    apiCalls += 1;

    await db.runStatement(
      `insert into shops (shop_id, shop_name, url, first_seen_at, last_seen_at)
       values ($shopId, $shopName, $url, $seenAt::TIMESTAMP, $seenAt::TIMESTAMP)
       on conflict (shop_id) do update set
         shop_name = excluded.shop_name,
         url = excluded.url,
         last_seen_at = excluded.last_seen_at`,
      {
        shopId,
        shopName: shop.shop_name ?? null,
        url: shop.url ?? null,
        seenAt: observedAt,
      },
    );

    await db.runStatement(
      `insert or replace into shop_observations
         (snapshot_id, shop_id, num_favorers, listing_active_count,
          review_count, review_average, observed_at)
       values ($snapshotId, $shopId, $numFavorers, $listingActiveCount,
               $reviewCount, $reviewAverage, $observedAt::TIMESTAMP)`,
      {
        snapshotId,
        shopId,
        numFavorers: shop.num_favorers ?? null,
        listingActiveCount: shop.listing_active_count ?? null,
        reviewCount: shop.review_count ?? null,
        reviewAverage: shop.review_average ?? null,
        observedAt,
      },
    );
  }

  return { shopCount: candidates.length, apiCalls };
}

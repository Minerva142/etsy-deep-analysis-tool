import type { Db } from '../db/connection.js';

export interface SellerRow {
  shopId: number;
  shopName: string | null;
  listingCount: number;
  totalFavorers: number;
  avgVelocity: number | null;
  reviewAverage: number | null;
}

export interface Concentration {
  sellerCount: number;
  top10Share: number;
  /** Payların kareleri toplamı; 1'e yakın değer tekelleşme demek. */
  hhi: number;
}

const SON_GOZLEM = `
  select v.listing_id, v.num_favorers, v.favorite_velocity, l.shop_id
    from v_listing_velocity v
    join v_latest_snapshot s
      on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
    join listings l on l.listing_id = v.listing_id
   where v.niche_id = $niche and l.shop_id is not null
`;

export async function getSellerTable(
  db: Db,
  nicheId: string,
  limit = 25,
): Promise<SellerRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with g as (${SON_GOZLEM})
     select g.shop_id,
            sh.shop_name,
            count(*)                         as listing_count,
            sum(coalesce(g.num_favorers, 0)) as total_favorers,
            avg(g.favorite_velocity)         as avg_velocity,
            max(so.review_average)           as review_average
       from g
       left join shops sh on sh.shop_id = g.shop_id
       left join shop_observations so
         on so.shop_id = g.shop_id
        and so.snapshot_id = (
              select snapshot_id from v_latest_snapshot where niche_id = $niche
            )
      group by g.shop_id, sh.shop_name
      order by listing_count desc, g.shop_id
      limit $limit`,
    { niche: nicheId, limit },
  );

  return rows.map((row) => ({
    shopId: Number(row.shop_id),
    shopName: row.shop_name === null ? null : String(row.shop_name),
    listingCount: Number(row.listing_count),
    totalFavorers: Number(row.total_favorers),
    avgVelocity: row.avg_velocity === null ? null : Number(row.avg_velocity),
    reviewAverage: row.review_average === null ? null : Number(row.review_average),
  }));
}

export async function getConcentration(
  db: Db,
  nicheId: string,
): Promise<Concentration | null> {
  const rows = await db.query<Record<string, unknown>>(
    `with g as (${SON_GOZLEM}),
     pay as (
       select shop_id,
              count(*) as adet,
              count(*) * 1.0 / sum(count(*)) over () as oran
         from g
        group by shop_id
     ),
     sirali as (
       select oran, row_number() over (order by oran desc) as sira from pay
     )
     select (select count(*) from pay)                                 as seller_count,
            (select coalesce(sum(oran), 0) from sirali where sira <= 10) as top10_share,
            (select coalesce(sum(pow(oran, 2)), 0) from pay)            as hhi`,
    { niche: nicheId },
  );

  const row = rows[0];
  if (row === undefined || Number(row.seller_count) === 0) return null;

  return {
    sellerCount: Number(row.seller_count),
    top10Share: Number(row.top10_share),
    hhi: Number(row.hhi),
  };
}

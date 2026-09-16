import type { Db } from '../db/connection.js';

export interface PriceBand {
  band: number;
  minPrice: number;
  maxPrice: number;
  supply: number;
  demand: number;
  demandPerListing: number;
}

export interface GapCell {
  taxonomyId: number | null;
  taxonomyPath: string | null;
  band: number;
  supply: number;
  demand: number;
  ratio: number;
}

/**
 * Son snapshot'ın gözlemlerini fiyat bandına atar.
 *
 * ntile() bir pencere fonksiyonu olduğu için doğrudan GROUP BY içinde
 * kullanılamıyor (DuckDB: "GROUP BY clause cannot contain window functions").
 * Bant numarası önce burada hesaplanıp gruplama sonra yapılıyor.
 */
const BANTLI_GOZLEM = `
  select
    v.listing_id,
    v.price_amount,
    coalesce(v.favorite_velocity, 0) as hiz,
    l.taxonomy_id,
    ntile($bands) over (order by v.price_amount) as bant
  from v_listing_velocity v
  join v_latest_snapshot s
    on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
  join listings l on l.listing_id = v.listing_id
  where v.niche_id = $niche and v.price_amount is not null
`;

export async function getPriceDemandCurve(
  db: Db,
  nicheId: string,
  bandCount = 10,
): Promise<PriceBand[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with bantli as (${BANTLI_GOZLEM})
     select bant,
            min(price_amount) as min_price,
            max(price_amount) as max_price,
            count(*)          as supply,
            sum(hiz)          as demand
       from bantli
      group by bant
      order by bant`,
    { niche: nicheId, bands: bandCount },
  );

  return rows.map((row) => {
    const supply = Number(row.supply);
    const demand = Number(row.demand);
    return {
      band: Number(row.bant),
      minPrice: Number(row.min_price),
      maxPrice: Number(row.max_price),
      supply,
      demand,
      demandPerListing: supply === 0 ? 0 : demand / supply,
    };
  });
}

/** Talep/arz oranı yüksek hücreler nişe giriş noktası adayıdır. */
export async function getGapMatrix(
  db: Db,
  nicheId: string,
  bandCount = 5,
): Promise<GapCell[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with bantli as (${BANTLI_GOZLEM})
     select b.taxonomy_id,
            t.full_path,
            b.bant,
            count(*)   as supply,
            sum(b.hiz) as demand
       from bantli b
       left join taxonomy_nodes t on t.taxonomy_id = b.taxonomy_id
      group by b.taxonomy_id, t.full_path, b.bant
      order by sum(b.hiz) / count(*) desc, b.bant`,
    { niche: nicheId, bands: bandCount },
  );

  return rows.map((row) => {
    const supply = Number(row.supply);
    const demand = Number(row.demand);
    return {
      taxonomyId: row.taxonomy_id === null ? null : Number(row.taxonomy_id),
      taxonomyPath: row.full_path === null ? null : String(row.full_path),
      band: Number(row.bant),
      supply,
      demand,
      ratio: supply === 0 ? 0 : demand / supply,
    };
  });
}

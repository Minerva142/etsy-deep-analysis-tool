import type { Db } from '../db/connection.js';

export interface VelocityPoint {
  snapshotId: string;
  observedAt: string;
  avgVelocity: number | null;
  listingCount: number;
}

export interface RiserRow {
  listingId: number;
  title: string | null;
  url: string | null;
  price: number | null;
  numFavorers: number;
  velocity: number;
}

export async function getVelocitySeries(
  db: Db,
  nicheId: string,
): Promise<VelocityPoint[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select v.snapshot_id,
            min(v.observed_at)       as observed_at,
            avg(v.favorite_velocity) as avg_velocity,
            count(*)                 as listing_count
       from v_listing_velocity v
      where v.niche_id = $niche
      group by v.snapshot_id
      order by observed_at`,
    { niche: nicheId },
  );

  return rows.map((row) => ({
    snapshotId: String(row.snapshot_id),
    observedAt: String(row.observed_at),
    avgVelocity: row.avg_velocity === null ? null : Number(row.avg_velocity),
    listingCount: Number(row.listing_count),
  }));
}

/** Hızı ölçülemeyen listing'ler (ilk kez görülenler) listeye girmez. */
export async function getTopRisers(
  db: Db,
  nicheId: string,
  limit = 20,
): Promise<RiserRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select v.listing_id, l.title, l.url, v.price_amount, v.num_favorers,
            v.favorite_velocity
       from v_listing_velocity v
       join v_latest_snapshot s
         on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
       join listings l on l.listing_id = v.listing_id
      where v.niche_id = $niche and v.favorite_velocity is not null
      order by v.favorite_velocity desc, v.listing_id
      limit $limit`,
    { niche: nicheId, limit },
  );

  return rows.map((row) => ({
    listingId: Number(row.listing_id),
    title: row.title === null ? null : String(row.title),
    url: row.url === null ? null : String(row.url),
    price: row.price_amount === null ? null : Number(row.price_amount),
    numFavorers: Number(row.num_favorers ?? 0),
    velocity: Number(row.favorite_velocity),
  }));
}

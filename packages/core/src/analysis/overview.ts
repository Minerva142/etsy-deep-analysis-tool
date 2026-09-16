import { BASKIN_KUR, KURDA } from './para-birimi.js';
import type { Db } from '../db/connection.js';

export interface MarketOverview {
  listingCount: number;
  sellerCount: number;
  medianPrice: number | null;
  p25Price: number | null;
  p75Price: number | null;
  avgVelocity: number | null;
  totalFavorers: number;
  /**
   * Fiyat istatistiklerinin ait olduğu para birimi.
   *
   * Etsy listing'leri satıcının kendi para biriminde geliyor; tek bir nişte
   * yirmiden fazla birim bir arada olabiliyor. Bunları toplamak medyanı
   * bozuyordu (ceramic-mug'da karışık medyan 29.00, yalnız USD 21.10).
   * Kur çevirmek uydurma sayı üretmek olurdu; onun yerine fiyat
   * istatistiklerini nişin baskın para birimine kısıtlayıp hangi birim
   * olduğunu ve kaç listing'i kapsadığını söylüyoruz.
   */
  priceCurrency: string | null;
  /** Fiyat istatistiklerine giren listing sayısı (baskın para biriminde). */
  pricedCount: number;
}

export interface Freshness {
  medianAgeDays: number | null;
  newLast30Days: number;
  newLast90Days: number;
}

export interface ReviewStats {
  ratingDistribution: { rating: number; count: number }[];
  lowRated: { listingId: number; rating: number; text: string }[];
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getMarketOverview(
  db: Db,
  nicheId: string,
): Promise<MarketOverview | null> {
  const rows = await db.query<Record<string, unknown>>(
    `with son as (
        select v.price_amount, v.currency_code, v.num_favorers,
               v.favorite_velocity, l.shop_id
          from v_listing_velocity v
          join v_latest_snapshot s
            on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
          join listings l on l.listing_id = v.listing_id
         where v.niche_id = $niche
     ),
     baskin as (${BASKIN_KUR})
     select
        count(*)                          as listing_count,
        count(distinct shop_id)           as seller_count,
        (select kur from baskin)          as price_currency,
        count(*) filter (${KURDA})        as priced_count,
        median(price_amount) filter (${KURDA})              as median_price,
        quantile_cont(price_amount, 0.25) filter (${KURDA}) as p25_price,
        quantile_cont(price_amount, 0.75) filter (${KURDA}) as p75_price,
        avg(favorite_velocity)            as avg_velocity,
        sum(coalesce(num_favorers, 0))    as total_favorers
       from son`,
    { niche: nicheId },
  );

  const row = rows[0];
  if (row === undefined || Number(row.listing_count) === 0) return null;

  return {
    listingCount: Number(row.listing_count),
    sellerCount: Number(row.seller_count),
    medianPrice: toNumberOrNull(row.median_price),
    p25Price: toNumberOrNull(row.p25_price),
    p75Price: toNumberOrNull(row.p75_price),
    avgVelocity: toNumberOrNull(row.avg_velocity),
    totalFavorers: Number(row.total_favorers),
    priceCurrency: row.price_currency === null ? null : String(row.price_currency),
    pricedCount: Number(row.priced_count ?? 0),
  };
}

/**
 * Yaş hesabı `original_creation_timestamp` üzerinden yapılır.
 * `created_timestamp` Etsy'de yenileme tarihidir ve neredeyse her zaman
 * yakın bir tarih gösterir.
 */
export async function getFreshness(
  db: Db,
  nicheId: string,
): Promise<Freshness | null> {
  const rows = await db.query<Record<string, unknown>>(
    `with son as (select * from v_latest_snapshot where niche_id = $niche),
          gozlem as (
            select l.original_creation_timestamp as olusturma, s.started_at as an
              from listing_observations o
              join son s on s.snapshot_id = o.snapshot_id
              join listings l on l.listing_id = o.listing_id
             where l.original_creation_timestamp is not null
          )
     select
       median(date_diff('day', olusturma, an))                       as median_age_days,
       count(*) filter (where date_diff('day', olusturma, an) <= 30) as new_30,
       count(*) filter (where date_diff('day', olusturma, an) <= 90) as new_90,
       count(*)                                                      as toplam
     from gozlem`,
    { niche: nicheId },
  );

  const row = rows[0];
  if (row === undefined || Number(row.toplam) === 0) return null;

  return {
    medianAgeDays: toNumberOrNull(row.median_age_days),
    newLast30Days: Number(row.new_30),
    newLast90Days: Number(row.new_90),
  };
}

export async function getReviewStats(db: Db, nicheId: string): Promise<ReviewStats> {
  const nisListingleri = `
    select distinct o.listing_id
      from listing_observations o
      join snapshots s on s.snapshot_id = o.snapshot_id
     where s.niche_id = $niche`;

  const dagilim = await db.query<{ rating: string; adet: string }>(
    `select r.rating, count(*) as adet
       from reviews r
      where r.rating is not null
        and r.listing_id in (${nisListingleri})
      group by r.rating
      order by r.rating`,
    { niche: nicheId },
  );

  const dusuk = await db.query<{
    listing_id: string;
    rating: string;
    review_text: string;
  }>(
    `select r.listing_id, r.rating, r.review_text
       from reviews r
      where r.rating <= 3
        and r.review_text is not null
        and r.listing_id in (${nisListingleri})
      order by r.rating, r.listing_id`,
    { niche: nicheId },
  );

  return {
    ratingDistribution: dagilim.map((r) => ({
      rating: Number(r.rating),
      count: Number(r.adet),
    })),
    lowRated: dusuk.map((r) => ({
      listingId: Number(r.listing_id),
      rating: Number(r.rating),
      text: r.review_text,
    })),
  };
}

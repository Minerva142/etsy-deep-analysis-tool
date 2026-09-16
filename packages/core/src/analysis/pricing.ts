import type { Db } from '../db/connection.js';

export interface PriceBand {
  /** Bandın para birimi; tüm bantlarda aynıdır. */
  currency: string | null;
  band: number;
  minPrice: number;
  maxPrice: number;
  supply: number;
  demand: number;
  demandPerListing: number;
}

/** Eşit GENİŞLİKLİ fiyat kovası (bantlardan farkı: adet değil aralık sabit). */
export interface PriceBin {
  currency: string | null;
  /** Kovanın alt sınırı (dahil). */
  from: number;
  /** Kovanın üst sınırı (son kova hariç, dışlayıcı). */
  to: number;
  count: number;
}

export interface GapCell {
  currency: string | null;
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
/*
 * Fiyat bantlari YALNIZ baskin para birimindeki listing'lerden kurulur.
 * Karisik birimleri tek bir ntile() siralamasina sokmak, 29 TRY ile 29 USD'yi
 * ayni banda atiyordu; bant sinirlari da medyan da anlamsizlasiyordu.
 */
const BANTLI_GOZLEM = `
  with kaynak as (
    select v.listing_id, v.price_amount, v.currency_code,
           coalesce(v.favorite_velocity, 0) as hiz,
           l.taxonomy_id
      from v_listing_velocity v
      join v_latest_snapshot s
        on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
      join listings l on l.listing_id = v.listing_id
     where v.niche_id = $niche and v.price_amount is not null
  ),
  baskin as (select currency_code as kur from kaynak
              where currency_code is not null
              group by currency_code order by count(*) desc, currency_code limit 1)
  select
    listing_id,
    price_amount,
    currency_code,
    hiz,
    taxonomy_id,
    ntile($bands) over (order by price_amount) as bant
  from kaynak
  where currency_code = (select kur from baskin)
`;

export async function getPriceDemandCurve(
  db: Db,
  nicheId: string,
  bandCount = 10,
): Promise<PriceBand[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with bantli as (${BANTLI_GOZLEM})
     select bant,
            any_value(currency_code) as currency,
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
      currency: row.currency === null ? null : String(row.currency),
      band: Number(row.bant),
      minPrice: Number(row.min_price),
      maxPrice: Number(row.max_price),
      supply,
      demand,
      demandPerListing: supply === 0 ? 0 : demand / supply,
    };
  });
}

/**
 * Fiyatların nerede yoğunlaştığını gösteren histogram.
 *
 * `getPriceDemandCurve` ntile kullanıyor: her bantta EŞİT SAYIDA listing olur,
 * bu yüzden arz tarafını çizmek için elverişsiz — on bant, on eşit çubuk.
 * Histogramda ise aralık sabit, yükseklik değişken; dağılımı gösteren budur.
 *
 * Kova sınırları %2–%98 aralığına göre kuruluyor: tek bir 1.336 dolarlık
 * listing bütün ölçeği düzleştirmesin. Dışarıda kalanlar uçtaki kovalara
 * ekleniyor, kaybolmuyor.
 */
export async function getPriceHistogram(
  db: Db,
  nicheId: string,
  binCount = 14,
): Promise<PriceBin[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with kaynak as (
        select v.price_amount, v.currency_code
          from v_listing_velocity v
          join v_latest_snapshot s
            on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
         where v.niche_id = $niche and v.price_amount is not null
      ),
      baskin as (select currency_code as kur from kaynak
                  where currency_code is not null
                  group by currency_code order by count(*) desc, currency_code limit 1),
      kurda as (select price_amount from kaynak
                 where currency_code = (select kur from baskin)),
      sinir as (
        select quantile_cont(price_amount, 0.02) as alt,
               quantile_cont(price_amount, 0.98) as ust
          from kurda
      ),
      genislik as (
        select alt,
               case when ust - alt <= 0 then 1.0 else (ust - alt) / $bins end as adim
          from sinir
      ),
      kovali as (
        select least(
                 $bins - 1,
                 greatest(0, cast(floor((k.price_amount - g.alt) / g.adim) as integer))
               ) as kova
          from kurda k, genislik g
      )
      select k.kova,
             (select kur from baskin)             as currency,
             (select alt from genislik) + k.kova * (select adim from genislik)       as bas,
             (select alt from genislik) + (k.kova + 1) * (select adim from genislik) as bit,
             count(*) as adet
        from kovali k
       group by k.kova
       order by k.kova`,
    { niche: nicheId, bins: binCount },
  );

  return rows.map((row) => ({
    currency: row.currency === null ? null : String(row.currency),
    from: Number(row.bas),
    to: Number(row.bit),
    count: Number(row.adet),
  }));
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
            any_value(b.currency_code) as currency,
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
      currency: row.currency === null ? null : String(row.currency),
      taxonomyId: row.taxonomy_id === null ? null : Number(row.taxonomy_id),
      taxonomyPath: row.full_path === null ? null : String(row.full_path),
      band: Number(row.bant),
      supply,
      demand,
      ratio: supply === 0 ? 0 : demand / supply,
    };
  });
}

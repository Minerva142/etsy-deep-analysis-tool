/**
 * DuckDB'deki son snapshot'a hızlı bir bakış. Faz 1'in analiz katmanı
 * gelene kadar verinin gerçekten anlamlı olduğunu doğrulamak için.
 *
 *   pnpm inspect
 */
import { loadConfig, loadDotEnvIfPresent, openDb } from '@etsy-analysis/core';

loadDotEnvIfPresent();
const config = loadConfig(process.env);
const db = await openDb(config.duckdbPath);

const overview = await db.query(`
  select
    count(*)                                      as listing,
    count(distinct l.shop_id)                     as satici,
    round(median(o.price_amount), 2)              as medyan_fiyat,
    round(quantile_cont(o.price_amount, 0.25), 2) as p25,
    round(quantile_cont(o.price_amount, 0.75), 2) as p75,
    max(o.num_favorers)                           as en_yuksek_favori
  from listing_observations o
  join listings l on l.listing_id = o.listing_id
`);
console.log('--- pazar görüntüsü ---');
console.table(overview);

const tags = await db.query(`
  select t.tag,
         count(*)                       as listing,
         round(avg(o.num_favorers), 1)  as ort_favori
    from listing_tags t
    join listing_observations o on o.listing_id = t.listing_id
   group by t.tag
  having count(*) >= 5
   order by ort_favori desc
   limit 8
`);
console.log('--- en yüksek ortalama favoriye sahip etiketler (>=5 listing) ---');
console.table(tags);

const ratings = await db.query(`
  select rating, count(*) as adet from reviews group by rating order by rating
`);
console.log('--- yorum puan dağılımı ---');
console.table(ratings);

const taxonomy = await db.query(`
  select full_path from taxonomy_nodes where level = 3 limit 3
`);
console.log('--- örnek kategori yolları ---');
console.table(taxonomy);

await db.close();

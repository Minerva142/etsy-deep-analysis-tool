import type { Db } from '../db/connection.js';

export type TagQuadrant = 'firsat' | 'doymus' | 'dusuk-getiri' | 'nis';

export interface TagRow {
  tag: string;
  usageCount: number;
  avgVelocity: number;
  quadrant: TagQuadrant;
}

/**
 * Her etiketi kullanım sıklığı × getiri düzleminde bir kadrana yerleştirir.
 * Aranan kadran `firsat`: getirisi medyanın üstünde ama az kullanılan
 * etiketler — rekabetin henüz dolmadığı yer.
 */
export async function getTagQuadrant(
  db: Db,
  nicheId: string,
  minListings = 5,
): Promise<TagRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with son_gozlem as (
       select v.listing_id, coalesce(v.favorite_velocity, 0) as hiz
         from v_listing_velocity v
         join v_latest_snapshot s
           on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
        where v.niche_id = $niche
     ),
     etiket as (
       select t.tag,
              count(*)   as kullanim,
              avg(g.hiz) as ort_hiz
         from listing_tags t
         join son_gozlem g on g.listing_id = t.listing_id
        group by t.tag
       having count(*) >= $minListings
     )
     select tag, kullanim, ort_hiz,
            median(kullanim) over () as medyan_kullanim,
            median(ort_hiz)  over () as medyan_hiz
       from etiket
      order by ort_hiz desc, tag`,
    { niche: nicheId, minListings },
  );

  return rows.map((row) => {
    const usageCount = Number(row.kullanim);
    const avgVelocity = Number(row.ort_hiz);
    const medyanKullanim = Number(row.medyan_kullanim);
    const medyanHiz = Number(row.medyan_hiz);

    const hizYuksek = avgVelocity >= medyanHiz;
    const kullanimYuksek = usageCount >= medyanKullanim;

    let quadrant: TagQuadrant;
    if (hizYuksek && !kullanimYuksek) quadrant = 'firsat';
    else if (hizYuksek && kullanimYuksek) quadrant = 'doymus';
    else if (!hizYuksek && kullanimYuksek) quadrant = 'dusuk-getiri';
    else quadrant = 'nis';

    return { tag: String(row.tag), usageCount, avgVelocity, quadrant };
  });
}

import { toDbTimestamp, type Db } from '../../src/db/connection.js';

/**
 * İki snapshot'lık bilinen bir veri seti. Aradaki fark tam 10 gün, böylece
 * favori hızı elle doğrulanabilir:
 *
 *   L1: 100 -> 200 favori =>  10 /gün   fiyat 10  shop 1  tag [a, b]
 *   L2:  50 ->  60 favori =>   1 /gün   fiyat 20  shop 1  tag [a]
 *   L3:  10 ->  10 favori =>   0 /gün   fiyat 30  shop 2  tag [c]
 *   L4:  sadece B'de, 5 favori => NULL  fiyat 40  shop 3  tag [c]
 */
export const SNAPSHOT_A = '2026-09-01T00:00:00Z';
export const SNAPSHOT_B = '2026-09-11T00:00:00Z';

interface SeedListing {
  id: number;
  shop: number;
  price: number;
  orijinal: string;
  tags: string[];
}

const LISTINGS: SeedListing[] = [
  { id: 1, shop: 1, price: 10, orijinal: '2024-01-01T00:00:00Z', tags: ['a', 'b'] },
  { id: 2, shop: 1, price: 20, orijinal: '2025-01-01T00:00:00Z', tags: ['a'] },
  { id: 3, shop: 2, price: 30, orijinal: '2026-06-20T00:00:00Z', tags: ['c'] },
  { id: 4, shop: 3, price: 40, orijinal: '2026-09-05T00:00:00Z', tags: ['c'] },
];

export async function seedTwoSnapshots(
  db: Db,
): Promise<{ nicheId: string; snapshotA: string; snapshotB: string }> {
  const nicheId = 'test-nis';
  const snapshotA = 'snap-a';
  const snapshotB = 'snap-b';

  await db.runStatement(
    `insert into niches (niche_id, name, keywords, created_at, sort_on)
     values ($id, 'Test niş', 'test', $t::TIMESTAMP, 'score')`,
    { id: nicheId, t: toDbTimestamp(new Date(SNAPSHOT_A)) },
  );

  for (const [id, iso] of [
    [snapshotA, SNAPSHOT_A],
    [snapshotB, SNAPSHOT_B],
  ] as const) {
    await db.runStatement(
      `insert into snapshots (snapshot_id, niche_id, started_at, finished_at, status)
       values ($id, $niche, $t::TIMESTAMP, $t::TIMESTAMP, 'complete')`,
      { id, niche: nicheId, t: toDbTimestamp(new Date(iso)) },
    );
  }

  for (const l of LISTINGS) {
    await db.runStatement(
      `insert into listings
         (listing_id, shop_id, title, url, original_creation_timestamp,
          first_seen_at, last_seen_at)
       values ($id, $shop, $title, 'https://example.com', $orijinal::TIMESTAMP,
               $t::TIMESTAMP, $t::TIMESTAMP)`,
      {
        id: l.id,
        shop: l.shop,
        title: `Listing ${String(l.id)}`,
        orijinal: toDbTimestamp(new Date(l.orijinal)),
        t: toDbTimestamp(new Date(l.id === 4 ? SNAPSHOT_B : SNAPSHOT_A)),
      },
    );
    for (const tag of l.tags) {
      await db.runStatement(
        'insert into listing_tags (listing_id, tag) values ($id, $tag)',
        { id: l.id, tag },
      );
    }
  }

  const gozlemler = [
    { snapshot: snapshotA, iso: SNAPSHOT_A, favoriler: [100, 50, 10, null] },
    { snapshot: snapshotB, iso: SNAPSHOT_B, favoriler: [200, 60, 10, 5] },
  ];

  for (const g of gozlemler) {
    for (const [index, favori] of g.favoriler.entries()) {
      const l = LISTINGS[index];
      if (favori === null || l === undefined) continue;
      await db.runStatement(
        `insert into listing_observations
           (snapshot_id, listing_id, price_amount, currency_code,
            num_favorers, quantity, state, observed_at)
         values ($snapshot, $listing, $price, 'USD', $favori, 1, 'active', $t::TIMESTAMP)`,
        {
          snapshot: g.snapshot,
          listing: l.id,
          price: l.price,
          favori,
          t: toDbTimestamp(new Date(g.iso)),
        },
      );
    }
  }

  // Satıcılar: shop 1'in iki listing'i var, shop 2 ve 3'ün birer tane.
  for (const [shopId, ad, puan] of [
    [1, 'Shop Bir', 4.9],
    [2, 'Shop Iki', 4.1],
    [3, 'Shop Uc', 3.5],
  ] as const) {
    await db.runStatement(
      `insert into shops (shop_id, shop_name, url, first_seen_at, last_seen_at)
       values ($id, $ad, 'https://example.com', $t::TIMESTAMP, $t::TIMESTAMP)`,
      { id: shopId, ad, t: toDbTimestamp(new Date(SNAPSHOT_A)) },
    );
    await db.runStatement(
      `insert into shop_observations
         (snapshot_id, shop_id, num_favorers, listing_active_count,
          review_count, review_average, observed_at)
       values ($snapshot, $id, 100, 5, 20, $puan, $t::TIMESTAMP)`,
      {
        snapshot: snapshotB,
        id: shopId,
        puan,
        t: toDbTimestamp(new Date(SNAPSHOT_B)),
      },
    );
  }

  // Yorumlar: iki düşük puanlı, bir yüksek.
  for (const [reviewId, listingId, rating, metin] of [
    ['r1', 1, 2, 'Kulpu kırık geldi'],
    ['r2', 1, 3, 'Rengi fotoğraftaki gibi değil'],
    ['r3', 2, 5, 'Harika'],
  ] as const) {
    await db.runStatement(
      `insert into reviews
         (review_id, listing_id, shop_id, rating, review_text, language, created_timestamp)
       values ($id, $listing, 1, $rating, $metin, 'tr', $t::TIMESTAMP)`,
      {
        id: reviewId,
        listing: listingId,
        rating,
        metin,
        t: toDbTimestamp(new Date(SNAPSHOT_B)),
      },
    );
  }

  return { nicheId, snapshotA, snapshotB };
}

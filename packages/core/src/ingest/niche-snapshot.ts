import { randomUUID } from 'node:crypto';
import { toDbTimestamp, type Db } from '../db/connection.js';
import type { EtsyClient } from '../etsy/client.js';
import { fetchAllActiveListings } from '../etsy/endpoints/listings.js';
import { normalizeListing } from './normalize.js';

export interface Niche {
  nicheId: string;
  name: string;
  keywords: string | null;
  taxonomyId: number | null;
  minPrice: number | null;
  maxPrice: number | null;
}

export async function upsertNiche(
  db: Db,
  niche: Niche,
  now: Date = new Date(),
): Promise<void> {
  await db.runStatement(
    `insert or replace into niches
       (niche_id, name, keywords, taxonomy_id, min_price, max_price, created_at, is_active)
     values ($id, $name, $keywords, $taxonomyId, $minPrice, $maxPrice, $createdAt::TIMESTAMP, true)`,
    {
      id: niche.nicheId,
      name: niche.name,
      keywords: niche.keywords,
      taxonomyId: niche.taxonomyId,
      minPrice: niche.minPrice,
      maxPrice: niche.maxPrice,
      createdAt: toDbTimestamp(now),
    },
  );
}

export interface SnapshotResult {
  snapshotId: string;
  listingCount: number;
  apiCalls: number;
  status: 'complete';
}

export async function runNicheSnapshot(options: {
  db: Db;
  client: EtsyClient;
  niche: Niche;
  now?: () => Date;
  maxPages?: number;
}): Promise<SnapshotResult> {
  const { db, client, niche } = options;
  const now = options.now ?? (() => new Date());
  const snapshotId = randomUUID();

  await db.runStatement(
    `insert into snapshots (snapshot_id, niche_id, started_at, status)
     values ($id, $nicheId, $startedAt::TIMESTAMP, 'running')`,
    {
      id: snapshotId,
      nicheId: niche.nicheId,
      startedAt: toDbTimestamp(now()),
    },
  );

  const { listings, apiCalls } = await fetchAllActiveListings(
    client,
    {
      keywords: niche.keywords ?? undefined,
      taxonomyId: niche.taxonomyId ?? undefined,
      minPrice: niche.minPrice ?? undefined,
      maxPrice: niche.maxPrice ?? undefined,
    },
    { maxPages: options.maxPages },
  );

  const observedAt = toDbTimestamp(now());

  for (const raw of listings) {
    const { listing, observation, tags } = normalizeListing(raw);

    await db.runStatement(
      `insert into listings
         (listing_id, shop_id, title, description, taxonomy_id, url,
          created_timestamp, first_seen_at, last_seen_at)
       values ($listingId, $shopId, $title, $description, $taxonomyId, $url,
               $createdTimestamp::TIMESTAMP, $seenAt::TIMESTAMP, $seenAt::TIMESTAMP)
       on conflict (listing_id) do update set
         shop_id = excluded.shop_id,
         title = excluded.title,
         description = excluded.description,
         taxonomy_id = excluded.taxonomy_id,
         url = excluded.url,
         created_timestamp = excluded.created_timestamp,
         last_seen_at = excluded.last_seen_at`,
      {
        listingId: listing.listing_id,
        shopId: listing.shop_id,
        title: listing.title,
        description: listing.description,
        taxonomyId: listing.taxonomy_id,
        url: listing.url,
        createdTimestamp:
          listing.created_timestamp === null
            ? null
            : toDbTimestamp(listing.created_timestamp),
        seenAt: observedAt,
      },
    );

    await db.runStatement(
      `insert or replace into listing_observations
         (snapshot_id, listing_id, price_amount, currency_code,
          num_favorers, quantity, state, observed_at)
       values ($snapshotId, $listingId, $priceAmount, $currencyCode,
               $numFavorers, $quantity, $state, $observedAt::TIMESTAMP)`,
      {
        snapshotId,
        listingId: observation.listing_id,
        priceAmount: observation.price_amount,
        currencyCode: observation.currency_code,
        numFavorers: observation.num_favorers,
        quantity: observation.quantity,
        state: observation.state,
        observedAt,
      },
    );

    // Etiketler listing başına silinip yeniden yazılır: Etsy'de etiket
    // kaldırıldığında bizde de kalmamalı.
    await db.runStatement('delete from listing_tags where listing_id = $listingId', {
      listingId: listing.listing_id,
    });
    for (const tag of tags) {
      await db.runStatement(
        'insert into listing_tags (listing_id, tag) values ($listingId, $tag)',
        { listingId: listing.listing_id, tag },
      );
    }
  }

  await db.runStatement(
    `update snapshots
        set finished_at = $finishedAt::TIMESTAMP,
            listing_count = $listingCount,
            api_calls = $apiCalls,
            status = 'complete'
      where snapshot_id = $id`,
    {
      id: snapshotId,
      finishedAt: toDbTimestamp(now()),
      listingCount: listings.length,
      apiCalls,
    },
  );

  return { snapshotId, listingCount: listings.length, apiCalls, status: 'complete' };
}

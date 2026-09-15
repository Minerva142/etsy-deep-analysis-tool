import { createHash } from 'node:crypto';
import { toDbTimestamp, type Db } from '../db/connection.js';
import type { EtsyClient } from '../etsy/client.js';
import { fetchListingReviews } from '../etsy/endpoints/reviews.js';
import type { EtsyReview } from '../etsy/types.js';

/** Yorumlar yalnızca en çok favorilenen ilk N listing için çekilir. */
const DEFAULT_MAX_LISTINGS = 50;

function reviewEpochSeconds(review: EtsyReview): number {
  return review.create_timestamp ?? review.created_timestamp ?? 0;
}

/**
 * Etsy'nin ListingReview şemasında birincil anahtar olacak bir alan yok.
 * Deterministik sentetik anahtar: aynı yorum farklı snapshot'larda tekrar
 * çekildiğinde aynı satıra yazılır, çoğalmaz.
 */
export function buildReviewId(listingId: number, review: EtsyReview): string {
  const digest = createHash('sha1')
    .update(review.review ?? '')
    .digest('hex')
    .slice(0, 8);
  return `${String(listingId)}:${String(reviewEpochSeconds(review))}:${digest}`;
}

export async function ingestReviews(options: {
  db: Db;
  client: EtsyClient;
  snapshotId: string;
  maxListings?: number;
}): Promise<{ reviewCount: number; apiCalls: number }> {
  const { db, client, snapshotId } = options;
  const maxListings = options.maxListings ?? DEFAULT_MAX_LISTINGS;

  const targets = await db.query<{ listing_id: string }>(
    `select listing_id
       from listing_observations
      where snapshot_id = $snapshotId
      order by coalesce(num_favorers, 0) desc, listing_id
      limit $maxListings`,
    { snapshotId, maxListings },
  );

  let reviewCount = 0;
  let apiCalls = 0;

  for (const target of targets) {
    const listingId = Number(target.listing_id);
    const reviews = await fetchListingReviews(client, listingId);
    apiCalls += 1;

    for (const review of reviews) {
      const epochSeconds = reviewEpochSeconds(review);
      await db.runStatement(
        `insert or replace into reviews
           (review_id, listing_id, shop_id, rating, review_text, language, created_timestamp)
         values ($reviewId, $listingId, $shopId, $rating, $reviewText, $language,
                 $createdTimestamp::TIMESTAMP)`,
        {
          reviewId: buildReviewId(listingId, review),
          listingId,
          shopId: review.shop_id ?? null,
          rating: review.rating ?? null,
          reviewText: review.review ?? null,
          language: review.language ?? null,
          createdTimestamp:
            epochSeconds === 0 ? null : toDbTimestamp(new Date(epochSeconds * 1000)),
        },
      );
      reviewCount += 1;
    }
  }

  return { reviewCount, apiCalls };
}

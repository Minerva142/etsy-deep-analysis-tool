import { TTL_SECONDS } from '../cache.js';
import type { EtsyClient } from '../client.js';
import { listingReviewsResponseSchema, type EtsyReview } from '../types.js';

export async function fetchListingReviews(
  client: EtsyClient,
  listingId: number,
): Promise<EtsyReview[]> {
  const raw = await client.request({
    path: `/v3/application/listings/${String(listingId)}/reviews`,
    ttlSeconds: TTL_SECONDS.reviews,
  });
  return listingReviewsResponseSchema.parse(raw).results;
}

import { TTL_SECONDS } from '../cache.js';
import type { EtsyClient } from '../client.js';
import {
  activeListingsResponseSchema,
  etsyListingSchema,
  type EtsyListing,
} from '../types.js';

export { etsyListingSchema };
export type { EtsyListing };

/** Etsy `listings/active` için limit üst sınırı 100'dür. */
const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 50;

/**
 * Etsy'nin varsayılanı `created` (newest-first). O örneklem her gün tamamen
 * değiştiği için aynı listing iki ardışık snapshot'ta görünmez ve favori hızı
 * hesaplanamaz. `score` kararlı ve temsili bir örneklem verir.
 */
const DEFAULT_SORT_ON = 'score' as const;

export interface ActiveListingsQuery {
  keywords?: string;
  taxonomyId?: number;
  minPrice?: number;
  maxPrice?: number;
  sortOn?: 'created' | 'price' | 'updated' | 'score';
  sortOrder?: 'up' | 'down';
}

export async function fetchAllActiveListings(
  client: EtsyClient,
  query: ActiveListingsQuery,
  options: { maxPages?: number } = {},
): Promise<{ listings: EtsyListing[]; apiCalls: number }> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const listings: EtsyListing[] = [];
  let apiCalls = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const raw = await client.request({
      path: '/v3/application/listings/active',
      params: {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        keywords: query.keywords,
        taxonomy_id: query.taxonomyId,
        min_price: query.minPrice,
        max_price: query.maxPrice,
        sort_on: query.sortOn ?? DEFAULT_SORT_ON,
        sort_order: query.sortOrder,
      },
      ttlSeconds: TTL_SECONDS.listingSearch,
    });
    apiCalls += 1;

    const response = activeListingsResponseSchema.parse(raw);
    listings.push(...response.results);

    // Dolu olmayan sayfa son sayfadır.
    if (response.results.length < PAGE_SIZE) break;
  }

  return { listings, apiCalls };
}

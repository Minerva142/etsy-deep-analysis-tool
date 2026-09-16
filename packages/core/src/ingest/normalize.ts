import type { EtsyListing } from '../etsy/types.js';

export interface ListingRow {
  listing_id: number;
  shop_id: number | null;
  title: string | null;
  description: string | null;
  taxonomy_id: number | null;
  url: string | null;
  created_timestamp: Date | null;
  /** Etsy'de created_timestamp yenileme tarihi; yaş hesabı bunu kullanır. */
  original_creation_timestamp: Date | null;
}

export interface ObservationRow {
  listing_id: number;
  price_amount: number | null;
  currency_code: string | null;
  num_favorers: number | null;
  quantity: number | null;
  state: string | null;
}

export interface NormalizedListing {
  listing: ListingRow;
  observation: ObservationRow;
  tags: string[];
}

function orNull<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

export function normalizeListing(listing: EtsyListing): NormalizedListing {
  const price = listing.price ?? null;
  const createdSeconds = orNull(listing.created_timestamp);

  return {
    listing: {
      listing_id: listing.listing_id,
      shop_id: orNull(listing.shop_id),
      title: orNull(listing.title),
      description: orNull(listing.description),
      taxonomy_id: orNull(listing.taxonomy_id),
      url: orNull(listing.url),
      created_timestamp: createdSeconds === null ? null : new Date(createdSeconds * 1000),
      original_creation_timestamp:
        listing.original_creation_timestamp == null
          ? null
          : new Date(listing.original_creation_timestamp * 1000),
    },
    observation: {
      listing_id: listing.listing_id,
      // Etsy fiyatı {amount, divisor} olarak döner; gerçek fiyat bölümdür.
      price_amount: price === null ? null : price.amount / price.divisor,
      currency_code: price === null ? null : price.currency_code,
      num_favorers: orNull(listing.num_favorers),
      quantity: orNull(listing.quantity),
      state: orNull(listing.state),
    },
    tags: [...new Set((listing.tags ?? []).map((tag) => tag.toLowerCase()))],
  };
}

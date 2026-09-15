import { z } from 'zod';

export const etsyPriceSchema = z.object({
  amount: z.number(),
  divisor: z.number().positive(),
  currency_code: z.string(),
});

export const etsyListingSchema = z.object({
  listing_id: z.number(),
  shop_id: z.number().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  url: z.string().nullable().optional(),
  num_favorers: z.number().nullable().optional(),
  taxonomy_id: z.number().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  created_timestamp: z.number().nullable().optional(),
  updated_timestamp: z.number().nullable().optional(),
  price: etsyPriceSchema.nullable().optional(),
});

export type EtsyListing = z.infer<typeof etsyListingSchema>;

export const activeListingsResponseSchema = z.object({
  count: z.number(),
  results: z.array(etsyListingSchema),
});

export const etsyShopSchema = z.object({
  shop_id: z.number(),
  shop_name: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  num_favorers: z.number().nullable().optional(),
  listing_active_count: z.number().nullable().optional(),
  review_count: z.number().nullable().optional(),
  review_average: z.number().nullable().optional(),
});

export type EtsyShop = z.infer<typeof etsyShopSchema>;

export const etsyReviewSchema = z.object({
  shop_id: z.number().nullable().optional(),
  listing_id: z.number().nullable().optional(),
  rating: z.number().nullable().optional(),
  review: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  // Etsy'nin ListingReview şeması her iki alanı da döndürüyor ve ikisi de
  // aynı epoch saniye değerini taşıyor. Şemada birincil anahtar olacak bir
  // review_id alanı yok; bkz. ingest/reviews.ts -> buildReviewId.
  create_timestamp: z.number().nullable().optional(),
  created_timestamp: z.number().nullable().optional(),
});

export type EtsyReview = z.infer<typeof etsyReviewSchema>;

export const listingReviewsResponseSchema = z.object({
  count: z.number(),
  results: z.array(etsyReviewSchema),
});

export interface SellerTaxonomyNode {
  id: number;
  level: number;
  name: string;
  parent_id: number | null;
  full_path_taxonomy_ids: number[];
  children: SellerTaxonomyNode[];
}

export const sellerTaxonomyNodeSchema: z.ZodType<SellerTaxonomyNode> = z.lazy(() =>
  z.object({
    id: z.number(),
    level: z.number(),
    name: z.string(),
    parent_id: z.number().nullable(),
    full_path_taxonomy_ids: z.array(z.number()),
    children: z.array(sellerTaxonomyNodeSchema),
  }),
);

export const sellerTaxonomyResponseSchema = z.object({
  count: z.number(),
  results: z.array(sellerTaxonomyNodeSchema),
});

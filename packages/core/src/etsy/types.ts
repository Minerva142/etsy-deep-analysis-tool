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

import { TTL_SECONDS } from '../cache.js';
import type { EtsyClient } from '../client.js';
import { sellerTaxonomyResponseSchema, type SellerTaxonomyNode } from '../types.js';

export async function fetchTaxonomyNodes(
  client: EtsyClient,
): Promise<SellerTaxonomyNode[]> {
  const raw = await client.request({
    path: '/v3/application/seller-taxonomy/nodes',
    ttlSeconds: TTL_SECONDS.taxonomy,
  });
  return sellerTaxonomyResponseSchema.parse(raw).results;
}

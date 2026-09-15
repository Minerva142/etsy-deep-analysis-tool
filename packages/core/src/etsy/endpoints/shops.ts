import { TTL_SECONDS } from '../cache.js';
import type { EtsyClient } from '../client.js';
import { etsyShopSchema, type EtsyShop } from '../types.js';

export async function fetchShop(client: EtsyClient, shopId: number): Promise<EtsyShop> {
  const raw = await client.request({
    path: `/v3/application/shops/${String(shopId)}`,
    ttlSeconds: TTL_SECONDS.listingDetail,
  });
  return etsyShopSchema.parse(raw);
}

export const CORE_VERSION = '0.1.0';

export { loadConfig, loadDotEnvIfPresent, type Config } from './config.js';
export {
  openDb,
  toDbTimestamp,
  fromDbTimestamp,
  type Db,
  type DbParams,
} from './db/connection.js';
export { migrate } from './db/migrate.js';

export { HttpCache, buildCacheKey, TTL_SECONDS } from './etsy/cache.js';
export { RateLimiter, parseRateLimitHeaders } from './etsy/rate-limiter.js';
export { EtsyClient, EtsyApiError } from './etsy/client.js';

export {
  fetchAllActiveListings,
  type ActiveListingsQuery,
} from './etsy/endpoints/listings.js';
export { fetchShop } from './etsy/endpoints/shops.js';
export { fetchListingReviews } from './etsy/endpoints/reviews.js';
export { fetchTaxonomyNodes } from './etsy/endpoints/taxonomy.js';

export { normalizeListing } from './ingest/normalize.js';
export { runNicheSnapshot, upsertNiche, type Niche } from './ingest/niche-snapshot.js';
export { enrichShops } from './ingest/shop-enrich.js';
export { ingestReviews, buildReviewId } from './ingest/reviews.js';
export { ingestTaxonomy, flattenTaxonomy } from './ingest/taxonomy.js';

// --- Analiz katmanı (Faz 1) ---
export { getLatestSnapshotId, countSnapshots } from './analysis/velocity.js';
export {
  getMarketOverview,
  getFreshness,
  getReviewStats,
  type MarketOverview,
  type Freshness,
  type ReviewStats,
} from './analysis/overview.js';
export {
  getVelocitySeries,
  getTopRisers,
  type VelocityPoint,
  type RiserRow,
} from './analysis/demand.js';
export {
  getPriceDemandCurve,
  getPriceHistogram,
  getGapMatrix,
  type PriceBand,
  type PriceBin,
  type GapCell,
} from './analysis/pricing.js';
export { getTagQuadrant, type TagRow, type TagQuadrant } from './analysis/tags.js';
export {
  getSellerTable,
  getConcentration,
  type SellerRow,
  type Concentration,
} from './analysis/sellers.js';

// --- AI katmani (Faz 3) ---
export { anthropicIstemcisi, type AiIstemci, type AiSonuc } from './ai/client.js';
export { insightOku, insightYaz } from './ai/cache.js';
export {
  INSIGHT_TIPLERI,
  nisOzetiSemasi,
  yorumTemalariSemasi,
  firsatAciklamasiSemasi,
  type NisOzeti,
  type YorumTemalari,
  type FirsatAciklamasi,
  type InsightTipi,
} from './ai/semalar.js';
export {
  nisOzetiUret,
  yorumTemalariUret,
  firsatAciklamasiUret,
  cachetenOku,
  type NisOzetiGirdisi,
  type YorumGirdisi,
  type FirsatGirdisi,
} from './ai/insights.js';

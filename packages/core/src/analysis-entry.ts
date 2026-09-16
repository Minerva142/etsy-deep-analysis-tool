/**
 * Yalnızca okuma yapan tüketiciler için giriş noktası.
 *
 * Dashboard'un Etsy HTTP istemcisine, fixture'lara ya da ingest job'larına
 * ihtiyacı yok. Barrel (`@etsy-analysis/core`) hepsini birden getirdiği için
 * bundler onları da paketlemeye çalışıyordu. Bu giriş noktası yüzeyi
 * veritabanı + analiz ile sınırlar.
 *
 *   import { withDb } from '@etsy-analysis/core/analysis';
 */
export { loadConfig, loadDotEnvIfPresent, type Config } from './config.js';
export {
  openDb,
  toDbTimestamp,
  fromDbTimestamp,
  type Db,
  type DbParams,
} from './db/connection.js';

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

// --- AI okuma yuzeyi: panel asla API cagirmaz ---
export { cachetenOku } from './ai/insights.js';
export type { NisOzeti, YorumTemalari, FirsatAciklamasi } from './ai/semalar.js';

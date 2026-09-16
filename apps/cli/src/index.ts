import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  EtsyClient,
  HttpCache,
  RateLimiter,
  countSnapshots,
  enrichShops,
  getConcentration,
  getFreshness,
  getGapMatrix,
  getMarketOverview,
  getPriceDemandCurve,
  getReviewStats,
  getSellerTable,
  getTagQuadrant,
  getTopRisers,
  getVelocitySeries,
  ingestReviews,
  ingestTaxonomy,
  loadConfig,
  loadDotEnvIfPresent,
  migrate,
  openDb,
  runNicheSnapshot,
  upsertNiche,
  type Db,
  type Niche,
} from '@etsy-analysis/core';
import { formatReport } from './report.js';
import { insightsCalistir } from './insights.js';

/** Canlı modda kotayı sınırlamak için üst sınırlar; hepsi opsiyonel. */
export interface SnapshotLimits {
  maxPages: number | null;
  maxShops: number | null;
  maxReviewListings: number | null;
}

export type ParsedArgs =
  | { command: 'snapshot'; niche: Niche; limits: SnapshotLimits }
  | { command: 'report'; nicheId: string }
  | { command: 'insights'; nicheId: string; force: boolean };

function readFlag(argv: string[], name: string): string | null {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return null;
  return argv[index + 1] ?? null;
}

function readNumberFlag(argv: string[], name: string): number | null {
  const raw = readFlag(argv, name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`--${name} sayı olmalı`);
  return value;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const command = argv[0];

  if (command === 'report') {
    const nicheId = readFlag(argv, 'niche');
    if (nicheId === null) throw new Error('--niche gerekli');
    return { command: 'report', nicheId };
  }

  if (command === 'insights') {
    const nicheId = readFlag(argv, 'niche');
    if (nicheId === null) throw new Error('--niche gerekli');
    return { command: 'insights', nicheId, force: argv.includes('--force') };
  }

  if (command !== 'snapshot') {
    throw new Error(
      `Bilinmeyen komut: ${String(command)}. Kullanılabilir: snapshot, report, insights`,
    );
  }

  const nicheId = readFlag(argv, 'niche');
  if (nicheId === null) throw new Error('--niche gerekli');

  const name = readFlag(argv, 'name');
  if (name === null) throw new Error('--name gerekli');

  return {
    command: 'snapshot',
    niche: {
      nicheId,
      name,
      keywords: readFlag(argv, 'keywords'),
      taxonomyId: readNumberFlag(argv, 'taxonomy-id'),
      minPrice: readNumberFlag(argv, 'min-price'),
      maxPrice: readNumberFlag(argv, 'max-price'),
      sortOn: (readFlag(argv, 'sort-on') ?? 'score') as Niche['sortOn'],
    },
    limits: {
      maxPages: readNumberFlag(argv, 'max-pages'),
      maxShops: readNumberFlag(argv, 'max-shops'),
      maxReviewListings: readNumberFlag(argv, 'max-review-listings'),
    },
  };
}

async function runSnapshot(
  db: Db,
  client: EtsyClient,
  niche: Niche,
  limits: SnapshotLimits,
): Promise<void> {
  await upsertNiche(db, niche);

  const result = await runNicheSnapshot({
    db,
    client,
    niche,
    maxPages: limits.maxPages ?? undefined,
  });
  const taxonomy = await ingestTaxonomy({ db, client });
  const shops = await enrichShops({
    db,
    client,
    snapshotId: result.snapshotId,
    maxShops: limits.maxShops ?? undefined,
  });
  const reviews = await ingestReviews({
    db,
    client,
    snapshotId: result.snapshotId,
    maxListings: limits.maxReviewListings ?? undefined,
  });

  const totalApiCalls = result.apiCalls + shops.apiCalls + reviews.apiCalls + 1;

  process.stdout.write(
    `Snapshot tamamlandı: ${result.snapshotId}\n` +
      `  listing: ${String(result.listingCount)}\n` +
      `  satıcı: ${String(shops.shopCount)}\n` +
      `  yorum: ${String(reviews.reviewCount)}\n` +
      `  kategori düğümü: ${String(taxonomy.nodeCount)}\n` +
      `  API çağrısı: ${String(totalApiCalls)}\n`,
  );
}

async function runReport(db: Db, nicheId: string): Promise<void> {
  const nisler = await db.query<{ name: string }>(
    'select name from niches where niche_id = $id',
    { id: nicheId },
  );
  const nis = nisler[0];
  if (nis === undefined) {
    throw new Error(
      `Niş bulunamadı: ${nicheId}. Önce snapshot alın: pnpm snapshot --niche ${nicheId} ...`,
    );
  }

  const [
    snapshotCount,
    overview,
    freshness,
    series,
    risers,
    bands,
    gaps,
    tags,
    sellers,
    concentration,
    reviews,
  ] = await Promise.all([
    countSnapshots(db, nicheId),
    getMarketOverview(db, nicheId),
    getFreshness(db, nicheId),
    getVelocitySeries(db, nicheId),
    getTopRisers(db, nicheId),
    getPriceDemandCurve(db, nicheId),
    getGapMatrix(db, nicheId),
    getTagQuadrant(db, nicheId),
    getSellerTable(db, nicheId),
    getConcentration(db, nicheId),
    getReviewStats(db, nicheId),
  ]);

  process.stdout.write(
    formatReport({
      nicheName: nis.name,
      snapshotCount,
      overview,
      freshness,
      series,
      risers,
      bands,
      gaps,
      tags,
      sellers,
      concentration,
      reviews,
    }),
  );
}

export async function main(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);
  loadDotEnvIfPresent();
  const config = loadConfig(process.env);

  await mkdir(dirname(config.duckdbPath), { recursive: true });
  const db = await openDb(config.duckdbPath);
  await migrate(db);

  if (parsed.command === 'report') {
    await runReport(db, parsed.nicheId);
  } else if (parsed.command === 'insights') {
    await insightsCalistir({
      db,
      config,
      nicheId: parsed.nicheId,
      force: parsed.force,
    });
  } else {
    const client = new EtsyClient({
      config,
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
    });
    await runSnapshot(db, client, parsed.niche, parsed.limits);
    process.stdout.write(`  mod: ${config.etsyMode}\n`);
  }

  await db.close();
}

if (process.argv[1]?.endsWith('index.ts') === true) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

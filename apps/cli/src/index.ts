import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  EtsyClient,
  HttpCache,
  RateLimiter,
  enrichShops,
  ingestReviews,
  ingestTaxonomy,
  loadConfig,
  migrate,
  openDb,
  runNicheSnapshot,
  upsertNiche,
  type Niche,
} from '@etsy-analysis/core';

export interface ParsedArgs {
  command: 'snapshot';
  niche: Niche;
}

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
  if (command !== 'snapshot') {
    throw new Error(`Bilinmeyen komut: ${String(command)}. Kullanılabilir: snapshot`);
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
    },
  };
}

export async function main(argv: string[]): Promise<void> {
  const { niche } = parseArgs(argv);
  const config = loadConfig(process.env);

  await mkdir(dirname(config.duckdbPath), { recursive: true });
  const db = await openDb(config.duckdbPath);
  await migrate(db);

  const client = new EtsyClient({
    config,
    db,
    cache: new HttpCache(db),
    limiter: new RateLimiter(db),
  });

  await upsertNiche(db, niche);

  const result = await runNicheSnapshot({ db, client, niche });
  const taxonomy = await ingestTaxonomy({ db, client });
  const shops = await enrichShops({ db, client, snapshotId: result.snapshotId });
  const reviews = await ingestReviews({ db, client, snapshotId: result.snapshotId });

  const totalApiCalls = result.apiCalls + shops.apiCalls + reviews.apiCalls + 1;

  process.stdout.write(
    `Snapshot tamamlandı: ${result.snapshotId}\n` +
      `  listing: ${String(result.listingCount)}\n` +
      `  satıcı: ${String(shops.shopCount)}\n` +
      `  yorum: ${String(reviews.reviewCount)}\n` +
      `  kategori düğümü: ${String(taxonomy.nodeCount)}\n` +
      `  API çağrısı: ${String(totalApiCalls)}\n` +
      `  mod: ${config.etsyMode}\n`,
  );

  await db.close();
}

if (process.argv[1]?.endsWith('index.ts') === true) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

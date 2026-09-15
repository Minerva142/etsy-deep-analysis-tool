import { toDbTimestamp, type Db } from '../db/connection.js';

export const TTL_SECONDS = {
  taxonomy: 30 * 24 * 3600,
  listingDetail: 24 * 3600,
  listingSearch: 6 * 3600,
  reviews: 24 * 3600,
} as const;

export function buildCacheKey(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const entries = Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${String(value)}`);
  return `${path}?${entries.join('&')}`;
}

export class HttpCache {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(key: string): Promise<unknown | null> {
    const rows = await this.db.query<{ response_json: string }>(
      `select response_json from http_cache
        where cache_key = $key and expires_at > $now::TIMESTAMP`,
      { key, now: toDbTimestamp(this.now()) },
    );
    const row = rows[0];
    return row ? (JSON.parse(row.response_json) as unknown) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const fetchedAt = this.now();
    const expiresAt = new Date(fetchedAt.getTime() + ttlSeconds * 1000);
    await this.db.runStatement(
      `insert or replace into http_cache (cache_key, response_json, fetched_at, expires_at)
       values ($key, $json, $fetchedAt::TIMESTAMP, $expiresAt::TIMESTAMP)`,
      {
        key,
        json: JSON.stringify(value),
        fetchedAt: toDbTimestamp(fetchedAt),
        expiresAt: toDbTimestamp(expiresAt),
      },
    );
  }
}

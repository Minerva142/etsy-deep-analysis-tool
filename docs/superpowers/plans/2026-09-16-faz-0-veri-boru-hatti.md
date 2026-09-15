# Faz 0 — Veri Boru Hattı Implementasyon Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Etsy Open API v3'ten bir niş sorgusunun tüm aktif listing'lerini çekip DuckDB'ye snapshot olarak yazan, uçtan uca test edilmiş bir veri boru hattı.

**Architecture:** `packages/core` içinde katmanlı bir yapı — `EtsyClient` (rate limiter + cache + fixture/live modu) → `endpoints` (sayfalama) → `normalize` (ham JSON → satır) → `ingest` (DuckDB'ye yazma). `apps/cli` bu boru hattını tetikler. Tüm testler fixture modunda çalışır, ağ erişimi gerektirmez.

**Tech Stack:** TypeScript 5.6+ (ESM), Node 20.17+, pnpm workspace, vitest, `@duckdb/node-api`, `zod`, `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-16-etsy-deep-analysis-tool-design.md`

## Global Constraints

- **Node >= 20.17** (bu makinede v20.17.0 kurulu), **pnpm >= 9** (corepack ile etkinlestirilir). Tüm paketler `"type": "module"` (ESM).
- TypeScript `strict: true`. `any` kullanımı yasak; bilinmeyen veri `unknown` + zod ile daraltılır.
- **Hiçbir sır repoya girmez.** Tüm kimlik bilgileri `.env` üzerinden okunur; `.env` gitignore'da.
- **Testler ağ çağrısı yapmaz.** Etsy'ye giden gerçek istek yalnızca `ETSY_MODE=live` ile ve yalnızca manuel doğrulamada.
- Etsy API taban URL'i: `https://openapi.etsy.com`. Public uçlar `x-api-key` header'ı ile çağrılır.
- `listings/active` için `limit` üst sınırı **100**'dür; daha büyük değer gönderilmez.
- Para birimi: Etsy fiyatı `{amount, divisor, currency_code}` olarak döner. Gerçek fiyat `amount / divisor`'dır ve **her zaman** bu şekilde hesaplanır.
- DuckDB'den okunan satırlar `getRowObjectsJson()` ile alınır (BIGINT → string, TIMESTAMP → string). Sayısal dönüşüm her sorgunun kendi mapper'ında açıkça yapılır.
- Commit mesajları Türkçe, `feat:` / `test:` / `chore:` öneki ile.

---

## Dosya Yapısı

| Dosya | Sorumluluk |
|---|---|
| `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts` | Workspace kökü ve araç yapılandırması |
| `packages/core/src/config.ts` | `.env` okuma ve doğrulama |
| `packages/core/src/db/connection.ts` | DuckDB bağlantısı, `query` / `exec` yardımcıları |
| `packages/core/src/db/schema.sql` | Tablo tanımları |
| `packages/core/src/db/migrate.ts` | Şemayı uygulama |
| `packages/core/src/etsy/types.ts` | Etsy yanıtlarının zod şemaları |
| `packages/core/src/etsy/cache.ts` | HTTP yanıt cache'i (TTL) |
| `packages/core/src/etsy/rate-limiter.ts` | Kalıcı QPS/QPD limiter |
| `packages/core/src/etsy/fixtures.ts` | Fixture modunda yanıt okuma |
| `packages/core/src/etsy/client.ts` | İstek yürütme: auth, cache, limiter, retry |
| `packages/core/src/etsy/endpoints/listings.ts` | `listings/active` + sayfalama |
| `packages/core/src/etsy/endpoints/{shops,reviews,taxonomy}.ts` | Diğer uçlar |
| `packages/core/src/ingest/normalize.ts` | Ham Etsy JSON → tablo satırı |
| `packages/core/src/ingest/niche-snapshot.ts` | Snapshot job'ı |
| `apps/cli/src/index.ts` | `snapshot` komutu |

---

## Task 1: Workspace iskeleti

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.env.example`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/smoke.test.ts`

**Interfaces:**
- Consumes: yok (ilk task)
- Produces: `pnpm test` çalışır durumda; `@etsy-analysis/core` paket adı diğer task'ların import kökü

- [ ] **Step 1: Failing test yaz**

`packages/core/test/smoke.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from '../src/index.js';

describe('core paketi', () => {
  it('sürüm sabitini dışa açar', () => {
    expect(CORE_VERSION).toBe('0.1.0');
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/smoke.test.ts`
Expected: FAIL — `pnpm` veya `vitest` yapılandırılmadığı için komut bulunamaz / modül çözülemez.

- [ ] **Step 3: Workspace dosyalarını oluştur**

`package.json`:
```json
{
  "name": "etsy-deep-analysis-tool",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20.17", "pnpm": ">=9" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
```

`packages/core/package.json`:
```json
{
  "name": "@etsy-analysis/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "dependencies": {
    "@duckdb/node-api": "1.5.5-r.5",
    "zod": "^3.23.0"
  }
}
```

`packages/core/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`packages/core/src/index.ts`:
```ts
export const CORE_VERSION = '0.1.0';
```

`.env.example`:
```
ETSY_API_KEY=
ETSY_MODE=fixture
ETSY_OAUTH_ACCESS_TOKEN=
ETSY_OAUTH_REFRESH_TOKEN=
ANTHROPIC_API_KEY=
DUCKDB_PATH=./data/etsy.duckdb
```

- [ ] **Step 4: Bağımlılıkları kur ve testi çalıştır**

Run: `pnpm install && pnpm test`
Expected: PASS — 1 test geçer.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts .env.example packages/core pnpm-lock.yaml
git commit -m "chore: pnpm workspace ve vitest iskeleti"
```

---

## Task 2: Yapılandırma okuma

**Files:**
- Create: `packages/core/src/config.ts`
- Test: `packages/core/test/config.test.ts`

**Interfaces:**
- Consumes: Task 1'in paket yapısı
- Produces: `loadConfig(env: NodeJS.ProcessEnv): Config` ve `type Config = { etsyApiKey: string | null; etsyMode: 'fixture' | 'live'; duckdbPath: string; anthropicApiKey: string | null }`

- [ ] **Step 1: Failing test yaz**

`packages/core/test/config.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('varsayılan olarak fixture modunu seçer', () => {
    const config = loadConfig({});
    expect(config.etsyMode).toBe('fixture');
    expect(config.duckdbPath).toBe('./data/etsy.duckdb');
    expect(config.etsyApiKey).toBeNull();
  });

  it('live modda API key zorunludur', () => {
    expect(() => loadConfig({ ETSY_MODE: 'live' })).toThrow(
      /ETSY_MODE=live için ETSY_API_KEY gerekli/,
    );
  });

  it('live modda API key verilince yapılandırmayı döner', () => {
    const config = loadConfig({ ETSY_MODE: 'live', ETSY_API_KEY: 'abc123' });
    expect(config.etsyMode).toBe('live');
    expect(config.etsyApiKey).toBe('abc123');
  });

  it('geçersiz modu reddeder', () => {
    expect(() => loadConfig({ ETSY_MODE: 'prod' })).toThrow();
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/config.test.ts`
Expected: FAIL — `Cannot find module '../src/config.js'`

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/config.ts`:
```ts
import { z } from 'zod';

const envSchema = z.object({
  ETSY_API_KEY: z.string().min(1).optional(),
  ETSY_MODE: z.enum(['fixture', 'live']).default('fixture'),
  ETSY_OAUTH_ACCESS_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  DUCKDB_PATH: z.string().min(1).default('./data/etsy.duckdb'),
});

export interface Config {
  etsyApiKey: string | null;
  etsyMode: 'fixture' | 'live';
  etsyOauthAccessToken: string | null;
  anthropicApiKey: string | null;
  duckdbPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.parse(env);

  if (parsed.ETSY_MODE === 'live' && !parsed.ETSY_API_KEY) {
    throw new Error('ETSY_MODE=live için ETSY_API_KEY gerekli');
  }

  return {
    etsyApiKey: parsed.ETSY_API_KEY ?? null,
    etsyMode: parsed.ETSY_MODE,
    etsyOauthAccessToken: parsed.ETSY_OAUTH_ACCESS_TOKEN ?? null,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY ?? null,
    duckdbPath: parsed.DUCKDB_PATH,
  };
}
```

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/config.test.ts`
Expected: PASS — 4 test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/config.ts packages/core/test/config.test.ts
git commit -m "feat: env yapılandırma okuma ve doğrulama"
```

---

## Task 3: DuckDB bağlantısı ve şema

**Files:**
- Create: `packages/core/src/db/connection.ts`, `packages/core/src/db/schema.sql`, `packages/core/src/db/migrate.ts`
- Test: `packages/core/test/db.test.ts`

**Interfaces:**
- Consumes: Task 2 `Config`
- Produces:
  - `openDb(path: string): Promise<Db>`
  - `interface Db { query<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown>): Promise<T[]>; exec(sql: string, params?: Record<string, unknown>): Promise<void>; close(): Promise<void> }`
  - `migrate(db: Db): Promise<void>`

- [ ] **Step 1: Failing test yaz**

`packages/core/test/db.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';

describe('veritabanı', () => {
  it('şemayı uygular ve beklenen tabloları oluşturur', async () => {
    const db = await openDb(':memory:');
    await migrate(db);

    const rows = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'main' order by table_name`,
    );
    const names = rows.map((r) => r.table_name);

    expect(names).toEqual([
      'ai_insights',
      'http_cache',
      'listing_observations',
      'listing_tags',
      'listings',
      'niches',
      'rate_limit_state',
      'reviews',
      'shop_observations',
      'shops',
      'snapshots',
      'taxonomy_nodes',
    ]);
    await db.close();
  });

  it('migrate iki kez çalıştırılabilir', async () => {
    const db = await openDb(':memory:');
    await migrate(db);
    await expect(migrate(db)).resolves.toBeUndefined();
    await db.close();
  });

  it('büyük listing_id değerini kayıpsız saklar', async () => {
    const db = await openDb(':memory:');
    await migrate(db);
    await db.exec(
      `insert into listings (listing_id, shop_id, title, first_seen_at, last_seen_at)
       values (4123456789, 1, 'test', now(), now())`,
    );
    const rows = await db.query<{ listing_id: string }>(
      'select listing_id from listings',
    );
    expect(rows[0]?.listing_id).toBe('4123456789');
    await db.close();
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/db.test.ts`
Expected: FAIL — `Cannot find module '../src/db/connection.js'`

- [ ] **Step 3: Şemayı yaz**

`packages/core/src/db/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS niches (
  niche_id    VARCHAR PRIMARY KEY,
  name        VARCHAR NOT NULL,
  keywords    VARCHAR,
  taxonomy_id BIGINT,
  min_price   DOUBLE,
  max_price   DOUBLE,
  created_at  TIMESTAMP NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id   VARCHAR PRIMARY KEY,
  niche_id      VARCHAR NOT NULL,
  started_at    TIMESTAMP NOT NULL,
  finished_at   TIMESTAMP,
  listing_count INTEGER NOT NULL DEFAULT 0,
  api_calls     INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR NOT NULL DEFAULT 'running'
);

CREATE TABLE IF NOT EXISTS listings (
  listing_id        BIGINT PRIMARY KEY,
  shop_id           BIGINT,
  title             VARCHAR,
  description       VARCHAR,
  taxonomy_id       BIGINT,
  url               VARCHAR,
  created_timestamp TIMESTAMP,
  first_seen_at     TIMESTAMP NOT NULL,
  last_seen_at      TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS listing_observations (
  snapshot_id   VARCHAR NOT NULL,
  listing_id    BIGINT NOT NULL,
  price_amount  DOUBLE,
  currency_code VARCHAR,
  num_favorers  INTEGER,
  quantity      INTEGER,
  state         VARCHAR,
  observed_at   TIMESTAMP NOT NULL,
  PRIMARY KEY (snapshot_id, listing_id)
);

CREATE TABLE IF NOT EXISTS listing_tags (
  listing_id BIGINT NOT NULL,
  tag        VARCHAR NOT NULL,
  PRIMARY KEY (listing_id, tag)
);

CREATE TABLE IF NOT EXISTS shops (
  shop_id       BIGINT PRIMARY KEY,
  shop_name     VARCHAR,
  url           VARCHAR,
  first_seen_at TIMESTAMP NOT NULL,
  last_seen_at  TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS shop_observations (
  snapshot_id          VARCHAR NOT NULL,
  shop_id              BIGINT NOT NULL,
  num_favorers         INTEGER,
  listing_active_count INTEGER,
  review_count         INTEGER,
  review_average       DOUBLE,
  observed_at          TIMESTAMP NOT NULL,
  PRIMARY KEY (snapshot_id, shop_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  review_id         VARCHAR PRIMARY KEY,
  listing_id        BIGINT,
  shop_id           BIGINT,
  rating            INTEGER,
  review_text       VARCHAR,
  language          VARCHAR,
  created_timestamp TIMESTAMP
);

CREATE TABLE IF NOT EXISTS taxonomy_nodes (
  taxonomy_id BIGINT PRIMARY KEY,
  name        VARCHAR,
  level       INTEGER,
  parent_id   BIGINT,
  full_path   VARCHAR
);

CREATE TABLE IF NOT EXISTS ai_insights (
  snapshot_id  VARCHAR NOT NULL,
  insight_type VARCHAR NOT NULL,
  payload_json VARCHAR NOT NULL,
  model        VARCHAR,
  created_at   TIMESTAMP NOT NULL,
  PRIMARY KEY (snapshot_id, insight_type)
);

CREATE TABLE IF NOT EXISTS http_cache (
  cache_key     VARCHAR PRIMARY KEY,
  response_json VARCHAR NOT NULL,
  fetched_at    TIMESTAMP NOT NULL,
  expires_at    TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_state (
  window_key            VARCHAR PRIMARY KEY,
  remaining_today       INTEGER,
  remaining_this_second INTEGER,
  updated_at            TIMESTAMP NOT NULL
);
```

- [ ] **Step 4: Bağlantı ve migrate implementasyonunu yaz**

`packages/core/src/db/connection.ts`:
```ts
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

export interface Db {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<T[]>;
  exec(sql: string, params?: Record<string, unknown>): Promise<void>;
  close(): Promise<void>;
}

class DuckDb implements Db {
  constructor(private readonly connection: DuckDBConnection) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    const reader = params
      ? await this.connection.runAndReadAll(sql, params)
      : await this.connection.runAndReadAll(sql);
    return reader.getRowObjectsJson() as T[];
  }

  async exec(sql: string, params?: Record<string, unknown>): Promise<void> {
    if (params) {
      await this.connection.run(sql, params);
    } else {
      await this.connection.run(sql);
    }
  }

  async close(): Promise<void> {
    this.connection.closeSync();
  }
}

export async function openDb(path: string): Promise<Db> {
  const instance = await DuckDBInstance.create(path);
  const connection = await instance.connect();
  return new DuckDb(connection);
}
```

`packages/core/src/db/migrate.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.js';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

export async function migrate(db: Db): Promise<void> {
  const schema = await readFile(schemaPath, 'utf8');
  for (const statement of schema.split(';')) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      await db.exec(trimmed);
    }
  }
}
```

- [ ] **Step 5: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/db.test.ts`
Expected: PASS — 3 test.

Not: `getRowObjectsJson()` BIGINT değerleri string olarak döndürdüğü için üçüncü test `'4123456789'` bekliyor. Test başka bir şekil bildirirse implementasyonu değil testi gerçek davranışa göre düzelt ve bu notu güncelle.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/db packages/core/test/db.test.ts
git commit -m "feat: DuckDB bağlantısı ve şema migration"
```

---

## Task 4: HTTP cache

**Files:**
- Create: `packages/core/src/etsy/cache.ts`
- Test: `packages/core/test/cache.test.ts`

**Interfaces:**
- Consumes: Task 3 `Db`
- Produces:
  - `buildCacheKey(path: string, params: Record<string, string | number | undefined>): string`
  - `class HttpCache { constructor(db: Db, now: () => Date); get(key: string): Promise<unknown | null>; set(key: string, value: unknown, ttlSeconds: number): Promise<void> }`
  - `TTL_SECONDS: Record<'taxonomy' | 'listingDetail' | 'listingSearch' | 'reviews', number>`

- [ ] **Step 1: Failing test yaz**

`packages/core/test/cache.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache, buildCacheKey, TTL_SECONDS } from '../src/etsy/cache.js';

describe('HttpCache', () => {
  let db: Db;
  let clock: Date;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    clock = new Date('2026-09-16T10:00:00Z');
  });

  const cache = () => new HttpCache(db, () => clock);

  it('yazılan değeri geri okur', async () => {
    await cache().set('k1', { count: 3 }, 60);
    expect(await cache().get('k1')).toEqual({ count: 3 });
  });

  it('bilinmeyen anahtar için null döner', async () => {
    expect(await cache().get('yok')).toBeNull();
  });

  it('TTL dolduğunda null döner', async () => {
    await cache().set('k1', { count: 3 }, 60);
    clock = new Date('2026-09-16T10:01:01Z');
    expect(await cache().get('k1')).toBeNull();
  });

  it('aynı anahtara ikinci yazma değeri günceller', async () => {
    await cache().set('k1', { count: 1 }, 60);
    await cache().set('k1', { count: 2 }, 60);
    expect(await cache().get('k1')).toEqual({ count: 2 });
  });

  it('cache anahtarı parametre sırasından bağımsızdır', async () => {
    const a = buildCacheKey('/listings/active', { keywords: 'mug', limit: 100 });
    const b = buildCacheKey('/listings/active', { limit: 100, keywords: 'mug' });
    expect(a).toBe(b);
  });

  it('tanımsız parametreleri anahtara katmaz', async () => {
    const a = buildCacheKey('/listings/active', { keywords: 'mug', offset: undefined });
    const b = buildCacheKey('/listings/active', { keywords: 'mug' });
    expect(a).toBe(b);
  });

  it("spec’teki TTL değerlerini taşır", () => {
    expect(TTL_SECONDS.taxonomy).toBe(30 * 24 * 3600);
    expect(TTL_SECONDS.listingDetail).toBe(24 * 3600);
    expect(TTL_SECONDS.listingSearch).toBe(6 * 3600);
    expect(TTL_SECONDS.reviews).toBe(24 * 3600);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/cache.test.ts`
Expected: FAIL — `Cannot find module '../src/etsy/cache.js'`

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/etsy/cache.ts`:
```ts
import type { Db } from '../db/connection.js';

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
       where cache_key = $key and expires_at > $now`,
      { key, now: this.now() },
    );
    const row = rows[0];
    return row ? (JSON.parse(row.response_json) as unknown) : null;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    const fetchedAt = this.now();
    const expiresAt = new Date(fetchedAt.getTime() + ttlSeconds * 1000);
    await this.db.exec(
      `insert or replace into http_cache (cache_key, response_json, fetched_at, expires_at)
       values ($key, $json, $fetchedAt, $expiresAt)`,
      { key, json: JSON.stringify(value), fetchedAt, expiresAt },
    );
  }
}
```

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/cache.test.ts`
Expected: PASS — 7 test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/etsy/cache.ts packages/core/test/cache.test.ts
git commit -m "feat: TTL tabanlı HTTP yanıt cache'i"
```

---

## Task 5: Rate limiter

**Files:**
- Create: `packages/core/src/etsy/rate-limiter.ts`
- Test: `packages/core/test/rate-limiter.test.ts`

**Interfaces:**
- Consumes: Task 3 `Db`
- Produces:
  - `interface RateLimitHeaders { limitPerSecond: number | null; remainingThisSecond: number | null; limitPerDay: number | null; remainingToday: number | null }`
  - `parseRateLimitHeaders(headers: Headers): RateLimitHeaders`
  - `class RateLimiter { constructor(db: Db, now: () => Date, sleep: (ms: number) => Promise<void>); acquire(): Promise<void>; syncFromHeaders(h: RateLimitHeaders): Promise<void>; isDayExhausted(): Promise<boolean> }`

Gerekçe: limiter kendi sayacına değil sunucunun bildirdiği `x-remaining-*` değerlerine güvenir. `acquire()` saniyelik kota bittiyse bir sonraki saniyeye kadar bekler; günlük kota bittiyse `isDayExhausted()` true döner ve job durur.

Not: Etsy dokümantasyonunda saniyelik kalan sayacın header adı `x-remaining-this-secon` olarak geçiyor (eksik harf Etsy'nin dokümanındaki haliyle). Implementasyon **her iki** yazımı da okur.

- [ ] **Step 1: Failing test yaz**

`packages/core/test/rate-limiter.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { RateLimiter, parseRateLimitHeaders } from '../src/etsy/rate-limiter.js';

describe('parseRateLimitHeaders', () => {
  it("Etsy header’larını okur", () => {
    const headers = new Headers({
      'x-limit-per-second': '150',
      'x-remaining-this-secon': '149',
      'x-limit-per-day': '10000',
      'x-remaining-today': '9998',
    });
    expect(parseRateLimitHeaders(headers)).toEqual({
      limitPerSecond: 150,
      remainingThisSecond: 149,
      limitPerDay: 10000,
      remainingToday: 9998,
    });
  });

  it("tam yazımlı saniye header’ını da kabul eder", () => {
    const headers = new Headers({ 'x-remaining-this-second': '7' });
    expect(parseRateLimitHeaders(headers).remainingThisSecond).toBe(7);
  });

  it("eksik header’lar için null döner", () => {
    expect(parseRateLimitHeaders(new Headers())).toEqual({
      limitPerSecond: null,
      remainingThisSecond: null,
      limitPerDay: null,
      remainingToday: null,
    });
  });
});

describe('RateLimiter', () => {
  let db: Db;
  let clock: Date;
  let slept: number[];

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    clock = new Date('2026-09-16T10:00:00.000Z');
    slept = [];
  });

  const limiter = () =>
    new RateLimiter(
      db,
      () => clock,
      async (ms) => {
        slept.push(ms);
        clock = new Date(clock.getTime() + ms);
      },
    );

  it('kota bilgisi yokken beklemeden geçer', async () => {
    await limiter().acquire();
    expect(slept).toEqual([]);
  });

  it('saniyelik kota bittiğinde sonraki saniyeye kadar bekler', async () => {
    const rl = limiter();
    await rl.syncFromHeaders({
      limitPerSecond: 150,
      remainingThisSecond: 0,
      limitPerDay: 10000,
      remainingToday: 5000,
    });
    await rl.acquire();
    expect(slept).toEqual([1000]);
  });

  it('günlük kota bittiğinde isDayExhausted true döner', async () => {
    const rl = limiter();
    await rl.syncFromHeaders({
      limitPerSecond: 150,
      remainingThisSecond: 100,
      limitPerDay: 10000,
      remainingToday: 0,
    });
    expect(await rl.isDayExhausted()).toBe(true);
  });

  it('durum veritabanında kalıcıdır', async () => {
    await limiter().syncFromHeaders({
      limitPerSecond: 150,
      remainingThisSecond: 10,
      limitPerDay: 10000,
      remainingToday: 42,
    });
    const rows = await db.query<{ remaining_today: number }>(
      'select remaining_today from rate_limit_state',
    );
    expect(Number(rows[0]?.remaining_today)).toBe(42);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/rate-limiter.test.ts`
Expected: FAIL — `Cannot find module '../src/etsy/rate-limiter.js'`

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/etsy/rate-limiter.ts`:
```ts
import type { Db } from '../db/connection.js';

const STATE_KEY = 'etsy';

export interface RateLimitHeaders {
  limitPerSecond: number | null;
  remainingThisSecond: number | null;
  limitPerDay: number | null;
  remainingToday: number | null;
}

function readNumber(headers: Headers, ...names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw !== null && raw.trim() !== '') {
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function parseRateLimitHeaders(headers: Headers): RateLimitHeaders {
  return {
    limitPerSecond: readNumber(headers, 'x-limit-per-second'),
    // Etsy dokümanında header adı 'x-remaining-this-secon' olarak geçiyor.
    remainingThisSecond: readNumber(
      headers,
      'x-remaining-this-secon',
      'x-remaining-this-second',
    ),
    limitPerDay: readNumber(headers, 'x-limit-per-day'),
    remainingToday: readNumber(headers, 'x-remaining-today'),
  };
}

export class RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async readState(): Promise<{
    remainingToday: number | null;
    remainingThisSecond: number | null;
    updatedAt: Date | null;
  }> {
    const rows = await this.db.query<{
      remaining_today: string | null;
      remaining_this_second: string | null;
      updated_at: string;
    }>(
      'select remaining_today, remaining_this_second, updated_at from rate_limit_state where window_key = $key',
      { key: STATE_KEY },
    );
    const row = rows[0];
    if (!row) {
      return { remainingToday: null, remainingThisSecond: null, updatedAt: null };
    }
    return {
      remainingToday: row.remaining_today === null ? null : Number(row.remaining_today),
      remainingThisSecond:
        row.remaining_this_second === null ? null : Number(row.remaining_this_second),
      updatedAt: new Date(`${row.updated_at}Z`),
    };
  }

  async syncFromHeaders(headers: RateLimitHeaders): Promise<void> {
    await this.db.exec(
      `insert or replace into rate_limit_state
         (window_key, remaining_today, remaining_this_second, updated_at)
       values ($key, $today, $second, $updatedAt)`,
      {
        key: STATE_KEY,
        today: headers.remainingToday,
        second: headers.remainingThisSecond,
        updatedAt: this.now(),
      },
    );
  }

  async isDayExhausted(): Promise<boolean> {
    const state = await this.readState();
    return state.remainingToday !== null && state.remainingToday <= 0;
  }

  async acquire(): Promise<void> {
    const state = await this.readState();
    if (state.remainingThisSecond !== null && state.remainingThisSecond <= 0) {
      await this.sleep(1000);
    }
  }
}
```

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/rate-limiter.test.ts`
Expected: PASS — 7 test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/etsy/rate-limiter.ts packages/core/test/rate-limiter.test.ts
git commit -m "feat: kalıcı Etsy rate limiter"
```

---

## Task 6: EtsyClient (fixture ve live mod)

**Files:**
- Create: `packages/core/src/etsy/fixtures.ts`, `packages/core/src/etsy/client.ts`
- Create: `packages/core/fixtures/listings-active-mug-offset0.json` (örnek yanıt)
- Test: `packages/core/test/client.test.ts`

**Interfaces:**
- Consumes: Task 2 `Config`, Task 3 `Db`, Task 4 `HttpCache`/`buildCacheKey`, Task 5 `RateLimiter`/`parseRateLimitHeaders`
- Produces:
  - `interface EtsyRequest { path: string; params?: Record<string, string | number | undefined>; ttlSeconds: number; auth?: 'apiKey' | 'oauth' }`
  - `class EtsyClient { constructor(opts: { config: Config; db: Db; cache: HttpCache; limiter: RateLimiter; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }); request<T>(req: EtsyRequest): Promise<T> }`
  - `class EtsyApiError extends Error { readonly status: number }`
  - `loadFixture(path: string, params: Record<string, string | number | undefined>): Promise<unknown>`

Davranış kuralları:
- `config.etsyMode === 'fixture'` → `loadFixture` ile diskten okur, ağ yok, cache yok, limiter yok.
- `live` → önce cache; miss ise `limiter.acquire()` → `fetch` → `limiter.syncFromHeaders` → cache'e yaz.
- 429 ve 5xx → üstel backoff (1s, 2s, 4s, 8s), en fazla 5 deneme. Diğer 4xx → anında `EtsyApiError`.
- `auth: 'apiKey'` (varsayılan) → `x-api-key`. `auth: 'oauth'` → `Authorization: Bearer` + `x-api-key`.

- [ ] **Step 1: Fixture dosyasını oluştur**

`packages/core/fixtures/listings-active-mug-offset0.json`:
```json
{
  "count": 2,
  "results": [
    {
      "listing_id": 1234567890,
      "shop_id": 11111,
      "title": "Handmade Ceramic Mug",
      "description": "A cozy mug.",
      "state": "active",
      "quantity": 10,
      "url": "https://www.etsy.com/listing/1234567890",
      "num_favorers": 42,
      "taxonomy_id": 1633,
      "tags": ["mug", "ceramic", "handmade"],
      "created_timestamp": 1735689600,
      "updated_timestamp": 1757980800,
      "price": { "amount": 2499, "divisor": 100, "currency_code": "USD" }
    },
    {
      "listing_id": 9876543210,
      "shop_id": 22222,
      "title": "Minimalist Coffee Mug",
      "description": "Clean lines.",
      "state": "active",
      "quantity": 3,
      "url": "https://www.etsy.com/listing/9876543210",
      "num_favorers": 7,
      "taxonomy_id": 1633,
      "tags": ["mug", "minimalist"],
      "created_timestamp": 1751328000,
      "updated_timestamp": 1757980800,
      "price": { "amount": 1800, "divisor": 100, "currency_code": "USD" }
    }
  ]
}
```

- [ ] **Step 2: Failing test yaz**

`packages/core/test/client.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache } from '../src/etsy/cache.js';
import { RateLimiter } from '../src/etsy/rate-limiter.js';
import { EtsyApiError, EtsyClient } from '../src/etsy/client.js';

interface ActiveListingsResponse {
  count: number;
  results: { listing_id: number }[];
}

describe('EtsyClient', () => {
  let db: Db;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
  });

  const build = (
    env: NodeJS.ProcessEnv,
    fetchImpl?: typeof fetch,
  ): EtsyClient => {
    const config = loadConfig(env);
    return new EtsyClient({
      config,
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
      fetchImpl,
      sleep: async () => {},
    });
  };

  it('fixture modunda diskten okur, ağ çağrısı yapmaz', async () => {
    const fetchImpl = vi.fn();
    const client = build({ ETSY_MODE: 'fixture' }, fetchImpl as unknown as typeof fetch);

    const result = await client.request<ActiveListingsResponse>({
      path: '/v3/application/listings/active',
      params: { keywords: 'mug', offset: 0 },
      ttlSeconds: 3600,
    });

    expect(result.count).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("live modda x-api-key header’ı gönderir", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ count: 0, results: [] }), { status: 200 }),
    );
    const client = build(
      { ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc' },
      fetchImpl as unknown as typeof fetch,
    );

    await client.request({ path: '/v3/application/shops', ttlSeconds: 60 });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('x-api-key')).toBe('key-abc');
    expect(headers.get('authorization')).toBeNull();
  });

  it('oauth isteğinde Bearer token ekler', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const client = build(
      { ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc', ETSY_OAUTH_ACCESS_TOKEN: 'tok-1' },
      fetchImpl as unknown as typeof fetch,
    );

    await client.request({ path: '/v3/application/users/me', ttlSeconds: 60, auth: 'oauth' });

    const [, init] = fetchImpl.mock.calls[0] ?? [];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('authorization')).toBe('Bearer tok-1');
    expect(headers.get('x-api-key')).toBe('key-abc');
  });

  it("ikinci özdeş istekte cache’ten okur", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ count: 1, results: [{ listing_id: 1 }] }), { status: 200 }),
    );
    const client = build(
      { ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc' },
      fetchImpl as unknown as typeof fetch,
    );
    const req = { path: '/v3/application/shops', params: { shop_name: 'x' }, ttlSeconds: 600 };

    await client.request(req);
    await client.request(req);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('429 sonrası yeniden dener ve başarıya ulaşır', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = build(
      { ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc' },
      fetchImpl as unknown as typeof fetch,
    );

    const result = await client.request<{ ok: boolean }>({
      path: '/v3/application/shops',
      ttlSeconds: 60,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('404 için yeniden denemeden hata fırlatır', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));
    const client = build(
      { ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc' },
      fetchImpl as unknown as typeof fetch,
    );

    await expect(
      client.request({ path: '/v3/application/shops/0', ttlSeconds: 60 }),
    ).rejects.toBeInstanceOf(EtsyApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rate limit header’larını limiter’a yazar", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'x-remaining-today': '9000', 'x-remaining-this-secon': '5' },
        }),
    );
    const client = build(
      { ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc' },
      fetchImpl as unknown as typeof fetch,
    );

    await client.request({ path: '/v3/application/shops', ttlSeconds: 60 });

    const rows = await db.query<{ remaining_today: string }>(
      'select remaining_today from rate_limit_state',
    );
    expect(Number(rows[0]?.remaining_today)).toBe(9000);
  });
});
```

- [ ] **Step 3: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/client.test.ts`
Expected: FAIL — `Cannot find module '../src/etsy/client.js'`

- [ ] **Step 4: Fixture yükleyiciyi yaz**

`packages/core/src/etsy/fixtures.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixturesDir = fileURLToPath(new URL('../../fixtures/', import.meta.url));

/**
 * Fixture dosya adı, endpoint yolunun son iki parçası ve ayırt edici
 * parametrelerden türetilir:
 *   /v3/application/listings/active + {keywords: 'mug', offset: 0}
 *     -> listings-active-mug-offset0.json
 */
export function fixtureFileName(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const segments = path.split('/').filter(Boolean).slice(-2).join('-');
  const keywords = params.keywords === undefined ? null : String(params.keywords);
  const offset = params.offset === undefined ? null : `offset${String(params.offset)}`;
  const suffix = [keywords, offset].filter((part) => part !== null).join('-');
  return suffix.length > 0 ? `${segments}-${suffix}.json` : `${segments}.json`;
}

export async function loadFixture(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  const fileName = fixtureFileName(path, params);
  try {
    const raw = await readFile(new URL(fileName, fixturesDir), 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Fixture bulunamadı: ${fileName} (${path})`);
  }
}
```

- [ ] **Step 5: Client'ı yaz**

`packages/core/src/etsy/client.ts`:
```ts
import type { Config } from '../config.js';
import type { Db } from '../db/connection.js';
import { HttpCache, buildCacheKey } from './cache.js';
import { RateLimiter, parseRateLimitHeaders } from './rate-limiter.js';
import { loadFixture } from './fixtures.js';

const BASE_URL = 'https://openapi.etsy.com';
const MAX_ATTEMPTS = 5;

export class EtsyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EtsyApiError';
  }
}

export interface EtsyRequest {
  path: string;
  params?: Record<string, string | number | undefined>;
  ttlSeconds: number;
  auth?: 'apiKey' | 'oauth';
}

export interface EtsyClientOptions {
  config: Config;
  db: Db;
  cache: HttpCache;
  limiter: RateLimiter;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class EtsyClient {
  private readonly config: Config;
  private readonly cache: HttpCache;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EtsyClientOptions) {
    this.config = options.config;
    this.cache = options.cache;
    this.limiter = options.limiter;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request<T>(request: EtsyRequest): Promise<T> {
    const params = request.params ?? {};

    if (this.config.etsyMode === 'fixture') {
      return (await loadFixture(request.path, params)) as T;
    }

    const key = buildCacheKey(request.path, params);
    const cached = await this.cache.get(key);
    if (cached !== null) return cached as T;

    const body = await this.fetchWithRetry(request.path, params, request.auth ?? 'apiKey');
    await this.cache.set(key, body, request.ttlSeconds);
    return body as T;
  }

  private buildHeaders(auth: 'apiKey' | 'oauth'): Headers {
    const headers = new Headers({ accept: 'application/json' });
    if (this.config.etsyApiKey) headers.set('x-api-key', this.config.etsyApiKey);
    if (auth === 'oauth') {
      if (!this.config.etsyOauthAccessToken) {
        throw new Error('OAuth isteği için ETSY_OAUTH_ACCESS_TOKEN gerekli');
      }
      headers.set('authorization', `Bearer ${this.config.etsyOauthAccessToken}`);
    }
    return headers;
  }

  private buildUrl(
    path: string,
    params: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(path, BASE_URL);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    return url.toString();
  }

  private async fetchWithRetry(
    path: string,
    params: Record<string, string | number | undefined>,
    auth: 'apiKey' | 'oauth',
  ): Promise<unknown> {
    const url = this.buildUrl(path, params);
    const headers = this.buildHeaders(auth);
    let lastError: EtsyApiError | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await this.limiter.acquire();
      const response = await this.fetchImpl(url, { method: 'GET', headers });
      await this.limiter.syncFromHeaders(parseRateLimitHeaders(response.headers));

      if (response.ok) {
        return (await response.json()) as unknown;
      }

      const retryable = response.status === 429 || response.status >= 500;
      const error = new EtsyApiError(
        `Etsy isteği başarısız (${String(response.status)}): ${path}`,
        response.status,
      );
      if (!retryable) throw error;

      lastError = error;
      await this.sleep(1000 * 2 ** attempt);
    }

    throw lastError ?? new EtsyApiError(`Etsy isteği başarısız: ${path}`, 0);
  }
}
```

- [ ] **Step 6: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/client.test.ts`
Expected: PASS — 7 test.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/etsy/client.ts packages/core/src/etsy/fixtures.ts packages/core/fixtures packages/core/test/client.test.ts
git commit -m "feat: EtsyClient — fixture/live mod, cache, retry, auth"
```

---

## Task 7: Endpoint sarmalayıcıları ve sayfalama

**Files:**
- Create: `packages/core/src/etsy/types.ts`, `packages/core/src/etsy/endpoints/listings.ts`
- Create: `packages/core/fixtures/listings-active-mug-offset100.json`
- Test: `packages/core/test/endpoints.test.ts`

**Interfaces:**
- Consumes: Task 6 `EtsyClient`
- Produces:
  - `const etsyListingSchema` (zod) ve `type EtsyListing = z.infer<typeof etsyListingSchema>`
  - `interface ActiveListingsQuery { keywords?: string; taxonomyId?: number; minPrice?: number; maxPrice?: number; sortOn?: 'created' | 'price' | 'updated' | 'score'; sortOrder?: 'up' | 'down' }`
  - `fetchAllActiveListings(client: EtsyClient, query: ActiveListingsQuery, options?: { maxPages?: number }): Promise<{ listings: EtsyListing[]; apiCalls: number }>`

Sayfalama kuralı: `limit=100` sabit, `offset` 100'er artar. Dönen sayfa 100'den az sonuç içeriyorsa veya `maxPages` (varsayılan 50, yani 5000 listing) aşılırsa durur.

- [ ] **Step 1: İkinci fixture'ı oluştur**

`packages/core/fixtures/listings-active-mug-offset100.json`:
```json
{ "count": 2, "results": [] }
```

- [ ] **Step 2: Failing test yaz**

`packages/core/test/endpoints.test.ts`:
```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache } from '../src/etsy/cache.js';
import { RateLimiter } from '../src/etsy/rate-limiter.js';
import { EtsyClient } from '../src/etsy/client.js';
import { etsyListingSchema, fetchAllActiveListings } from '../src/etsy/endpoints/listings.js';

describe('etsyListingSchema', () => {
  it("geçerli listing’i kabul eder", () => {
    const parsed = etsyListingSchema.parse({
      listing_id: 1,
      shop_id: 2,
      title: 'x',
      state: 'active',
      url: 'https://example.com',
      num_favorers: 5,
      taxonomy_id: 10,
      tags: ['a'],
      created_timestamp: 1735689600,
      price: { amount: 1000, divisor: 100, currency_code: 'USD' },
    });
    expect(parsed.listing_id).toBe(1);
  });

  it('listing_id eksikse reddeder', () => {
    expect(() => etsyListingSchema.parse({ title: 'x' })).toThrow();
  });
});

describe('fetchAllActiveListings', () => {
  let db: Db;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
  });

  const fixtureClient = () =>
    new EtsyClient({
      config: loadConfig({ ETSY_MODE: 'fixture' }),
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
      sleep: async () => {},
    });

  it("fixture’tan listing’leri okur ve sayfalamayı sonlandırır", async () => {
    const result = await fetchAllActiveListings(fixtureClient(), { keywords: 'mug' });
    expect(result.listings).toHaveLength(2);
    expect(result.listings[0]?.listing_id).toBe(1234567890);
    expect(result.apiCalls).toBe(1);
  });

  it("dolu sayfadan sonra bir sonraki offset’i ister", async () => {
    const full = {
      count: 150,
      results: Array.from({ length: 100 }, (_, index) => ({
        listing_id: index + 1,
        shop_id: 1,
        title: 't',
        state: 'active',
        url: 'https://example.com',
        num_favorers: 0,
        taxonomy_id: 1,
        tags: [],
        created_timestamp: 1735689600,
        price: { amount: 100, divisor: 100, currency_code: 'USD' },
      })),
    };
    const requested: number[] = [];
    const client = {
      request: vi.fn(async (req: { params?: Record<string, unknown> }) => {
        const offset = Number(req.params?.offset ?? 0);
        requested.push(offset);
        return offset === 0 ? full : { count: 150, results: [] };
      }),
    } as unknown as EtsyClient;

    const result = await fetchAllActiveListings(client, { keywords: 'mug' });

    expect(requested).toEqual([0, 100]);
    expect(result.listings).toHaveLength(100);
    expect(result.apiCalls).toBe(2);
  });

  it('maxPages sınırına uyar', async () => {
    const page = {
      count: 10000,
      results: Array.from({ length: 100 }, (_, index) => ({
        listing_id: index + 1,
        shop_id: 1,
        title: 't',
        state: 'active',
        url: 'https://example.com',
        num_favorers: 0,
        taxonomy_id: 1,
        tags: [],
        created_timestamp: 1735689600,
        price: { amount: 100, divisor: 100, currency_code: 'USD' },
      })),
    };
    const client = { request: vi.fn(async () => page) } as unknown as EtsyClient;

    const result = await fetchAllActiveListings(client, { keywords: 'mug' }, { maxPages: 3 });

    expect(result.apiCalls).toBe(3);
    expect(result.listings).toHaveLength(300);
  });
});
```

- [ ] **Step 3: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/endpoints.test.ts`
Expected: FAIL — `Cannot find module '../src/etsy/endpoints/listings.js'`

- [ ] **Step 4: Şema ve endpoint'i yaz**

`packages/core/src/etsy/types.ts`:
```ts
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
```

`packages/core/src/etsy/endpoints/listings.ts`:
```ts
import { TTL_SECONDS } from '../cache.js';
import type { EtsyClient } from '../client.js';
import { activeListingsResponseSchema, etsyListingSchema, type EtsyListing } from '../types.js';

export { etsyListingSchema };
export type { EtsyListing };

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 50;

export interface ActiveListingsQuery {
  keywords?: string;
  taxonomyId?: number;
  minPrice?: number;
  maxPrice?: number;
  sortOn?: 'created' | 'price' | 'updated' | 'score';
  sortOrder?: 'up' | 'down';
}

export async function fetchAllActiveListings(
  client: EtsyClient,
  query: ActiveListingsQuery,
  options: { maxPages?: number } = {},
): Promise<{ listings: EtsyListing[]; apiCalls: number }> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const listings: EtsyListing[] = [];
  let apiCalls = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const raw = await client.request({
      path: '/v3/application/listings/active',
      params: {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        keywords: query.keywords,
        taxonomy_id: query.taxonomyId,
        min_price: query.minPrice,
        max_price: query.maxPrice,
        sort_on: query.sortOn,
        sort_order: query.sortOrder,
      },
      ttlSeconds: TTL_SECONDS.listingSearch,
    });
    apiCalls += 1;

    const response = activeListingsResponseSchema.parse(raw);
    listings.push(...response.results);

    if (response.results.length < PAGE_SIZE) break;
  }

  return { listings, apiCalls };
}
```

- [ ] **Step 5: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/endpoints.test.ts`
Expected: PASS — 5 test.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/etsy/types.ts packages/core/src/etsy/endpoints packages/core/fixtures packages/core/test/endpoints.test.ts
git commit -m "feat: listings/active sarmalayıcısı ve sayfalama"
```

---

## Task 8: Normalize

**Files:**
- Create: `packages/core/src/ingest/normalize.ts`
- Test: `packages/core/test/normalize.test.ts`

**Interfaces:**
- Consumes: Task 7 `EtsyListing`
- Produces:
  - `interface ListingRow { listing_id: number; shop_id: number | null; title: string | null; description: string | null; taxonomy_id: number | null; url: string | null; created_timestamp: Date | null }`
  - `interface ObservationRow { listing_id: number; price_amount: number | null; currency_code: string | null; num_favorers: number | null; quantity: number | null; state: string | null }`
  - `normalizeListing(listing: EtsyListing): { listing: ListingRow; observation: ObservationRow; tags: string[] }`

- [ ] **Step 1: Failing test yaz**

`packages/core/test/normalize.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../src/ingest/normalize.js';

const base = {
  listing_id: 1234567890,
  shop_id: 11111,
  title: 'Handmade Ceramic Mug',
  description: 'A cozy mug.',
  state: 'active',
  quantity: 10,
  url: 'https://www.etsy.com/listing/1234567890',
  num_favorers: 42,
  taxonomy_id: 1633,
  tags: ['mug', 'ceramic'],
  created_timestamp: 1735689600,
  price: { amount: 2499, divisor: 100, currency_code: 'USD' },
};

describe('normalizeListing', () => {
  it('fiyatı amount/divisor olarak hesaplar', () => {
    expect(normalizeListing(base).observation.price_amount).toBe(24.99);
  });

  it('divisor 1 olduğunda fiyatı bozmaz', () => {
    const result = normalizeListing({ ...base, price: { amount: 30, divisor: 1, currency_code: 'TRY' } });
    expect(result.observation.price_amount).toBe(30);
    expect(result.observation.currency_code).toBe('TRY');
  });

  it('fiyat yoksa null döner', () => {
    const result = normalizeListing({ ...base, price: null });
    expect(result.observation.price_amount).toBeNull();
    expect(result.observation.currency_code).toBeNull();
  });

  it("created_timestamp’i saniyeden Date’e çevirir", () => {
    const result = normalizeListing(base);
    expect(result.listing.created_timestamp?.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });

  it('etiketleri küçük harfe indirir ve tekilleştirir', () => {
    const result = normalizeListing({ ...base, tags: ['Mug', 'mug', 'CERAMIC'] });
    expect(result.tags).toEqual(['mug', 'ceramic']);
  });

  it('etiket yoksa boş dizi döner', () => {
    expect(normalizeListing({ ...base, tags: null }).tags).toEqual([]);
  });

  it('opsiyonel alanlar eksikken null üretir', () => {
    const result = normalizeListing({ listing_id: 5 });
    expect(result.listing.shop_id).toBeNull();
    expect(result.listing.title).toBeNull();
    expect(result.observation.num_favorers).toBeNull();
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/normalize.test.ts`
Expected: FAIL — `Cannot find module '../src/ingest/normalize.js'`

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/ingest/normalize.ts`:
```ts
import type { EtsyListing } from '../etsy/types.js';

export interface ListingRow {
  listing_id: number;
  shop_id: number | null;
  title: string | null;
  description: string | null;
  taxonomy_id: number | null;
  url: string | null;
  created_timestamp: Date | null;
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
      created_timestamp:
        createdSeconds === null ? null : new Date(createdSeconds * 1000),
    },
    observation: {
      listing_id: listing.listing_id,
      price_amount: price === null ? null : price.amount / price.divisor,
      currency_code: price === null ? null : price.currency_code,
      num_favorers: orNull(listing.num_favorers),
      quantity: orNull(listing.quantity),
      state: orNull(listing.state),
    },
    tags: [...new Set((listing.tags ?? []).map((tag) => tag.toLowerCase()))],
  };
}
```

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/normalize.test.ts`
Expected: PASS — 7 test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingest/normalize.ts packages/core/test/normalize.test.ts
git commit -m "feat: ham Etsy listing'ini tablo satırına normalize etme"
```

---

## Task 9: Snapshot job

**Files:**
- Create: `packages/core/src/ingest/niche-snapshot.ts`
- Test: `packages/core/test/niche-snapshot.test.ts`

**Interfaces:**
- Consumes: Task 3 `Db`, Task 6 `EtsyClient`, Task 7 `fetchAllActiveListings`/`ActiveListingsQuery`, Task 8 `normalizeListing`
- Produces:
  - `interface Niche { nicheId: string; name: string; keywords: string | null; taxonomyId: number | null; minPrice: number | null; maxPrice: number | null }`
  - `upsertNiche(db: Db, niche: Niche, now?: Date): Promise<void>`
  - `runNicheSnapshot(opts: { db: Db; client: EtsyClient; niche: Niche; now?: () => Date; maxPages?: number }): Promise<{ snapshotId: string; listingCount: number; apiCalls: number; status: 'complete' }>`

Davranış:
- `snapshots` satırı `status='running'` ile açılır, iş bitince `status='complete'`, `finished_at`, `listing_count`, `api_calls` yazılır.
- `listings` upsert edilir: yeni listing için `first_seen_at = now`, mevcut listing için `first_seen_at` korunur, `last_seen_at = now`.
- `listing_observations` her snapshot için yeni satır yazar.
- `listing_tags` listing başına silinip yeniden yazılır.

- [ ] **Step 1: Failing test yaz**

`packages/core/test/niche-snapshot.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache } from '../src/etsy/cache.js';
import { RateLimiter } from '../src/etsy/rate-limiter.js';
import { EtsyClient } from '../src/etsy/client.js';
import { runNicheSnapshot, upsertNiche, type Niche } from '../src/ingest/niche-snapshot.js';

const niche: Niche = {
  nicheId: 'mug',
  name: 'Seramik kupa',
  keywords: 'mug',
  taxonomyId: null,
  minPrice: null,
  maxPrice: null,
};

describe('runNicheSnapshot', () => {
  let db: Db;
  let client: EtsyClient;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    client = new EtsyClient({
      config: loadConfig({ ETSY_MODE: 'fixture' }),
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
      sleep: async () => {},
    });
    await upsertNiche(db, niche);
  });

  it("fixture verisini uçtan uca DB’ye yazar", async () => {
    const result = await runNicheSnapshot({ db, client, niche });

    expect(result.listingCount).toBe(2);
    expect(result.status).toBe('complete');

    const listings = await db.query<{ n: string }>('select count(*) as n from listings');
    expect(Number(listings[0]?.n)).toBe(2);

    const observations = await db.query<{ n: string }>(
      'select count(*) as n from listing_observations',
    );
    expect(Number(observations[0]?.n)).toBe(2);

    const tags = await db.query<{ n: string }>('select count(*) as n from listing_tags');
    expect(Number(tags[0]?.n)).toBe(5);
  });

  it('snapshot kaydını complete olarak kapatır', async () => {
    const result = await runNicheSnapshot({ db, client, niche });
    const rows = await db.query<{ status: string; listing_count: string; finished_at: string | null }>(
      'select status, listing_count, finished_at from snapshots where snapshot_id = $id',
      { id: result.snapshotId },
    );
    expect(rows[0]?.status).toBe('complete');
    expect(Number(rows[0]?.listing_count)).toBe(2);
    expect(rows[0]?.finished_at).not.toBeNull();
  });

  it("ikinci snapshot first_seen_at’i korur, last_seen_at’i günceller", async () => {
    let clock = new Date('2026-09-16T10:00:00Z');
    await runNicheSnapshot({ db, client, niche, now: () => clock });

    clock = new Date('2026-09-17T10:00:00Z');
    await runNicheSnapshot({ db, client, niche, now: () => clock });

    const rows = await db.query<{ first_seen_at: string; last_seen_at: string }>(
      'select first_seen_at, last_seen_at from listings where listing_id = 1234567890',
    );
    expect(rows[0]?.first_seen_at).toContain('2026-09-16');
    expect(rows[0]?.last_seen_at).toContain('2026-09-17');
  });

  it('her snapshot için ayrı gözlem satırı yazar', async () => {
    let clock = new Date('2026-09-16T10:00:00Z');
    await runNicheSnapshot({ db, client, niche, now: () => clock });
    clock = new Date('2026-09-17T10:00:00Z');
    await runNicheSnapshot({ db, client, niche, now: () => clock });

    const rows = await db.query<{ n: string }>(
      'select count(*) as n from listing_observations where listing_id = 1234567890',
    );
    expect(Number(rows[0]?.n)).toBe(2);
  });

  it('etiketleri tekrar yazarken çoğaltmaz', async () => {
    await runNicheSnapshot({ db, client, niche });
    await runNicheSnapshot({ db, client, niche });
    const rows = await db.query<{ n: string }>(
      'select count(*) as n from listing_tags where listing_id = 1234567890',
    );
    expect(Number(rows[0]?.n)).toBe(3);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/niche-snapshot.test.ts`
Expected: FAIL — `Cannot find module '../src/ingest/niche-snapshot.js'`

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/ingest/niche-snapshot.ts`:
```ts
import { randomUUID } from 'node:crypto';
import type { Db } from '../db/connection.js';
import type { EtsyClient } from '../etsy/client.js';
import { fetchAllActiveListings } from '../etsy/endpoints/listings.js';
import { normalizeListing } from './normalize.js';

export interface Niche {
  nicheId: string;
  name: string;
  keywords: string | null;
  taxonomyId: number | null;
  minPrice: number | null;
  maxPrice: number | null;
}

export async function upsertNiche(
  db: Db,
  niche: Niche,
  now: Date = new Date(),
): Promise<void> {
  await db.exec(
    `insert or replace into niches
       (niche_id, name, keywords, taxonomy_id, min_price, max_price, created_at, is_active)
     values ($id, $name, $keywords, $taxonomyId, $minPrice, $maxPrice, $createdAt, true)`,
    {
      id: niche.nicheId,
      name: niche.name,
      keywords: niche.keywords,
      taxonomyId: niche.taxonomyId,
      minPrice: niche.minPrice,
      maxPrice: niche.maxPrice,
      createdAt: now,
    },
  );
}

export interface SnapshotResult {
  snapshotId: string;
  listingCount: number;
  apiCalls: number;
  status: 'complete';
}

export async function runNicheSnapshot(options: {
  db: Db;
  client: EtsyClient;
  niche: Niche;
  now?: () => Date;
  maxPages?: number;
}): Promise<SnapshotResult> {
  const { db, client, niche } = options;
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const snapshotId = randomUUID();

  await db.exec(
    `insert into snapshots (snapshot_id, niche_id, started_at, status)
     values ($id, $nicheId, $startedAt, 'running')`,
    { id: snapshotId, nicheId: niche.nicheId, startedAt },
  );

  const { listings, apiCalls } = await fetchAllActiveListings(
    client,
    {
      keywords: niche.keywords ?? undefined,
      taxonomyId: niche.taxonomyId ?? undefined,
      minPrice: niche.minPrice ?? undefined,
      maxPrice: niche.maxPrice ?? undefined,
    },
    { maxPages: options.maxPages },
  );

  const observedAt = now();

  for (const raw of listings) {
    const { listing, observation, tags } = normalizeListing(raw);

    await db.exec(
      `insert into listings
         (listing_id, shop_id, title, description, taxonomy_id, url,
          created_timestamp, first_seen_at, last_seen_at)
       values ($listingId, $shopId, $title, $description, $taxonomyId, $url,
               $createdTimestamp, $seenAt, $seenAt)
       on conflict (listing_id) do update set
         shop_id = excluded.shop_id,
         title = excluded.title,
         description = excluded.description,
         taxonomy_id = excluded.taxonomy_id,
         url = excluded.url,
         created_timestamp = excluded.created_timestamp,
         last_seen_at = excluded.last_seen_at`,
      {
        listingId: listing.listing_id,
        shopId: listing.shop_id,
        title: listing.title,
        description: listing.description,
        taxonomyId: listing.taxonomy_id,
        url: listing.url,
        createdTimestamp: listing.created_timestamp,
        seenAt: observedAt,
      },
    );

    await db.exec(
      `insert or replace into listing_observations
         (snapshot_id, listing_id, price_amount, currency_code,
          num_favorers, quantity, state, observed_at)
       values ($snapshotId, $listingId, $priceAmount, $currencyCode,
               $numFavorers, $quantity, $state, $observedAt)`,
      {
        snapshotId,
        listingId: observation.listing_id,
        priceAmount: observation.price_amount,
        currencyCode: observation.currency_code,
        numFavorers: observation.num_favorers,
        quantity: observation.quantity,
        state: observation.state,
        observedAt,
      },
    );

    await db.exec('delete from listing_tags where listing_id = $listingId', {
      listingId: listing.listing_id,
    });
    for (const tag of tags) {
      await db.exec(
        'insert into listing_tags (listing_id, tag) values ($listingId, $tag)',
        { listingId: listing.listing_id, tag },
      );
    }
  }

  await db.exec(
    `update snapshots
        set finished_at = $finishedAt,
            listing_count = $listingCount,
            api_calls = $apiCalls,
            status = 'complete'
      where snapshot_id = $id`,
    {
      id: snapshotId,
      finishedAt: now(),
      listingCount: listings.length,
      apiCalls,
    },
  );

  return { snapshotId, listingCount: listings.length, apiCalls, status: 'complete' };
}
```

- [ ] **Step 4: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/niche-snapshot.test.ts`
Expected: PASS — 5 test.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/ingest/niche-snapshot.ts packages/core/test/niche-snapshot.test.ts
git commit -m "feat: niş snapshot job'ı — Etsy'den DuckDB'ye uçtan uca"
```

---

## Task 10: CLI

**Files:**
- Create: `apps/cli/package.json`, `apps/cli/tsconfig.json`, `apps/cli/src/index.ts`
- Modify: `packages/core/src/index.ts` (dışa aktarımlar)
- Test: `apps/cli/test/args.test.ts`

**Interfaces:**
- Consumes: Task 2–9'un tamamı
- Produces: `parseArgs(argv: string[]): { command: 'snapshot'; niche: Niche } ` ve çalıştırılabilir `pnpm snapshot --niche mug --keywords mug --name "Seramik kupa"`

- [ ] **Step 1: Failing test yaz**

`apps/cli/test/args.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/index.js';

describe('parseArgs', () => {
  it('zorunlu argümanlarla snapshot komutunu ayrıştırır', () => {
    const parsed = parseArgs(['snapshot', '--niche', 'mug', '--name', 'Seramik kupa', '--keywords', 'mug']);
    expect(parsed.command).toBe('snapshot');
    expect(parsed.niche.nicheId).toBe('mug');
    expect(parsed.niche.name).toBe('Seramik kupa');
    expect(parsed.niche.keywords).toBe('mug');
  });

  it('opsiyonel fiyat aralığını sayıya çevirir', () => {
    const parsed = parseArgs([
      'snapshot', '--niche', 'mug', '--name', 'x', '--min-price', '10', '--max-price', '50',
    ]);
    expect(parsed.niche.minPrice).toBe(10);
    expect(parsed.niche.maxPrice).toBe(50);
  });

  it('verilmeyen opsiyonel alanlar null olur', () => {
    const parsed = parseArgs(['snapshot', '--niche', 'mug', '--name', 'x']);
    expect(parsed.niche.keywords).toBeNull();
    expect(parsed.niche.taxonomyId).toBeNull();
  });

  it('bilinmeyen komutu reddeder', () => {
    expect(() => parseArgs(['analyze'])).toThrow(/Bilinmeyen komut/);
  });

  it('--niche eksikse hata verir', () => {
    expect(() => parseArgs(['snapshot', '--name', 'x'])).toThrow(/--niche gerekli/);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run apps/cli/test/args.test.ts`
Expected: FAIL — `Cannot find module '../src/index.js'`

- [ ] **Step 3: Core dışa aktarımlarını genişlet**

`packages/core/src/index.ts`:
```ts
export const CORE_VERSION = '0.1.0';

export { loadConfig, type Config } from './config.js';
export { openDb, type Db } from './db/connection.js';
export { migrate } from './db/migrate.js';
export { HttpCache, buildCacheKey, TTL_SECONDS } from './etsy/cache.js';
export { RateLimiter, parseRateLimitHeaders } from './etsy/rate-limiter.js';
export { EtsyClient, EtsyApiError } from './etsy/client.js';
export { fetchAllActiveListings, type ActiveListingsQuery } from './etsy/endpoints/listings.js';
export { normalizeListing } from './ingest/normalize.js';
export { runNicheSnapshot, upsertNiche, type Niche } from './ingest/niche-snapshot.js';
```

- [ ] **Step 4: CLI'ı yaz**

`apps/cli/package.json`:
```json
{
  "name": "@etsy-analysis/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "etsy-analysis": "./src/index.ts" },
  "dependencies": { "@etsy-analysis/core": "workspace:*" }
}
```

`apps/cli/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`apps/cli/src/index.ts`:
```ts
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  EtsyClient,
  HttpCache,
  RateLimiter,
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

  process.stdout.write(
    `Snapshot tamamlandı: ${result.snapshotId}\n` +
      `  listing: ${String(result.listingCount)}\n` +
      `  API çağrısı: ${String(result.apiCalls)}\n` +
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
```

- [ ] **Step 5: Kök script'i ekle**

`package.json` içindeki `scripts` bölümüne ekle:
```json
"snapshot": "tsx apps/cli/src/index.ts snapshot"
```

- [ ] **Step 6: Testleri çalıştır**

Run: `pnpm install && pnpm test`
Expected: PASS — tüm test dosyaları (toplam 45+ test) geçer.

- [ ] **Step 7: CLI'ı fixture modunda elle çalıştır**

Run: `pnpm snapshot --niche mug --name "Seramik kupa" --keywords mug`
Expected: `Snapshot tamamlandı: <uuid>` ve `listing: 2`, `mod: fixture`. `data/etsy.duckdb` dosyası oluşur.

- [ ] **Step 8: Commit**

```bash
git add apps/cli packages/core/src/index.ts package.json pnpm-lock.yaml
git commit -m "feat: snapshot CLI komutu"
```

---

## Task 11: Satıcı zenginleştirme

**Files:**
- Modify: `packages/core/src/etsy/types.ts` (şema ekle)
- Create: `packages/core/src/etsy/endpoints/shops.ts`, `packages/core/src/ingest/shop-enrich.ts`
- Create: `packages/core/fixtures/shops-11111.json`, `packages/core/fixtures/shops-22222.json`
- Test: `packages/core/test/shop-enrich.test.ts`

**Interfaces:**
- Consumes: Task 3 `Db`, Task 6 `EtsyClient`, Task 9'un yazdığı `listing_observations` / `listings`
- Produces:
  - `etsyShopSchema` ve `type EtsyShop`
  - `fetchShop(client: EtsyClient, shopId: number): Promise<EtsyShop>`
  - `enrichShops(opts: { db: Db; client: EtsyClient; snapshotId: string; now?: () => Date; maxShops?: number }): Promise<{ shopCount: number; apiCalls: number }>`

**Neden gerekli:** Spec §6.6 satıcı tablosu `shop_name` ve `review_average` istiyor; bu alanlar listing yanıtında yok, yalnızca `GET /v3/application/shops/{shop_id}` (`getShop`) dönüyor.

**API maliyeti sınırı:** Bir nişte yüzlerce satıcı olabilir ve her biri ayrı çağrı demektir. Bu yüzden yalnızca o snapshot'ta **en çok listing'i olan ilk N satıcı** zenginleştirilir (`maxShops`, varsayılan 50).

- [ ] **Step 1: Fixture dosyalarını oluştur**

`packages/core/fixtures/shops-11111.json`:
```json
{
  "shop_id": 11111,
  "shop_name": "CozyCeramics",
  "url": "https://www.etsy.com/shop/CozyCeramics",
  "num_favorers": 1200,
  "listing_active_count": 48,
  "review_count": 310,
  "review_average": 4.8
}
```

`packages/core/fixtures/shops-22222.json`:
```json
{
  "shop_id": 22222,
  "shop_name": "MinimalMugs",
  "url": "https://www.etsy.com/shop/MinimalMugs",
  "num_favorers": 95,
  "listing_active_count": 6,
  "review_count": 12,
  "review_average": 4.2
}
```

- [ ] **Step 2: Failing test yaz**

`packages/core/test/shop-enrich.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache } from '../src/etsy/cache.js';
import { RateLimiter } from '../src/etsy/rate-limiter.js';
import { EtsyClient } from '../src/etsy/client.js';
import { runNicheSnapshot, upsertNiche, type Niche } from '../src/ingest/niche-snapshot.js';
import { enrichShops } from '../src/ingest/shop-enrich.js';

const niche: Niche = {
  nicheId: 'mug',
  name: 'Seramik kupa',
  keywords: 'mug',
  taxonomyId: null,
  minPrice: null,
  maxPrice: null,
};

describe('enrichShops', () => {
  let db: Db;
  let client: EtsyClient;
  let snapshotId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    client = new EtsyClient({
      config: loadConfig({ ETSY_MODE: 'fixture' }),
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
      sleep: async () => {},
    });
    await upsertNiche(db, niche);
    snapshotId = (await runNicheSnapshot({ db, client, niche })).snapshotId;
  });

  it("snapshot'taki satıcıları shops tablosuna yazar", async () => {
    const result = await enrichShops({ db, client, snapshotId });

    expect(result.shopCount).toBe(2);
    expect(result.apiCalls).toBe(2);

    const rows = await db.query<{ shop_id: string; shop_name: string }>(
      'select shop_id, shop_name from shops order by shop_id',
    );
    expect(rows.map((r) => r.shop_name)).toEqual(['CozyCeramics', 'MinimalMugs']);
  });

  it('shop_observations satırını snapshot ile ilişkilendirir', async () => {
    await enrichShops({ db, client, snapshotId });

    const rows = await db.query<{ review_average: number; listing_active_count: string }>(
      'select review_average, listing_active_count from shop_observations where shop_id = 11111',
    );
    expect(Number(rows[0]?.review_average)).toBeCloseTo(4.8);
    expect(Number(rows[0]?.listing_active_count)).toBe(48);
  });

  it('maxShops sınırına uyar', async () => {
    const result = await enrichShops({ db, client, snapshotId, maxShops: 1 });
    expect(result.shopCount).toBe(1);
    expect(result.apiCalls).toBe(1);
  });

  it("ikinci çalıştırmada shops satırını çoğaltmaz, first_seen_at'i korur", async () => {
    let clock = new Date('2026-09-16T10:00:00Z');
    await enrichShops({ db, client, snapshotId, now: () => clock });
    clock = new Date('2026-09-17T10:00:00Z');
    await enrichShops({ db, client, snapshotId, now: () => clock });

    const count = await db.query<{ n: string }>('select count(*) as n from shops');
    expect(Number(count[0]?.n)).toBe(2);

    const rows = await db.query<{ first_seen_at: string; last_seen_at: string }>(
      'select first_seen_at, last_seen_at from shops where shop_id = 11111',
    );
    expect(rows[0]?.first_seen_at).toContain('2026-09-16');
    expect(rows[0]?.last_seen_at).toContain('2026-09-17');
  });
});
```

- [ ] **Step 3: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/shop-enrich.test.ts`
Expected: FAIL — `Cannot find module '../src/ingest/shop-enrich.js'`

- [ ] **Step 4: Şemayı ekle**

`packages/core/src/etsy/types.ts` dosyasının sonuna ekle:
```ts
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
```

- [ ] **Step 5: Endpoint sarmalayıcısını yaz**

`packages/core/src/etsy/endpoints/shops.ts`:
```ts
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
```

- [ ] **Step 6: Zenginleştirme job'ını yaz**

`packages/core/src/ingest/shop-enrich.ts`:
```ts
import type { Db } from '../db/connection.js';
import type { EtsyClient } from '../etsy/client.js';
import { fetchShop } from '../etsy/endpoints/shops.js';

const DEFAULT_MAX_SHOPS = 50;

export async function enrichShops(options: {
  db: Db;
  client: EtsyClient;
  snapshotId: string;
  now?: () => Date;
  maxShops?: number;
}): Promise<{ shopCount: number; apiCalls: number }> {
  const { db, client, snapshotId } = options;
  const now = options.now ?? (() => new Date());
  const maxShops = options.maxShops ?? DEFAULT_MAX_SHOPS;

  const candidates = await db.query<{ shop_id: string }>(
    `select l.shop_id as shop_id, count(*) as listing_count
       from listing_observations o
       join listings l on l.listing_id = o.listing_id
      where o.snapshot_id = $snapshotId and l.shop_id is not null
      group by l.shop_id
      order by listing_count desc, l.shop_id
      limit $maxShops`,
    { snapshotId, maxShops },
  );

  const observedAt = now();
  let apiCalls = 0;

  for (const candidate of candidates) {
    const shopId = Number(candidate.shop_id);
    const shop = await fetchShop(client, shopId);
    apiCalls += 1;

    await db.exec(
      `insert into shops (shop_id, shop_name, url, first_seen_at, last_seen_at)
       values ($shopId, $shopName, $url, $seenAt, $seenAt)
       on conflict (shop_id) do update set
         shop_name = excluded.shop_name,
         url = excluded.url,
         last_seen_at = excluded.last_seen_at`,
      {
        shopId,
        shopName: shop.shop_name ?? null,
        url: shop.url ?? null,
        seenAt: observedAt,
      },
    );

    await db.exec(
      `insert or replace into shop_observations
         (snapshot_id, shop_id, num_favorers, listing_active_count,
          review_count, review_average, observed_at)
       values ($snapshotId, $shopId, $numFavorers, $listingActiveCount,
               $reviewCount, $reviewAverage, $observedAt)`,
      {
        snapshotId,
        shopId,
        numFavorers: shop.num_favorers ?? null,
        listingActiveCount: shop.listing_active_count ?? null,
        reviewCount: shop.review_count ?? null,
        reviewAverage: shop.review_average ?? null,
        observedAt,
      },
    );
  }

  return { shopCount: candidates.length, apiCalls };
}
```

- [ ] **Step 7: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/shop-enrich.test.ts`
Expected: PASS — 4 test.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/etsy/types.ts packages/core/src/etsy/endpoints/shops.ts packages/core/src/ingest/shop-enrich.ts packages/core/fixtures packages/core/test/shop-enrich.test.ts
git commit -m "feat: satıcı zenginleştirme — getShop ile shops ve shop_observations"
```

---

## Task 12: Yorum ingest

**Files:**
- Modify: `packages/core/src/etsy/types.ts` (şema ekle)
- Create: `packages/core/src/etsy/endpoints/reviews.ts`, `packages/core/src/ingest/reviews.ts`
- Create: `packages/core/fixtures/1234567890-reviews.json`, `packages/core/fixtures/9876543210-reviews.json`
- Test: `packages/core/test/reviews.test.ts`

**Interfaces:**
- Consumes: Task 3 `Db`, Task 6 `EtsyClient`, Task 9'un yazdığı gözlemler
- Produces:
  - `etsyReviewSchema`, `type EtsyReview`, `listingReviewsResponseSchema`
  - `fetchListingReviews(client: EtsyClient, listingId: number): Promise<EtsyReview[]>`
  - `buildReviewId(listingId: number, review: EtsyReview): string`
  - `ingestReviews(opts: { db: Db; client: EtsyClient; snapshotId: string; maxListings?: number }): Promise<{ reviewCount: number; apiCalls: number }>`

**Doğrulanmış API gerçeği:** Etsy'nin `ListingReview` şemasında **birincil anahtar olacak bir `review_id` alanı yok.** Ayrıca hem `create_timestamp` hem `created_timestamp` alanları var ve ikisi de aynı epoch saniye değerini taşıyor. Bu yüzden `reviews.review_id` sentetik olarak üretilir:

```
review_id = "<listing_id>:<epoch_seconds>:<review metninin sha1'inin ilk 8 hanesi>"
```

Bu anahtar deterministiktir; aynı yorum farklı snapshot'larda tekrar çekildiğinde aynı satıra yazılır, çoğalmaz.

**API maliyeti sınırı:** Yorumlar yalnızca o snapshot'ta **en çok favorilenen ilk N listing** için çekilir (`maxListings`, varsayılan 50).

- [ ] **Step 1: Fixture dosyalarını oluştur**

`packages/core/fixtures/1234567890-reviews.json`:
```json
{
  "count": 2,
  "results": [
    {
      "shop_id": 11111,
      "listing_id": 1234567890,
      "rating": 5,
      "review": "Beautiful mug, exactly as pictured.",
      "language": "en-US",
      "create_timestamp": 1756684800,
      "created_timestamp": 1756684800
    },
    {
      "shop_id": 11111,
      "listing_id": 1234567890,
      "rating": 2,
      "review": "Arrived chipped and the handle feels fragile.",
      "language": "en-US",
      "create_timestamp": 1756771200,
      "created_timestamp": 1756771200
    }
  ]
}
```

`packages/core/fixtures/9876543210-reviews.json`:
```json
{ "count": 0, "results": [] }
```

- [ ] **Step 2: Failing test yaz**

`packages/core/test/reviews.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache } from '../src/etsy/cache.js';
import { RateLimiter } from '../src/etsy/rate-limiter.js';
import { EtsyClient } from '../src/etsy/client.js';
import { runNicheSnapshot, upsertNiche, type Niche } from '../src/ingest/niche-snapshot.js';
import { buildReviewId, ingestReviews } from '../src/ingest/reviews.js';

const niche: Niche = {
  nicheId: 'mug',
  name: 'Seramik kupa',
  keywords: 'mug',
  taxonomyId: null,
  minPrice: null,
  maxPrice: null,
};

describe('buildReviewId', () => {
  it('aynı yorum için aynı anahtarı üretir', () => {
    const review = { rating: 5, review: 'nice', create_timestamp: 1756684800 };
    expect(buildReviewId(1, review)).toBe(buildReviewId(1, review));
  });

  it('farklı metin için farklı anahtar üretir', () => {
    const a = buildReviewId(1, { rating: 5, review: 'nice', create_timestamp: 1756684800 });
    const b = buildReviewId(1, { rating: 5, review: 'bad', create_timestamp: 1756684800 });
    expect(a).not.toBe(b);
  });

  it('listing_id ile başlar', () => {
    const id = buildReviewId(42, { rating: 5, review: 'x', create_timestamp: 1756684800 });
    expect(id.startsWith('42:')).toBe(true);
  });
});

describe('ingestReviews', () => {
  let db: Db;
  let client: EtsyClient;
  let snapshotId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    client = new EtsyClient({
      config: loadConfig({ ETSY_MODE: 'fixture' }),
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
      sleep: async () => {},
    });
    await upsertNiche(db, niche);
    snapshotId = (await runNicheSnapshot({ db, client, niche })).snapshotId;
  });

  it('yorumları reviews tablosuna yazar', async () => {
    const result = await ingestReviews({ db, client, snapshotId });

    expect(result.reviewCount).toBe(2);
    expect(result.apiCalls).toBe(2);

    const rows = await db.query<{ rating: string }>(
      'select rating from reviews order by rating',
    );
    expect(rows.map((r) => Number(r.rating))).toEqual([2, 5]);
  });

  it('en çok favorilenen listing ile başlar', async () => {
    const result = await ingestReviews({ db, client, snapshotId, maxListings: 1 });
    expect(result.apiCalls).toBe(1);
    expect(result.reviewCount).toBe(2);
  });

  it('ikinci çalıştırmada yorumları çoğaltmaz', async () => {
    await ingestReviews({ db, client, snapshotId });
    await ingestReviews({ db, client, snapshotId });

    const rows = await db.query<{ n: string }>('select count(*) as n from reviews');
    expect(Number(rows[0]?.n)).toBe(2);
  });

  it('yorum metnini ve puanı birlikte saklar', async () => {
    await ingestReviews({ db, client, snapshotId });
    const rows = await db.query<{ review_text: string }>(
      'select review_text from reviews where rating = 2',
    );
    expect(rows[0]?.review_text).toContain('chipped');
  });
});
```

- [ ] **Step 3: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/reviews.test.ts`
Expected: FAIL — `Cannot find module '../src/ingest/reviews.js'`

- [ ] **Step 4: Şemayı ekle**

`packages/core/src/etsy/types.ts` dosyasının sonuna ekle:
```ts
export const etsyReviewSchema = z.object({
  shop_id: z.number().nullable().optional(),
  listing_id: z.number().nullable().optional(),
  rating: z.number().nullable().optional(),
  review: z.string().nullable().optional(),
  language: z.string().nullable().optional(),
  // Etsy her iki alanı da döndürüyor ve ikisi de aynı epoch saniye değerini taşıyor.
  create_timestamp: z.number().nullable().optional(),
  created_timestamp: z.number().nullable().optional(),
});

export type EtsyReview = z.infer<typeof etsyReviewSchema>;

export const listingReviewsResponseSchema = z.object({
  count: z.number(),
  results: z.array(etsyReviewSchema),
});
```

- [ ] **Step 5: Endpoint sarmalayıcısını yaz**

`packages/core/src/etsy/endpoints/reviews.ts`:
```ts
import { TTL_SECONDS } from '../cache.js';
import type { EtsyClient } from '../client.js';
import { listingReviewsResponseSchema, type EtsyReview } from '../types.js';

export async function fetchListingReviews(
  client: EtsyClient,
  listingId: number,
): Promise<EtsyReview[]> {
  const raw = await client.request({
    path: `/v3/application/listings/${String(listingId)}/reviews`,
    ttlSeconds: TTL_SECONDS.reviews,
  });
  return listingReviewsResponseSchema.parse(raw).results;
}
```

- [ ] **Step 6: Ingest job'ını yaz**

`packages/core/src/ingest/reviews.ts`:
```ts
import { createHash } from 'node:crypto';
import type { Db } from '../db/connection.js';
import type { EtsyClient } from '../etsy/client.js';
import { fetchListingReviews } from '../etsy/endpoints/reviews.js';
import type { EtsyReview } from '../etsy/types.js';

const DEFAULT_MAX_LISTINGS = 50;

function reviewEpochSeconds(review: EtsyReview): number {
  return review.create_timestamp ?? review.created_timestamp ?? 0;
}

export function buildReviewId(listingId: number, review: EtsyReview): string {
  const digest = createHash('sha1')
    .update(review.review ?? '')
    .digest('hex')
    .slice(0, 8);
  return `${String(listingId)}:${String(reviewEpochSeconds(review))}:${digest}`;
}

export async function ingestReviews(options: {
  db: Db;
  client: EtsyClient;
  snapshotId: string;
  maxListings?: number;
}): Promise<{ reviewCount: number; apiCalls: number }> {
  const { db, client, snapshotId } = options;
  const maxListings = options.maxListings ?? DEFAULT_MAX_LISTINGS;

  const targets = await db.query<{ listing_id: string }>(
    `select listing_id
       from listing_observations
      where snapshot_id = $snapshotId
      order by coalesce(num_favorers, 0) desc, listing_id
      limit $maxListings`,
    { snapshotId, maxListings },
  );

  let reviewCount = 0;
  let apiCalls = 0;

  for (const target of targets) {
    const listingId = Number(target.listing_id);
    const reviews = await fetchListingReviews(client, listingId);
    apiCalls += 1;

    for (const review of reviews) {
      const epochSeconds = reviewEpochSeconds(review);
      await db.exec(
        `insert or replace into reviews
           (review_id, listing_id, shop_id, rating, review_text, language, created_timestamp)
         values ($reviewId, $listingId, $shopId, $rating, $reviewText, $language, $createdTimestamp)`,
        {
          reviewId: buildReviewId(listingId, review),
          listingId,
          shopId: review.shop_id ?? null,
          rating: review.rating ?? null,
          reviewText: review.review ?? null,
          language: review.language ?? null,
          createdTimestamp: epochSeconds === 0 ? null : new Date(epochSeconds * 1000),
        },
      );
      reviewCount += 1;
    }
  }

  return { reviewCount, apiCalls };
}
```

- [ ] **Step 7: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/reviews.test.ts`
Expected: PASS — 7 test.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/etsy/types.ts packages/core/src/etsy/endpoints/reviews.ts packages/core/src/ingest/reviews.ts packages/core/fixtures packages/core/test/reviews.test.ts
git commit -m "feat: yorum ingest ve deterministik sentetik review_id"
```

---

## Task 13: Kategori ağacı ingest

**Files:**
- Modify: `packages/core/src/etsy/types.ts` (şema ekle)
- Create: `packages/core/src/etsy/endpoints/taxonomy.ts`, `packages/core/src/ingest/taxonomy.ts`
- Create: `packages/core/fixtures/seller-taxonomy-nodes.json`
- Test: `packages/core/test/taxonomy.test.ts`

**Interfaces:**
- Consumes: Task 3 `Db`, Task 6 `EtsyClient`
- Produces:
  - `interface SellerTaxonomyNode { id: number; level: number; name: string; parent_id: number | null; full_path_taxonomy_ids: number[]; children: SellerTaxonomyNode[] }`
  - `sellerTaxonomyNodeSchema`, `fetchTaxonomyNodes(client: EtsyClient): Promise<SellerTaxonomyNode[]>`
  - `flattenTaxonomy(nodes: SellerTaxonomyNode[]): { taxonomy_id: number; name: string; level: number; parent_id: number | null; full_path: string }[]`
  - `ingestTaxonomy(opts: { db: Db; client: EtsyClient }): Promise<{ nodeCount: number }>`

**Neden gerekli:** Spec §6.5 boşluk matrisi alt kategori × fiyat bandı kırılımı istiyor. `listings.taxonomy_id` elimizde ama okunabilir kategori adı yalnızca `getSellerTaxonomyNodes` ucundan geliyor. Uç yalnızca API key gerektiriyor ve 30 gün cache'leniyor, yani günde bir çağrıdan az maliyeti var.

`full_path`, `full_path_taxonomy_ids` dizisindeki her id'nin adının ` > ` ile birleştirilmesiyle üretilir. Ağaç iç içe döndüğü için önce tüm düğümlerden bir `id -> name` haritası kurulur, sonra yollar yazılır.

- [ ] **Step 1: Fixture dosyasını oluştur**

`packages/core/fixtures/seller-taxonomy-nodes.json`:
```json
{
  "count": 1,
  "results": [
    {
      "id": 1,
      "level": 1,
      "name": "Home & Living",
      "parent_id": null,
      "full_path_taxonomy_ids": [1],
      "children": [
        {
          "id": 66,
          "level": 2,
          "name": "Kitchen & Dining",
          "parent_id": 1,
          "full_path_taxonomy_ids": [1, 66],
          "children": [
            {
              "id": 1633,
              "level": 3,
              "name": "Drinkware",
              "parent_id": 66,
              "full_path_taxonomy_ids": [1, 66, 1633],
              "children": []
            }
          ]
        }
      ]
    }
  ]
}
```

- [ ] **Step 2: Failing test yaz**

`packages/core/test/taxonomy.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache } from '../src/etsy/cache.js';
import { RateLimiter } from '../src/etsy/rate-limiter.js';
import { EtsyClient } from '../src/etsy/client.js';
import { flattenTaxonomy, ingestTaxonomy } from '../src/ingest/taxonomy.js';

describe('flattenTaxonomy', () => {
  const tree = [
    {
      id: 1,
      level: 1,
      name: 'Home & Living',
      parent_id: null,
      full_path_taxonomy_ids: [1],
      children: [
        {
          id: 66,
          level: 2,
          name: 'Kitchen & Dining',
          parent_id: 1,
          full_path_taxonomy_ids: [1, 66],
          children: [],
        },
      ],
    },
  ];

  it('iç içe ağacı düz listeye çevirir', () => {
    expect(flattenTaxonomy(tree)).toHaveLength(2);
  });

  it('full_path alanını ad zinciri olarak üretir', () => {
    const rows = flattenTaxonomy(tree);
    const child = rows.find((row) => row.taxonomy_id === 66);
    expect(child?.full_path).toBe('Home & Living > Kitchen & Dining');
  });

  it('kök düğümün full_path alanı kendi adıdır', () => {
    const rows = flattenTaxonomy(tree);
    expect(rows.find((row) => row.taxonomy_id === 1)?.full_path).toBe('Home & Living');
  });
});

describe('ingestTaxonomy', () => {
  let db: Db;
  let client: EtsyClient;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    client = new EtsyClient({
      config: loadConfig({ ETSY_MODE: 'fixture' }),
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
      sleep: async () => {},
    });
  });

  it('üç seviyeli ağacı taxonomy_nodes tablosuna yazar', async () => {
    const result = await ingestTaxonomy({ db, client });
    expect(result.nodeCount).toBe(3);

    const rows = await db.query<{ full_path: string }>(
      'select full_path from taxonomy_nodes where taxonomy_id = 1633',
    );
    expect(rows[0]?.full_path).toBe('Home & Living > Kitchen & Dining > Drinkware');
  });

  it('ikinci çalıştırmada satırları çoğaltmaz', async () => {
    await ingestTaxonomy({ db, client });
    await ingestTaxonomy({ db, client });
    const rows = await db.query<{ n: string }>('select count(*) as n from taxonomy_nodes');
    expect(Number(rows[0]?.n)).toBe(3);
  });
});
```

- [ ] **Step 3: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/taxonomy.test.ts`
Expected: FAIL — `Cannot find module '../src/ingest/taxonomy.js'`

- [ ] **Step 4: Şemayı ekle**

`packages/core/src/etsy/types.ts` dosyasının sonuna ekle:
```ts
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
```

- [ ] **Step 5: Endpoint sarmalayıcısını yaz**

`packages/core/src/etsy/endpoints/taxonomy.ts`:
```ts
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
```

- [ ] **Step 6: Ingest job'ını yaz**

`packages/core/src/ingest/taxonomy.ts`:
```ts
import type { Db } from '../db/connection.js';
import type { EtsyClient } from '../etsy/client.js';
import { fetchTaxonomyNodes } from '../etsy/endpoints/taxonomy.js';
import type { SellerTaxonomyNode } from '../etsy/types.js';

export interface TaxonomyRow {
  taxonomy_id: number;
  name: string;
  level: number;
  parent_id: number | null;
  full_path: string;
}

function collect(nodes: SellerTaxonomyNode[], into: SellerTaxonomyNode[]): void {
  for (const node of nodes) {
    into.push(node);
    collect(node.children, into);
  }
}

export function flattenTaxonomy(nodes: SellerTaxonomyNode[]): TaxonomyRow[] {
  const all: SellerTaxonomyNode[] = [];
  collect(nodes, all);

  const nameById = new Map<number, string>();
  for (const node of all) nameById.set(node.id, node.name);

  return all.map((node) => ({
    taxonomy_id: node.id,
    name: node.name,
    level: node.level,
    parent_id: node.parent_id,
    full_path: node.full_path_taxonomy_ids
      .map((id) => nameById.get(id) ?? String(id))
      .join(' > '),
  }));
}

export async function ingestTaxonomy(options: {
  db: Db;
  client: EtsyClient;
}): Promise<{ nodeCount: number }> {
  const rows = flattenTaxonomy(await fetchTaxonomyNodes(options.client));

  for (const row of rows) {
    await options.db.exec(
      `insert or replace into taxonomy_nodes
         (taxonomy_id, name, level, parent_id, full_path)
       values ($taxonomyId, $name, $level, $parentId, $fullPath)`,
      {
        taxonomyId: row.taxonomy_id,
        name: row.name,
        level: row.level,
        parentId: row.parent_id,
        fullPath: row.full_path,
      },
    );
  }

  return { nodeCount: rows.length };
}
```

- [ ] **Step 7: Testi çalıştır, geçtiğini gör**

Run: `pnpm vitest run packages/core/test/taxonomy.test.ts`
Expected: PASS — 5 test.

- [ ] **Step 8: CLI'ı zenginleştirme adımlarıyla genişlet**

`apps/cli/src/index.ts` içinde `runNicheSnapshot` çağrısından sonrasını şununla değiştir:
```ts
  const result = await runNicheSnapshot({ db, client, niche });
  const taxonomy = await ingestTaxonomy({ db, client });
  const shops = await enrichShops({ db, client, snapshotId: result.snapshotId });
  const reviews = await ingestReviews({ db, client, snapshotId: result.snapshotId });

  process.stdout.write(
    `Snapshot tamamlandı: ${result.snapshotId}\n` +
      `  listing: ${String(result.listingCount)}\n` +
      `  satıcı: ${String(shops.shopCount)}\n` +
      `  yorum: ${String(reviews.reviewCount)}\n` +
      `  kategori düğümü: ${String(taxonomy.nodeCount)}\n` +
      `  API çağrısı: ${String(result.apiCalls + shops.apiCalls + reviews.apiCalls + 1)}\n` +
      `  mod: ${config.etsyMode}\n`,
  );
```

Import satırına ekle: `enrichShops`, `ingestReviews`, `ingestTaxonomy`.

`packages/core/src/index.ts` dosyasına dışa aktarımları ekle:
```ts
export { enrichShops } from './ingest/shop-enrich.js';
export { ingestReviews, buildReviewId } from './ingest/reviews.js';
export { ingestTaxonomy, flattenTaxonomy } from './ingest/taxonomy.js';
export { fetchShop } from './etsy/endpoints/shops.js';
export { fetchListingReviews } from './etsy/endpoints/reviews.js';
export { fetchTaxonomyNodes } from './etsy/endpoints/taxonomy.js';
```

- [ ] **Step 9: Tüm testleri çalıştır ve CLI'ı elle doğrula**

Run: `pnpm test && pnpm typecheck`
Expected: PASS — tüm test dosyaları geçer.

Run: `pnpm snapshot --niche mug --name "Seramik kupa" --keywords mug`
Expected: `listing: 2`, `satıcı: 2`, `yorum: 2`, `kategori düğümü: 3`, `mod: fixture`.

- [ ] **Step 10: Commit**

```bash
git add packages/core/src apps/cli/src packages/core/fixtures packages/core/test
git commit -m "feat: kategori ağacı ingest ve CLI zenginleştirme adımları"
```

---

## Faz 0 bitti sayılma ölçütü

- [ ] `pnpm test` yeşil, tüm testler ağ erişimi olmadan çalışıyor
- [ ] `pnpm typecheck` hatasız
- [ ] `pnpm snapshot --niche mug --name "Seramik kupa" --keywords mug` fixture modunda DuckDB’ye 2 listing, 2 satıcı, 2 yorum ve 3 kategori düğümü yazıyor
- [ ] Faz 1’in ihtiyaç duyduğu dört tablo dolu: `listing_observations`, `shop_observations`, `reviews`, `taxonomy_nodes`
- [ ] `data/` ve `.env` git'e girmemiş

---

## Sonraki adım

Faz 1 (analiz katmanı) için ayrı bir plan yazılacak: `docs/superpowers/plans/YYYY-MM-DD-faz-1-analiz-katmani.md`. Faz 1'in SQL sorguları bu fazda oluşan tablo ve kolon adlarına doğrudan bağlı olduğundan, plan ancak Faz 0 yeşile döndükten sonra yazılır.

Gerçek Etsy API key alındığında yapılacak ilk doğrulama: `.env` içine `ETSY_MODE=live` ve `ETSY_API_KEY` yazıp aynı CLI komutunu çalıştırmak. Bu, canlı sayfalamanın ve `offset` derinliğinin (spec §13'teki açık soru) gerçek davranışını ölçer.

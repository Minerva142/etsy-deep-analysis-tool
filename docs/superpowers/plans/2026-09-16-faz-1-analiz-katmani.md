# Faz 1 — Analiz Katmanı Implementasyon Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spec §6'daki sekiz analizi DuckDB SQL olarak yazmak ve `pnpm report` ile okunabilir bir terminal raporu üretmek.

**Architecture:** Her analiz `packages/core/src/analysis/` altında bir SQL sabiti + tipli sarmalayıcı. Hepsi ortak iki view üzerine kurulu: `v_listing_velocity` (ardışık snapshot'lar arası favori hızı) ve `v_latest_snapshot` (niş başına son tamamlanmış snapshot). `apps/cli` bir `report` komutuyla bunları basar.

**Tech Stack:** Faz 0 ile aynı — TypeScript (ESM), DuckDB, vitest.

**Spec:** `docs/superpowers/specs/2026-09-16-etsy-deep-analysis-tool-design.md`

**Önceki plan:** `docs/superpowers/plans/2026-09-16-faz-0-veri-boru-hatti.md`

## Global Constraints

- Faz 0'ın tüm kısıtları geçerli (Node >= 20.17, ESM, `strict: true`, testler ağa çıkmaz).
- **Sayıyı SQL üretir.** Analizler TypeScript'te hesap yapmaz; JS tarafı yalnızca satırları tipler ve biçimlendirir.
- **`getRowObjectsJson()` her sayıyı string döndürür.** Her sarmalayıcı kendi `Number(...)` dönüşümünü açıkça yapar.
- Zaman damgası parametreleri `toDbTimestamp()` ile geçirilir ve SQL'de `$p::TIMESTAMP` ile cast edilir.
- Analizler **niş bazlıdır**: her fonksiyon `nicheId` alır ve yalnızca o nişin snapshot'larına bakar.
- Bir analiz veri yetersizliğinde (tek snapshot, boş niş) **hata fırlatmaz**, boş dizi veya `null` alanlar döner. Rapor bunu açıkça yazar.

## Ölçülmüş API gerçekleri (bu plan bunlara dayanıyor)

Faz 0'ın canlı koşusunda ölçüldü, 2026-09-16:

| Bulgu | Kanıt | Sonuç |
|---|---|---|
| `created_timestamp` **yenileme** tarihidir, oluşturma değil | Bir listing'de `created=2026-09-16`, `original_creation_timestamp=2022-10-21` | Yaş/tazelik analizi `original_creation_timestamp` kullanır |
| `listings/active` varsayılanı `sort_on=created`, newest-first | Etsy dokümanı: *"paginated by their creation date. Without sort_order listings will be returned newest-first by default."* | Varsayılan örneklem her gün tamamen değişir |
| `sort_on=created` örnekleminde favoriler ~0 | Beş örneğin tamamı `fav=0` | Talep sinyali ölçülemez |
| `sort_on=score` kararlı ve temsili örneklem verir | Favoriler 0–5 arası karışık, orijinal tarihler 2024–2026 arası | **Snapshot'lar `score` ile alınır** |

`sort_on=created` ile aynı listing iki ardışık snapshot'ta görünmez; kesişim boş olduğu için favori hızı her zaman `NULL` çıkar. Task 1 bunu düzeltmeden diğer tasklar anlamsızdır.

---

## Dosya Yapısı

| Dosya | Sorumluluk |
|---|---|
| `packages/core/src/db/schema.sql` | (değişiklik) `listings.original_creation_timestamp`, `niches.sort_on` kolonları + iki analiz view'ı |
| `packages/core/src/analysis/velocity.ts` | Ortak view'lara dayanan yardımcılar ve tipler |
| `packages/core/src/analysis/overview.ts` | §6.1 pazar görünümü, §6.7 tazelik, §6.8 yorum istatistikleri |
| `packages/core/src/analysis/demand.ts` | §6.2 talep hızı ve yükselenler |
| `packages/core/src/analysis/pricing.ts` | §6.3 fiyat–talep eğrisi, §6.5 boşluk matrisi |
| `packages/core/src/analysis/tags.ts` | §6.4 etiket fırsat kadranı |
| `packages/core/src/analysis/sellers.ts` | §6.6 satıcı tablosu ve konsantrasyon |
| `packages/core/test/helpers/seed.ts` | Testlerin paylaştığı, bilinen iki-snapshot veri seti |
| `apps/cli/src/report.ts` | Rapor komutunun biçimlendirmesi |

---

## Task 1: Örneklemi düzelt

**Files:**
- Modify: `packages/core/src/db/schema.sql`, `packages/core/src/etsy/types.ts`
- Modify: `packages/core/src/etsy/endpoints/listings.ts`, `packages/core/src/ingest/normalize.ts`
- Modify: `packages/core/src/ingest/niche-snapshot.ts`, `apps/cli/src/index.ts`
- Test: `packages/core/test/normalize.test.ts`, `packages/core/test/niche-snapshot.test.ts`

**Interfaces:**
- Consumes: Faz 0'ın tamamı
- Produces:
  - `Niche` arayüzüne `sortOn: 'created' | 'price' | 'updated' | 'score'` alanı
  - `ListingRow`'a `original_creation_timestamp: Date | null`
  - `fetchAllActiveListings` artık `sortOn` almadığında **`score`** kullanır

- [ ] **Step 1: Failing test yaz**

`packages/core/test/normalize.test.ts` dosyasına ekle:
```ts
  it('original_creation_timestamp alanını ayrı saklar', () => {
    const result = normalizeListing({
      ...base,
      created_timestamp: 1758000000,
      original_creation_timestamp: 1666310400,
    });
    // created_timestamp yenileme tarihidir; yaş hesabı orijinali kullanır.
    expect(result.listing.created_timestamp?.getUTCFullYear()).toBe(2025);
    expect(result.listing.original_creation_timestamp?.getUTCFullYear()).toBe(2022);
  });

  it('original_creation_timestamp yoksa null döner', () => {
    expect(normalizeListing(base).listing.original_creation_timestamp).toBeNull();
  });
```

`packages/core/test/endpoints.test.ts` dosyasına ekle:
```ts
  it('sortOn verilmediğinde score ile sorgular', async () => {
    let captured: Record<string, unknown> | undefined;
    const client = {
      request: vi.fn(async (req: { params?: Record<string, unknown> }) => {
        captured ??= req.params;
        return { count: 0, results: [] };
      }),
    } as unknown as EtsyClient;

    await fetchAllActiveListings(client, { keywords: 'mug' });

    // Etsy varsayılanı 'created'; o örneklem her gün tamamen değiştiği için
    // favori hızı hesaplanamaz hale geliyor.
    expect(captured?.sort_on).toBe('score');
  });

  it('açıkça verilen sortOn değerine uyar', async () => {
    let captured: Record<string, unknown> | undefined;
    const client = {
      request: vi.fn(async (req: { params?: Record<string, unknown> }) => {
        captured ??= req.params;
        return { count: 0, results: [] };
      }),
    } as unknown as EtsyClient;

    await fetchAllActiveListings(client, { keywords: 'mug', sortOn: 'price' });

    expect(captured?.sort_on).toBe('price');
  });
```

- [ ] **Step 2: Testleri çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/normalize.test.ts packages/core/test/endpoints.test.ts`
Expected: FAIL — `original_creation_timestamp` alanı yok; `sort_on` `undefined` geliyor.

- [ ] **Step 3: Şemaya kolonları ekle**

`packages/core/src/db/schema.sql` içinde `listings` tablosuna `url` satırından sonra ekle:
```sql
  original_creation_timestamp TIMESTAMP,
```

`niches` tablosuna `max_price` satırından sonra ekle:
```sql
  sort_on     VARCHAR NOT NULL DEFAULT 'score',
```

Not: mevcut `data/etsy.duckdb` eski şemayla oluşmuş. Faz 1 geliştirmesine geçmeden dosyayı sil (`data/` gitignore'da, yeniden üretilebilir) ve snapshot'ları yeniden al.

- [ ] **Step 4: Şema ve tipleri güncelle**

`packages/core/src/etsy/types.ts` içinde `etsyListingSchema`'ya ekle:
```ts
  original_creation_timestamp: z.number().nullable().optional(),
```

`packages/core/src/ingest/normalize.ts` — `ListingRow`'a alan ekle:
```ts
  original_creation_timestamp: Date | null;
```
ve `normalizeListing` içinde `listing` nesnesine:
```ts
      original_creation_timestamp:
        listing.original_creation_timestamp == null
          ? null
          : new Date(listing.original_creation_timestamp * 1000),
```

`packages/core/src/etsy/endpoints/listings.ts` — varsayılanı değiştir:
```ts
/**
 * Etsy'nin varsayılanı `created` (newest-first). O örneklem her gün
 * tamamen değiştiği için aynı listing iki ardışık snapshot'ta görünmez
 * ve favori hızı hesaplanamaz. `score` kararlı ve temsili bir örneklem
 * verir; ölçüm için bkz. plan başındaki tablo.
 */
const DEFAULT_SORT_ON = 'score' as const;
```
ve istek parametresinde:
```ts
        sort_on: query.sortOn ?? DEFAULT_SORT_ON,
```

- [ ] **Step 5: Niche ve ingest'i güncelle**

`packages/core/src/ingest/niche-snapshot.ts`:
```ts
export interface Niche {
  nicheId: string;
  name: string;
  keywords: string | null;
  taxonomyId: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  sortOn: 'created' | 'price' | 'updated' | 'score';
}
```

`upsertNiche` SQL'ine `sort_on` kolonunu ekle (`values` listesine `$sortOn`, parametrelere `sortOn: niche.sortOn`).

`runNicheSnapshot` içinde `fetchAllActiveListings` çağrısına ekle:
```ts
      sortOn: niche.sortOn,
```

`listings` insert'ine kolonu ekle:
```sql
          original_creation_timestamp,
```
`values` listesine `$originalCreatedTimestamp::TIMESTAMP`, `do update set` bloğuna
`original_creation_timestamp = excluded.original_creation_timestamp`, parametrelere:
```ts
        originalCreatedTimestamp:
          listing.original_creation_timestamp === null
            ? null
            : toDbTimestamp(listing.original_creation_timestamp),
```

- [ ] **Step 6: CLI'a --sort-on ekle**

`apps/cli/src/index.ts` içinde `parseArgs`'ın döndürdüğü `niche` nesnesine:
```ts
      sortOn: (readFlag(argv, 'sort-on') ?? 'score') as Niche['sortOn'],
```

- [ ] **Step 7: Testleri çalıştır**

Run: `pnpm test`
Expected: PASS. Mevcut testlerde `Niche` nesneleri `sortOn: 'score'` alanını taşımalı; eksikse TypeScript hata verir, ekle.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "fix: snapshot ornegini score ile al ve orijinal olusturma tarihini sakla"
```

---

## Task 2: Analiz temeli — view'lar ve test seed'i

**Files:**
- Modify: `packages/core/src/db/schema.sql`
- Create: `packages/core/src/analysis/velocity.ts`, `packages/core/test/helpers/seed.ts`
- Test: `packages/core/test/velocity.test.ts`

**Interfaces:**
- Consumes: Task 1
- Produces:
  - View `v_listing_velocity` ve `v_latest_snapshot`
  - `getLatestSnapshotId(db: Db, nicheId: string): Promise<string | null>`
  - `countSnapshots(db: Db, nicheId: string): Promise<number>`
  - `seedTwoSnapshots(db: Db): Promise<{ nicheId: string; snapshotA: string; snapshotB: string }>`

**Favori hızı tanımı:** aynı nişte aynı listing'in ardışık iki gözlemi arasında
`(num_favorers[t] - num_favorers[t-1]) / geçen_gün`. İlk gözlemde `NULL`.

- [ ] **Step 1: View'ları şemaya ekle**

`packages/core/src/db/schema.sql` sonuna ekle:
```sql
CREATE OR REPLACE VIEW v_listing_velocity AS
WITH ardisik AS (
  SELECT
    s.niche_id,
    o.snapshot_id,
    o.listing_id,
    o.observed_at,
    o.num_favorers,
    o.price_amount,
    LAG(o.num_favorers) OVER (
      PARTITION BY s.niche_id, o.listing_id ORDER BY o.observed_at
    ) AS onceki_favori,
    LAG(o.observed_at) OVER (
      PARTITION BY s.niche_id, o.listing_id ORDER BY o.observed_at
    ) AS onceki_an
  FROM listing_observations o
  JOIN snapshots s ON s.snapshot_id = o.snapshot_id
)
SELECT
  niche_id,
  snapshot_id,
  listing_id,
  observed_at,
  num_favorers,
  price_amount,
  CASE
    WHEN onceki_favori IS NULL THEN NULL
    WHEN date_diff('second', onceki_an, observed_at) <= 0 THEN NULL
    ELSE (num_favorers - onceki_favori)
         / (date_diff('second', onceki_an, observed_at) / 86400.0)
  END AS favorite_velocity
FROM ardisik;

CREATE OR REPLACE VIEW v_latest_snapshot AS
SELECT niche_id, snapshot_id, started_at
FROM (
  SELECT niche_id, snapshot_id, started_at,
         ROW_NUMBER() OVER (PARTITION BY niche_id ORDER BY started_at DESC) AS sira
  FROM snapshots
  WHERE status = 'complete'
)
WHERE sira = 1;
```

- [ ] **Step 2: Test seed'ini yaz**

`packages/core/test/helpers/seed.ts`:
```ts
import { toDbTimestamp, type Db } from '../../src/db/connection.js';

/**
 * İki snapshot'lık bilinen bir veri seti. Aradaki fark tam 10 gün, böylece
 * favori hızı elle doğrulanabilir:
 *
 *   L1: 100 -> 200 favori =>  10 /gün   fiyat 10  shop 1  tag [a, b]
 *   L2:  50 ->  60 favori =>   1 /gün   fiyat 20  shop 1  tag [a]
 *   L3:  10 ->  10 favori =>   0 /gün   fiyat 30  shop 2  tag [c]
 *   L4:  sadece B'de, 5 favori => NULL  fiyat 40  shop 3  tag [c]
 */
export const SNAPSHOT_A = '2026-09-01T00:00:00Z';
export const SNAPSHOT_B = '2026-09-11T00:00:00Z';

export async function seedTwoSnapshots(
  db: Db,
): Promise<{ nicheId: string; snapshotA: string; snapshotB: string }> {
  const nicheId = 'test-nis';
  const snapshotA = 'snap-a';
  const snapshotB = 'snap-b';

  await db.runStatement(
    `insert into niches (niche_id, name, keywords, created_at, sort_on)
     values ($id, 'Test niş', 'test', $t::TIMESTAMP, 'score')`,
    { id: nicheId, t: toDbTimestamp(new Date(SNAPSHOT_A)) },
  );

  for (const [id, iso] of [
    [snapshotA, SNAPSHOT_A],
    [snapshotB, SNAPSHOT_B],
  ] as const) {
    await db.runStatement(
      `insert into snapshots (snapshot_id, niche_id, started_at, finished_at, status)
       values ($id, $niche, $t::TIMESTAMP, $t::TIMESTAMP, 'complete')`,
      { id, niche: nicheId, t: toDbTimestamp(new Date(iso)) },
    );
  }

  const listings = [
    { id: 1, shop: 1, price: 10, orijinal: '2024-01-01T00:00:00Z', tags: ['a', 'b'] },
    { id: 2, shop: 1, price: 20, orijinal: '2025-01-01T00:00:00Z', tags: ['a'] },
    { id: 3, shop: 2, price: 30, orijinal: '2026-06-20T00:00:00Z', tags: ['c'] },
    { id: 4, shop: 3, price: 40, orijinal: '2026-09-05T00:00:00Z', tags: ['c'] },
  ];

  for (const l of listings) {
    await db.runStatement(
      `insert into listings
         (listing_id, shop_id, title, url, original_creation_timestamp,
          first_seen_at, last_seen_at)
       values ($id, $shop, $title, 'https://example.com', $orijinal::TIMESTAMP,
               $t::TIMESTAMP, $t::TIMESTAMP)`,
      {
        id: l.id,
        shop: l.shop,
        title: `Listing ${String(l.id)}`,
        orijinal: toDbTimestamp(new Date(l.orijinal)),
        t: toDbTimestamp(new Date(l.id === 4 ? SNAPSHOT_B : SNAPSHOT_A)),
      },
    );
    for (const tag of l.tags) {
      await db.runStatement(
        'insert into listing_tags (listing_id, tag) values ($id, $tag)',
        { id: l.id, tag },
      );
    }
  }

  const gozlemler = [
    { snapshot: snapshotA, iso: SNAPSHOT_A, favoriler: [100, 50, 10, null] },
    { snapshot: snapshotB, iso: SNAPSHOT_B, favoriler: [200, 60, 10, 5] },
  ];

  for (const g of gozlemler) {
    for (const [index, favori] of g.favoriler.entries()) {
      if (favori === null) continue;
      const l = listings[index];
      if (l === undefined) continue;
      await db.runStatement(
        `insert into listing_observations
           (snapshot_id, listing_id, price_amount, currency_code,
            num_favorers, quantity, state, observed_at)
         values ($snapshot, $listing, $price, 'USD', $favori, 1, 'active', $t::TIMESTAMP)`,
        {
          snapshot: g.snapshot,
          listing: l.id,
          price: l.price,
          favori,
          t: toDbTimestamp(new Date(g.iso)),
        },
      );
    }
  }

  // Satıcılar: shop 1 iki listing, shop 2 ve 3 birer tane.
  for (const [shopId, ad, puan] of [
    [1, 'Shop Bir', 4.9],
    [2, 'Shop Iki', 4.1],
    [3, 'Shop Uc', 3.5],
  ] as const) {
    await db.runStatement(
      `insert into shops (shop_id, shop_name, url, first_seen_at, last_seen_at)
       values ($id, $ad, 'https://example.com', $t::TIMESTAMP, $t::TIMESTAMP)`,
      { id: shopId, ad, t: toDbTimestamp(new Date(SNAPSHOT_A)) },
    );
    await db.runStatement(
      `insert into shop_observations
         (snapshot_id, shop_id, num_favorers, listing_active_count,
          review_count, review_average, observed_at)
       values ($snapshot, $id, 100, 5, 20, $puan, $t::TIMESTAMP)`,
      {
        snapshot: snapshotB,
        id: shopId,
        puan,
        t: toDbTimestamp(new Date(SNAPSHOT_B)),
      },
    );
  }

  // Yorumlar: iki düşük puanlı, bir yüksek.
  for (const [reviewId, listingId, rating, metin] of [
    ['r1', 1, 2, 'Kulpu kırık geldi'],
    ['r2', 1, 3, 'Rengi fotoğraftaki gibi değil'],
    ['r3', 2, 5, 'Harika'],
  ] as const) {
    await db.runStatement(
      `insert into reviews
         (review_id, listing_id, shop_id, rating, review_text, language, created_timestamp)
       values ($id, $listing, 1, $rating, $metin, 'tr', $t::TIMESTAMP)`,
      {
        id: reviewId,
        listing: listingId,
        rating,
        metin,
        t: toDbTimestamp(new Date(SNAPSHOT_B)),
      },
    );
  }

  return { nicheId, snapshotA, snapshotB };
}
```

- [ ] **Step 3: Failing test yaz**

`packages/core/test/velocity.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { countSnapshots, getLatestSnapshotId } from '../src/analysis/velocity.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('favori hızı view’ı', () => {
  let db: Db;
  let nicheId: string;
  let snapshotB: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId, snapshotB } = await seedTwoSnapshots(db));
  });

  it('10 günde 100 favori artışını günde 10 olarak hesaplar', async () => {
    const rows = await db.query<{ favorite_velocity: number }>(
      `select favorite_velocity from v_listing_velocity
        where listing_id = 1 and snapshot_id = $s`,
      { s: snapshotB },
    );
    expect(Number(rows[0]?.favorite_velocity)).toBeCloseTo(10);
  });

  it('değişmeyen favoriyi sıfır hız sayar', async () => {
    const rows = await db.query<{ favorite_velocity: number }>(
      `select favorite_velocity from v_listing_velocity
        where listing_id = 3 and snapshot_id = $s`,
      { s: snapshotB },
    );
    expect(Number(rows[0]?.favorite_velocity)).toBe(0);
  });

  it('ilk gözlemde hız NULL olur', async () => {
    const rows = await db.query<{ favorite_velocity: number | null }>(
      `select favorite_velocity from v_listing_velocity where listing_id = 4`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.favorite_velocity).toBeNull();
  });

  it('son snapshot’ı bulur', async () => {
    expect(await getLatestSnapshotId(db, nicheId)).toBe(snapshotB);
  });

  it('bilinmeyen niş için null döner', async () => {
    expect(await getLatestSnapshotId(db, 'yok')).toBeNull();
  });

  it('snapshot sayısını verir', async () => {
    expect(await countSnapshots(db, nicheId)).toBe(2);
  });
});
```

- [ ] **Step 4: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/velocity.test.ts`
Expected: FAIL — `Cannot find module '../src/analysis/velocity.js'`

- [ ] **Step 5: Yardımcıları yaz**

`packages/core/src/analysis/velocity.ts`:
```ts
import type { Db } from '../db/connection.js';

export async function getLatestSnapshotId(
  db: Db,
  nicheId: string,
): Promise<string | null> {
  const rows = await db.query<{ snapshot_id: string }>(
    'select snapshot_id from v_latest_snapshot where niche_id = $niche',
    { niche: nicheId },
  );
  return rows[0]?.snapshot_id ?? null;
}

export async function countSnapshots(db: Db, nicheId: string): Promise<number> {
  const rows = await db.query<{ n: string }>(
    `select count(*) as n from snapshots
      where niche_id = $niche and status = 'complete'`,
    { niche: nicheId },
  );
  return Number(rows[0]?.n ?? 0);
}
```

- [ ] **Step 6: Testi çalıştır ve commit**

Run: `pnpm vitest run packages/core/test/velocity.test.ts`
Expected: PASS — 6 test.

```bash
git add -A
git commit -m "feat: favori hizi view'i ve analiz test seed'i"
```

---

## Task 3: Pazar görünümü, tazelik ve yorum istatistikleri

**Files:**
- Create: `packages/core/src/analysis/overview.ts`
- Test: `packages/core/test/overview.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces:
  - `getMarketOverview(db, nicheId): Promise<MarketOverview | null>`
  - `getFreshness(db, nicheId): Promise<Freshness | null>`
  - `getReviewStats(db, nicheId): Promise<ReviewStats>`

```ts
export interface MarketOverview {
  listingCount: number; sellerCount: number;
  medianPrice: number | null; p25Price: number | null; p75Price: number | null;
  avgVelocity: number | null; totalFavorers: number;
}
export interface Freshness {
  medianAgeDays: number | null; newLast30Days: number; newLast90Days: number;
}
export interface ReviewStats {
  ratingDistribution: { rating: number; count: number }[];
  lowRated: { listingId: number; rating: number; text: string }[];
}
```

- [ ] **Step 1: Failing test yaz**

`packages/core/test/overview.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import {
  getFreshness,
  getMarketOverview,
  getReviewStats,
} from '../src/analysis/overview.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('pazar görünümü', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('son snapshot’taki listing ve satıcı sayısını verir', async () => {
    const o = await getMarketOverview(db, nicheId);
    // B snapshot'ında dört listing, üç satıcı var.
    expect(o?.listingCount).toBe(4);
    expect(o?.sellerCount).toBe(3);
  });

  it('fiyat medyanını ve çeyrekliklerini hesaplar', async () => {
    const o = await getMarketOverview(db, nicheId);
    // Fiyatlar 10, 20, 30, 40 -> medyan 25
    expect(o?.medianPrice).toBeCloseTo(25);
    expect(o?.p25Price).toBeCloseTo(17.5);
    expect(o?.p75Price).toBeCloseTo(32.5);
  });

  it('ortalama favori hızını yalnızca ölçülebilen listing’ler üzerinden alır', async () => {
    const o = await getMarketOverview(db, nicheId);
    // L1=10, L2=1, L3=0 -> ortalama 11/3; L4'ün hızı NULL, dışarıda.
    expect(o?.avgVelocity).toBeCloseTo(11 / 3);
  });

  it('bilinmeyen niş için null döner', async () => {
    expect(await getMarketOverview(db, 'yok')).toBeNull();
  });

  it('tazeliği orijinal oluşturma tarihinden hesaplar', async () => {
    const f = await getFreshness(db, nicheId);
    // L4 2026-09-05'te, son snapshot 2026-09-11 -> 30 gün içinde 1 tane.
    expect(f?.newLast30Days).toBe(1);
    // L3 (2026-06-20, 83 gün önce) ve L4 -> 90 gün içinde 2 tane.
    expect(f?.newLast90Days).toBe(2);
  });

  it('yorum puan dağılımını verir', async () => {
    const s = await getReviewStats(db, nicheId);
    expect(s.ratingDistribution).toEqual([
      { rating: 2, count: 1 },
      { rating: 3, count: 1 },
      { rating: 5, count: 1 },
    ]);
  });

  it('düşük puanlı yorumları metniyle listeler', async () => {
    const s = await getReviewStats(db, nicheId);
    expect(s.lowRated).toHaveLength(2);
    expect(s.lowRated.map((r) => r.text)).toContain('Kulpu kırık geldi');
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/overview.test.ts`
Expected: FAIL — modül yok.

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/analysis/overview.ts`:
```ts
import type { Db } from '../db/connection.js';

export interface MarketOverview {
  listingCount: number;
  sellerCount: number;
  medianPrice: number | null;
  p25Price: number | null;
  p75Price: number | null;
  avgVelocity: number | null;
  totalFavorers: number;
}

export interface Freshness {
  medianAgeDays: number | null;
  newLast30Days: number;
  newLast90Days: number;
}

export interface ReviewStats {
  ratingDistribution: { rating: number; count: number }[];
  lowRated: { listingId: number; rating: number; text: string }[];
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function getMarketOverview(
  db: Db,
  nicheId: string,
): Promise<MarketOverview | null> {
  const rows = await db.query<Record<string, unknown>>(
    `select
        count(*)                                  as listing_count,
        count(distinct l.shop_id)                 as seller_count,
        median(v.price_amount)                    as median_price,
        quantile_cont(v.price_amount, 0.25)       as p25_price,
        quantile_cont(v.price_amount, 0.75)       as p75_price,
        avg(v.favorite_velocity)                  as avg_velocity,
        sum(coalesce(v.num_favorers, 0))          as total_favorers
       from v_listing_velocity v
       join v_latest_snapshot s
         on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
       join listings l on l.listing_id = v.listing_id
      where v.niche_id = $niche`,
    { niche: nicheId },
  );

  const row = rows[0];
  if (row === undefined || Number(row.listing_count) === 0) return null;

  return {
    listingCount: Number(row.listing_count),
    sellerCount: Number(row.seller_count),
    medianPrice: toNumberOrNull(row.median_price),
    p25Price: toNumberOrNull(row.p25_price),
    p75Price: toNumberOrNull(row.p75_price),
    avgVelocity: toNumberOrNull(row.avg_velocity),
    totalFavorers: Number(row.total_favorers),
  };
}

export async function getFreshness(
  db: Db,
  nicheId: string,
): Promise<Freshness | null> {
  const rows = await db.query<Record<string, unknown>>(
    `with son as (select * from v_latest_snapshot where niche_id = $niche),
          gozlem as (
            select l.original_creation_timestamp as olusturma, s.started_at as an
              from listing_observations o
              join son s on s.snapshot_id = o.snapshot_id
              join listings l on l.listing_id = o.listing_id
          )
     select
       median(date_diff('day', olusturma, an))                                as median_age_days,
       count(*) filter (where date_diff('day', olusturma, an) <= 30)          as new_30,
       count(*) filter (where date_diff('day', olusturma, an) <= 90)          as new_90,
       count(*)                                                              as toplam
     from gozlem`,
    { niche: nicheId },
  );

  const row = rows[0];
  if (row === undefined || Number(row.toplam) === 0) return null;

  return {
    medianAgeDays: toNumberOrNull(row.median_age_days),
    newLast30Days: Number(row.new_30),
    newLast90Days: Number(row.new_90),
  };
}

export async function getReviewStats(db: Db, nicheId: string): Promise<ReviewStats> {
  const nisListingleri = `
    select distinct o.listing_id
      from listing_observations o
      join snapshots s on s.snapshot_id = o.snapshot_id
     where s.niche_id = $niche`;

  const dagilim = await db.query<{ rating: string; adet: string }>(
    `select r.rating, count(*) as adet
       from reviews r
      where r.rating is not null
        and r.listing_id in (${nisListingleri})
      group by r.rating
      order by r.rating`,
    { niche: nicheId },
  );

  const dusuk = await db.query<{ listing_id: string; rating: string; review_text: string }>(
    `select r.listing_id, r.rating, r.review_text
       from reviews r
      where r.rating <= 3
        and r.review_text is not null
        and r.listing_id in (${nisListingleri})
      order by r.rating, r.listing_id`,
    { niche: nicheId },
  );

  return {
    ratingDistribution: dagilim.map((r) => ({
      rating: Number(r.rating),
      count: Number(r.adet),
    })),
    lowRated: dusuk.map((r) => ({
      listingId: Number(r.listing_id),
      rating: Number(r.rating),
      text: r.review_text,
    })),
  };
}
```

- [ ] **Step 4: Testi çalıştır ve commit**

Run: `pnpm vitest run packages/core/test/overview.test.ts`
Expected: PASS — 7 test.

```bash
git add -A && git commit -m "feat: pazar gorunumu, tazelik ve yorum istatistikleri"
```

---

## Task 4: Talep hızı ve yükselenler

**Files:**
- Create: `packages/core/src/analysis/demand.ts`
- Test: `packages/core/test/demand.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces:
  - `getVelocitySeries(db, nicheId): Promise<{ snapshotId: string; observedAt: string; avgVelocity: number | null; listingCount: number }[]>`
  - `getTopRisers(db, nicheId, limit?): Promise<RiserRow[]>` — `RiserRow = { listingId: number; title: string | null; url: string | null; price: number | null; numFavorers: number; velocity: number }`

- [ ] **Step 1: Failing test yaz**

`packages/core/test/demand.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { getTopRisers, getVelocitySeries } from '../src/analysis/demand.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('talep hızı', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('snapshot başına bir zaman serisi noktası üretir', async () => {
    const seri = await getVelocitySeries(db, nicheId);
    expect(seri).toHaveLength(2);
  });

  it('ilk snapshot’ın ortalama hızı ölçülemez', async () => {
    const seri = await getVelocitySeries(db, nicheId);
    expect(seri[0]?.avgVelocity).toBeNull();
  });

  it('ikinci snapshot’ın ortalama hızını hesaplar', async () => {
    const seri = await getVelocitySeries(db, nicheId);
    expect(seri[1]?.avgVelocity).toBeCloseTo(11 / 3);
  });

  it('en hızlı yükselenleri sıralar', async () => {
    const yukselenler = await getTopRisers(db, nicheId);
    expect(yukselenler.map((r) => r.listingId)).toEqual([1, 2, 3]);
    expect(yukselenler[0]?.velocity).toBeCloseTo(10);
  });

  it('hızı ölçülemeyen listing’i dışarıda bırakır', async () => {
    const yukselenler = await getTopRisers(db, nicheId);
    expect(yukselenler.map((r) => r.listingId)).not.toContain(4);
  });

  it('limit parametresine uyar', async () => {
    expect(await getTopRisers(db, nicheId, 1)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/demand.test.ts`
Expected: FAIL — modül yok.

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/analysis/demand.ts`:
```ts
import type { Db } from '../db/connection.js';

export interface VelocityPoint {
  snapshotId: string;
  observedAt: string;
  avgVelocity: number | null;
  listingCount: number;
}

export interface RiserRow {
  listingId: number;
  title: string | null;
  url: string | null;
  price: number | null;
  numFavorers: number;
  velocity: number;
}

export async function getVelocitySeries(
  db: Db,
  nicheId: string,
): Promise<VelocityPoint[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select v.snapshot_id,
            min(v.observed_at)        as observed_at,
            avg(v.favorite_velocity)  as avg_velocity,
            count(*)                  as listing_count
       from v_listing_velocity v
      where v.niche_id = $niche
      group by v.snapshot_id
      order by observed_at`,
    { niche: nicheId },
  );

  return rows.map((row) => ({
    snapshotId: String(row.snapshot_id),
    observedAt: String(row.observed_at),
    avgVelocity: row.avg_velocity === null ? null : Number(row.avg_velocity),
    listingCount: Number(row.listing_count),
  }));
}

export async function getTopRisers(
  db: Db,
  nicheId: string,
  limit = 20,
): Promise<RiserRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `select v.listing_id, l.title, l.url, v.price_amount, v.num_favorers,
            v.favorite_velocity
       from v_listing_velocity v
       join v_latest_snapshot s
         on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
       join listings l on l.listing_id = v.listing_id
      where v.niche_id = $niche and v.favorite_velocity is not null
      order by v.favorite_velocity desc, v.listing_id
      limit $limit`,
    { niche: nicheId, limit },
  );

  return rows.map((row) => ({
    listingId: Number(row.listing_id),
    title: row.title === null ? null : String(row.title),
    url: row.url === null ? null : String(row.url),
    price: row.price_amount === null ? null : Number(row.price_amount),
    numFavorers: Number(row.num_favorers ?? 0),
    velocity: Number(row.favorite_velocity),
  }));
}
```

- [ ] **Step 4: Testi çalıştır ve commit**

Run: `pnpm vitest run packages/core/test/demand.test.ts`
Expected: PASS — 6 test.

```bash
git add -A && git commit -m "feat: talep hizi serisi ve yukselen listingler"
```

---

## Task 5: Fiyat–talep eğrisi ve boşluk matrisi

**Files:**
- Create: `packages/core/src/analysis/pricing.ts`
- Test: `packages/core/test/pricing.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces:
  - `getPriceDemandCurve(db, nicheId, bandCount?): Promise<PriceBand[]>`
    — `PriceBand = { band: number; minPrice: number; maxPrice: number; supply: number; demand: number; demandPerListing: number }`
  - `getGapMatrix(db, nicheId, bandCount?): Promise<GapCell[]>`
    — `GapCell = { taxonomyId: number | null; taxonomyPath: string | null; band: number; supply: number; demand: number; ratio: number }`

**Not:** `ntile()` doğrudan `GROUP BY` içinde kullanılamaz (DuckDB: *"GROUP BY clause cannot contain window functions"*). Bant numarası önce bir CTE'de hesaplanır, gruplama ondan sonra yapılır.

- [ ] **Step 1: Failing test yaz**

`packages/core/test/pricing.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { getGapMatrix, getPriceDemandCurve } from '../src/analysis/pricing.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('fiyat–talep eğrisi', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('istenen sayıda bant üretir', async () => {
    // Dört listing, iki bant -> bant başına iki listing.
    const bantlar = await getPriceDemandCurve(db, nicheId, 2);
    expect(bantlar).toHaveLength(2);
    expect(bantlar[0]?.supply).toBe(2);
    expect(bantlar[1]?.supply).toBe(2);
  });

  it('bant sınırlarını doğru verir', async () => {
    const bantlar = await getPriceDemandCurve(db, nicheId, 2);
    expect(bantlar[0]?.minPrice).toBeCloseTo(10);
    expect(bantlar[0]?.maxPrice).toBeCloseTo(20);
    expect(bantlar[1]?.minPrice).toBeCloseTo(30);
  });

  it('talebi bandaki favori hızlarının toplamı sayar', async () => {
    const bantlar = await getPriceDemandCurve(db, nicheId, 2);
    // Alt bant: L1 (10/gün) + L2 (1/gün) = 11
    expect(bantlar[0]?.demand).toBeCloseTo(11);
    // Üst bant: L3 (0) + L4 (NULL -> 0) = 0
    expect(bantlar[1]?.demand).toBeCloseTo(0);
  });

  it('listing başına talebi hesaplar', async () => {
    const bantlar = await getPriceDemandCurve(db, nicheId, 2);
    expect(bantlar[0]?.demandPerListing).toBeCloseTo(5.5);
  });

  it('boş niş için boş dizi döner', async () => {
    expect(await getPriceDemandCurve(db, 'yok', 2)).toEqual([]);
  });
});

describe('boşluk matrisi', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('kategori × bant hücreleri üretir', async () => {
    const hucreler = await getGapMatrix(db, nicheId, 2);
    expect(hucreler.length).toBeGreaterThan(0);
    for (const h of hucreler) {
      expect(h.supply).toBeGreaterThan(0);
      expect(Number.isFinite(h.ratio)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/pricing.test.ts`
Expected: FAIL — modül yok.

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/analysis/pricing.ts`:
```ts
import type { Db } from '../db/connection.js';

export interface PriceBand {
  band: number;
  minPrice: number;
  maxPrice: number;
  supply: number;
  demand: number;
  demandPerListing: number;
}

export interface GapCell {
  taxonomyId: number | null;
  taxonomyPath: string | null;
  band: number;
  supply: number;
  demand: number;
  ratio: number;
}

/**
 * Son snapshot'ın gözlemlerini fiyat bandına atar.
 *
 * ntile() bir pencere fonksiyonu olduğu için doğrudan GROUP BY içinde
 * kullanılamıyor; bant numarası önce burada hesaplanıp sonra gruplanıyor.
 */
const BANTLI_GOZLEM = `
  select
    v.listing_id,
    v.price_amount,
    coalesce(v.favorite_velocity, 0) as hiz,
    l.taxonomy_id,
    ntile($bands) over (order by v.price_amount) as bant
  from v_listing_velocity v
  join v_latest_snapshot s
    on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
  join listings l on l.listing_id = v.listing_id
  where v.niche_id = $niche and v.price_amount is not null
`;

export async function getPriceDemandCurve(
  db: Db,
  nicheId: string,
  bandCount = 10,
): Promise<PriceBand[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with bantli as (${BANTLI_GOZLEM})
     select bant,
            min(price_amount) as min_price,
            max(price_amount) as max_price,
            count(*)          as supply,
            sum(hiz)          as demand
       from bantli
      group by bant
      order by bant`,
    { niche: nicheId, bands: bandCount },
  );

  return rows.map((row) => {
    const supply = Number(row.supply);
    const demand = Number(row.demand);
    return {
      band: Number(row.bant),
      minPrice: Number(row.min_price),
      maxPrice: Number(row.max_price),
      supply,
      demand,
      demandPerListing: supply === 0 ? 0 : demand / supply,
    };
  });
}

export async function getGapMatrix(
  db: Db,
  nicheId: string,
  bandCount = 5,
): Promise<GapCell[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with bantli as (${BANTLI_GOZLEM})
     select b.taxonomy_id,
            t.full_path,
            b.bant,
            count(*) as supply,
            sum(b.hiz) as demand
       from bantli b
       left join taxonomy_nodes t on t.taxonomy_id = b.taxonomy_id
      group by b.taxonomy_id, t.full_path, b.bant
      order by sum(b.hiz) / count(*) desc, b.bant`,
    { niche: nicheId, bands: bandCount },
  );

  return rows.map((row) => {
    const supply = Number(row.supply);
    const demand = Number(row.demand);
    return {
      taxonomyId: row.taxonomy_id === null ? null : Number(row.taxonomy_id),
      taxonomyPath: row.full_path === null ? null : String(row.full_path),
      band: Number(row.bant),
      supply,
      demand,
      ratio: supply === 0 ? 0 : demand / supply,
    };
  });
}
```

- [ ] **Step 4: Testi çalıştır ve commit**

Run: `pnpm vitest run packages/core/test/pricing.test.ts`
Expected: PASS — 6 test.

```bash
git add -A && git commit -m "feat: fiyat-talep egrisi ve bosluk matrisi"
```

---

## Task 6: Etiket fırsat kadranı

**Files:**
- Create: `packages/core/src/analysis/tags.ts`
- Test: `packages/core/test/tags.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces: `getTagQuadrant(db, nicheId, minListings?): Promise<TagRow[]>`
  — `TagRow = { tag: string; usageCount: number; avgVelocity: number; quadrant: 'firsat' | 'doymus' | 'dusuk-getiri' | 'nis' }`

**Kadran tanımı:** `usageCount` ve `avgVelocity` medyanlarına göre bölünür.
- `firsat` — hız medyanın üstünde, kullanım medyanın altında (aranan kadran)
- `doymus` — ikisi de medyanın üstünde
- `dusuk-getiri` — kullanım üstte, hız altta
- `nis` — ikisi de altta

- [ ] **Step 1: Failing test yaz**

`packages/core/test/tags.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { getTagQuadrant } from '../src/analysis/tags.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('etiket fırsat kadranı', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('gürültü filtresini uygular', async () => {
    // Seed'de hiçbir etiket 5 listing'de geçmiyor.
    expect(await getTagQuadrant(db, nicheId, 5)).toEqual([]);
  });

  it('eşik düşürülünce etiketleri döndürür', async () => {
    const etiketler = await getTagQuadrant(db, nicheId, 1);
    expect(etiketler.map((t) => t.tag).sort()).toEqual(['a', 'b', 'c']);
  });

  it('etiket başına ortalama hızı hesaplar', async () => {
    const etiketler = await getTagQuadrant(db, nicheId, 1);
    // 'a' etiketi L1 (10/gün) ve L2 (1/gün) -> ortalama 5.5
    expect(etiketler.find((t) => t.tag === 'a')?.avgVelocity).toBeCloseTo(5.5);
    // 'b' yalnızca L1 -> 10
    expect(etiketler.find((t) => t.tag === 'b')?.avgVelocity).toBeCloseTo(10);
  });

  it('kullanım sayısını verir', async () => {
    const etiketler = await getTagQuadrant(db, nicheId, 1);
    expect(etiketler.find((t) => t.tag === 'a')?.usageCount).toBe(2);
    expect(etiketler.find((t) => t.tag === 'c')?.usageCount).toBe(2);
  });

  it('her etikete bir kadran atar', async () => {
    const etiketler = await getTagQuadrant(db, nicheId, 1);
    const gecerli = ['firsat', 'doymus', 'dusuk-getiri', 'nis'];
    for (const t of etiketler) expect(gecerli).toContain(t.quadrant);
  });

  it('hıza göre azalan sıralar', async () => {
    const etiketler = await getTagQuadrant(db, nicheId, 1);
    const hizlar = etiketler.map((t) => t.avgVelocity);
    expect([...hizlar].sort((a, b) => b - a)).toEqual(hizlar);
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/tags.test.ts`
Expected: FAIL — modül yok.

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/analysis/tags.ts`:
```ts
import type { Db } from '../db/connection.js';

export type TagQuadrant = 'firsat' | 'doymus' | 'dusuk-getiri' | 'nis';

export interface TagRow {
  tag: string;
  usageCount: number;
  avgVelocity: number;
  quadrant: TagQuadrant;
}

export async function getTagQuadrant(
  db: Db,
  nicheId: string,
  minListings = 5,
): Promise<TagRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with son_gozlem as (
       select v.listing_id, coalesce(v.favorite_velocity, 0) as hiz
         from v_listing_velocity v
         join v_latest_snapshot s
           on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
        where v.niche_id = $niche
     ),
     etiket as (
       select t.tag,
              count(*)      as kullanim,
              avg(g.hiz)    as ort_hiz
         from listing_tags t
         join son_gozlem g on g.listing_id = t.listing_id
        group by t.tag
       having count(*) >= $minListings
     )
     select tag, kullanim, ort_hiz,
            median(kullanim) over ()  as medyan_kullanim,
            median(ort_hiz)  over ()  as medyan_hiz
       from etiket
      order by ort_hiz desc, tag`,
    { niche: nicheId, minListings },
  );

  return rows.map((row) => {
    const usageCount = Number(row.kullanim);
    const avgVelocity = Number(row.ort_hiz);
    const medyanKullanim = Number(row.medyan_kullanim);
    const medyanHiz = Number(row.medyan_hiz);

    const hizYuksek = avgVelocity >= medyanHiz;
    const kullanimYuksek = usageCount >= medyanKullanim;

    let quadrant: TagQuadrant;
    if (hizYuksek && !kullanimYuksek) quadrant = 'firsat';
    else if (hizYuksek && kullanimYuksek) quadrant = 'doymus';
    else if (!hizYuksek && kullanimYuksek) quadrant = 'dusuk-getiri';
    else quadrant = 'nis';

    return { tag: String(row.tag), usageCount, avgVelocity, quadrant };
  });
}
```

- [ ] **Step 4: Testi çalıştır ve commit**

Run: `pnpm vitest run packages/core/test/tags.test.ts`
Expected: PASS — 6 test.

```bash
git add -A && git commit -m "feat: etiket firsat kadrani"
```

---

## Task 7: Satıcı tablosu ve konsantrasyon

**Files:**
- Create: `packages/core/src/analysis/sellers.ts`
- Test: `packages/core/test/sellers.test.ts`

**Interfaces:**
- Consumes: Task 2
- Produces:
  - `getSellerTable(db, nicheId, limit?): Promise<SellerRow[]>`
    — `SellerRow = { shopId: number; shopName: string | null; listingCount: number; totalFavorers: number; avgVelocity: number | null; reviewAverage: number | null }`
  - `getConcentration(db, nicheId): Promise<Concentration | null>`
    — `Concentration = { sellerCount: number; top10Share: number; hhi: number }`

**HHI:** her satıcının listing payının karelerinin toplamı (0–1 arası; 1'e yakın = tekel).

- [ ] **Step 1: Failing test yaz**

`packages/core/test/sellers.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { getConcentration, getSellerTable } from '../src/analysis/sellers.js';
import { seedTwoSnapshots } from './helpers/seed.js';

describe('satıcı analizi', () => {
  let db: Db;
  let nicheId: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ nicheId } = await seedTwoSnapshots(db));
  });

  it('satıcıları listing sayısına göre sıralar', async () => {
    const saticilar = await getSellerTable(db, nicheId);
    expect(saticilar[0]?.shopId).toBe(1);
    expect(saticilar[0]?.listingCount).toBe(2);
  });

  it('satıcı adını ve yorum ortalamasını taşır', async () => {
    const saticilar = await getSellerTable(db, nicheId);
    expect(saticilar[0]?.shopName).toBe('Shop Bir');
    expect(saticilar[0]?.reviewAverage).toBeCloseTo(4.9);
  });

  it('satıcı bazında ortalama hızı hesaplar', async () => {
    const saticilar = await getSellerTable(db, nicheId);
    // Shop 1: L1 (10) ve L2 (1) -> 5.5
    expect(saticilar[0]?.avgVelocity).toBeCloseTo(5.5);
  });

  it('konsantrasyonu hesaplar', async () => {
    const k = await getConcentration(db, nicheId);
    expect(k?.sellerCount).toBe(3);
    // Paylar 2/4, 1/4, 1/4 -> HHI = 0.25 + 0.0625 + 0.0625 = 0.375
    expect(k?.hhi).toBeCloseTo(0.375);
  });

  it('az satıcıda top10 payı tam 1 olur', async () => {
    const k = await getConcentration(db, nicheId);
    expect(k?.top10Share).toBeCloseTo(1);
  });

  it('bilinmeyen niş için null döner', async () => {
    expect(await getConcentration(db, 'yok')).toBeNull();
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run packages/core/test/sellers.test.ts`
Expected: FAIL — modül yok.

- [ ] **Step 3: Implementasyonu yaz**

`packages/core/src/analysis/sellers.ts`:
```ts
import type { Db } from '../db/connection.js';

export interface SellerRow {
  shopId: number;
  shopName: string | null;
  listingCount: number;
  totalFavorers: number;
  avgVelocity: number | null;
  reviewAverage: number | null;
}

export interface Concentration {
  sellerCount: number;
  top10Share: number;
  hhi: number;
}

const SON_GOZLEM = `
  select v.listing_id, v.num_favorers, v.favorite_velocity, l.shop_id
    from v_listing_velocity v
    join v_latest_snapshot s
      on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
    join listings l on l.listing_id = v.listing_id
   where v.niche_id = $niche and l.shop_id is not null
`;

export async function getSellerTable(
  db: Db,
  nicheId: string,
  limit = 25,
): Promise<SellerRow[]> {
  const rows = await db.query<Record<string, unknown>>(
    `with g as (${SON_GOZLEM})
     select g.shop_id,
            sh.shop_name,
            count(*)                              as listing_count,
            sum(coalesce(g.num_favorers, 0))      as total_favorers,
            avg(g.favorite_velocity)              as avg_velocity,
            max(so.review_average)                as review_average
       from g
       left join shops sh on sh.shop_id = g.shop_id
       left join shop_observations so
         on so.shop_id = g.shop_id
        and so.snapshot_id = (select snapshot_id from v_latest_snapshot where niche_id = $niche)
      group by g.shop_id, sh.shop_name
      order by listing_count desc, g.shop_id
      limit $limit`,
    { niche: nicheId, limit },
  );

  return rows.map((row) => ({
    shopId: Number(row.shop_id),
    shopName: row.shop_name === null ? null : String(row.shop_name),
    listingCount: Number(row.listing_count),
    totalFavorers: Number(row.total_favorers),
    avgVelocity: row.avg_velocity === null ? null : Number(row.avg_velocity),
    reviewAverage: row.review_average === null ? null : Number(row.review_average),
  }));
}

export async function getConcentration(
  db: Db,
  nicheId: string,
): Promise<Concentration | null> {
  const rows = await db.query<Record<string, unknown>>(
    `with g as (${SON_GOZLEM}),
     pay as (
       select shop_id,
              count(*) as adet,
              count(*) * 1.0 / sum(count(*)) over () as oran
         from g
        group by shop_id
     ),
     sirali as (
       select oran, row_number() over (order by oran desc) as sira from pay
     )
     select (select count(*) from pay)                                as seller_count,
            (select coalesce(sum(oran), 0) from sirali where sira <= 10) as top10_share,
            (select coalesce(sum(pow(oran, 2)), 0) from pay)          as hhi`,
    { niche: nicheId },
  );

  const row = rows[0];
  if (row === undefined || Number(row.seller_count) === 0) return null;

  return {
    sellerCount: Number(row.seller_count),
    top10Share: Number(row.top10_share),
    hhi: Number(row.hhi),
  };
}
```

- [ ] **Step 4: Testi çalıştır ve commit**

Run: `pnpm vitest run packages/core/test/sellers.test.ts`
Expected: PASS — 6 test.

```bash
git add -A && git commit -m "feat: satici tablosu ve konsantrasyon"
```

---

## Task 8: Rapor komutu ve Docker doğrulaması

**Files:**
- Create: `apps/cli/src/report.ts`
- Modify: `apps/cli/src/index.ts`, `packages/core/src/index.ts`, `package.json`, `README.md`
- Test: `apps/cli/test/report.test.ts`

**Interfaces:**
- Consumes: Task 3–7
- Produces:
  - `formatReport(data: ReportData): string`
  - CLI: `pnpm report --niche <id>`

**Veri yetersizliği kuralı:** niş için tek snapshot varsa rapor hız bölümlerini
basmaz, bunun yerine tek satırlık bir uyarı yazar. Bu, kullanıcının boş tabloya
bakıp analizin bozuk olduğunu sanmasını engeller.

- [ ] **Step 1: Failing test yaz**

`apps/cli/test/report.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { formatReport } from '../src/report.js';

const bosVeri = {
  nicheName: 'Test niş',
  snapshotCount: 1,
  overview: null,
  freshness: null,
  series: [],
  risers: [],
  bands: [],
  gaps: [],
  tags: [],
  sellers: [],
  concentration: null,
  reviews: { ratingDistribution: [], lowRated: [] },
};

describe('formatReport', () => {
  it('niş adını başlığa koyar', () => {
    expect(formatReport(bosVeri)).toContain('Test niş');
  });

  it('tek snapshot varken hız analizlerinin ölçülemediğini söyler', () => {
    const cikti = formatReport(bosVeri);
    expect(cikti).toContain('en az iki snapshot');
  });

  it('iki snapshot varken uyarıyı basmaz', () => {
    const cikti = formatReport({ ...bosVeri, snapshotCount: 2 });
    expect(cikti).not.toContain('en az iki snapshot');
  });

  it('pazar görünümü sayılarını basar', () => {
    const cikti = formatReport({
      ...bosVeri,
      snapshotCount: 2,
      overview: {
        listingCount: 100,
        sellerCount: 81,
        medianPrice: 16.19,
        p25Price: 10.83,
        p75Price: 21.9,
        avgVelocity: 1.5,
        totalFavorers: 4200,
      },
    });
    expect(cikti).toContain('100');
    expect(cikti).toContain('16.19');
  });

  it('fırsat kadranındaki etiketleri ayrıca vurgular', () => {
    const cikti = formatReport({
      ...bosVeri,
      snapshotCount: 2,
      tags: [
        { tag: 'custom name mug', usageCount: 5, avgVelocity: 104, quadrant: 'firsat' as const },
      ],
    });
    expect(cikti).toContain('custom name mug');
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run apps/cli/test/report.test.ts`
Expected: FAIL — modül yok.

- [ ] **Step 3: Rapor biçimlendiricisini yaz**

`apps/cli/src/report.ts`:
```ts
import type {
  Concentration,
  Freshness,
  GapCell,
  MarketOverview,
  PriceBand,
  ReviewStats,
  RiserRow,
  SellerRow,
  TagRow,
  VelocityPoint,
} from '@etsy-analysis/core';

export interface ReportData {
  nicheName: string;
  snapshotCount: number;
  overview: MarketOverview | null;
  freshness: Freshness | null;
  series: VelocityPoint[];
  risers: RiserRow[];
  bands: PriceBand[];
  gaps: GapCell[];
  tags: TagRow[];
  sellers: SellerRow[];
  concentration: Concentration | null;
  reviews: ReviewStats;
}

const para = (value: number | null): string =>
  value === null ? '—' : value.toFixed(2);
const sayi = (value: number | null, basamak = 2): string =>
  value === null ? '—' : value.toFixed(basamak);

function baslik(metin: string): string {
  return `\n${metin}\n${'─'.repeat(metin.length)}`;
}

export function formatReport(data: ReportData): string {
  const satirlar: string[] = [`Niş: ${data.nicheName}`];

  if (data.snapshotCount < 2) {
    satirlar.push(
      '',
      `Uyarı: bu nişte ${String(data.snapshotCount)} snapshot var.`,
      'Favori hızına dayanan analizler için en az iki snapshot gerekiyor;',
      'aşağıdaki hız değerleri ölçülemedi.',
    );
  }

  if (data.overview !== null) {
    const o = data.overview;
    satirlar.push(
      baslik('Pazar görünümü'),
      `  listing            ${String(o.listingCount)}`,
      `  satıcı             ${String(o.sellerCount)}`,
      `  medyan fiyat       ${para(o.medianPrice)}`,
      `  fiyat aralığı      ${para(o.p25Price)} – ${para(o.p75Price)} (p25–p75)`,
      `  toplam favori      ${String(o.totalFavorers)}`,
      `  ort. favori hızı   ${sayi(o.avgVelocity)} /gün`,
    );
  }

  if (data.freshness !== null) {
    const f = data.freshness;
    satirlar.push(
      baslik('Tazelik'),
      `  medyan yaş         ${sayi(f.medianAgeDays, 0)} gün`,
      `  son 30 günde yeni  ${String(f.newLast30Days)}`,
      `  son 90 günde yeni  ${String(f.newLast90Days)}`,
    );
  }

  if (data.risers.length > 0) {
    satirlar.push(baslik('En hızlı yükselen listingler'));
    for (const r of data.risers.slice(0, 10)) {
      satirlar.push(
        `  ${sayi(r.velocity).padStart(8)} /gün  ${para(r.price).padStart(8)}  ` +
          `${(r.title ?? '(başlıksız)').slice(0, 52)}`,
      );
    }
  }

  if (data.bands.length > 0) {
    satirlar.push(baslik('Fiyat–talep eğrisi'));
    satirlar.push('  bant      fiyat aralığı      arz    talep   talep/listing');
    for (const b of data.bands) {
      satirlar.push(
        `  ${String(b.band).padStart(4)}  ${para(b.minPrice).padStart(8)}–${para(b.maxPrice).padEnd(8)}` +
          `${String(b.supply).padStart(5)}  ${sayi(b.demand).padStart(7)}  ${sayi(b.demandPerListing).padStart(10)}`,
      );
    }
  }

  const firsatlar = data.tags.filter((t) => t.quadrant === 'firsat');
  if (firsatlar.length > 0) {
    satirlar.push(
      baslik('Etiket fırsatları (yüksek hız, düşük kullanım)'),
    );
    for (const t of firsatlar.slice(0, 10)) {
      satirlar.push(
        `  ${sayi(t.avgVelocity).padStart(8)} /gün  ${String(t.usageCount).padStart(4)} listing  ${t.tag}`,
      );
    }
  }

  if (data.gaps.length > 0) {
    satirlar.push(baslik('Boşluk matrisi (en yüksek talep/arz oranı)'));
    for (const g of data.gaps.slice(0, 8)) {
      satirlar.push(
        `  oran ${sayi(g.ratio).padStart(7)}  bant ${String(g.band)}  arz ${String(g.supply).padStart(4)}  ` +
          `${(g.taxonomyPath ?? String(g.taxonomyId ?? '—')).slice(0, 48)}`,
      );
    }
  }

  if (data.sellers.length > 0) {
    satirlar.push(baslik('Satıcılar'));
    for (const s of data.sellers.slice(0, 10)) {
      satirlar.push(
        `  ${String(s.listingCount).padStart(3)} listing  ${sayi(s.avgVelocity).padStart(8)} /gün  ` +
          `puan ${sayi(s.reviewAverage, 1).padStart(4)}  ${s.shopName ?? String(s.shopId)}`,
      );
    }
  }

  if (data.concentration !== null) {
    const c = data.concentration;
    satirlar.push(
      baslik('Rekabet yoğunluğu'),
      `  satıcı sayısı      ${String(c.sellerCount)}`,
      `  top-10 payı        ${(c.top10Share * 100).toFixed(1)}%`,
      `  HHI                ${sayi(c.hhi, 4)}`,
    );
  }

  if (data.reviews.ratingDistribution.length > 0) {
    satirlar.push(baslik('Yorumlar'));
    for (const r of data.reviews.ratingDistribution) {
      satirlar.push(`  ${String(r.rating)} yıldız  ${String(r.count)}`);
    }
    if (data.reviews.lowRated.length > 0) {
      satirlar.push('', '  Düşük puanlı yorumlardan örnekler:');
      for (const r of data.reviews.lowRated.slice(0, 5)) {
        satirlar.push(`    (${String(r.rating)}) ${r.text.slice(0, 70)}`);
      }
    }
  }

  return satirlar.join('\n');
}
```

- [ ] **Step 4: Analiz tiplerini core'dan dışa aç**

`packages/core/src/index.ts` sonuna ekle:
```ts
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
  getGapMatrix,
  type PriceBand,
  type GapCell,
} from './analysis/pricing.js';
export { getTagQuadrant, type TagRow, type TagQuadrant } from './analysis/tags.js';
export {
  getSellerTable,
  getConcentration,
  type SellerRow,
  type Concentration,
} from './analysis/sellers.js';
```

- [ ] **Step 5: CLI'a report komutunu ekle**

`apps/cli/src/index.ts` içinde `parseArgs`'ı iki komutu kabul edecek şekilde genişlet
(`'snapshot' | 'report'`); `report` yalnızca `--niche` ister. `main` içinde komuta göre
dallan ve `report` dalında `formatReport(...)` çıktısını `process.stdout.write` ile bas.
Rapor için gereken tüm analizleri `Promise.all` ile paralel çağır.

`package.json` scripts'e ekle:
```json
    "report": "tsx apps/cli/src/index.ts report",
```

- [ ] **Step 6: Tüm testleri ve typecheck'i çalıştır**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Yerelde gerçek veriyle doğrula**

```bash
rm -f data/etsy.duckdb          # eski şema; yeniden üretilecek
pnpm snapshot --niche ceramic-mug --name "Ceramic mugs" --keywords "ceramic mug" \
  --max-pages 1 --max-shops 5 --max-review-listings 5
pnpm report --niche ceramic-mug
```
Expected: rapor basılır; tek snapshot olduğu için hız uyarısı görünür, fiyat ve
satıcı bölümleri gerçek sayılar taşır.

İkinci snapshot alınıp rapor tekrar çalıştırıldığında uyarı kaybolur ve hız
bölümleri dolar.

- [ ] **Step 8: Docker'da doğrula**

```bash
docker compose build
docker compose run --rm cli report --niche ceramic-mug
```
Expected: aynı rapor, aynı sayılar (volume paylaşıldığı için host'takiyle aynı veri).

- [ ] **Step 9: README'yi güncelle ve commit**

README'ye `pnpm report` kullanımını ve iki-snapshot kuralını ekle.

```bash
git add -A && git commit -m "feat: rapor komutu ve Faz 1 analiz katmani"
```

---

## Faz 1 bitti sayılma ölçütü

- [ ] `pnpm test` yeşil, ağ erişimi yok
- [ ] `pnpm typecheck` temiz
- [ ] `pnpm report --niche <id>` sekiz analizin tamamını gerçek veriyle basıyor
- [ ] Tek snapshot'lı nişte rapor boş tablo yerine açık bir uyarı veriyor
- [ ] `docker compose run --rm cli report --niche <id>` aynı çıktıyı veriyor
- [ ] Snapshot'lar `sort_on=score` ile alınıyor ve `original_creation_timestamp` saklanıyor

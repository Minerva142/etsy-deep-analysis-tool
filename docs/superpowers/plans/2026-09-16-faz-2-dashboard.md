# Faz 2 — Dashboard Implementasyon Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faz 1'in sekiz analizini tarayıcıda okunabilir kılan, beş ekranlı bir Next.js dashboard'u; yerelde ve Docker'da çalışır.

**Architecture:** Next.js App Router, yalnızca server component. Veri `@etsy-analysis/core`'dan doğrudan çağrılır — API katmanı yok, client'a veri fetch'i yok. Grafikler elle yazılmış satır içi SVG; grafik kütüphanesi yok. Etkileşim için tek bir küçük client component (hover tooltip).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, `@duckdb/node-api` (server-only), IBM Plex Sans.

**Spec:** `docs/superpowers/specs/2026-09-16-etsy-deep-analysis-tool-design.md` §7

**Önceki planlar:** Faz 0 `2026-09-16-faz-0-veri-boru-hatti.md`, Faz 1 `2026-09-16-faz-1-analiz-katmani.md`

## Uygulama notu — Next.js bırakıldı

Bu plan Next.js ile yazıldı; implementasyon sırasında Next bırakılıp yerine
düz bir Node HTTP sunucusu kondu. Sebep: panelin işi yerel bir DuckDB
dosyasını okuyup HTML basmak. Next bunun için hiçbir şey katmadı ama bir
bundler getirdi ve karşılaşılan engellerin **tamamı** bundler kaynaklıydı:

- native DuckDB modülünü paketlemeye çalışması (`serverExternalPackages`
  yetmedi, webpack externals gerekti)
- core'un Node ESM `.js` uzantılarını çözememesi (`extensionAlias` gerekti)
- `transpilePackages` ile external işaretlemesinin çakışması
- `migrate`'in şema dosyasını modül yolundan okumasının bundle sonrası
  çalışmaması
- derleme adımının Windows'ta pipe'lı çalıştırmada kilitlenmesi

Düz sunucuda bunların hiçbiri yok: derleme adımı yok, `tsx` ile CLI'ın
çalıştığı gibi çalışıyor. Tasarım kararları (palet, tipografi, beş ekran,
ölçüldü/ölçülemedi ayrımı) aynen korundu.

**Gerçekleşen dosya yapısı:**

| Dosya | Sorumluluk |
|---|---|
| `apps/web/src/sunucu.ts` | node:http sunucusu ve yönlendirme |
| `apps/web/src/sayfalar.ts` | Beş ekran |
| `apps/web/src/grafikler.ts` | Dört SVG grafik + ölçek fonksiyonları |
| `apps/web/src/html.ts` | Kabuk, kaçış, `deger()`, `olculemediBolumu()` |
| `apps/web/src/stil.css` | Tasarım token'ları |
| `apps/web/src/lib/{db,format}.ts` | Veri erişimi ve biçimlendirme |

Ayrıca iki çekirdek düzeltme gerekti:

- `openDb` DuckDB **instance**'ını hiç kapatmıyordu; yalnızca bağlantı
  kapanıyor, dosya kilidi süreçte kalıyordu. Tek seferlik CLI koşusunda fark
  etmiyordu, istek başına açan sunucuda ilk istekten sonrasını bozdu.
- Panel için `openDb(path, { readOnly: true })` eklendi.
- `@etsy-analysis/core/analysis` alt giriş noktası: panelin Etsy HTTP
  istemcisine ve ingest job'larına ihtiyacı yok.

---

## Global Constraints

- Faz 0/1 kısıtları geçerli (Node >= 20.17, ESM, `strict: true`, testler ağa çıkmaz).
- **Veri yalnızca server component'te okunur.** DuckDB native modül; client'a sızarsa build kırılır. `next.config.ts` içinde `serverExternalPackages: ['@duckdb/node-api']`.
- **Her sayfa `dynamic = 'force-dynamic'`.** Veri build sırasında değil istek anında okunur; snapshot alındığında sayfa tazelenmeli.
- **Grafik kütüphanesi yok.** Satır içi SVG; mark ölçüleri dataviz rehberine uyar (2px çizgi, >=8px işaretçi, 4px yuvarlatılmış veri ucu, saç teli grid).
- **Ölçülemeyen değer uydurulmaz.** `null` gelen her sayı soluk tire (`—`) olarak basılır; hız bölümleri tek snapshot varken bölüm olarak gizlenir, yerine tek satır sebep yazılır.
- **Tek aksan rengi kuralı:** `#eb6834` yalnızca fırsat işareti. Başka hiçbir öğe bu rengi kullanmaz.

## Doğrulanmış renk paleti

`dataviz/scripts/validate_palette.js` ile ölçüldü (2026-09-16), her iki mod all-pairs geçti:

| Rol | Light | Dark | Not |
|---|---|---|---|
| Seri 1 / birincil | `#2a78d6` | `#3987e5` | mavi |
| Fırsat aksanı | `#eb6834` | `#d95926` | **yalnızca fırsat** |
| Seri 3 | `#1baf7a` | `#199e70` | ışıkta kontrast 2.74 → **doğrudan etiket + tablo zorunlu** |
| Isı haritası | mavi ramp `#cde2fb` → `#0d366b` | aynı | sequential, tek hue |

Sayfa düzlemi `#eef1ed` (light) / `#0d0d0d` (dark). Kart/grafik yüzeyi `#fcfcfb` / `#1a1a19`.
Mürekkep `#0b0b0b` / `#ffffff`, ikincil `#52514e` / `#c3c2b7`, soluk `#898781`, grid `#e1e0d9` / `#2c2c2a`.

---

## Dosya Yapısı

| Dosya | Sorumluluk |
|---|---|
| `apps/web/next.config.ts` | `serverExternalPackages`, transpile ayarı |
| `apps/web/src/lib/db.ts` | İstek başına DuckDB bağlantısı açıp kapatan yardımcı |
| `apps/web/src/app/layout.tsx` | Kabuk: sol raf navigasyon, tema token'ları |
| `apps/web/src/app/globals.css` | Token'lar, tipografi, temel düzen |
| `apps/web/src/app/page.tsx` | **Nişler** ekranı |
| `apps/web/src/app/nis/[id]/page.tsx` | **Niş Özeti** |
| `apps/web/src/app/nis/[id]/firsatlar/page.tsx` | **Fırsatlar** |
| `apps/web/src/app/nis/[id]/rakipler/page.tsx` | **Rakipler** |
| `apps/web/src/app/nis/[id]/listingler/page.tsx` | **Listing Gezgini** |
| `apps/web/src/components/Deger.tsx` | Ölçüldü/ölçülemedi ayrımını basan tek öğe |
| `apps/web/src/components/Olculemedi.tsx` | Bölüm yerine geçen açıklama bloğu |
| `apps/web/src/components/charts/*.tsx` | Dört grafik, satır içi SVG |
| `apps/web/src/components/charts/Tooltip.tsx` | Tek client component |

---

## Task 1: Next.js iskeleti ve veri erişimi

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`
- Create: `apps/web/src/lib/db.ts`, `apps/web/src/lib/format.ts`
- Modify: `package.json` (scripts), `tsconfig.json` (references)
- Test: `apps/web/test/format.test.ts`

**Interfaces:**
- Produces:
  - `withDb<T>(fn: (db: Db) => Promise<T>): Promise<T>` — bağlantıyı açar, işi yapar, her durumda kapatır
  - `sayi(value: number | null, basamak?: number): string` ve `para(value: number | null): string` — `null` → `'—'`

- [ ] **Step 1: Failing test yaz**

`apps/web/test/format.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { para, sayi, yuzde } from '../src/lib/format.js';

describe('biçimlendirme', () => {
  it('ölçülemeyen değeri tire olarak basar', () => {
    expect(sayi(null)).toBe('—');
    expect(para(null)).toBe('—');
    expect(yuzde(null)).toBe('—');
  });

  it('sayıyı istenen basamağa yuvarlar', () => {
    expect(sayi(3.14159, 2)).toBe('3.14');
    expect(sayi(10, 0)).toBe('10');
  });

  it('parayı iki basamakla basar', () => {
    expect(para(29.5)).toBe('29.50');
  });

  it('oranı yüzdeye çevirir', () => {
    expect(yuzde(0.375)).toBe('37.5%');
  });

  it('sıfırı tire ile karıştırmaz', () => {
    // 0 ölçülmüş bir değerdir; ölçülemeyenden ayrılmalı.
    expect(sayi(0)).toBe('0.00');
  });
});
```

- [ ] **Step 2: Testi çalıştır, başarısız olduğunu gör**

Run: `pnpm vitest run apps/web/test/format.test.ts`
Expected: FAIL — modül yok.

- [ ] **Step 3: Paket ve yapılandırma dosyalarını yaz**

`apps/web/package.json`:
```json
{
  "name": "@etsy-analysis/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "@etsy-analysis/core": "workspace:*",
    "next": "^15.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0"
  }
}
```

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from 'next';

const config: NextConfig = {
  // DuckDB native bir modül; Next'in bundle'ına girerse build kırılır.
  serverExternalPackages: ['@duckdb/node-api'],
  transpilePackages: ['@etsy-analysis/core'],
};

export default config;
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": false,
    "declaration": false,
    "jsx": "preserve",
    "lib": ["DOM", "DOM.Iterable", "ES2023"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "allowJs": true,
    "incremental": true
  },
  "include": ["src", "next-env.d.ts", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Kök `tsconfig.json`'a referans **eklenmez** — Next kendi typecheck'ini yapar ve `noEmit` proje referanslarıyla çakışır.

- [ ] **Step 4: Veri ve biçim yardımcılarını yaz**

`apps/web/src/lib/db.ts`:
```ts
import { loadConfig, loadDotEnvIfPresent, migrate, openDb, type Db } from '@etsy-analysis/core';

/**
 * İstek başına bir bağlantı açar ve her durumda kapatır.
 *
 * DuckDB dosyasını uzun süre açık tutmak, CLI'ın aynı dosyaya yazmasını
 * engelliyor; dashboard okurken snapshot alınabilmeli.
 */
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  loadDotEnvIfPresent();
  const config = loadConfig(process.env);
  const db = await openDb(config.duckdbPath);
  try {
    await migrate(db);
    return await fn(db);
  } finally {
    await db.close();
  }
}
```

`apps/web/src/lib/format.ts`:
```ts
/** Ölçülemeyen değerin tek gösterimi. Sıfırdan ayrılır: 0 ölçülmüş bir değerdir. */
export const OLCULEMEDI = '—';

export function sayi(value: number | null | undefined, basamak = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return OLCULEMEDI;
  return value.toFixed(basamak);
}

export function para(value: number | null | undefined): string {
  return sayi(value, 2);
}

export function yuzde(value: number | null | undefined, basamak = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return OLCULEMEDI;
  return `${(value * 100).toFixed(basamak)}%`;
}

export function tamsayi(value: number | null | undefined): string {
  return sayi(value, 0);
}
```

- [ ] **Step 5: Kök script'leri ekle**

`package.json` scripts'e:
```json
    "dev": "pnpm --filter @etsy-analysis/web dev",
    "build:web": "pnpm --filter @etsy-analysis/web build",
    "start:web": "pnpm --filter @etsy-analysis/web start",
```

`vitest.config.ts` include listesine `apps/web/test/**/*.test.ts` zaten kapsanıyor (`apps/*/test/**`).

- [ ] **Step 6: Testi çalıştır ve commit**

Run: `pnpm install && pnpm vitest run apps/web/test/format.test.ts`
Expected: PASS — 5 test.

```bash
git add -A && git commit -m "feat: Next.js iskeleti ve veri erisim katmani"
```

---

## Task 2: Kabuk, tasarım token'ları ve ölçüm öğeleri

**Files:**
- Create: `apps/web/src/app/layout.tsx`, `apps/web/src/app/globals.css`
- Create: `apps/web/src/components/Deger.tsx`, `apps/web/src/components/Olculemedi.tsx`
- Test: `apps/web/test/deger.test.tsx` *(render testi yok — bileşenler saf; test yerine typecheck yeterli)*

**Interfaces:**
- Produces:
  - `<Deger value={number|null} tip="para"|"sayi"|"yuzde"|"tamsayi" birim?={string} />`
  - `<Olculemedi baslik={string} sebep={string} />`

**Tasarım kararları** (uygulanacak, tartışılmayacak):
- Sayfa düzlemi `#eef1ed`; kartlar `#fcfcfb` yüzey + `1px` saç teli kenarlık. **Gölge yok.**
- Tek aile: IBM Plex Sans (400/500/600). Başlıklarda ayrı serif yok.
- Sayı sütunlarında `font-variant-numeric: tabular-nums`.
- ALL-CAPS etiket yok, orta nokta ayraç yok, bağlantı metninde `→` yok.
- Aksan `#eb6834` yalnızca fırsat bağlamında.
- Sol raf navigasyon: araç tekrar tekrar açılıyor, gezinme kalıcı olmalı.

- [ ] **Step 1: globals.css yaz**

Token'lar `:root` üzerinde light, `@media (prefers-color-scheme: dark)` ve `:root[data-theme="dark"]` altında dark. Yukarıdaki palet tablosundaki değerler birebir kullanılır.

```css
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap');

:root {
  --plane: #eef1ed;
  --surface: #fcfcfb;
  --ink: #0b0b0b;
  --ink-2: #52514e;
  --ink-muted: #898781;
  --hairline: #d9ddd7;
  --grid: #e1e0d9;
  --seri-1: #2a78d6;
  --firsat: #eb6834;
  --seri-3: #1baf7a;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --plane: #0d0d0d;
    --surface: #1a1a19;
    --ink: #ffffff;
    --ink-2: #c3c2b7;
    --hairline: #2c2c2a;
    --grid: #2c2c2a;
    --seri-1: #3987e5;
    --firsat: #d95926;
    --seri-3: #199e70;
    color-scheme: dark;
  }
}

:root[data-theme='dark'] { /* aynı dark blok */ }

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--plane);
  color: var(--ink);
  font-family: 'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
  font-size: 14px;
  line-height: 1.55;
}

.kabuk { display: grid; grid-template-columns: 220px 1fr; min-height: 100vh; }
.raf { border-right: 1px solid var(--hairline); padding: 24px 16px; }
.icerik { padding: 32px 40px; max-width: 1180px; }

.kart {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 3px;
  padding: 20px 22px;
}

.sayi { font-variant-numeric: tabular-nums; }
.olculemedi { color: var(--ink-muted); }

table { border-collapse: collapse; width: 100%; }
th { text-align: left; font-weight: 500; color: var(--ink-2); }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
tr + tr td { border-top: 1px solid var(--grid); }

a { color: var(--seri-1); }
:focus-visible { outline: 2px solid var(--seri-1); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}

@media (max-width: 860px) {
  .kabuk { grid-template-columns: 1fr; }
  .raf { border-right: 0; border-bottom: 1px solid var(--hairline); }
  .icerik { padding: 20px; }
}
```

- [ ] **Step 2: Ölçüm öğelerini yaz**

`apps/web/src/components/Deger.tsx`:
```tsx
import { para, sayi, tamsayi, yuzde } from '../lib/format.js';

type Tip = 'para' | 'sayi' | 'yuzde' | 'tamsayi';

const bicimleyici: Record<Tip, (v: number | null) => string> = {
  para,
  sayi: (v) => sayi(v),
  yuzde,
  tamsayi,
};

/**
 * Ölçülen değeri tam mürekkeple, ölçülemeyeni soluk tireyle basar.
 * Bu ayrım arayüzün taşıyıcı öğesi: araç ölçemediği şeyi uydurmaz.
 */
export function Deger({
  value,
  tip = 'sayi',
  birim,
}: {
  value: number | null;
  tip?: Tip;
  birim?: string;
}): React.JSX.Element {
  const olculdu = value !== null && Number.isFinite(value);
  const metin = bicimleyici[tip](value);
  return (
    <span className={olculdu ? 'sayi' : 'sayi olculemedi'}>
      {metin}
      {olculdu && birim !== undefined ? ` ${birim}` : ''}
    </span>
  );
}
```

`apps/web/src/components/Olculemedi.tsx`:
```tsx
/**
 * Bir bölümün yerine geçer. Boş tablo göstermek yerine neden boş
 * olduğunu ve ne yapılması gerektiğini söyler.
 */
export function Olculemedi({
  baslik,
  sebep,
}: {
  baslik: string;
  sebep: string;
}): React.JSX.Element {
  return (
    <section className="kart">
      <h2>{baslik}</h2>
      <p className="olculemedi">{sebep}</p>
    </section>
  );
}
```

- [ ] **Step 3: layout.tsx yaz**

Sol rafta: ürün adı, niş listesi bağlantısı, seçili nişin dört alt sayfası. `params` erişimi olmadığı için raf statik bağlantılar taşır; aktif niş sayfa içinden verilir.

- [ ] **Step 4: Derlemeyi doğrula ve commit**

Run: `pnpm build:web`
Expected: derleme başarılı.

```bash
git add -A && git commit -m "feat: dashboard kabugu ve olcum ogeleri"
```

---

## Task 3: Nişler ekranı

**Files:**
- Create: `apps/web/src/app/page.tsx`

Niş listesi: ad, snapshot sayısı, son snapshot zamanı, listing sayısı. Her satır niş özetine bağlanır. Hiç niş yoksa boş ekran bir davet olur: çalıştırılacak komutu gösterir.

- [ ] **Step 1: Sayfayı yaz** — `withDb` ile `niches` + `snapshots` sorgusu, tablo render'ı, boş durum metni.
- [ ] **Step 2:** `pnpm dev` ile aç, gerçek veriyle iki nişin listelendiğini gör.
- [ ] **Step 3:** Commit.

---

## Task 4: Grafikler

**Files:**
- Create: `apps/web/src/components/charts/Tooltip.tsx` (client)
- Create: `apps/web/src/components/charts/HizSerisi.tsx` (çizgi)
- Create: `apps/web/src/components/charts/FiyatTalep.tsx` (çubuk)
- Create: `apps/web/src/components/charts/EtiketKadrani.tsx` (scatter)
- Create: `apps/web/src/components/charts/BoslukMatrisi.tsx` (ısı haritası)
- Test: `apps/web/test/charts.test.ts` (ölçek fonksiyonları)

**Grafik kuralları** (dataviz rehberinden, uygulanacak):
- **Tek eksen.** Fiyat–talep grafiği çift eksen kullanmaz: y ekseni `talep/listing`, arz her çubuğun üstünde doğrudan etiket.
- Çizgi 2px, işaretçi >=8px, çubuk veri ucu 4px yuvarlatılmış ve taban çizgisine oturur.
- Grid saç teli ve geri planda; eksen `--grid`.
- Scatter'da medyan çizgileri referans; fırsat kadranı hafif turuncu zemin.
- Isı haritası tek hue mavi ramp; hücrelerde 2px yüzey boşluğu.
- **Her grafiğin altında tablo görünümü** (`<details>` içinde) — hem erişilebilirlik hem ışık modundaki aqua kontrast uyarısının gereği.
- Tek seri olan grafiklerde legend yok, başlık seriyi adlandırır.

Ölçek fonksiyonları saf ve test edilir:
```ts
export function olcek(deger: number, alan: [number, number], hedef: [number, number]): number
```

- [ ] **Step 1:** Ölçek testi yaz, başarısız olduğunu gör, `olcek` ve eksen tick üreticisini yaz, geçir.
- [ ] **Step 2:** Dört grafiği yaz.
- [ ] **Step 3:** Commit.

---

## Task 5: Niş Özeti, Fırsatlar, Rakipler, Listing Gezgini

**Files:**
- Create: dört `page.tsx`

| Ekran | İçerik |
|---|---|
| **Niş Özeti** | Ölçüm durumu bloğu (snapshot sayısı, aralık), pazar görünümü değerleri, tazelik, hız serisi grafiği, en hızlı yükselenler tablosu |
| **Fırsatlar** | Fiyat–talep grafiği, etiket kadranı scatter, boşluk matrisi. Hız ölçülemiyorsa üçü de `Olculemedi` ile değişir |
| **Rakipler** | Satıcı tablosu, konsantrasyon değerleri (HHI, top-10 payı) |
| **Listing Gezgini** | Filtrelenebilir tablo; sıralama URL parametresiyle (`?sirala=hiz|fiyat|favori`), server-side |

Listing Gezgini için `core`'a yeni bir fonksiyon gerekir:
`listListings(db, nicheId, { sortBy, limit })` — `packages/core/src/analysis/listings.ts`, kendi testiyle.

- [ ] **Step 1:** `listListings` için failing test → implementasyon → geçir.
- [ ] **Step 2:** Dört sayfayı yaz.
- [ ] **Step 3:** `pnpm dev` ile hepsini gerçek veriyle gez.
- [ ] **Step 4:** Commit.

---

## Task 6: Docker ve doğrulama

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `README.md`

Web servisi ayrı bir compose servisi olarak eklenir; 3000 portu açılır, aynı `./data` volume'u bağlanır.

```yaml
  web:
    build: .
    image: etsy-deep-analysis-tool
    command: ['--filter', '@etsy-analysis/web', 'dev']
    env_file: [.env]
    environment:
      DUCKDB_PATH: /app/data/etsy.duckdb
    ports: ['3000:3000']
    volumes:
      - ./data:/app/data
```

- [ ] **Step 1:** Compose servisini ekle, `docker compose up web` ile ayağa kaldır.
- [ ] **Step 2:** `http://localhost:3000` üzerinden beş ekranı da gez, ekran görüntüsü al.
- [ ] **Step 3:** README'ye dashboard bölümü ekle.
- [ ] **Step 4:** Commit ve push.

---

## Faz 2 bitti sayılma ölçütü

- [ ] `pnpm dev` ile beş ekran gerçek veriyle açılıyor
- [ ] `docker compose up web` ile aynı ekranlar 3000 portunda açılıyor
- [ ] Tek snapshot'lı nişte hız bölümleri boş tablo değil, sebep metni gösteriyor
- [ ] Her grafiğin altında tablo görünümü var
- [ ] `pnpm test` ve `pnpm typecheck` yeşil
- [ ] Karanlık modda tüm ekranlar okunabilir

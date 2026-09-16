import {
  EtsyClient,
  HttpCache,
  RateLimiter,
  enrichShops,
  getLatestSnapshotId,
  ingestReviews,
  ingestTaxonomy,
  loadConfig,
  loadDotEnvIfPresent,
  migrate,
  openDb,
  runNicheSnapshot,
  upsertNiche,
  anthropicIstemcisi,
  firsatAciklamasiUret,
  nisOzetiUret,
  yorumTemalariUret,
  getFreshness,
  getGapMatrix,
  getMarketOverview,
  getPriceDemandCurve,
  getReviewStats,
  getTagQuadrant,
  getTopRisers,
  getVelocitySeries,
  type Niche,
} from '@etsy-analysis/core';
import { veritabaniYolu } from './lib/db.js';

/**
 * Yazma işlemleri için ayrı bağlantı.
 *
 * Panel okurken salt-okunur açıyor; niş eklemek ve snapshot almak yazma
 * gerektiriyor. DuckDB tek yazar kabul ettiği için bu bağlantı da kısa
 * ömürlü: iş biter bitmez kapanıyor.
 */
async function yazmaIcin<T>(
  fn: (db: Awaited<ReturnType<typeof openDb>>, config: ReturnType<typeof loadConfig>) => Promise<T>,
): Promise<T> {
  loadDotEnvIfPresent();
  const config = loadConfig(process.env);
  const db = await openDb(veritabaniYolu(config.duckdbPath));
  try {
    await migrate(db);
    return await fn(db, config);
  } finally {
    await db.close();
  }
}

export interface EylemSonucu {
  basarili: boolean;
  mesaj: string;
  yol: string;
}

function metin(form: URLSearchParams, alan: string): string | null {
  const v = form.get(alan);
  return v === null || v.trim() === '' ? null : v.trim();
}

function sayi(form: URLSearchParams, alan: string): number | null {
  const v = metin(form, alan);
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Niş kimliği URL'de kullanılıyor; dar tutuyoruz. */
const KIMLIK_DESENI = /^[a-z0-9][a-z0-9-]{1,48}$/;

export async function nisEkle(form: URLSearchParams): Promise<EylemSonucu> {
  const nicheId = metin(form, 'niche_id')?.toLowerCase() ?? null;
  const name = metin(form, 'name');

  if (nicheId === null || !KIMLIK_DESENI.test(nicheId)) {
    return {
      basarili: false,
      mesaj:
        'Kimlik küçük harf, rakam ve tire içerebilir; 2–49 karakter olmalı. Örnek: seramik-kupa',
      yol: '/',
    };
  }
  if (name === null) {
    return { basarili: false, mesaj: 'Nişe bir ad verin.', yol: '/' };
  }

  const niche: Niche = {
    nicheId,
    name,
    keywords: metin(form, 'keywords'),
    taxonomyId: sayi(form, 'taxonomy_id'),
    minPrice: sayi(form, 'min_price'),
    maxPrice: sayi(form, 'max_price'),
    sortOn: (metin(form, 'sort_on') ?? 'score') as Niche['sortOn'],
  };

  if (niche.keywords === null && niche.taxonomyId === null) {
    return {
      basarili: false,
      mesaj: 'Anahtar kelime ya da kategori kimliğinden en az biri gerekli.',
      yol: '/',
    };
  }

  await yazmaIcin(async (db) => {
    await upsertNiche(db, niche);
  });

  return {
    basarili: true,
    mesaj: `"${name}" eklendi. Şimdi ilk snapshot'ı alın.`,
    yol: `/nis/${encodeURIComponent(nicheId)}`,
  };
}

export async function snapshotAl(
  nicheId: string,
  form: URLSearchParams,
): Promise<EylemSonucu> {
  const yol = `/nis/${encodeURIComponent(nicheId)}`;

  return yazmaIcin(async (db, config) => {
    const rows = await db.query<{
      niche_id: string;
      name: string;
      keywords: string | null;
      taxonomy_id: string | null;
      min_price: number | null;
      max_price: number | null;
      sort_on: string;
    }>(
      `select niche_id, name, keywords, taxonomy_id, min_price, max_price, sort_on
         from niches where niche_id = $id`,
      { id: nicheId },
    );
    const row = rows[0];
    if (row === undefined) {
      return { basarili: false, mesaj: `Niş bulunamadı: ${nicheId}`, yol: '/' };
    }

    if (config.etsyMode !== 'live') {
      return {
        basarili: false,
        mesaj:
          'ETSY_MODE=live değil. Gerçek veri çekmek için .env dosyasında ETSY_MODE=live olmalı.',
        yol,
      };
    }

    const niche: Niche = {
      nicheId: row.niche_id,
      name: row.name,
      keywords: row.keywords,
      taxonomyId: row.taxonomy_id === null ? null : Number(row.taxonomy_id),
      minPrice: row.min_price,
      maxPrice: row.max_price,
      sortOn: row.sort_on as Niche['sortOn'],
    };

    const client = new EtsyClient({
      config,
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
    });

    const oncekiSnapshot = await getLatestSnapshotId(db, nicheId);

    try {
      const sonuc = await runNicheSnapshot({
        db,
        client,
        niche,
        maxPages: sayi(form, 'max_pages') ?? 1,
      });
      await ingestTaxonomy({ db, client });
      const shops = await enrichShops({
        db,
        client,
        snapshotId: sonuc.snapshotId,
        maxShops: sayi(form, 'max_shops') ?? 5,
      });
      const reviews = await ingestReviews({
        db,
        client,
        snapshotId: sonuc.snapshotId,
        maxListings: sayi(form, 'max_reviews') ?? 5,
      });

      const ikinci = oncekiSnapshot !== null;
      return {
        basarili: true,
        mesaj:
          `Snapshot alındı: ${String(sonuc.listingCount)} listing, ` +
          `${String(shops.shopCount)} satıcı, ${String(reviews.reviewCount)} yorum.` +
          (ikinci
            ? ' Bu ikinci snapshot olduğu için hız analizleri artık ölçülebilir.'
            : ' Hız analizleri için ikinci bir snapshot gerekiyor.'),
        yol,
      };
    } catch (error) {
      return {
        basarili: false,
        mesaj: error instanceof Error ? error.message : String(error),
        yol,
      };
    }
  });
}

/* ---------------------------------------------------------------- */

/** Panelden AI yorumlarını üretir. Cache varsa API'ye gitmez. */
export async function insightUret(nicheId: string): Promise<EylemSonucu> {
  const yol = `/nis/${encodeURIComponent(nicheId)}`;

  return yazmaIcin(async (db, config) => {
    if (config.anthropicApiKey === null) {
      return {
        basarili: false,
        mesaj:
          'ANTHROPIC_API_KEY tanımlı değil. .env dosyasına ekleyin; araç anahtarsız da tam çalışır, yalnızca yorum katmanı kapalı kalır.',
        yol,
      };
    }

    const nisler = await db.query<{ name: string }>(
      'select name from niches where niche_id = $id',
      { id: nicheId },
    );
    const nis = nisler[0];
    if (nis === undefined) {
      return { basarili: false, mesaj: `Niş bulunamadı: ${nicheId}`, yol: '/' };
    }

    const snapshotId = await getLatestSnapshotId(db, nicheId);
    if (snapshotId === null) {
      return {
        basarili: false,
        mesaj: 'Önce bir snapshot alın; yorumlanacak veri yok.',
        yol,
      };
    }

    const istemci = anthropicIstemcisi(config.anthropicApiKey);

    const [ozet, tazelik, seri, yukselenler, bantlar, etiketler, hucreler, yorumlar] =
      await Promise.all([
        getMarketOverview(db, nicheId),
        getFreshness(db, nicheId),
        getVelocitySeries(db, nicheId),
        getTopRisers(db, nicheId),
        getPriceDemandCurve(db, nicheId),
        getTagQuadrant(db, nicheId),
        getGapMatrix(db, nicheId),
        getReviewStats(db, nicheId),
      ]);

    const uretilen: string[] = [];
    const sorunlu: string[] = [];

    const kaydet = (etiket: string, durum: string): void => {
      if (durum === 'tamam') uretilen.push(etiket);
      else sorunlu.push(`${etiket} (${durum})`);
    };

    kaydet(
      'niş özeti',
      (
        await nisOzetiUret({
          db,
          istemci,
          snapshotId,
          girdi: { nisAdi: nis.name, ozet, tazelik, seri, yukselenler },
        })
      ).durum,
    );

    kaydet(
      'fırsat açıklaması',
      (
        await firsatAciklamasiUret({
          db,
          istemci,
          snapshotId,
          girdi: {
            nisAdi: nis.name,
            bantlar,
            firsatEtiketleri: etiketler.filter((t) => t.quadrant === 'firsat'),
            hucreler,
          },
        })
      ).durum,
    );

    if (yorumlar.lowRated.length > 0) {
      kaydet(
        'yorum temaları',
        (
          await yorumTemalariUret({
            db,
            istemci,
            snapshotId,
            girdi: {
              nisAdi: nis.name,
              dusukPuanli: yorumlar.lowRated.map((r) => ({
                rating: r.rating,
                text: r.text,
              })),
            },
          })
        ).durum,
      );
    }

    return {
      basarili: sorunlu.length === 0,
      mesaj:
        sorunlu.length === 0
          ? `AI yorumları hazır: ${uretilen.join(', ')}.`
          : `Bazıları üretilemedi: ${sorunlu.join(', ')}.`,
      yol,
    };
  });
}

/** Nişi ve ona bağlı snapshot verisini siler. */
export async function nisSil(nicheId: string): Promise<EylemSonucu> {
  return yazmaIcin(async (db) => {
    const nisler = await db.query<{ name: string }>(
      'select name from niches where niche_id = $id',
      { id: nicheId },
    );
    const nis = nisler[0];
    if (nis === undefined) {
      return { basarili: false, mesaj: `Niş bulunamadı: ${nicheId}`, yol: '/' };
    }

    // Gözlemler snapshot üzerinden bağlı; listing ve satıcı kayıtları
    // başka nişlerle paylaşılabildiği için silinmiyor.
    await db.runStatement(
      `delete from ai_insights where snapshot_id in
         (select snapshot_id from snapshots where niche_id = $id)`,
      { id: nicheId },
    );
    await db.runStatement(
      `delete from listing_observations where snapshot_id in
         (select snapshot_id from snapshots where niche_id = $id)`,
      { id: nicheId },
    );
    await db.runStatement(
      `delete from shop_observations where snapshot_id in
         (select snapshot_id from snapshots where niche_id = $id)`,
      { id: nicheId },
    );
    await db.runStatement('delete from snapshots where niche_id = $id', { id: nicheId });
    await db.runStatement('delete from niches where niche_id = $id', { id: nicheId });

    return { basarili: true, mesaj: `"${nis.name}" silindi.`, yol: '/' };
  });
}

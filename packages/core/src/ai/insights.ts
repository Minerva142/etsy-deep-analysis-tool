import type { Db } from '../db/connection.js';
import type { Freshness, MarketOverview } from '../analysis/overview.js';
import type { RiserRow, VelocityPoint } from '../analysis/demand.js';
import type { GapCell, PriceBand } from '../analysis/pricing.js';
import type { TagRow } from '../analysis/tags.js';
import type { AiIstemci, AiSonuc } from './client.js';
import { insightOku, insightYaz } from './cache.js';
import {
  INSIGHT_TIPLERI,
  firsatAciklamasiSemasi,
  nisOzetiSemasi,
  yorumTemalariSemasi,
  type FirsatAciklamasi,
  type InsightTipi,
  type NisOzeti,
  type YorumTemalari,
} from './semalar.js';

const sayi = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? 'ölçülemedi' : v.toFixed(2);

/**
 * Cache varsa API'ye gitmeden döner; yoksa üretir ve yazar.
 *
 * `force` yalnızca kullanıcı açıkça istediğinde true olur — bir snapshot'ın
 * verisi değişmediği için yorumunun da değişmesi gerekmez.
 */
async function uretVeYaz<T>(options: {
  db: Db;
  istemci: AiIstemci;
  snapshotId: string;
  tip: InsightTipi;
  sema: Parameters<typeof insightOku<T>>[3];
  istem: string;
  force: boolean;
}): Promise<AiSonuc<T> & { cacheten?: boolean }> {
  const { db, istemci, snapshotId, tip, sema, istem, force } = options;

  if (!force) {
    const mevcut = await insightOku<T>(db, snapshotId, tip, sema);
    if (mevcut !== null) {
      return { durum: 'tamam', veri: mevcut.veri, model: mevcut.model ?? '', cacheten: true };
    }
  }

  const sonuc = await istemci.uret<T>({ istem, sema });
  if (sonuc.durum === 'tamam') {
    await insightYaz(db, snapshotId, tip, sonuc.veri, sonuc.model);
  }
  return { ...sonuc, cacheten: false };
}

/* ---------------------------------------------------------------- */

export interface NisOzetiGirdisi {
  nisAdi: string;
  ozet: MarketOverview | null;
  tazelik: Freshness | null;
  seri: VelocityPoint[];
  yukselenler: RiserRow[];
}

function nisOzetiIstemi(g: NisOzetiGirdisi): string {
  const o = g.ozet;
  const t = g.tazelik;
  return `Niş: ${g.nisAdi}

Ölçülmüş pazar görünümü (son snapshot):
- aktif listing: ${o === null ? 'ölçülemedi' : String(o.listingCount)}
- benzersiz satıcı: ${o === null ? 'ölçülemedi' : String(o.sellerCount)}
- medyan fiyat: ${sayi(o?.medianPrice)}
- fiyat p25–p75: ${sayi(o?.p25Price)} – ${sayi(o?.p75Price)}
- toplam favori: ${o === null ? 'ölçülemedi' : String(o.totalFavorers)}
- ortalama favori hızı (adet/gün): ${sayi(o?.avgVelocity)}

Tazelik:
- listing medyan yaşı (gün): ${sayi(t?.medianAgeDays)}
- son 30 günde eklenen: ${t === null ? 'ölçülemedi' : String(t.newLast30Days)}
- son 90 günde eklenen: ${t === null ? 'ölçülemedi' : String(t.newLast90Days)}

Favori hızının snapshot'lara göre seyri:
${
  g.seri.length === 0
    ? '- veri yok'
    : g.seri
        .map((p) => `- ${p.observedAt}: ortalama ${sayi(p.avgVelocity)} /gün, ${String(p.listingCount)} listing`)
        .join('\n')
}

En hızlı yükselen listingler:
${
  g.yukselenler.length === 0
    ? '- ölçülebilen hız yok'
    : g.yukselenler
        .slice(0, 10)
        .map((r) => `- "${r.title ?? 'başlıksız'}" · ${sayi(r.velocity)} favori/gün · fiyat ${sayi(r.price)}`)
        .join('\n')
}

Bu nişin durumunu özetle, veride görünen trendleri say ve en fazla üç somut aksiyon öner.`;
}

export async function nisOzetiUret(options: {
  db: Db;
  istemci: AiIstemci;
  snapshotId: string;
  girdi: NisOzetiGirdisi;
  force?: boolean;
}): Promise<AiSonuc<NisOzeti> & { cacheten?: boolean }> {
  return uretVeYaz<NisOzeti>({
    db: options.db,
    istemci: options.istemci,
    snapshotId: options.snapshotId,
    tip: INSIGHT_TIPLERI.nisOzeti,
    sema: nisOzetiSemasi,
    istem: nisOzetiIstemi(options.girdi),
    force: options.force ?? false,
  });
}

/* ---------------------------------------------------------------- */

export interface YorumGirdisi {
  nisAdi: string;
  dusukPuanli: { rating: number; text: string }[];
}

/** En fazla 60 yorum: girdi büyüdükçe maliyet artıyor, sinyal artmıyor. */
const YORUM_SINIRI = 60;

function yorumIstemi(g: YorumGirdisi): string {
  return `Niş: ${g.nisAdi}

Aşağıda bu nişteki listing'lere bırakılmış düşük puanlı (1–3 yıldız) yorumlar var.
Tekrar eden şikâyet temalarını çıkar ve bu şikâyetleri çözecek ürün iyileştirmelerini öner.

${g.dusukPuanli
  .slice(0, YORUM_SINIRI)
  .map((r) => `(${String(r.rating)} yıldız) ${r.text.replace(/\s+/g, ' ').slice(0, 300)}`)
  .join('\n')}`;
}

export async function yorumTemalariUret(options: {
  db: Db;
  istemci: AiIstemci;
  snapshotId: string;
  girdi: YorumGirdisi;
  force?: boolean;
}): Promise<AiSonuc<YorumTemalari> & { cacheten?: boolean }> {
  return uretVeYaz<YorumTemalari>({
    db: options.db,
    istemci: options.istemci,
    snapshotId: options.snapshotId,
    tip: INSIGHT_TIPLERI.yorumTemalari,
    sema: yorumTemalariSemasi,
    istem: yorumIstemi(options.girdi),
    force: options.force ?? false,
  });
}

/* ---------------------------------------------------------------- */

export interface FirsatGirdisi {
  nisAdi: string;
  bantlar: PriceBand[];
  firsatEtiketleri: TagRow[];
  hucreler: GapCell[];
}

function firsatIstemi(g: FirsatGirdisi): string {
  return `Niş: ${g.nisAdi}

Fiyat bandına göre arz ve talep (talep = bandaki listing'lerin favori hızı toplamı):
${
  g.bantlar.length === 0
    ? '- veri yok'
    : g.bantlar
        .map(
          (b) =>
            `- ${sayi(b.minPrice)}–${sayi(b.maxPrice)}: arz ${String(b.supply)} listing, talep ${sayi(b.demand)}, listing başına talep ${sayi(b.demandPerListing)}`,
        )
        .join('\n')
}

Getirisi medyanın üstünde ama az kullanılan etiketler:
${
  g.firsatEtiketleri.length === 0
    ? '- yok'
    : g.firsatEtiketleri
        .slice(0, 12)
        .map((t) => `- "${t.tag}": ${String(t.usageCount)} listing, ortalama ${sayi(t.avgVelocity)} favori/gün`)
        .join('\n')
}

Talep/arz oranı en yüksek kategori ve fiyat bandı hücreleri:
${
  g.hucreler.length === 0
    ? '- veri yok'
    : g.hucreler
        .slice(0, 8)
        .map(
          (h) =>
            `- ${h.taxonomyPath ?? 'kategori bilinmiyor'} · bant ${String(h.band)}: oran ${sayi(h.ratio)}, arz ${String(h.supply)}`,
        )
        .join('\n')
}

Bu verilerde görünen en belirgin fırsatı açıkla, bu alanın neden boş kalmış olabileceğine dair olası bir açıklama sun, riskleri say ve verinin bu sonucu ne kadar desteklediğini belirt.`;
}

export async function firsatAciklamasiUret(options: {
  db: Db;
  istemci: AiIstemci;
  snapshotId: string;
  girdi: FirsatGirdisi;
  force?: boolean;
}): Promise<AiSonuc<FirsatAciklamasi> & { cacheten?: boolean }> {
  return uretVeYaz<FirsatAciklamasi>({
    db: options.db,
    istemci: options.istemci,
    snapshotId: options.snapshotId,
    tip: INSIGHT_TIPLERI.firsatAciklamasi,
    sema: firsatAciklamasiSemasi,
    istem: firsatIstemi(options.girdi),
    force: options.force ?? false,
  });
}

/* ---------------------------------------------------------------- */
/* Panel için: yalnızca cache'ten okur, asla API çağırmaz.            */

export async function cachetenOku(
  db: Db,
  snapshotId: string,
): Promise<{
  nisOzeti: NisOzeti | null;
  yorumTemalari: YorumTemalari | null;
  firsatAciklamasi: FirsatAciklamasi | null;
}> {
  const [ozet, yorum, firsat] = await Promise.all([
    insightOku<NisOzeti>(db, snapshotId, INSIGHT_TIPLERI.nisOzeti, nisOzetiSemasi),
    insightOku<YorumTemalari>(
      db,
      snapshotId,
      INSIGHT_TIPLERI.yorumTemalari,
      yorumTemalariSemasi,
    ),
    insightOku<FirsatAciklamasi>(
      db,
      snapshotId,
      INSIGHT_TIPLERI.firsatAciklamasi,
      firsatAciklamasiSemasi,
    ),
  ]);

  return {
    nisOzeti: ozet?.veri ?? null,
    yorumTemalari: yorum?.veri ?? null,
    firsatAciklamasi: firsat?.veri ?? null,
  };
}

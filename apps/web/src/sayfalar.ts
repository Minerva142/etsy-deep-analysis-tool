import {
  countSnapshots,
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
  cachetenOku,
  getLatestSnapshotId,
  type Db,
} from '@etsy-analysis/core/analysis';
import { semaHazirMi, withDb } from './lib/db.js';
import { para, sayi, tamsayi, tarih } from './lib/format.js';
import { boslukMatrisi, etiketKadrani, fiyatTalep, hizSerisi } from './grafikler.js';
import { deger, esc, olculemediBolumu, sayfa, type NisBagi } from './html.js';
import {
  firsatAciklamasiBolumu,
  nisOzetiBolumu,
  yorumTemalariBolumu,
} from './ai-bolumleri.js';

const IKI_SNAPSHOT_SEBEBI =
  'Favori hızı ardışık iki snapshot arasındaki değişimden hesaplanıyor. Bu nişin şu an tek snapshot’ı var, bu yüzden hıza dayanan analizler ölçülemedi.';
const IKI_SNAPSHOT_COZUMU =
  'İkinci snapshot alındığında bu bölümler kendiliğinden dolacak. Snapshot’lar arasında en az bir saat olmalı.';

interface Nis {
  niche_id: string;
  name: string;
  keywords: string | null;
}

async function nisGetir(db: Db, id: string): Promise<Nis | null> {
  if (!(await semaHazirMi(db))) return null;
  const rows = await db.query<Nis>(
    'select niche_id, name, keywords from niches where niche_id = $id',
    { id },
  );
  return rows[0] ?? null;
}

function tabloyaBas(
  basliklar: string[],
  satirlar: string[][],
  bosMesaj = 'Kayıt yok.',
): string {
  if (satirlar.length === 0) return `<p class="olculemedi dar">${esc(bosMesaj)}</p>`;
  return `<div class="kaydir"><table>
    <thead><tr>${basliklar
      .map((b, i) => `<th${i === 0 ? '' : ' class="num"'}>${esc(b)}</th>`)
      .join('')}</tr></thead>
    <tbody>${satirlar
      .map(
        (s) =>
          `<tr>${s
            .map((h, i) => (i === 0 ? `<td>${h}</td>` : `<td class="num">${h}</td>`))
            .join('')}</tr>`,
      )
      .join('')}</tbody>
  </table></div>`;
}

/* --------------------------------------------------------------- */
/* 1. Nişler                                                        */

export async function nislerSayfasi(): Promise<string> {
  const nisler = await withDb(async (db) => {
    if (!(await semaHazirMi(db))) return [];
    return db.query<{
      niche_id: string;
      name: string;
      keywords: string | null;
      snapshot_sayisi: string;
      son_snapshot: string | null;
      listing_sayisi: string | null;
    }>(`
      select
        n.niche_id, n.name, n.keywords,
        count(s.snapshot_id) filter (where s.status = 'complete') as snapshot_sayisi,
        max(s.started_at)    filter (where s.status = 'complete') as son_snapshot,
        max(s.listing_count) filter (where s.status = 'complete') as listing_sayisi
      from niches n
      left join snapshots s on s.niche_id = n.niche_id
      where n.is_active
      group by n.niche_id, n.name, n.keywords
      order by n.name
    `);
  });

  const govde =
    nisler.length === 0
      ? `<div class="kart bos">
           <h2>Henüz takip edilen niş yok</h2>
           <p class="dar">Bir niş tanımlayıp ilk snapshot’ı almak için bu komutu çalıştırın.</p>
           <code>pnpm snapshot --niche seramik-kupa --name "Seramik kupa" --keywords "ceramic mug" --max-pages 2</code>
         </div>`
      : `<section class="kart">${tabloyaBas(
          ['Niş', 'Anahtar kelime', 'Snapshot', 'Listing', 'Son çekim'],
          nisler.map((n) => {
            const adet = Number(n.snapshot_sayisi);
            const snapshotHucresi =
              adet < 2
                ? `<span class="olculemedi" title="Hız analizleri için en az iki snapshot gerekiyor">${esc(tamsayi(adet))}</span>`
                : esc(tamsayi(adet));
            return [
              `<a href="/nis/${encodeURIComponent(n.niche_id)}">${esc(n.name)}</a>
               <div class="olculemedi">${esc(n.keywords ?? '')}</div>`,
              snapshotHucresi,
              n.listing_sayisi === null ? '—' : esc(tamsayi(Number(n.listing_sayisi))),
              `<span class="sayi">${esc(tarih(n.son_snapshot))}</span>`,
            ];
          }),
        )}</section>`;

  // Not: başlık sütun sayısıyla satır sütun sayısı eşleşmeli.
  const duzeltilmis = govde.replace(
    '<th>Niş</th><th class="num">Anahtar kelime</th>',
    '<th>Niş</th>',
  );

  return sayfa({
    baslik: 'Nişler',
    aktif: '/',
    icerik: `<h1>Nişler</h1>
      <p class="sayfa-alt">Her niş için periyodik snapshot alınır. Talep analizleri ardışık snapshot’lar arasındaki değişimden hesaplandığı için, ikinci snapshot alınana kadar hız değerleri ölçülemez.</p>
      ${duzeltilmis}`,
  });
}

/* --------------------------------------------------------------- */
/* 2. Niş Özeti                                                     */

export async function nisOzetiSayfasi(id: string): Promise<string | null> {
  return withDb(async (db) => {
    const nis = await nisGetir(db, id);
    if (nis === null) return null;

    const snapshotId = await getLatestSnapshotId(db, id);
    const ai =
      snapshotId === null
        ? { nisOzeti: null, yorumTemalari: null, firsatAciklamasi: null }
        : await cachetenOku(db, snapshotId);

    const [snapshotSayisi, ozet, tazelik, seri, yukselenler] = await Promise.all([
      countSnapshots(db, id),
      getMarketOverview(db, id),
      getFreshness(db, id),
      getVelocitySeries(db, id),
      getTopRisers(db, id),
    ]);

    const bag: NisBagi = { id, ad: nis.name };

    const olcumDurumu = `<section class="kart">
      <h2>Ölçüm durumu</h2>
      <p class="okuma">${esc(tamsayi(snapshotSayisi))} snapshot</p>
      <p class="${snapshotSayisi < 2 ? 'olculemedi' : 'ikincil'} dar" style="margin-top:6px">
        ${snapshotSayisi < 2 ? esc(IKI_SNAPSHOT_SEBEBI) : 'Hıza dayanan analizler ölçülebiliyor.'}
      </p>
    </section>`;

    const pazar =
      ozet === null
        ? olculemediBolumu('Pazar görünümü', 'Bu niş için henüz gözlem yok.')
        : `<section class="kart">
            <h2>Pazar görünümü</h2>
            <dl class="deger-listesi">
              <dt>Listing</dt><dd>${deger(ozet.listingCount, 'tamsayi')}</dd>
              <dt>Satıcı</dt><dd>${deger(ozet.sellerCount, 'tamsayi')}</dd>
              <dt>Medyan fiyat</dt><dd>${deger(ozet.medianPrice, 'para')}</dd>
              <dt>Fiyat aralığı</dt><dd>${deger(ozet.p25Price, 'para')} – ${deger(ozet.p75Price, 'para')}</dd>
              <dt>Toplam favori</dt><dd>${deger(ozet.totalFavorers, 'tamsayi')}</dd>
              <dt>Ort. favori hızı</dt><dd>${deger(ozet.avgVelocity, 'sayi', '/gün')}</dd>
            </dl>
          </section>`;

    const tazelikBolumu =
      tazelik === null
        ? olculemediBolumu('Tazelik', 'Oluşturma tarihi bilinen listing yok.')
        : `<section class="kart">
            <h2>Tazelik</h2>
            <dl class="deger-listesi">
              <dt>Medyan yaş</dt><dd>${deger(tazelik.medianAgeDays, 'tamsayi', 'gün')}</dd>
              <dt>Son 30 günde yeni</dt><dd>${deger(tazelik.newLast30Days, 'tamsayi')}</dd>
              <dt>Son 90 günde yeni</dt><dd>${deger(tazelik.newLast90Days, 'tamsayi')}</dd>
            </dl>
          </section>`;

    const hizBolumu =
      snapshotSayisi < 2
        ? olculemediBolumu('Favori hızı', IKI_SNAPSHOT_SEBEBI, IKI_SNAPSHOT_COZUMU)
        : `<section class="kart"><h2>Favori hızı</h2>${hizSerisi(seri)}</section>`;

    const yukselenBolumu =
      snapshotSayisi < 2
        ? ''
        : `<section class="kart">
            <h2>En hızlı yükselen listingler</h2>
            ${tabloyaBas(
              ['Başlık', 'Hız /gün', 'Fiyat', 'Favori'],
              yukselenler
                .slice(0, 12)
                .map((r) => [
                  r.url === null
                    ? `<span class="kirp">${esc(r.title ?? '(başlıksız)')}</span>`
                    : `<a class="kirp" href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title ?? '(başlıksız)')}</a>`,
                  deger(r.velocity, 'sayi'),
                  deger(r.price, 'para'),
                  deger(r.numFavorers, 'tamsayi'),
                ]),
              'Ölçülebilen hız yok.',
            )}
          </section>`;

    return sayfa({
      baslik: nis.name,
      nis: bag,
      aktif: `/nis/${encodeURIComponent(id)}`,
      icerik: `<h1>${esc(nis.name)}</h1>
        <p class="sayfa-alt">${esc(nis.keywords ?? '')}</p>
        <div class="yigin">
          <div class="izgara-2">${olcumDurumu}${tazelikBolumu}</div>
          ${pazar}
          ${nisOzetiBolumu(ai.nisOzeti, id)}
          ${hizBolumu}
          ${yukselenBolumu}
        </div>`,
    });
  });
}

/* --------------------------------------------------------------- */
/* 3. Fırsatlar                                                     */

export async function firsatlarSayfasi(id: string): Promise<string | null> {
  return withDb(async (db) => {
    const nis = await nisGetir(db, id);
    if (nis === null) return null;

    const firsatSnapshotId = await getLatestSnapshotId(db, id);
    const firsatAi =
      firsatSnapshotId === null
        ? { firsatAciklamasi: null }
        : await cachetenOku(db, firsatSnapshotId);

    const [snapshotSayisi, bantlar, etiketler, hucreler] = await Promise.all([
      countSnapshots(db, id),
      getPriceDemandCurve(db, id),
      getTagQuadrant(db, id),
      getGapMatrix(db, id),
    ]);

    const bag: NisBagi = { id, ad: nis.name };

    if (snapshotSayisi < 2) {
      return sayfa({
        baslik: `${nis.name} · Fırsatlar`,
        nis: bag,
        aktif: `/nis/${encodeURIComponent(id)}/firsatlar`,
        icerik: `<h1>Fırsatlar</h1>
          <p class="sayfa-alt">Üç analiz de talebin nereye gittiğine bakıyor; talep ise favori hızından geliyor.</p>
          ${olculemediBolumu('Fırsat analizleri ölçülemedi', IKI_SNAPSHOT_SEBEBI, IKI_SNAPSHOT_COZUMU)}`,
      });
    }

    const firsatEtiketleri = etiketler.filter((t) => t.quadrant === 'firsat');

    return sayfa({
      baslik: `${nis.name} · Fırsatlar`,
      nis: bag,
      aktif: `/nis/${encodeURIComponent(id)}/firsatlar`,
      icerik: `<h1>Fırsatlar</h1>
        <p class="sayfa-alt">Üçü de aynı soruya bakıyor: talebin arzı aştığı yer neresi?</p>
        <div class="yigin">
          <section class="kart"><h2>Fiyat–talep eğrisi</h2>${fiyatTalep(bantlar)}</section>
          <section class="kart">
            <h2>Etiket fırsat kadranı
              ${firsatEtiketleri.length > 0 ? `<span class="firsat-rozet">${esc(tamsayi(firsatEtiketleri.length))} fırsat</span>` : ''}
            </h2>
            ${etiketKadrani(etiketler)}
          </section>
          <section class="kart"><h2>Boşluk matrisi</h2>${boslukMatrisi(hucreler)}</section>
          ${firsatAciklamasiBolumu(firsatAi.firsatAciklamasi, id)}
        </div>`,
    });
  });
}

/* --------------------------------------------------------------- */
/* 4. Rakipler                                                      */

export async function rakiplerSayfasi(id: string): Promise<string | null> {
  return withDb(async (db) => {
    const nis = await nisGetir(db, id);
    if (nis === null) return null;

    const rakipSnapshotId = await getLatestSnapshotId(db, id);
    const rakipAi =
      rakipSnapshotId === null
        ? { yorumTemalari: null }
        : await cachetenOku(db, rakipSnapshotId);

    const [saticilar, konsantrasyon, yorumlar] = await Promise.all([
      getSellerTable(db, id),
      getConcentration(db, id),
      getReviewStats(db, id),
    ]);

    const bag: NisBagi = { id, ad: nis.name };

    const konsantrasyonBolumu =
      konsantrasyon === null
        ? olculemediBolumu('Rekabet yoğunluğu', 'Satıcı verisi yok.')
        : `<section class="kart">
            <h2>Rekabet yoğunluğu</h2>
            <dl class="deger-listesi">
              <dt>Satıcı sayısı</dt><dd>${deger(konsantrasyon.sellerCount, 'tamsayi')}</dd>
              <dt>Top-10 payı</dt><dd>${deger(konsantrasyon.top10Share, 'yuzde')}</dd>
              <dt>HHI</dt><dd>${deger(konsantrasyon.hhi, 'sayi')}</dd>
            </dl>
            <p class="grafik-alt">HHI, satıcı paylarının karelerinin toplamı. 1’e yaklaştıkça pazar tek elde toplanıyor demektir.</p>
          </section>`;

    const yorumBolumu = `<section class="kart">
      <h2>Yorumlar</h2>
      ${tabloyaBas(
        ['Puan', 'Adet'],
        yorumlar.ratingDistribution.map((r) => [
          `${esc(String(r.rating))} yıldız`,
          esc(tamsayi(r.count)),
        ]),
        'Yorum çekilmemiş.',
      )}
      ${
        yorumlar.lowRated.length === 0
          ? ''
          : `<h2 style="margin-top:20px">Düşük puanlı yorumlar</h2>
             <ul class="dar" style="padding-left:18px;margin:0">
               ${yorumlar.lowRated
                 .slice(0, 8)
                 .map(
                   (r) =>
                     `<li><span class="sayi olculemedi">${esc(String(r.rating))}</span> ${esc(r.text.slice(0, 160))}</li>`,
                 )
                 .join('')}
             </ul>`
      }
    </section>`;

    return sayfa({
      baslik: `${nis.name} · Rakipler`,
      nis: bag,
      aktif: `/nis/${encodeURIComponent(id)}/rakipler`,
      icerik: `<h1>Rakipler</h1>
        <p class="sayfa-alt">Bu nişte kimler var, pazar ne kadar dağınık ve alıcılar neden şikâyet ediyor?</p>
        <div class="yigin">
          <section class="kart">
            <h2>Satıcılar</h2>
            ${tabloyaBas(
              ['Satıcı', 'Listing', 'Hız /gün', 'Favori', 'Puan'],
              saticilar.map((s) => [
                esc(s.shopName ?? String(s.shopId)),
                deger(s.listingCount, 'tamsayi'),
                deger(s.avgVelocity, 'sayi'),
                deger(s.totalFavorers, 'tamsayi'),
                deger(s.reviewAverage, 'sayi'),
              ]),
              'Satıcı zenginleştirmesi yapılmamış.',
            )}
          </section>
          ${konsantrasyonBolumu}
          ${yorumBolumu}
          ${yorumTemalariBolumu(rakipAi.yorumTemalari, id)}
        </div>`,
    });
  });
}

/* --------------------------------------------------------------- */
/* 5. Listing Gezgini                                               */

const SIRALAMALAR: Record<string, { etiket: string; sql: string }> = {
  hiz: { etiket: 'Favori hızı', sql: 'v.favorite_velocity desc nulls last' },
  favori: { etiket: 'Favori', sql: 'v.num_favorers desc nulls last' },
  fiyat: { etiket: 'Fiyat', sql: 'v.price_amount desc nulls last' },
  yeni: { etiket: 'En yeni', sql: 'l.original_creation_timestamp desc nulls last' },
};

export async function listinglerSayfasi(
  id: string,
  siralama: string,
): Promise<string | null> {
  const sirala = SIRALAMALAR[siralama] ?? SIRALAMALAR.hiz;
  if (sirala === undefined) return null;

  return withDb(async (db) => {
    const nis = await nisGetir(db, id);
    if (nis === null) return null;

    const satirlar = await db.query<{
      listing_id: string;
      title: string | null;
      url: string | null;
      price_amount: number | null;
      num_favorers: string | null;
      favorite_velocity: number | null;
      shop_name: string | null;
    }>(
      `select v.listing_id, l.title, l.url, v.price_amount, v.num_favorers,
              v.favorite_velocity, sh.shop_name
         from v_listing_velocity v
         join v_latest_snapshot s
           on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
         join listings l on l.listing_id = v.listing_id
         left join shops sh on sh.shop_id = l.shop_id
        where v.niche_id = $niche
        order by ${sirala.sql}, v.listing_id
        limit 100`,
      { niche: id },
    );

    const bag: NisBagi = { id, ad: nis.name };
    const yol = `/nis/${encodeURIComponent(id)}/listingler`;

    const siralamaBaglari = Object.entries(SIRALAMALAR)
      .map(([anahtar, s]) =>
        anahtar === siralama
          ? `<strong>${esc(s.etiket)}</strong>`
          : `<a href="${yol}?sirala=${anahtar}">${esc(s.etiket)}</a>`,
      )
      .join(' &nbsp; ');

    return sayfa({
      baslik: `${nis.name} · Listingler`,
      nis: bag,
      aktif: yol,
      icerik: `<h1>Listing gezgini</h1>
        <p class="sayfa-alt">Son snapshot’taki ilk 100 listing. Sırala: ${siralamaBaglari}</p>
        <section class="kart">
          ${tabloyaBas(
            ['Başlık', 'Hız /gün', 'Fiyat', 'Favori'],
            satirlar.map((r) => [
              `${
                r.url === null
                  ? `<span class="kirp">${esc(r.title ?? '(başlıksız)')}</span>`
                  : `<a class="kirp" href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title ?? '(başlıksız)')}</a>`
              }<div class="olculemedi">${esc(r.shop_name ?? '')}</div>`,
              deger(r.favorite_velocity, 'sayi'),
              deger(r.price_amount, 'para'),
              deger(r.num_favorers === null ? null : Number(r.num_favorers), 'tamsayi'),
            ]),
            'Bu nişte listing yok.',
          )}
        </section>`,
    });
  });
}

export { para, sayi };

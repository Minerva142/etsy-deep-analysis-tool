import {
  cachetenOku,
  countSnapshots,
  getConcentration,
  getFreshness,
  getGapMatrix,
  getLatestSnapshotId,
  getMarketOverview,
  getPriceDemandCurve,
  getReviewStats,
  getSellerTable,
  getTagQuadrant,
  getTopRisers,
  getVelocitySeries,
  type Concentration,
  type Db,
  type MarketOverview,
  type RiserRow,
} from '@etsy-analysis/core/analysis';
import { semaHazirMi, withDb } from './lib/db.js';
import { para, sayi, tamsayi, tarih } from './lib/format.js';
import { boslukMatrisi, etiketKadrani, fiyatTalep, hizSerisi } from './grafikler.js';
import { sparkline } from './sparkline.js';
import {
  bolum,
  deger,
  esc,
  olculemediGovdesi,
  sayfa,
  sayiHucresi,
  type NisBagi,
} from './html.js';
import {
  firsatAciklamasiBolumu,
  nisOzetiBolumu,
  yorumTemalariBolumu,
} from './ai-bolumleri.js';

const IKI_CEKIM_SEBEBI =
  'Favori hızı ardışık iki çekim arasındaki değişimden hesaplanıyor ve karşılaştırma en az bir saat öncesindeki gözlemle yapılıyor. Bu nişte henüz o aralık oluşmadı.';
const IKI_CEKIM_COZUMU =
  'Yarın bir çekim daha alın; bu bölümler kendiliğinden dolacak.';

/* Veri bütünlüğü: bu varsayılanlar tabloların boş kalmaması için seçildi. */
const VARSAYILAN = { sayfa: 5, satici: 25, yorum: 25 };

interface Nis {
  niche_id: string;
  name: string;
  keywords: string | null;
  sort_on: string;
}

async function nisGetir(db: Db, id: string): Promise<Nis | null> {
  if (!(await semaHazirMi(db))) return null;
  const rows = await db.query<Nis>(
    'select niche_id, name, keywords, sort_on from niches where niche_id = $id',
    { id },
  );
  return rows[0] ?? null;
}

function bildirim(mesaj: string | null, hata: boolean): string {
  if (mesaj === null || mesaj === '') return '';
  return `<div class="bildirim${hata ? ' bildirim-hata' : ''}" role="status">
    <p>${esc(mesaj)}</p>
  </div>`;
}

function tablo(
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

/**
 * Manşet: sayfanın cevabı, ölçülen değerlerden kuruluyor.
 *
 * Hiçbir yargı ölçülmemiş bir sayıya dayanmıyor; ölçülemeyen durumda
 * cümle bunu açıkça söylüyor.
 */
function manset(
  ozet: MarketOverview | null,
  konsantrasyon: Concentration | null,
  cekimSayisi: number,
  yukselenler: RiserRow[],
): { baslik: string; giris: string } {
  if (ozet === null) {
    return {
      baslik: 'Bu niş için henüz veri yok.',
      giris:
        'Aşağıdan bir çekim başlatın. İlk çekim pazarın anlık görüntüsünü alır; hareketi görmek için ikincisi gerekiyor.',
    };
  }

  const dagitim =
    konsantrasyon === null
      ? null
      : konsantrasyon.top10Share < 0.25
        ? 'dağınık'
        : konsantrasyon.top10Share < 0.5
          ? 'orta yoğunlukta'
          : 'yoğun';

  const olculen = yukselenler.filter((r) => Number.isFinite(r.velocity));
  const hareketli = olculen.filter((r) => r.velocity > 0);

  let baslik: string;
  if (cekimSayisi < 2 || olculen.length === 0) {
    baslik =
      dagitim === null
        ? 'Pazarın anlık görüntüsü alındı.'
        : `Pazar ${dagitim}, hareket henüz ölçülmedi.`;
  } else if (hareketli.length === 0) {
    baslik =
      dagitim === null
        ? 'Ölçüldü: bu aralıkta hiçbir listing favori kazanmadı.'
        : `Pazar ${dagitim}, bu aralıkta hiçbir listing favori kazanmadı.`;
  } else {
    baslik = `Pazar ${dagitim ?? 'ölçüldü'}, ${String(hareketli.length)} listing favori kazanıyor.`;
  }

  const parcalar: string[] = [
    `${tamsayi(ozet.listingCount)} listing, ${tamsayi(ozet.sellerCount)} satıcı.`,
  ];
  if (konsantrasyon !== null) {
    parcalar.push(
      `En büyük on satıcı listinglerin %${(konsantrasyon.top10Share * 100).toFixed(0)}’ini tutuyor.`,
    );
  }
  if (ozet.medianPrice !== null) {
    parcalar.push(`Medyan fiyat ${para(ozet.medianPrice)}.`);
  }
  if (cekimSayisi < 2 || olculen.length === 0) {
    parcalar.push('Favori hızı henüz ölçülemedi.');
  }

  return { baslik, giris: parcalar.join(' ') };
}

/** Veriden çıkan, yapılabilir sonraki adımlar. */
function siradakiAdimlar(options: {
  cekimSayisi: number;
  yukselenler: RiserRow[];
  adsizSatici: number;
  aiVar: boolean;
}): string[] {
  const adimlar: string[] = [];
  const olculen = options.yukselenler.filter((r) => Number.isFinite(r.velocity));

  if (options.cekimSayisi < 2 || olculen.length === 0) {
    adimlar.push(
      'Yarın bir çekim daha alın — hız analizleri ancak gün ölçeğinde anlam kazanıyor.',
    );
  } else if (olculen.every((r) => r.velocity === 0)) {
    adimlar.push(
      'Çekimler arasında bir gün bırakın: bu aralıkta hiçbir favori değişmemiş, yani pencere çok dar.',
    );
  }

  if (options.adsizSatici > 0) {
    adimlar.push(
      `${String(options.adsizSatici)} satıcının adı çekilmedi. Çekim formunda “satıcı detayı” sayısını artırın.`,
    );
  }

  if (!options.aiVar) {
    adimlar.push('AI yorumu üretin — ölçülen sayıları okunur bir özete çevirir.');
  }

  if (adimlar.length === 0) {
    adimlar.push(
      'Fırsatlar ekranındaki etiket kadranına bakın; kişiselleştirme benzeri desenler orada görünür.',
    );
  }

  return adimlar;
}

/* --------------------------------------------------------------- */
/* 1. Nişler                                                        */

function nisEkleFormu(): string {
  return `<details class="katlanir" style="border-top:1px solid var(--hairline);padding-top:32px">
    <summary>Yeni niş ekle</summary>
    <form method="post" action="/nis/ekle">
      <div class="form-izgara">
        <div class="alan">
          <label for="niche_id">Kimlik</label>
          <input id="niche_id" name="niche_id" placeholder="seramik-kupa" required>
          <span class="ipucu">URL'de kullanılır. Küçük harf, rakam, tire.</span>
        </div>
        <div class="alan">
          <label for="name">Ad</label>
          <input id="name" name="name" placeholder="Seramik kupa" required>
        </div>
        <div class="alan">
          <label for="keywords">Anahtar kelime</label>
          <input id="keywords" name="keywords" placeholder="ceramic mug">
          <span class="ipucu">Etsy'de arayacağımız terim.</span>
        </div>
        <div class="alan">
          <label for="taxonomy_id">Kategori kimliği</label>
          <input id="taxonomy_id" name="taxonomy_id" inputmode="numeric" placeholder="1633">
        </div>
        <div class="alan">
          <label for="min_price">En düşük fiyat</label>
          <input id="min_price" name="min_price" inputmode="decimal" placeholder="10">
        </div>
        <div class="alan">
          <label for="max_price">En yüksek fiyat</label>
          <input id="max_price" name="max_price" inputmode="decimal" placeholder="80">
        </div>
        <div class="alan">
          <label for="sort_on">Örnekleme</label>
          <select id="sort_on" name="sort_on">
            <option value="score">Alaka düzeyi (önerilen)</option>
            <option value="created">Oluşturma tarihi</option>
            <option value="price">Fiyat</option>
            <option value="updated">Güncellenme</option>
          </select>
          <span class="ipucu">Alaka düzeyi kararlı örneklem verir; hız ölçümü buna bağlı.</span>
        </div>
      </div>
      <div class="form-dip">
        <button class="dugme dugme-birincil" type="submit">Nişi ekle</button>
        <span class="maliyet">Eklemek API çağrısı harcamaz; çekim ayrı bir adım.</span>
      </div>
    </form>
  </details>`;
}

export async function nislerSayfasi(
  mesaj: string | null = null,
  hata = false,
): Promise<string> {
  const nisler = await withDb(async (db) => {
    if (!(await semaHazirMi(db))) return [];
    return db.query<{
      niche_id: string;
      name: string;
      keywords: string | null;
      cekim: string;
      son_cekim: string | null;
      listing: string | null;
      hizlar: string | null;
    }>(`
      select
        n.niche_id, n.name, n.keywords,
        count(s.snapshot_id) filter (where s.status = 'complete') as cekim,
        max(s.started_at)    filter (where s.status = 'complete') as son_cekim,
        max(s.listing_count) filter (where s.status = 'complete') as listing,
        (select string_agg(cast(round(h, 3) as varchar), ',' order by an)
           from (select v.snapshot_id, min(v.observed_at) as an,
                        avg(v.favorite_velocity) as h
                   from v_listing_velocity v
                  where v.niche_id = n.niche_id and v.favorite_velocity is not null
                  group by v.snapshot_id)) as hizlar
      from niches n
      left join snapshots s on s.niche_id = n.niche_id
      where n.is_active
      group by n.niche_id, n.name, n.keywords
      order by n.name
    `);
  });

  const toplamListing = nisler.reduce(
    (t, n) => t + (n.listing === null ? 0 : Number(n.listing)),
    0,
  );
  const olcumeHazir = nisler.filter((n) => Number(n.cekim) >= 2).length;

  const govde =
    nisler.length === 0
      ? `<p class="olculemedi dar">Henüz takip edilen niş yok.</p>
         <p class="ikincil dar">Aşağıdaki formdan bir niş ekleyin, sonra o nişin sayfasından ilk çekimi başlatın.</p>`
      : tablo(
          ['Niş', 'Çekim', 'Listing', 'Hız eğrisi', 'Son çekim'],
          nisler.map((n) => {
            const adet = Number(n.cekim);
            const noktalar =
              n.hizlar === null
                ? []
                : n.hizlar.split(',').map(Number).filter(Number.isFinite);
            return [
              `<a href="/nis/${encodeURIComponent(n.niche_id)}">${esc(n.name)}</a>
               <span class="alt-satir" style="display:block">${esc(n.keywords ?? 'anahtar kelime yok')}</span>`,
              adet < 2
                ? `<span class="olculemedi" title="Hız için en az iki çekim gerekiyor">${esc(tamsayi(adet))}</span>`
                : esc(tamsayi(adet)),
              n.listing === null ? '—' : esc(tamsayi(Number(n.listing))),
              noktalar.length < 2
                ? '<span class="olculemedi">—</span>'
                : sparkline(noktalar),
              `<span class="tnum">${esc(tarih(n.son_cekim))}</span>`,
            ];
          }),
        );

  const m =
    nisler.length === 0
      ? {
          baslik: 'Henüz hiçbir niş takip edilmiyor.',
          giris: 'Bir niş ekleyerek başlayın.',
        }
      : {
          baslik: `${String(nisler.length)} niş izleniyor.`,
          giris: `Toplam ${tamsayi(toplamListing)} listing kayıtlı. ${
            olcumeHazir === 0
              ? 'Hiçbirinde henüz hız ölçülemiyor — bunun için nişte iki çekim gerekiyor.'
              : `${String(olcumeHazir)} nişte hız ölçülebiliyor.`
          }`,
        };

  return sayfa({
    baslik: 'Nişler',
    aktif: '/',
    icerik: `<h1>${esc(m.baslik)}</h1>
      <p class="giris">${esc(m.giris)}</p>
      ${bildirim(mesaj, hata)}
      <div style="margin-top:44px"></div>
      ${bolum({ baslik: 'Takip edilenler', govde })}
      ${nisEkleFormu()}`,
  });
}

/* --------------------------------------------------------------- */
/* 2. Niş Özeti                                                     */

function cekimFormu(id: string): string {
  const tahmin = VARSAYILAN.sayfa + 1 + VARSAYILAN.satici + VARSAYILAN.yorum;
  return `<form method="post" action="/nis/${encodeURIComponent(id)}/snapshot">
    <div class="form-izgara">
      <div class="alan">
        <label for="max_pages">Listing sayfası</label>
        <input id="max_pages" name="max_pages" inputmode="numeric" value="${String(VARSAYILAN.sayfa)}">
        <span class="ipucu">Sayfa başına 100 listing.</span>
      </div>
      <div class="alan">
        <label for="max_shops">Satıcı detayı</label>
        <input id="max_shops" name="max_shops" inputmode="numeric" value="${String(VARSAYILAN.satici)}">
        <span class="ipucu">Bu sayının dışındakiler adsız kalır.</span>
      </div>
      <div class="alan">
        <label for="max_reviews">Yorum çekilecek listing</label>
        <input id="max_reviews" name="max_reviews" inputmode="numeric" value="${String(VARSAYILAN.yorum)}">
        <span class="ipucu">En çok favorilenenlerden başlar.</span>
      </div>
    </div>
    <div class="form-dip">
      <button class="dugme dugme-birincil" type="submit">Çekimi başlat</button>
      <span class="maliyet">Yaklaşık ${String(tahmin)} API çağrısı; yarım dakika kadar sürer ve sayfa o süre bekler.</span>
    </div>
  </form>`;
}

export async function nisOzetiSayfasi(
  id: string,
  mesaj: string | null = null,
  hata = false,
): Promise<string | null> {
  return withDb(async (db) => {
    const nis = await nisGetir(db, id);
    if (nis === null) return null;

    const cekimId = await getLatestSnapshotId(db, id);
    const ai =
      cekimId === null
        ? { nisOzeti: null, yorumTemalari: null, firsatAciklamasi: null }
        : await cachetenOku(db, cekimId);

    const [cekimSayisi, ozet, tazelik, seri, yukselenler, konsantrasyon, saticilar, gecmis] =
      await Promise.all([
        countSnapshots(db, id),
        getMarketOverview(db, id),
        getFreshness(db, id),
        getVelocitySeries(db, id),
        getTopRisers(db, id),
        getConcentration(db, id),
        getSellerTable(db, id, 50),
        db.query<{
          started_at: string;
          listing_count: string;
          api_calls: string;
          status: string;
        }>(
          `select started_at, listing_count, api_calls, status
             from snapshots where niche_id = $id order by started_at desc limit 8`,
          { id },
        ),
      ]);

    const bag: NisBagi = { id, ad: nis.name };
    const yol = `/nis/${encodeURIComponent(id)}`;
    const m = manset(ozet, konsantrasyon, cekimSayisi, yukselenler);
    const adsiz = saticilar.filter((s) => s.shopName === null).length;
    const hareketVar = yukselenler.some(
      (r) => Number.isFinite(r.velocity) && r.velocity > 0,
    );

    const sayiSeridi = `<div class="sayi-seridi">
      ${sayiHucresi('Listing', deger(ozet?.listingCount, 'tamsayi'), 'son çekimde')}
      ${sayiHucresi('Satıcı', deger(ozet?.sellerCount, 'tamsayi'), konsantrasyon === null ? undefined : `HHI ${sayi(konsantrasyon.hhi, 3)}`)}
      ${sayiHucresi('Medyan fiyat', deger(ozet?.medianPrice, 'para'), ozet === null ? undefined : `${para(ozet.p25Price)} – ${para(ozet.p75Price)} aralığında yarısı`)}
      ${sayiHucresi('Listing yaşı', deger(tazelik?.medianAgeDays, 'tamsayi'), 'gün, medyan')}
      ${sayiHucresi('Favori hızı', deger(ozet?.avgVelocity, 'sayi'), cekimSayisi < 2 ? 'ikinci çekimle ölçülecek' : 'adet/gün')}
    </div>`;

    const hizGovde =
      cekimSayisi < 2
        ? olculemediGovdesi(IKI_CEKIM_SEBEBI, IKI_CEKIM_COZUMU)
        : hizSerisi(seri);

    const yukselenGovde = !hareketVar
      ? olculemediGovdesi(
          cekimSayisi < 2
            ? IKI_CEKIM_SEBEBI
            : 'Ölçüldü, ama bu aralıkta hiçbir listing favori kazanmamış.',
          cekimSayisi < 2
            ? IKI_CEKIM_COZUMU
            : 'Favoriler gün ölçeğinde değişiyor; pencereyi genişletin.',
        )
      : tablo(
          ['Başlık', 'Hız /gün', 'Fiyat', 'Favori'],
          yukselenler
            .slice(0, 10)
            .map((r) => [
              r.url === null
                ? `<span class="kirp">${esc(r.title ?? '(başlıksız)')}</span>`
                : `<a class="kirp" href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title ?? '(başlıksız)')}</a>`,
              deger(r.velocity, 'sayi'),
              deger(r.price, 'para'),
              deger(r.numFavorers, 'tamsayi'),
            ]),
        );

    const adimlar = siradakiAdimlar({
      cekimSayisi,
      yukselenler,
      adsizSatici: adsiz,
      aiVar: ai.nisOzeti !== null,
    });

    return sayfa({
      baslik: nis.name,
      nis: bag,
      aktif: yol,
      icerik: `<p class="ust-etiket">${esc(nis.name)} · ${esc(nis.keywords ?? 'anahtar kelime yok')}</p>
        <h1>${esc(m.baslik)}</h1>
        <p class="giris">${esc(m.giris)}</p>
        ${bildirim(mesaj, hata)}
        ${sayiSeridi}
        ${bolum({
          baslik: 'Sıradaki adım',
          govde: `<ol class="adimlar dar">${adimlar.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>`,
        })}
        ${nisOzetiBolumu(ai.nisOzeti, id)}
        ${bolum({
          baslik: 'Favori hızı',
          altBaslik: 'çekim başına ortalama, adet/gün',
          govde: hizGovde,
        })}
        ${bolum({
          baslik: 'Yükselenler',
          altBaslik: 'en hızlı favori kazananlar',
          govde: yukselenGovde,
        })}
        ${bolum({
          baslik: 'Tazelik',
          altBaslik: 'gerçek oluşturma tarihine göre',
          govde:
            tazelik === null
              ? olculemediGovdesi('Oluşturma tarihi bilinen listing yok.')
              : `<p class="dar" style="margin-top:0">Son 30 günde <span class="tnum">${esc(tamsayi(tazelik.newLast30Days))}</span>,
                   son 90 günde <span class="tnum">${esc(tamsayi(tazelik.newLast90Days))}</span> yeni listing girmiş.
                   Medyan yaş <span class="tnum">${esc(tamsayi(tazelik.medianAgeDays))}</span> gün.</p>`,
        })}
        ${bolum({
          baslik: 'Yeni çekim',
          altBaslik: 'API kotası harcar',
          govde: cekimFormu(id),
        })}
        ${bolum({
          baslik: 'Çekim geçmişi',
          govde: tablo(
            ['Zaman', 'Listing', 'API çağrısı', 'Durum'],
            gecmis.map((g) => [
              `<span class="tnum">${esc(tarih(g.started_at))}</span>`,
              esc(tamsayi(Number(g.listing_count))),
              esc(tamsayi(Number(g.api_calls))),
              esc(g.status),
            ]),
            'Henüz çekim yapılmamış.',
          ),
        })}
        ${bolum({
          baslik: 'Niş ayarları',
          govde: `<div class="eylem-satiri">
              <form method="post" action="${yol}/insight">
                <button class="dugme dugme-sade" type="submit">AI yorumu üret</button>
              </form>
              <form method="post" action="${yol}/sil"
                    onsubmit="return confirm('Bu niş ve tüm çekim geçmişi silinecek. Devam edilsin mi?')">
                <button class="dugme dugme-tehlike" type="submit">Nişi sil</button>
              </form>
            </div>
            <p class="alt-satir" style="margin:14px 0 0">Örnekleme: ${esc(nis.sort_on)}</p>`,
        })}`,
    });
  });
}

/* --------------------------------------------------------------- */
/* 3. Fırsatlar                                                     */

export async function firsatlarSayfasi(id: string): Promise<string | null> {
  return withDb(async (db) => {
    const nis = await nisGetir(db, id);
    if (nis === null) return null;

    const cekimId = await getLatestSnapshotId(db, id);
    const ai =
      cekimId === null ? { firsatAciklamasi: null } : await cachetenOku(db, cekimId);

    const [cekimSayisi, bantlar, etiketler, hucreler] = await Promise.all([
      countSnapshots(db, id),
      getPriceDemandCurve(db, id),
      getTagQuadrant(db, id),
      getGapMatrix(db, id),
    ]);

    const bag: NisBagi = { id, ad: nis.name };
    const yol = `/nis/${encodeURIComponent(id)}/firsatlar`;
    const firsatlar = etiketler.filter((t) => t.quadrant === 'firsat');

    if (cekimSayisi < 2) {
      return sayfa({
        baslik: `${nis.name} · Fırsatlar`,
        nis: bag,
        aktif: yol,
        icerik: `<p class="ust-etiket">${esc(nis.name)}</p>
          <h1>Fırsat analizleri henüz ölçülemedi.</h1>
          <p class="giris">Üç analiz de talebin nereye gittiğine bakıyor; talep ise favori hızından geliyor.</p>
          <div style="margin-top:44px"></div>
          ${bolum({ baslik: 'Neden boş', govde: olculemediGovdesi(IKI_CEKIM_SEBEBI, IKI_CEKIM_COZUMU) })}`,
      });
    }

    const enIyi = firsatlar[0];
    const baslik =
      enIyi === undefined
        ? 'Öne çıkan etiket fırsatı bulunamadı.'
        : `${String(firsatlar.length)} etiket getirisinin üstünde, kullanımının altında.`;
    const giris =
      enIyi === undefined
        ? 'Bu çekimde hiçbir etiket, medyanın üstünde getiri ile medyanın altında kullanımı bir arada taşımıyor.'
        : `En belirgini “${enIyi.tag}”: ${tamsayi(enIyi.usageCount)} listing’de geçiyor, ortalama ${sayi(enIyi.avgVelocity)} favori/gün taşıyor.`;

    return sayfa({
      baslik: `${nis.name} · Fırsatlar`,
      nis: bag,
      aktif: yol,
      icerik: `<p class="ust-etiket">${esc(nis.name)}</p>
        <h1>${esc(baslik)}</h1>
        <p class="giris">${esc(giris)}</p>
        <div style="margin-top:44px"></div>
        ${bolum({
          baslik: 'Etiket kadranı',
          altBaslik: 'kullanım × getiri',
          govde: `${
            firsatlar.length > 0
              ? `<p style="margin:0 0 14px"><span class="firsat-rozet">${esc(tamsayi(firsatlar.length))} fırsat</span></p>`
              : ''
          }${etiketKadrani(etiketler)}`,
        })}
        ${bolum({
          baslik: 'Fiyat–talep',
          altBaslik: 'bant başına arz ve talep',
          govde: fiyatTalep(bantlar),
        })}
        ${bolum({
          baslik: 'Boşluk matrisi',
          altBaslik: 'kategori × fiyat bandı',
          govde: boslukMatrisi(hucreler),
        })}
        ${firsatAciklamasiBolumu(ai.firsatAciklamasi, id)}`,
    });
  });
}

/* --------------------------------------------------------------- */
/* 4. Rakipler                                                      */

export async function rakiplerSayfasi(id: string): Promise<string | null> {
  return withDb(async (db) => {
    const nis = await nisGetir(db, id);
    if (nis === null) return null;

    const cekimId = await getLatestSnapshotId(db, id);
    const ai = cekimId === null ? { yorumTemalari: null } : await cachetenOku(db, cekimId);

    const [saticilar, konsantrasyon, yorumlar] = await Promise.all([
      getSellerTable(db, id, 50),
      getConcentration(db, id),
      getReviewStats(db, id),
    ]);

    const bag: NisBagi = { id, ad: nis.name };
    const adsiz = saticilar.filter((s) => s.shopName === null).length;
    const dusuk = yorumlar.ratingDistribution
      .filter((r) => r.rating <= 3)
      .reduce((t, r) => t + r.count, 0);
    const toplamYorum = yorumlar.ratingDistribution.reduce((t, r) => t + r.count, 0);

    const baslik =
      konsantrasyon === null
        ? 'Satıcı verisi yok.'
        : konsantrasyon.top10Share < 0.25
          ? 'Pazar dağınık, tek bir satıcı baskın değil.'
          : konsantrasyon.top10Share < 0.5
            ? 'Pazar orta yoğunlukta.'
            : 'Pazar birkaç satıcının elinde.';

    const giris =
      konsantrasyon === null
        ? 'Bu niş için satıcı çekilmemiş.'
        : `${tamsayi(konsantrasyon.sellerCount)} satıcı listeleniyor; en büyük onu listinglerin %${(konsantrasyon.top10Share * 100).toFixed(0)}’ini tutuyor.${
            toplamYorum > 0
              ? ` Çekilen ${tamsayi(toplamYorum)} yorumun ${tamsayi(dusuk)} tanesi üç yıldız ve altı.`
              : ''
          }`;

    return sayfa({
      baslik: `${nis.name} · Rakipler`,
      nis: bag,
      aktif: `/nis/${encodeURIComponent(id)}/rakipler`,
      icerik: `<p class="ust-etiket">${esc(nis.name)}</p>
        <h1>${esc(baslik)}</h1>
        <p class="giris">${esc(giris)}</p>
        ${
          konsantrasyon === null
            ? '<div style="margin-top:44px"></div>'
            : `<div class="sayi-seridi">
                ${sayiHucresi('Satıcı', deger(konsantrasyon.sellerCount, 'tamsayi'))}
                ${sayiHucresi('Top-10 payı', deger(konsantrasyon.top10Share, 'yuzde'))}
                ${sayiHucresi('HHI', deger(konsantrasyon.hhi, 'sayi'), '1’e yakın = tekel')}
              </div>`
        }
        ${bolum({
          baslik: 'Satıcılar',
          altBaslik: adsiz > 0 ? `${String(adsiz)} tanesinin adı çekilmedi` : undefined,
          govde: tablo(
            ['Satıcı', 'Listing', 'Hız /gün', 'Favori', 'Puan'],
            saticilar.map((s) => [
              s.shopName === null
                ? `<span class="olculemedi" title="Bu satıcının detayı çekilmedi">#${esc(String(s.shopId))} · ad çekilmedi</span>`
                : esc(s.shopName),
              deger(s.listingCount, 'tamsayi'),
              deger(s.avgVelocity, 'sayi'),
              deger(s.totalFavorers, 'tamsayi'),
              deger(s.reviewAverage, 'sayi'),
            ]),
            'Satıcı verisi yok.',
          ),
        })}
        ${bolum({
          baslik: 'Yorumlar',
          altBaslik: 'puan dağılımı',
          govde: `${tablo(
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
              : `<p class="alt-satir" style="margin:22px 0 10px">Düşük puanlı yorumlardan örnekler</p>
                 <ul class="dar" style="padding-left:18px;margin:0">
                   ${yorumlar.lowRated
                     .slice(0, 8)
                     .map(
                       (r) =>
                         `<li><span class="tnum olculemedi">${esc(String(r.rating))}</span> ${esc(r.text.slice(0, 180))}</li>`,
                     )
                     .join('')}
                 </ul>`
          }`,
        })}
        ${yorumTemalariBolumu(ai.yorumTemalari, id)}`,
    });
  });
}

/* --------------------------------------------------------------- */
/* 5. Listing Gezgini                                               */

const SIRALAMALAR: Record<string, { etiket: string; sql: string }> = {
  hiz: { etiket: 'Favori hızı', sql: 'v.favorite_velocity desc nulls last' },
  favori: { etiket: 'Favori', sql: 'v.num_favorers desc nulls last' },
  fiyat: { etiket: 'Fiyat (yüksek)', sql: 'v.price_amount desc nulls last' },
  ucuz: { etiket: 'Fiyat (düşük)', sql: 'v.price_amount asc nulls last' },
  yeni: { etiket: 'En yeni', sql: 'l.original_creation_timestamp desc nulls last' },
};

export interface ListingFiltresi {
  sirala: string;
  ara: string | null;
  minFiyat: string | null;
  maxFiyat: string | null;
}

export async function listinglerSayfasi(
  id: string,
  filtre: ListingFiltresi,
): Promise<string | null> {
  const anahtar = filtre.sirala in SIRALAMALAR ? filtre.sirala : 'hiz';
  const sirala = SIRALAMALAR[anahtar];
  if (sirala === undefined) return null;

  return withDb(async (db) => {
    const nis = await nisGetir(db, id);
    if (nis === null) return null;

    const kosullar = ['v.niche_id = $niche'];
    const parametreler: Record<string, string | number> = { niche: id };

    if (filtre.ara !== null && filtre.ara.trim() !== '') {
      kosullar.push('lower(l.title) like $ara');
      parametreler.ara = `%${filtre.ara.trim().toLowerCase()}%`;
    }
    const min = Number(filtre.minFiyat);
    if (filtre.minFiyat !== null && Number.isFinite(min)) {
      kosullar.push('v.price_amount >= $min');
      parametreler.min = min;
    }
    const max = Number(filtre.maxFiyat);
    if (filtre.maxFiyat !== null && Number.isFinite(max)) {
      kosullar.push('v.price_amount <= $max');
      parametreler.max = max;
    }

    const satirlar = await db.query<{
      listing_id: string;
      title: string | null;
      url: string | null;
      price_amount: number | null;
      num_favorers: string | null;
      favorite_velocity: number | null;
      shop_name: string | null;
      shop_id: string | null;
    }>(
      `select v.listing_id, l.title, l.url, v.price_amount, v.num_favorers,
              v.favorite_velocity, sh.shop_name, l.shop_id
         from v_listing_velocity v
         join v_latest_snapshot s
           on s.niche_id = v.niche_id and s.snapshot_id = v.snapshot_id
         join listings l on l.listing_id = v.listing_id
         left join shops sh on sh.shop_id = l.shop_id
        where ${kosullar.join(' and ')}
        order by ${sirala.sql}, v.listing_id
        limit 200`,
      parametreler,
    );

    const bag: NisBagi = { id, ad: nis.name };
    const yol = `/nis/${encodeURIComponent(id)}/listingler`;
    const filtreliMi =
      (filtre.ara !== null && filtre.ara !== '') ||
      (filtre.minFiyat !== null && filtre.minFiyat !== '') ||
      (filtre.maxFiyat !== null && filtre.maxFiyat !== '');

    const siralamaBaglari = Object.entries(SIRALAMALAR)
      .map(([k, s]) => {
        const url = new URL(yol, 'http://yerel');
        url.searchParams.set('sirala', k);
        if (filtre.ara !== null && filtre.ara !== '') url.searchParams.set('ara', filtre.ara);
        if (filtre.minFiyat !== null && filtre.minFiyat !== '')
          url.searchParams.set('min', filtre.minFiyat);
        if (filtre.maxFiyat !== null && filtre.maxFiyat !== '')
          url.searchParams.set('max', filtre.maxFiyat);
        return k === anahtar
          ? `<strong>${esc(s.etiket)}</strong>`
          : `<a href="${esc(`${url.pathname}${url.search}`)}">${esc(s.etiket)}</a>`;
      })
      .join('');

    return sayfa({
      baslik: `${nis.name} · Listingler`,
      nis: bag,
      aktif: yol,
      icerik: `<p class="ust-etiket">${esc(nis.name)}</p>
        <h1>${esc(tamsayi(satirlar.length))} listing listeleniyor.</h1>
        <p class="giris">Son çekimdeki kayıtlar, ${esc(sirala.etiket.toLowerCase())} sırasına göre.${
          filtreliMi ? ' Filtre uygulandı.' : ' En fazla 200 satır gösterilir.'
        }</p>
        <div style="margin-top:44px"></div>
        ${bolum({
          baslik: 'Filtre',
          govde: `<form method="get" action="${yol}" class="filtre-satiri">
              <input type="hidden" name="sirala" value="${esc(anahtar)}">
              <div class="alan">
                <label for="ara">Başlıkta ara</label>
                <input id="ara" name="ara" value="${esc(filtre.ara ?? '')}" placeholder="handmade">
              </div>
              <div class="alan">
                <label for="min">En düşük fiyat</label>
                <input id="min" name="min" inputmode="decimal" value="${esc(filtre.minFiyat ?? '')}">
              </div>
              <div class="alan">
                <label for="max">En yüksek fiyat</label>
                <input id="max" name="max" inputmode="decimal" value="${esc(filtre.maxFiyat ?? '')}">
              </div>
              <button class="dugme dugme-sade" type="submit">Uygula</button>
              ${filtreliMi ? `<a class="dugme dugme-sade" href="${yol}">Temizle</a>` : ''}
            </form>
            <p class="siralama">Sırala: ${siralamaBaglari}</p>`,
        })}
        ${bolum({
          baslik: 'Listingler',
          govde: tablo(
            ['Başlık', 'Hız /gün', 'Fiyat', 'Favori'],
            satirlar.map((r) => [
              `${
                r.url === null
                  ? `<span class="kirp">${esc(r.title ?? '(başlıksız)')}</span>`
                  : `<a class="kirp" href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title ?? '(başlıksız)')}</a>`
              }<span class="alt-satir">${
                r.shop_name === null
                  ? `#${esc(String(r.shop_id ?? '—'))} · ad çekilmedi`
                  : esc(r.shop_name)
              }</span>`,
              deger(r.favorite_velocity, 'sayi'),
              deger(r.price_amount, 'para'),
              deger(r.num_favorers === null ? null : Number(r.num_favorers), 'tamsayi'),
            ]),
            'Bu filtreyle eşleşen listing yok.',
          ),
        })}`,
    });
  });
}

export { para, sayi };

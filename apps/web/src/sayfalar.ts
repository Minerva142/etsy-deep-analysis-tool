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
  type Db,
} from '@etsy-analysis/core/analysis';
import { semaHazirMi, withDb } from './lib/db.js';
import { para, sayi, tamsayi, tarih } from './lib/format.js';
import {
  boslukMatrisi,
  etiketKadrani,
  fiyatTalep,
  hizSerisi,
} from './grafikler.js';
import { sparkline } from './sparkline.js';
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

/* Veri bütünlüğü: bu varsayılanlar tabloların boş kalmaması için seçildi.
   Daha düşük değerler hızlı ama satıcı adları ve yorumlar eksik gelir. */
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

function bildirimSeridi(mesaj: string | null, hata: boolean): string {
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

function kpi(
  etiket: string,
  degerHtml: string,
  alt?: string,
): string {
  return `<div class="kpi">
    <p class="kpi-etiket">${esc(etiket)}</p>
    <div class="kpi-deger">${degerHtml}</div>
    ${alt === undefined ? '' : `<p class="kpi-alt">${esc(alt)}</p>`}
  </div>`;
}

/* --------------------------------------------------------------- */
/* 1. Nişler                                                        */

function nisEkleFormu(): string {
  return `<details class="katlanir kart" style="margin-bottom:16px">
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
          <span class="ipucu">İsteğe bağlı. Aramayı daraltır.</span>
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
  bildirim: string | null = null,
  hata = false,
): Promise<string> {
  const nisler = await withDb(async (db) => {
    if (!(await semaHazirMi(db))) return [];
    return db.query<{
      niche_id: string;
      name: string;
      keywords: string | null;
      snapshot_sayisi: string;
      son_snapshot: string | null;
      listing_sayisi: string | null;
      hizlar: string | null;
    }>(`
      select
        n.niche_id, n.name, n.keywords,
        count(s.snapshot_id) filter (where s.status = 'complete') as snapshot_sayisi,
        max(s.started_at)    filter (where s.status = 'complete') as son_snapshot,
        max(s.listing_count) filter (where s.status = 'complete') as listing_sayisi,
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

  const liste =
    nisler.length === 0
      ? `<div class="kart bos">
           <h2>Henüz takip edilen niş yok</h2>
           <p class="dar">Yukarıdaki formdan bir niş ekleyin, sonra o nişin sayfasından ilk çekimi başlatın.</p>
         </div>`
      : `<section class="kart">${tablo(
          ['Niş', 'Snapshot', 'Listing', 'Hız eğrisi', 'Son çekim'],
          nisler.map((n) => {
            const adet = Number(n.snapshot_sayisi);
            const noktalar =
              n.hizlar === null
                ? []
                : n.hizlar.split(',').map(Number).filter(Number.isFinite);
            return [
              `<a href="/nis/${encodeURIComponent(n.niche_id)}">${esc(n.name)}</a>
               <div class="olculemedi">${esc(n.keywords ?? 'anahtar kelime yok')}</div>`,
              adet < 2
                ? `<span class="olculemedi" title="Hız analizleri için en az iki snapshot gerekiyor">${esc(tamsayi(adet))}</span>`
                : esc(tamsayi(adet)),
              n.listing_sayisi === null ? '—' : esc(tamsayi(Number(n.listing_sayisi))),
              noktalar.length < 2
                ? '<span class="olculemedi">—</span>'
                : sparkline(noktalar),
              `<span class="sayi">${esc(tarih(n.son_snapshot))}</span>`,
            ];
          }),
        )}</section>`;

  return sayfa({
    baslik: 'Nişler',
    aktif: '/',
    icerik: `<div class="sayfa-basi"><h1>Nişler</h1></div>
      <p class="sayfa-alt">Her niş için periyodik çekim yapılır. Talep analizleri ardışık çekimler arasındaki değişimden hesaplandığı için, ikinci çekim alınana kadar hız değerleri ölçülemez.</p>
      ${bildirimSeridi(bildirim, hata)}
      ${nisEkleFormu()}
      ${liste}`,
  });
}

/* --------------------------------------------------------------- */
/* 2. Niş Özeti                                                     */

function cekimFormu(id: string): string {
  const tahmin = VARSAYILAN.sayfa + 1 + VARSAYILAN.satici + VARSAYILAN.yorum;
  return `<details class="katlanir kart">
    <summary>Yeni çekim başlat</summary>
    <form method="post" action="/nis/${encodeURIComponent(id)}/snapshot">
      <div class="form-izgara">
        <div class="alan">
          <label for="max_pages">Listing sayfası</label>
          <input id="max_pages" name="max_pages" inputmode="numeric" value="${String(VARSAYILAN.sayfa)}">
          <span class="ipucu">Sayfa başına 100 listing.</span>
        </div>
        <div class="alan">
          <label for="max_shops">Satıcı detayı</label>
          <input id="max_shops" name="max_shops" inputmode="numeric" value="${String(VARSAYILAN.satici)}">
          <span class="ipucu">Bu sayının dışındaki satıcılar adsız kalır.</span>
        </div>
        <div class="alan">
          <label for="max_reviews">Yorum çekilecek listing</label>
          <input id="max_reviews" name="max_reviews" inputmode="numeric" value="${String(VARSAYILAN.yorum)}">
          <span class="ipucu">En çok favorilenenlerden başlar.</span>
        </div>
      </div>
      <div class="form-dip">
        <button class="dugme dugme-birincil" type="submit">Çekimi başlat</button>
        <span class="maliyet">Bu ayarlarla yaklaşık ${String(tahmin)} API çağrısı; yarım dakika kadar sürer ve sayfa o süre boyunca bekler.</span>
      </div>
    </form>
  </details>`;
}

export async function nisOzetiSayfasi(
  id: string,
  bildirim: string | null = null,
  hata = false,
): Promise<string | null> {
  return withDb(async (db) => {
    const nis = await nisGetir(db, id);
    if (nis === null) return null;

    const snapshotId = await getLatestSnapshotId(db, id);
    const ai =
      snapshotId === null
        ? { nisOzeti: null, yorumTemalari: null, firsatAciklamasi: null }
        : await cachetenOku(db, snapshotId);

    const [snapshotSayisi, ozet, tazelik, seri, yukselenler, gecmis] = await Promise.all([
      countSnapshots(db, id),
      getMarketOverview(db, id),
      getFreshness(db, id),
      getVelocitySeries(db, id),
      getTopRisers(db, id),
      db.query<{
        started_at: string;
        listing_count: string;
        api_calls: string;
        status: string;
      }>(
        `select started_at, listing_count, api_calls, status
           from snapshots where niche_id = $id order by started_at desc limit 10`,
        { id },
      ),
    ]);

    const bag: NisBagi = { id, ad: nis.name };
    const yol = `/nis/${encodeURIComponent(id)}`;

    const kpiSeridi = `<section class="kart">
      <div class="kpi-serisi">
        ${kpi('Çekim', esc(tamsayi(snapshotSayisi)), snapshotSayisi < 2 ? 'hız ölçülemiyor' : 'hız ölçülebiliyor')}
        ${kpi('Listing', deger(ozet?.listingCount, 'tamsayi'))}
        ${kpi('Satıcı', deger(ozet?.sellerCount, 'tamsayi'))}
        ${kpi('Medyan fiyat', deger(ozet?.medianPrice, 'para'))}
        ${kpi('Favori hızı', deger(ozet?.avgVelocity, 'sayi'), 'adet/gün')}
      </div>
    </section>`;

    const pazar =
      ozet === null
        ? olculemediBolumu('Pazar görünümü', 'Bu niş için henüz gözlem yok.', 'Yukarıdan bir çekim başlatın.')
        : `<section class="kart">
            <h2>Pazar görünümü</h2>
            <dl class="deger-listesi">
              <dt>Fiyat aralığı</dt><dd>${deger(ozet.p25Price, 'para')} – ${deger(ozet.p75Price, 'para')} <span class="olculemedi">(p25–p75)</span></dd>
              <dt>Toplam favori</dt><dd>${deger(ozet.totalFavorers, 'tamsayi')}</dd>
              <dt>Örnekleme</dt><dd>${esc(nis.sort_on)}</dd>
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

    // Hepsi sıfırsa sıralama yoktur: rastgele on satır göstermek
    // "bunlar yükseliyor" izlenimi verir. Ölçüldü ama hareket yok demek doğrusu.
    const hareketYok =
      yukselenler.length > 0 && yukselenler.every((r) => r.velocity === 0);

    const yukselenBolumu =
      snapshotSayisi < 2
        ? ''
        : hareketYok
          ? `<section class="kart">
              <h2>En hızlı yükselen listingler</h2>
              <p class="olculemedi dar">Ölçüldü, ama hiçbir listing favori kazanmamış.
                Çekimler arası süre favori hareketini yakalamak için fazla kısa olabilir —
                favoriler gün ölçeğinde değişiyor.</p>
            </section>`
          : `<section class="kart">
            <h2>En hızlı yükselen listingler</h2>
            ${tablo(
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

    const gecmisBolumu = `<section class="kart">
      <h2>Çekim geçmişi</h2>
      ${tablo(
        ['Zaman', 'Listing', 'API çağrısı', 'Durum'],
        gecmis.map((g) => [
          `<span class="sayi">${esc(tarih(g.started_at))}</span>`,
          esc(tamsayi(Number(g.listing_count))),
          esc(tamsayi(Number(g.api_calls))),
          esc(g.status),
        ]),
        'Henüz çekim yapılmamış.',
      )}
    </section>`;

    return sayfa({
      baslik: nis.name,
      nis: bag,
      aktif: yol,
      icerik: `<div class="sayfa-basi">
          <div>
            <h1>${esc(nis.name)}</h1>
            <p class="ikincil" style="margin:2px 0 0">${esc(nis.keywords ?? 'anahtar kelime yok')}</p>
          </div>
          <div class="eylemler">
            <form method="post" action="${yol}/insight">
              <button class="dugme" type="submit">AI yorumu üret</button>
            </form>
            <form method="post" action="${yol}/sil"
                  onsubmit="return confirm('Bu niş ve tüm çekim geçmişi silinecek. Devam edilsin mi?')">
              <button class="dugme dugme-tehlike" type="submit">Nişi sil</button>
            </form>
          </div>
        </div>
        <p class="sayfa-alt"></p>
        ${bildirimSeridi(bildirim, hata)}
        <div class="yigin">
          ${kpiSeridi}
          ${cekimFormu(id)}
          <div class="izgara-2">${pazar}${tazelikBolumu}</div>
          ${nisOzetiBolumu(ai.nisOzeti, id)}
          ${hizBolumu}
          ${yukselenBolumu}
          ${gecmisBolumu}
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
    const yol = `/nis/${encodeURIComponent(id)}/firsatlar`;

    if (snapshotSayisi < 2) {
      return sayfa({
        baslik: `${nis.name} · Fırsatlar`,
        nis: bag,
        aktif: yol,
        icerik: `<div class="sayfa-basi"><h1>Fırsatlar</h1></div>
          <p class="sayfa-alt">Üç analiz de talebin nereye gittiğine bakıyor; talep ise favori hızından geliyor.</p>
          ${olculemediBolumu('Fırsat analizleri ölçülemedi', IKI_SNAPSHOT_SEBEBI, IKI_SNAPSHOT_COZUMU)}`,
      });
    }

    const firsatEtiketleri = etiketler.filter((t) => t.quadrant === 'firsat');

    return sayfa({
      baslik: `${nis.name} · Fırsatlar`,
      nis: bag,
      aktif: yol,
      icerik: `<div class="sayfa-basi"><h1>Fırsatlar</h1></div>
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
      getSellerTable(db, id, 50),
      getConcentration(db, id),
      getReviewStats(db, id),
    ]);

    const bag: NisBagi = { id, ad: nis.name };
    const adsiz = saticilar.filter((s) => s.shopName === null).length;

    const konsantrasyonBolumu =
      konsantrasyon === null
        ? olculemediBolumu('Rekabet yoğunluğu', 'Satıcı verisi yok.')
        : `<section class="kart">
            <h2>Rekabet yoğunluğu</h2>
            <div class="kpi-serisi">
              ${kpi('Satıcı', deger(konsantrasyon.sellerCount, 'tamsayi'))}
              ${kpi('Top-10 payı', deger(konsantrasyon.top10Share, 'yuzde'))}
              ${kpi('HHI', deger(konsantrasyon.hhi, 'sayi'), '1’e yakın = tekel')}
            </div>
          </section>`;

    return sayfa({
      baslik: `${nis.name} · Rakipler`,
      nis: bag,
      aktif: `/nis/${encodeURIComponent(id)}/rakipler`,
      icerik: `<div class="sayfa-basi"><h1>Rakipler</h1></div>
        <p class="sayfa-alt">Bu nişte kimler var, pazar ne kadar dağınık ve alıcılar neden şikâyet ediyor?</p>
        <div class="yigin">
          ${konsantrasyonBolumu}
          <section class="kart">
            <h2>Satıcılar</h2>
            ${
              adsiz === 0
                ? ''
                : `<p class="grafik-alt" style="margin-top:0;margin-bottom:12px">${esc(String(adsiz))} satıcının adı çekilmemiş. Çekim formunda “satıcı detayı” sayısını artırıp yeni bir çekim alın.</p>`
            }
            ${tablo(
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
            )}
          </section>
          <section class="kart">
            <h2>Yorumlar</h2>
            ${tablo(
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
                       .slice(0, 10)
                       .map(
                         (r) =>
                           `<li><span class="sayi olculemedi">${esc(String(r.rating))}</span> ${esc(r.text.slice(0, 180))}</li>`,
                       )
                       .join('')}
                   </ul>`
            }
          </section>
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
  const siralamaAnahtari = filtre.sirala in SIRALAMALAR ? filtre.sirala : 'hiz';
  const sirala = SIRALAMALAR[siralamaAnahtari];
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

    const siralamaBaglari = Object.entries(SIRALAMALAR)
      .map(([anahtar, s]) => {
        const url = new URL(yol, 'http://yerel');
        url.searchParams.set('sirala', anahtar);
        if (filtre.ara !== null && filtre.ara !== '') url.searchParams.set('ara', filtre.ara);
        if (filtre.minFiyat !== null && filtre.minFiyat !== '')
          url.searchParams.set('min', filtre.minFiyat);
        if (filtre.maxFiyat !== null && filtre.maxFiyat !== '')
          url.searchParams.set('max', filtre.maxFiyat);
        return anahtar === siralamaAnahtari
          ? `<strong>${esc(s.etiket)}</strong>`
          : `<a href="${esc(`${url.pathname}${url.search}`)}">${esc(s.etiket)}</a>`;
      })
      .join('');

    return sayfa({
      baslik: `${nis.name} · Listingler`,
      nis: bag,
      aktif: yol,
      icerik: `<div class="sayfa-basi"><h1>Listing gezgini</h1></div>
        <p class="sayfa-alt">Son çekimdeki listingler. En fazla 200 satır gösterilir.</p>
        <section class="kart">
          <form method="get" action="${yol}" class="filtre-satiri">
            <input type="hidden" name="sirala" value="${esc(siralamaAnahtari)}">
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
            <button class="dugme" type="submit">Filtrele</button>
            ${
              filtre.ara !== null || filtre.minFiyat !== null || filtre.maxFiyat !== null
                ? `<a class="dugme" href="${yol}" style="text-decoration:none">Temizle</a>`
                : ''
            }
          </form>
          <p class="grafik-alt siralama-baglari" style="margin-bottom:14px">Sırala: ${siralamaBaglari}</p>
          <p class="grafik-alt" style="margin-top:0;margin-bottom:14px">${esc(tamsayi(satirlar.length))} satır</p>
          ${tablo(
            ['Başlık', 'Hız /gün', 'Fiyat', 'Favori'],
            satirlar.map((r) => [
              `${
                r.url === null
                  ? `<span class="kirp">${esc(r.title ?? '(başlıksız)')}</span>`
                  : `<a class="kirp" href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.title ?? '(başlıksız)')}</a>`
              }<div class="olculemedi">${
                r.shop_name === null
                  ? `#${esc(String(r.shop_id ?? '—'))} · ad çekilmedi`
                  : esc(r.shop_name)
              }</div>`,
              deger(r.favorite_velocity, 'sayi'),
              deger(r.price_amount, 'para'),
              deger(r.num_favorers === null ? null : Number(r.num_favorers), 'tamsayi'),
            ]),
            'Bu filtreyle eşleşen listing yok.',
          )}
        </section>`,
    });
  });
}

export { para, sayi };

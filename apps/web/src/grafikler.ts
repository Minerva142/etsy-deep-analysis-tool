import type {
  GapCell,
  PriceBand,
  PriceBin,
  TagRow,
  VelocityPoint,
} from '@etsy-analysis/core/analysis';
import { esc } from './html.js';
import { para, sayi, tamsayi } from './lib/format.js';

/**
 * Grafikler sayfanın TAM sütun genişliğinde çiziliyor (912 px).
 *
 * viewBox ölçeklendiğinde içindeki yazı da ölçekleniyor: dar bir kapta
 * duran geniş bir viewBox, 12 px etiketi ekranda 7 px yapar. Bu yüzden
 * viewBox genişliği gerçek render genişliğine eşit — ölçek 1, punto birebir.
 */
const W = 912;

/** Bir değeri kaynak aralığından hedef aralığına taşır. */
export function olcek(
  deger: number,
  [altKaynak, ustKaynak]: [number, number],
  [altHedef, ustHedef]: [number, number],
): number {
  if (ustKaynak === altKaynak) return (altHedef + ustHedef) / 2;
  const oran = (deger - altKaynak) / (ustKaynak - altKaynak);
  return altHedef + oran * (ustHedef - altHedef);
}

/** Ekseni okunur aralıklara böler. */
export function tickler(alt: number, ust: number, adet = 4): number[] {
  if (!Number.isFinite(alt) || !Number.isFinite(ust) || ust <= alt) return [alt];
  const ham = (ust - alt) / adet;
  const buyukluk = 10 ** Math.floor(Math.log10(ham));
  const adim = [1, 2, 2.5, 5, 10].map((m) => m * buyukluk).find((a) => a >= ham) ?? ham;
  const out: number[] = [];
  for (let v = Math.ceil(alt / adim) * adim; v <= ust + adim * 0.001; v += adim) {
    out.push(Number(v.toFixed(10)));
  }
  return out;
}

function tabloGorunumu(basliklar: string[], satirlar: string[][]): string {
  return `<details class="tablo-gorunumu">
    <summary>Tablo görünümü</summary>
    <div class="kaydir"><table>
      <thead><tr>${basliklar
        .map((b, i) => `<th${i === 0 ? '' : ' class="num"'}>${esc(b)}</th>`)
        .join('')}</tr></thead>
      <tbody>${satirlar
        .map(
          (s) =>
            `<tr>${s
              .map((h, i) => `<td${i === 0 ? '' : ' class="num"'}>${esc(h)}</td>`)
              .join('')}</tr>`,
        )
        .join('')}</tbody>
    </table></div>
  </details>`;
}

const G = { sol: 58, sag: 20, ust: 22 };
const PUNTO = { eksen: 12, etiket: 12.5, deger: 12 };

function bosMesaj(metin: string): string {
  return `<p class="olculemedi dar" style="margin:0">${esc(metin)}</p>`;
}

/* ------------------------------------------------------------------ */
/* Favori hızı zaman serisi — tek seri, legend yok                     */

export function hizSerisi(noktalar: VelocityPoint[]): string {
  const olculen = noktalar.filter((n) => n.avgVelocity !== null);
  if (olculen.length < 2) {
    return bosMesaj(
      'Zaman serisi için en az iki ölçülmüş nokta gerekiyor. Bir çekim daha alın.',
    );
  }

  const H = 250;
  const x0 = G.sol;
  const x1 = W - G.sag;
  const y0 = H - 46;
  const y1 = G.ust;

  const degerler = olculen.map((n) => n.avgVelocity ?? 0);
  const enAz = Math.min(0, ...degerler);
  const enCok = Math.max(...degerler);
  const yTick = tickler(enAz, enCok === enAz ? enAz + 1 : enCok, 4);
  const yAlt = Math.min(enAz, ...yTick);
  const yUst = Math.max(enCok, ...yTick);

  const xOf = (i: number): number => olcek(i, [0, olculen.length - 1], [x0, x1]);
  const yOf = (v: number): number => olcek(v, [yAlt, yUst], [y0, y1]);

  const cizgi = olculen
    .map(
      (n, i) =>
        `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(n.avgVelocity ?? 0).toFixed(1)}`,
    )
    .join(' ');

  const gridler = yTick
    .map(
      (t) =>
        `<line x1="${String(x0)}" x2="${String(x1)}" y1="${yOf(t).toFixed(1)}" y2="${yOf(t).toFixed(1)}" stroke="var(--izgara)" stroke-width="1"/>
         <text x="${String(x0 - 12)}" y="${(yOf(t) + 4).toFixed(1)}" text-anchor="end" font-size="${String(PUNTO.eksen)}" fill="var(--soluk)">${esc(sayi(t, 1))}</text>`,
    )
    .join('');

  const isaretciler = olculen
    .map(
      (n, i) =>
        `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(n.avgVelocity ?? 0).toFixed(1)}" r="5"
           fill="var(--seri)" stroke="var(--kagit)" stroke-width="2">
           <title>${esc(n.observedAt)} · ${esc(sayi(n.avgVelocity))} /gün</title>
         </circle>`,
    )
    .join('');

  // Yalnızca ilk ve son tarih: aradakiler üst üste biner.
  const ilk = olculen[0];
  const son = olculen[olculen.length - 1];
  const xEtiket =
    ilk === undefined || son === undefined
      ? ''
      : `<text x="${String(x0)}" y="${String(H - 14)}" font-size="${String(PUNTO.eksen)}" fill="var(--soluk)">${esc(ilk.observedAt.slice(0, 16))}</text>
         <text x="${String(x1)}" y="${String(H - 14)}" text-anchor="end" font-size="${String(PUNTO.eksen)}" fill="var(--soluk)">${esc(son.observedAt.slice(0, 16))}</text>`;

  return `<svg class="grafik" viewBox="0 0 ${String(W)} ${String(H)}" role="img"
    aria-label="Ortalama favori hızının çekimler boyunca seyri">
    ${gridler}
    <line x1="${String(x0)}" x2="${String(x1)}" y1="${String(y0)}" y2="${String(y0)}" stroke="var(--hairline)" stroke-width="1"/>
    <path d="${cizgi}" fill="none" stroke="var(--seri)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${isaretciler}${xEtiket}
  </svg>
  ${tabloGorunumu(
    ['Çekim', 'Ort. hız /gün', 'Listing'],
    olculen.map((n) => [n.observedAt, sayi(n.avgVelocity), tamsayi(n.listingCount)]),
  )}`;
}

/* ------------------------------------------------------------------ */
/* Fiyat–talep: TEK eksen. y = talep/listing, arz doğrudan etiket.      */

/**
 * Fiyat bandı grafiği. `arzModu` talep ölçülemediğinde devreye girer:
 * hepsi sıfır olan bir talep serisini çizmek yerine, gerçekten ölçülmüş
 * olan arz dağılımını çizeriz.
 */
export function fiyatTalep(bantlar: PriceBand[], arzModu = false): string {
  if (bantlar.length === 0) return bosMesaj('Bant verisi yok.');

  const H = 300;
  const x0 = G.sol;
  const x1 = W - G.sag;
  const y0 = H - 64;
  const y1 = G.ust + 10;

  const kur = bantlar[0]?.currency ?? null;
  const cizilen = (b: PriceBand): number => (arzModu ? b.supply : b.demandPerListing);
  const toplamArz = bantlar.reduce((t, b) => t + b.supply, 0);
  const enCok = Math.max(...bantlar.map(cizilen), 0);
  const yTick = tickler(0, enCok === 0 ? 1 : enCok, 4);
  const yUst = Math.max(enCok, ...yTick);

  const genislik = (x1 - x0) / bantlar.length;
  const cubukGen = Math.max(10, genislik - 14);

  const gridler = yTick
    .map((t) => {
      const y = olcek(t, [0, yUst], [y0, y1]);
      return `<line x1="${String(x0)}" x2="${String(x1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--izgara)" stroke-width="1"/>
        <text x="${String(x0 - 12)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="${String(PUNTO.eksen)}" fill="var(--soluk)">${esc(arzModu ? tamsayi(t) : sayi(t, 1))}</text>`;
    })
    .join('');

  const cubuklar = bantlar
    .map((b, i) => {
      const x = x0 + i * genislik + (genislik - cubukGen) / 2;
      const y = olcek(cizilen(b), [0, yUst], [y0, y1]);
      const h = Math.max(1, y0 - y);
      const orta = x + cubukGen / 2;
      return `<g>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cubukGen.toFixed(1)}" height="${h.toFixed(1)}"
              rx="4" fill="var(--seri)">
          <title>${esc(para(b.minPrice))}–${esc(para(b.maxPrice, kur))} · arz ${esc(tamsayi(b.supply))} listing${
            arzModu ? '' : ` · talep/listing ${esc(sayi(b.demandPerListing))}`
          }</title>
        </rect>
        <text x="${orta.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle"
              font-size="${String(PUNTO.deger)}" fill="var(--soluk)">${esc(tamsayi(b.supply))}</text>
        <text x="${orta.toFixed(1)}" y="${String(y0 + 20)}" text-anchor="middle"
              font-size="${String(PUNTO.eksen)}" fill="var(--soluk)">${esc(para(b.minPrice))}</text>
      </g>`;
    })
    .join('');

  return `<svg class="grafik" viewBox="0 0 ${String(W)} ${String(H)}" role="img"
    aria-label="${arzModu ? 'Fiyat bandına göre listing sayısı' : 'Fiyat bandına göre listing başına talep'}">
    ${gridler}
    <line x1="${String(x0)}" x2="${String(x1)}" y1="${String(y0)}" y2="${String(y0)}" stroke="var(--hairline)" stroke-width="1"/>
    ${cubuklar}
    <text x="${String(x0)}" y="${String(H - 16)}" font-size="${String(PUNTO.etiket)}" fill="var(--soluk)">${
      arzModu
        ? `Çubuk: o fiyat bandındaki listing adedi · alt eksen: bandın alt fiyatı${kur === null ? '' : ` (${kur})`}`
        : `Çubuk: listing başına talep · üstteki sayı: o banttaki listing adedi · alt eksen: bandın alt fiyatı${kur === null ? '' : ` (${kur})`}`
    }</text>
  </svg>
  ${
    arzModu
      ? tabloGorunumu(
          [`Fiyat bandı${kur === null ? '' : ` (${kur})`}`, 'Listing', 'Payı'],
          bantlar.map((b) => [
            `${para(b.minPrice)} – ${para(b.maxPrice)}`,
            tamsayi(b.supply),
            toplamArz === 0 ? '—' : `%${((b.supply / toplamArz) * 100).toFixed(1)}`,
          ]),
        )
      : tabloGorunumu(
          [`Fiyat bandı${kur === null ? '' : ` (${kur})`}`, 'Arz', 'Talep', 'Talep/listing'],
          bantlar.map((b) => [
            `${para(b.minPrice)} – ${para(b.maxPrice)}`,
            tamsayi(b.supply),
            sayi(b.demand),
            sayi(b.demandPerListing),
          ]),
        )
  }`;
}

/* ------------------------------------------------------------------ */
/* Etiket kadranı — scatter. Fırsat noktaları HER ZAMAN etiketli:      */
/* ışık modunda yeşil/turuncu CVD ayrımı uyarı bandında, renk tek      */
/* başına anlam taşıyamaz.                                             */

export function etiketKadrani(etiketler: TagRow[]): string {
  if (etiketler.length === 0) return bosMesaj('Etiket verisi yok.');

  const H = 430;
  const x0 = G.sol;
  const x1 = W - 170; // sağda etiket metnine yer
  const y0 = H - 62;
  const y1 = G.ust + 14;

  const kullanimlar = etiketler.map((t) => t.usageCount);
  const hizlar = etiketler.map((t) => t.avgVelocity);
  const xUst = Math.max(...kullanimlar, 1);
  const yUst = Math.max(...hizlar, 1);
  const yAlt = Math.min(0, ...hizlar);

  const medyan = (a: number[]): number => {
    const s = [...a].sort((p, q) => p - q);
    const o = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? ((s[o - 1] ?? 0) + (s[o] ?? 0)) / 2 : (s[o] ?? 0);
  };
  const mx = olcek(medyan(kullanimlar), [0, xUst], [x0, x1]);
  const my = olcek(medyan(hizlar), [yAlt, yUst], [y0, y1]);

  const xOf = (v: number): number => olcek(v, [0, xUst], [x0, x1]);
  const yOf = (v: number): number => olcek(v, [yAlt, yUst], [y0, y1]);

  const firsatlar = etiketler.filter((t) => t.quadrant === 'firsat');

  /* Etiket metinlerini dikeyde ayır ki üst üste binmesinler. */
  const yerlesmis: { x: number; y: number; metin: string }[] = [];
  for (const t of firsatlar.slice(0, 8)) {
    const px = xOf(t.usageCount);
    let py = yOf(t.avgVelocity) + 4;
    while (yerlesmis.some((v) => Math.abs(v.y - py) < 15 && Math.abs(v.x - px) < 200)) {
      py += 15;
    }
    yerlesmis.push({ x: px, y: py, metin: t.tag });
  }

  const noktalar = etiketler
    .map((t) => {
      const firsat = t.quadrant === 'firsat';
      return `<circle cx="${xOf(t.usageCount).toFixed(1)}" cy="${yOf(t.avgVelocity).toFixed(1)}"
        r="${firsat ? '6' : '5'}"
        fill="${firsat ? 'var(--firsat)' : 'var(--seri)'}" stroke="var(--kagit)" stroke-width="2">
        <title>${esc(t.tag)} · ${esc(tamsayi(t.usageCount))} listing · ${esc(sayi(t.avgVelocity))} favori/gün</title>
      </circle>`;
    })
    .join('');

  const etiketMetni = yerlesmis
    .map(
      (v) =>
        `<text x="${(v.x + 11).toFixed(1)}" y="${v.y.toFixed(1)}" font-size="${String(PUNTO.etiket)}" fill="var(--murekkep-2)">${esc(v.metin.slice(0, 26))}</text>`,
    )
    .join('');

  return `<svg class="grafik" viewBox="0 0 ${String(W)} ${String(H)}" role="img"
    aria-label="Etiketlerin kullanım sıklığına ve favori getirisine göre dağılımı">
    <rect x="${String(x0)}" y="${String(y1)}" width="${(mx - x0).toFixed(1)}" height="${(my - y1).toFixed(1)}" fill="var(--firsat-zemin)"/>
    <line x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="${String(y1)}" y2="${String(y0)}" stroke="var(--hairline)" stroke-width="1" stroke-dasharray="3 3"/>
    <line x1="${String(x0)}" x2="${String(x1)}" y1="${my.toFixed(1)}" y2="${my.toFixed(1)}" stroke="var(--hairline)" stroke-width="1" stroke-dasharray="3 3"/>
    <line x1="${String(x0)}" x2="${String(x1)}" y1="${String(y0)}" y2="${String(y0)}" stroke="var(--hairline)" stroke-width="1"/>
    <text x="${String(x0 + 10)}" y="${String(y1 + 16)}" font-size="${String(PUNTO.etiket)}" fill="var(--firsat-metin)">az kullanılan · yüksek getiri</text>
    <text x="${String(x1)}" y="${String(y1 + 16)}" text-anchor="end" font-size="${String(PUNTO.etiket)}" fill="var(--soluk)">çok kullanılan</text>
    ${noktalar}${etiketMetni}
    <text x="${String(x0)}" y="${String(y0 + 22)}" font-size="${String(PUNTO.eksen)}" fill="var(--soluk)">1 listing</text>
    <text x="${String(x1)}" y="${String(y0 + 22)}" text-anchor="end" font-size="${String(PUNTO.eksen)}" fill="var(--soluk)">${esc(tamsayi(xUst))} listing</text>
    <text x="${String(x0)}" y="${String(H - 16)}" font-size="${String(PUNTO.etiket)}" fill="var(--soluk)">Yatay: etiket kaç listing'de geçiyor · Dikey: o listinglerin ortalama favori hızı · Kesikli çizgiler medyan</text>
  </svg>
  ${tabloGorunumu(
    ['Etiket', 'Listing', 'Ort. hız /gün', 'Kadran'],
    etiketler.map((t) => [t.tag, tamsayi(t.usageCount), sayi(t.avgVelocity), t.quadrant]),
  )}`;
}



/* ------------------------------------------------------------------ */
/* Fiyat histogramı — talep ölçülemediğinde fiyat bölümünün yerini     */
/* alır. Bant grafiği ntile'a dayanıyor: her bantta eşit sayıda listing */
/* olduğu için arz tarafında on özdeş çubuk çıkıyordu. Histogramda     */
/* aralık sabit, yükseklik değişken; dağılımı gösteren budur.           */

export function fiyatHistogrami(kovalar: PriceBin[]): string {
  if (kovalar.length === 0) return bosMesaj('Fiyat verisi yok.');

  const H = 320;
  const x0 = G.sol;
  const x1 = W - G.sag;
  const y0 = H - 70;
  const y1 = G.ust + 10;

  const kur = kovalar[0]?.currency ?? null;
  const toplam = kovalar.reduce((t, k) => t + k.count, 0);
  const enCok = Math.max(...kovalar.map((k) => k.count), 1);
  const yTick = tickler(0, enCok, 4);
  const yUst = Math.max(enCok, ...yTick);

  const genislik = (x1 - x0) / kovalar.length;
  const cubukGen = Math.max(8, genislik - 4);

  const gridler = yTick
    .map((t) => {
      const y = olcek(t, [0, yUst], [y0, y1]);
      return `<line x1="${String(x0)}" x2="${String(x1)}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--izgara)" stroke-width="1"/>
        <text x="${String(x0 - 12)}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="${String(PUNTO.eksen)}" fill="var(--soluk)">${esc(tamsayi(t))}</text>`;
    })
    .join('');

  /* Her kovanın altına fiyat yazmak 14 etiketi üst üste bindirir; ikide bir yazarız. */
  const adim = kovalar.length > 8 ? 2 : 1;

  const cubuklar = kovalar
    .map((k, i) => {
      const x = x0 + i * genislik + (genislik - cubukGen) / 2;
      const y = olcek(k.count, [0, yUst], [y0, y1]);
      const h = Math.max(1, y0 - y);
      const orta = x + cubukGen / 2;
      const pay = toplam === 0 ? '' : ` · %${((k.count / toplam) * 100).toFixed(1)}`;
      return `<g>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cubukGen.toFixed(1)}" height="${h.toFixed(1)}"
              rx="4" fill="var(--seri)">
          <title>${esc(para(k.from))} – ${esc(para(k.to, kur))} · ${esc(tamsayi(k.count))} listing${esc(pay)}</title>
        </rect>
        <text x="${orta.toFixed(1)}" y="${(y - 8).toFixed(1)}" text-anchor="middle"
              font-size="${String(PUNTO.deger)}" fill="var(--soluk)">${esc(tamsayi(k.count))}</text>
        ${
          i % adim === 0
            ? `<text x="${orta.toFixed(1)}" y="${String(y0 + 20)}" text-anchor="middle"
              font-size="${String(PUNTO.eksen)}" fill="var(--soluk)">${esc(para(k.from))}</text>`
            : ''
        }
      </g>`;
    })
    .join('');

  const son = kovalar[kovalar.length - 1];

  return `<svg class="grafik" viewBox="0 0 ${String(W)} ${String(H)}" role="img"
    aria-label="Fiyat dağılımı histogramı">
    ${gridler}
    <line x1="${String(x0)}" x2="${String(x1)}" y1="${String(y0)}" y2="${String(y0)}" stroke="var(--hairline)" stroke-width="1"/>
    ${cubuklar}
    <text x="${String(x0)}" y="${String(H - 34)}" font-size="${String(PUNTO.etiket)}" fill="var(--soluk)">Çubuk: o fiyat aralığındaki listing adedi · aralıklar eşit genişlikte${
      kur === null ? '' : ` (${kur})`
    }</text>
    <text x="${String(x0)}" y="${String(H - 14)}" font-size="${String(PUNTO.etiket)}" fill="var(--soluk)">Ölçek %2–%98 aralığına kuruldu; dışında kalan listing'ler uçtaki kovalara eklendi.</text>
  </svg>
  ${tabloGorunumu(
    [`Fiyat aralığı${kur === null ? '' : ` (${kur})`}`, 'Listing', 'Payı'],
    kovalar.map((k, i) => [
      `${para(k.from)} – ${para(k.to)}${i === kovalar.length - 1 && son !== undefined ? '+' : ''}`,
      tamsayi(k.count),
      toplam === 0 ? '—' : `%${((k.count / toplam) * 100).toFixed(1)}`,
    ]),
  )}`;
}

/* ------------------------------------------------------------------ */
/* Etiket kullanımı — talep ölçülemediğinde kadranın yerini alır.      */
/* Kadran iki eksene muhtaç; getiri ekseni sıfırsa noktalar tek bir    */
/* çizgiye çöker ve "fırsat" etiketi sadece nadirliği ödüllendirir.    */
/* Arz tarafı ise ölçülmüş: hangi etiket kaç listing'de geçiyor.       */

export function etiketKullanimi(etiketler: TagRow[]): string {
  if (etiketler.length === 0) return bosMesaj('Etiket verisi yok.');

  const sirali = [...etiketler].sort((a, b) => b.usageCount - a.usageCount);
  const ilk = sirali.slice(0, 18);

  const etiketGen = 250;
  const satirYuk = 28;
  const x0 = etiketGen;
  const x1 = W - 90;
  const ustBosluk = 16;
  const H = ustBosluk + ilk.length * satirYuk + 46;

  const enCok = Math.max(...ilk.map((t) => t.usageCount), 1);

  const satirlar = ilk
    .map((t, i) => {
      const y = ustBosluk + i * satirYuk;
      const gen = Math.max(2, ((x1 - x0) * t.usageCount) / enCok);
      const gosterilen = t.tag.length > 30 ? `${t.tag.slice(0, 29)}…` : t.tag;
      return `<g>
        <text x="${String(etiketGen - 12)}" y="${String(y + satirYuk / 2 + 4)}" text-anchor="end"
              font-size="${String(PUNTO.etiket)}" fill="var(--murekkep-2)">${esc(gosterilen)}</text>
        <rect x="${String(x0)}" y="${String(y + 4)}" width="${gen.toFixed(1)}" height="${String(satirYuk - 10)}"
              rx="4" fill="var(--seri)">
          <title>${esc(t.tag)} · ${esc(tamsayi(t.usageCount))} listing</title>
        </rect>
        <text x="${(x0 + gen + 8).toFixed(1)}" y="${String(y + satirYuk / 2 + 4)}"
              font-size="${String(PUNTO.deger)}" fill="var(--soluk)">${esc(tamsayi(t.usageCount))}</text>
      </g>`;
    })
    .join('');

  return `<svg class="grafik" viewBox="0 0 ${String(W)} ${String(H)}" role="img"
    aria-label="Etiketlerin kaç listing'de geçtiği">
    ${satirlar}
    <text x="${String(x0)}" y="${String(H - 14)}" font-size="${String(PUNTO.etiket)}" fill="var(--soluk)">Çubuk: etiketin geçtiği listing adedi · en çok kullanılan 18 etiket</text>
  </svg>
  ${tabloGorunumu(
    ['Etiket', 'Listing'],
    sirali.map((t) => [t.tag, tamsayi(t.usageCount)]),
  )}`;
}

/* ------------------------------------------------------------------ */
/* Boşluk matrisi — sequential tek hue yeşil ramp                      */

/**
 * Kategori × fiyat bandı ısı haritası. `arzModu` talep ölçülemediğinde
 * rampı talep/arz oranı yerine arzın kendisine bağlar; aksi halde her
 * hücre aynı tonda çıkar ve harita hiçbir şey anlatmaz.
 */
export function boslukMatrisi(hucreler: GapCell[], arzModu = false): string {
  if (hucreler.length === 0) return bosMesaj('Matris verisi yok.');

  const kategoriler = [...new Set(hucreler.map((h) => h.taxonomyPath ?? '—'))].slice(0, 9);
  const bantlar = [...new Set(hucreler.map((h) => h.band))].sort((a, b) => a - b);
  const olcu = (h: GapCell): number => (arzModu ? h.supply : h.ratio);
  const enCok = Math.max(...hucreler.map(olcu), 0);

  const rampAdimi = (oran: number): string => {
    if (enCok === 0) return 'var(--ramp-0)';
    const k = oran / enCok;
    if (k <= 0.001) return 'var(--ramp-0)';
    if (k < 0.25) return 'var(--ramp-1)';
    if (k < 0.5) return 'var(--ramp-2)';
    if (k < 0.75) return 'var(--ramp-3)';
    if (k < 0.95) return 'var(--ramp-4)';
    return 'var(--ramp-5)';
  };

  const etiketGen = 330;
  const kalanGen = W - etiketGen - 12;
  const hucreGen = Math.max(28, Math.min(64, kalanGen / Math.max(1, bantlar.length)));
  const hucreYuk = 30;
  const ustBosluk = 30;
  const H = ustBosluk + kategoriler.length * hucreYuk + 44;

  const basliklar = bantlar
    .map(
      (b, i) =>
        `<text x="${String(etiketGen + i * hucreGen + hucreGen / 2)}" y="18" text-anchor="middle" font-size="${String(PUNTO.eksen)}" fill="var(--soluk)">${esc(String(b))}</text>`,
    )
    .join('');

  const satirlar = kategoriler
    .map((kat, satir) => {
      const y = ustBosluk + satir * hucreYuk;
      const hucrelerHtml = bantlar
        .map((bant, sutun) => {
          const h = hucreler.find((c) => (c.taxonomyPath ?? '—') === kat && c.band === bant);
          const x = etiketGen + sutun * hucreGen;
          if (h === undefined) {
            return `<rect x="${String(x + 1)}" y="${String(y + 1)}" width="${String(hucreGen - 2)}" height="${String(hucreYuk - 2)}" rx="2" fill="none" stroke="var(--izgara)" stroke-width="1"/>`;
          }
          return `<rect x="${String(x + 1)}" y="${String(y + 1)}" width="${String(hucreGen - 2)}" height="${String(hucreYuk - 2)}" rx="2" fill="${rampAdimi(olcu(h))}">
            <title>${esc(kat)} · bant ${esc(String(bant))} · arz ${esc(tamsayi(h.supply))} listing${
              arzModu ? '' : ` · talep/arz ${esc(sayi(h.ratio))}`
            }</title>
          </rect>`;
        })
        .join('');
      // Kategori yolunun son iki parçası yeter; tam yol zaten title'da.
      const parcalar = kat.split(' > ');
      const kisa = parcalar.slice(-2).join(' > ');
      const gosterilen = kisa.length > 44 ? `${kisa.slice(0, 43)}…` : kisa;
      return `${hucrelerHtml}<text x="${String(etiketGen - 12)}" y="${String(y + hucreYuk / 2 + 4)}" text-anchor="end" font-size="${String(PUNTO.etiket)}" fill="var(--murekkep-2)">${esc(gosterilen)}</text>`;
    })
    .join('');

  return `<svg class="grafik" viewBox="0 0 ${String(W)} ${String(H)}" role="img"
    aria-label="${arzModu ? 'Kategori ve fiyat bandına göre listing yoğunluğu' : 'Kategori ve fiyat bandına göre talep arz oranı'}">
    ${basliklar}${satirlar}
    <text x="0" y="${String(H - 14)}" font-size="${String(PUNTO.etiket)}" fill="var(--soluk)">${
      arzModu
        ? 'Üst sıra: fiyat bandı numarası · koyu hücre: listingin yoğunlaştığı kesişim'
        : 'Üst sıra: fiyat bandı numarası · koyu hücre: talep/arz oranının yüksek olduğu kesişim'
    }</text>
  </svg>
  ${
    arzModu
      ? tabloGorunumu(
          ['Kategori', 'Bant', 'Listing'],
          hucreler
            .slice(0, 40)
            .map((h) => [
              h.taxonomyPath ?? String(h.taxonomyId ?? '—'),
              String(h.band),
              tamsayi(h.supply),
            ]),
        )
      : tabloGorunumu(
          ['Kategori', 'Bant', 'Arz', 'Talep', 'Talep/arz'],
          hucreler
            .slice(0, 40)
            .map((h) => [
              h.taxonomyPath ?? String(h.taxonomyId ?? '—'),
              String(h.band),
              tamsayi(h.supply),
              sayi(h.demand),
              sayi(h.ratio),
            ]),
        )
  }`;
}

import type { GapCell, PriceBand, TagRow, VelocityPoint } from '@etsy-analysis/core/analysis';
import { esc } from './html.js';
import { para, sayi, tamsayi } from './lib/format.js';

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

const G = { sol: 52, sag: 16, ust: 14, alt: 34 };

/* ------------------------------------------------------------------ */
/* Favori hızı zaman serisi — tek seri, legend yok (başlık seriyi adlandırır) */

export function hizSerisi(noktalar: VelocityPoint[]): string {
  const olculen = noktalar.filter((n) => n.avgVelocity !== null);
  if (olculen.length < 2) {
    return `<p class="grafik-alt">Zaman serisi için en az iki ölçülmüş nokta gerekiyor.</p>`;
  }

  const W = 680;
  const H = 210;
  const x0 = G.sol;
  const x1 = W - G.sag;
  const y0 = H - G.alt;
  const y1 = G.ust;

  const degerler = olculen.map((n) => n.avgVelocity ?? 0);
  const enAz = Math.min(0, ...degerler);
  const enCok = Math.max(...degerler);
  const yTick = tickler(enAz, enCok, 4);
  const yAlt = Math.min(enAz, ...yTick);
  const yUst = Math.max(enCok, ...yTick);

  const xOf = (i: number): number => olcek(i, [0, olculen.length - 1], [x0, x1]);
  const yOf = (v: number): number => olcek(v, [yAlt, yUst], [y0, y1]);

  const cizgi = olculen
    .map((n, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(n.avgVelocity ?? 0).toFixed(1)}`)
    .join(' ');

  const gridler = yTick
    .map(
      (t) =>
        `<line x1="${x0}" x2="${x1}" y1="${yOf(t).toFixed(1)}" y2="${yOf(t).toFixed(1)}" stroke="var(--izgara)" stroke-width="1"/>
         <text x="${x0 - 8}" y="${(yOf(t) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--soluk)">${esc(sayi(t, 1))}</text>`,
    )
    .join('');

  const isaretciler = olculen
    .map(
      (n, i) =>
        `<circle cx="${xOf(i).toFixed(1)}" cy="${yOf(n.avgVelocity ?? 0).toFixed(1)}" r="4.5"
           fill="var(--seri)" stroke="var(--kagit)" stroke-width="2">
           <title>${esc(n.observedAt)} · ${esc(sayi(n.avgVelocity))} /gün</title>
         </circle>`,
    )
    .join('');

  const xEtiket = olculen
    .map((n, i) => {
      if (i !== 0 && i !== olculen.length - 1) return '';
      const anchor = i === 0 ? 'start' : 'end';
      return `<text x="${xOf(i).toFixed(1)}" y="${H - 12}" text-anchor="${anchor}" font-size="11" fill="var(--soluk)">${esc(n.observedAt.slice(0, 10))}</text>`;
    })
    .join('');

  return `<svg class="grafik" viewBox="0 0 ${W} ${H}" role="img" aria-label="Ortalama favori hızının zaman içindeki seyri">
    ${gridler}
    <line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" stroke="var(--izgara)" stroke-width="1"/>
    <path d="${cizgi}" fill="none" stroke="var(--seri)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${isaretciler}${xEtiket}
  </svg>
  ${tabloGorunumu(
    ['Snapshot', 'Ort. hız /gün', 'Listing'],
    olculen.map((n) => [n.observedAt, sayi(n.avgVelocity), tamsayi(n.listingCount)]),
  )}`;
}

/* ------------------------------------------------------------------ */
/* Fiyat–talep: TEK eksen. y = talep/listing, arz doğrudan etiket olarak. */

export function fiyatTalep(bantlar: PriceBand[]): string {
  if (bantlar.length === 0) return '<p class="grafik-alt">Bant verisi yok.</p>';

  const W = 680;
  const H = 230;
  const x0 = G.sol;
  const x1 = W - G.sag;
  const y0 = H - G.alt;
  const y1 = G.ust;

  const enCok = Math.max(...bantlar.map((b) => b.demandPerListing), 0);
  const yTick = tickler(0, enCok === 0 ? 1 : enCok, 4);
  const yUst = Math.max(enCok, ...yTick);

  const genislik = (x1 - x0) / bantlar.length;
  const cubukGen = Math.max(6, genislik - 8);

  const gridler = yTick
    .map((t) => {
      const y = olcek(t, [0, yUst], [y0, y1]);
      return `<line x1="${x0}" x2="${x1}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="var(--izgara)" stroke-width="1"/>
        <text x="${x0 - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="var(--soluk)">${esc(sayi(t, 1))}</text>`;
    })
    .join('');

  const cubuklar = bantlar
    .map((b, i) => {
      const x = x0 + i * genislik + (genislik - cubukGen) / 2;
      const y = olcek(b.demandPerListing, [0, yUst], [y0, y1]);
      const h = Math.max(0, y0 - y);
      return `<g>
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cubukGen.toFixed(1)}" height="${h.toFixed(1)}"
              rx="4" fill="var(--seri)">
          <title>${esc(para(b.minPrice))}–${esc(para(b.maxPrice))} · arz ${esc(tamsayi(b.supply))} · talep/listing ${esc(sayi(b.demandPerListing))}</title>
        </rect>
        <text x="${(x + cubukGen / 2).toFixed(1)}" y="${(y - 5).toFixed(1)}" text-anchor="middle"
              font-size="10.5" fill="var(--soluk)">${esc(tamsayi(b.supply))}</text>
        <text x="${(x + cubukGen / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle"
              font-size="10.5" fill="var(--soluk)">${esc(para(b.minPrice))}</text>
      </g>`;
    })
    .join('');

  return `<svg class="grafik" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fiyat bandına göre listing başına talep">
    ${gridler}
    <line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" stroke="var(--izgara)" stroke-width="1"/>
    ${cubuklar}
  </svg>
  <p class="grafik-alt">Çubuk yüksekliği listing başına talep; çubuğun üstündeki sayı o banttaki arz (listing adedi). Alt eksen bandın alt fiyat sınırı.</p>
  ${tabloGorunumu(
    ['Fiyat bandı', 'Arz', 'Talep', 'Talep/listing'],
    bantlar.map((b) => [
      `${para(b.minPrice)} – ${para(b.maxPrice)}`,
      tamsayi(b.supply),
      sayi(b.demand),
      sayi(b.demandPerListing),
    ]),
  )}`;
}

/* ------------------------------------------------------------------ */
/* Etiket kadranı — scatter, medyan çizgileri referans, fırsat kadranı işaretli */

export function etiketKadrani(etiketler: TagRow[]): string {
  if (etiketler.length === 0) return '<p class="grafik-alt">Etiket verisi yok.</p>';

  const W = 680;
  const H = 300;
  const x0 = G.sol;
  const x1 = W - G.sag;
  const y0 = H - G.alt;
  const y1 = G.ust;

  const kullanimlar = etiketler.map((t) => t.usageCount);
  const hizlar = etiketler.map((t) => t.avgVelocity);
  const xUst = Math.max(...kullanimlar, 1);
  const yUst = Math.max(...hizlar, 1);
  const yAlt = Math.min(0, ...hizlar);

  const sirali = (a: number[]): number => {
    const s = [...a].sort((p, q) => p - q);
    const orta = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? ((s[orta - 1] ?? 0) + (s[orta] ?? 0)) / 2 : (s[orta] ?? 0);
  };
  const medyanKullanim = sirali(kullanimlar);
  const medyanHiz = sirali(hizlar);

  const xOf = (v: number): number => olcek(v, [0, xUst], [x0, x1]);
  const yOf = (v: number): number => olcek(v, [yAlt, yUst], [y0, y1]);

  const mx = xOf(medyanKullanim);
  const my = yOf(medyanHiz);

  // Fırsat kadranı: yüksek hız, düşük kullanım — sol üst.
  const kadranZemin = `<rect x="${x0}" y="${y1}" width="${(mx - x0).toFixed(1)}" height="${(my - y1).toFixed(1)}" fill="var(--firsat-zemin)"/>`;

  const noktalar = etiketler
    .map((t) => {
      const firsat = t.quadrant === 'firsat';
      return `<circle cx="${xOf(t.usageCount).toFixed(1)}" cy="${yOf(t.avgVelocity).toFixed(1)}" r="5"
        fill="${firsat ? 'var(--firsat)' : 'var(--seri)'}" stroke="var(--kagit)" stroke-width="2">
        <title>${esc(t.tag)} · ${esc(tamsayi(t.usageCount))} listing · ${esc(sayi(t.avgVelocity))} /gün</title>
      </circle>`;
    })
    .join('');

  // Fırsat kadranındaki ilk beş etiket doğrudan etiketlenir (kontrast kuralı).
  const etiketMetni = etiketler
    .filter((t) => t.quadrant === 'firsat')
    .slice(0, 5)
    .map(
      (t) =>
        `<text x="${(xOf(t.usageCount) + 9).toFixed(1)}" y="${(yOf(t.avgVelocity) + 4).toFixed(1)}"
           font-size="11" fill="var(--murekkep-2)">${esc(t.tag.slice(0, 22))}</text>`,
    )
    .join('');

  return `<svg class="grafik" viewBox="0 0 ${W} ${H}" role="img" aria-label="Etiketlerin kullanım sıklığına ve getirisine göre dağılımı">
    ${kadranZemin}
    <line x1="${mx.toFixed(1)}" x2="${mx.toFixed(1)}" y1="${y1}" y2="${y0}" stroke="var(--izgara)" stroke-width="1" stroke-dasharray="3 3"/>
    <line x1="${x0}" x2="${x1}" y1="${my.toFixed(1)}" y2="${my.toFixed(1)}" stroke="var(--izgara)" stroke-width="1" stroke-dasharray="3 3"/>
    <line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}" stroke="var(--izgara)" stroke-width="1"/>
    ${noktalar}${etiketMetni}
    <text x="${x0}" y="${H - 12}" font-size="11" fill="var(--soluk)">az kullanılan</text>
    <text x="${x1}" y="${H - 12}" text-anchor="end" font-size="11" fill="var(--soluk)">çok kullanılan</text>
    <text x="${x0 - 8}" y="${y1 + 8}" text-anchor="end" font-size="11" fill="var(--soluk)">yüksek</text>
    <text x="${x0 - 8}" y="${y0}" text-anchor="end" font-size="11" fill="var(--soluk)">düşük</text>
  </svg>
  <p class="grafik-alt">Turuncu bölge: getirisi medyanın üstünde ama az kullanılan etiketler. Dikey eksen etiket başına ortalama favori hızı, yatay eksen kaç listing&#39;de geçtiği.</p>
  ${tabloGorunumu(
    ['Etiket', 'Listing', 'Ort. hız /gün', 'Kadran'],
    etiketler.map((t) => [t.tag, tamsayi(t.usageCount), sayi(t.avgVelocity), t.quadrant]),
  )}`;
}

/* ------------------------------------------------------------------ */
/* Boşluk matrisi — sequential tek hue mavi ramp */

export function boslukMatrisi(hucreler: GapCell[]): string {
  if (hucreler.length === 0) return '<p class="grafik-alt">Matris verisi yok.</p>';

  const kategoriler = [...new Set(hucreler.map((h) => h.taxonomyPath ?? '—'))].slice(0, 10);
  const bantlar = [...new Set(hucreler.map((h) => h.band))].sort((a, b) => a - b);
  const enCok = Math.max(...hucreler.map((h) => h.ratio), 0);

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

  const hucreGen = 46;
  const hucreYuk = 26;
  const etiketGen = 260;
  const W = etiketGen + bantlar.length * hucreGen + 8;
  const H = 26 + kategoriler.length * hucreYuk + 6;

  const basliklar = bantlar
    .map(
      (b, i) =>
        `<text x="${etiketGen + i * hucreGen + hucreGen / 2}" y="16" text-anchor="middle" font-size="11" fill="var(--soluk)">${esc(String(b))}</text>`,
    )
    .join('');

  const satirlar = kategoriler
    .map((kat, satir) => {
      const y = 26 + satir * hucreYuk;
      const hucrelerHtml = bantlar
        .map((bant, sutun) => {
          const h = hucreler.find(
            (c) => (c.taxonomyPath ?? '—') === kat && c.band === bant,
          );
          const x = etiketGen + sutun * hucreGen;
          if (h === undefined) {
            return `<rect x="${x + 1}" y="${y + 1}" width="${hucreGen - 2}" height="${hucreYuk - 2}" rx="2" fill="none" stroke="var(--izgara)" stroke-width="1"/>`;
          }
          return `<rect x="${x + 1}" y="${y + 1}" width="${hucreGen - 2}" height="${hucreYuk - 2}" rx="2" fill="${rampAdimi(h.ratio)}">
            <title>${esc(kat)} · bant ${esc(String(bant))} · oran ${esc(sayi(h.ratio))} · arz ${esc(tamsayi(h.supply))}</title>
          </rect>`;
        })
        .join('');
      const kisa = kat.length > 38 ? `${kat.slice(0, 37)}…` : kat;
      return `${hucrelerHtml}<text x="${etiketGen - 10}" y="${y + hucreYuk / 2 + 4}" text-anchor="end" font-size="11" fill="var(--murekkep-2)">${esc(kisa)}</text>`;
    })
    .join('');

  return `<svg class="grafik" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kategori ve fiyat bandına göre talep arz oranı">
    ${basliklar}${satirlar}
  </svg>
  <p class="grafik-alt">Koyu hücre, o kategori ve fiyat bandında talebin arza oranının yüksek olduğunu gösterir. Üst satırdaki sayılar fiyat bandı numarası.</p>
  ${tabloGorunumu(
    ['Kategori', 'Bant', 'Arz', 'Talep', 'Oran'],
    hucreler
      .slice(0, 40)
      .map((h) => [
        h.taxonomyPath ?? String(h.taxonomyId ?? '—'),
        String(h.band),
        tamsayi(h.supply),
        sayi(h.demand),
        sayi(h.ratio),
      ]),
  )}`;
}

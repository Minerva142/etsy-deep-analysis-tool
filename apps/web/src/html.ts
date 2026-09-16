import { para, sayi, tamsayi, yuzde } from './lib/format.js';

/** HTML'e gömülen her değer buradan geçer. */
export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Tip = 'para' | 'sayi' | 'yuzde' | 'tamsayi';

const bicimleyici: Record<Tip, (v: number | null | undefined) => string> = {
  para,
  sayi: (v) => sayi(v),
  yuzde: (v) => yuzde(v),
  tamsayi,
};

/**
 * Ölçülen değeri tam mürekkeple, ölçülemeyeni soluk tireyle basar.
 *
 * Bu ayrım arayüzün taşıyıcı öğesi: araç ölçemediğini uydurmuyor ve bunu
 * görsel olarak da söylüyor. Birim yalnızca ölçülmüş değere eklenir —
 * "— /gün" okunmaz bir şey olurdu.
 */
export function deger(
  value: number | null | undefined,
  tip: Tip = 'sayi',
  birim?: string,
): string {
  const olculdu = value !== null && value !== undefined && Number.isFinite(value);
  const metin = esc(bicimleyici[tip](value));
  if (!olculdu) {
    return `<span class="sayi olculemedi" title="Bu değer ölçülemedi">${metin}</span>`;
  }
  return `<span class="sayi">${metin}${birim === undefined ? '' : ` ${esc(birim)}`}</span>`;
}

/**
 * Bir bölümün yerine geçer. Boş tablo göstermek "analiz bozuk" dedirtir;
 * onun yerine neden ölçülemediğini ve ne yapılacağını söyleriz.
 */
export function olculemediBolumu(
  baslik: string,
  sebep: string,
  cozum?: string,
): string {
  return `<section class="kart">
    <h2>${esc(baslik)}</h2>
    <p class="olculemedi dar">${esc(sebep)}</p>
    ${cozum === undefined ? '' : `<p class="ikincil dar">${esc(cozum)}</p>`}
  </section>`;
}

export interface NisBagi {
  id: string;
  ad: string;
}

/** Sol raf: araç tekrar tekrar açılıyor, gezinme kalıcı olmalı. */
function raf(nis: NisBagi | null, aktif: string): string {
  const bag = (yol: string, etiket: string): string =>
    `<a href="${esc(yol)}"${aktif === yol ? ' aria-current="page"' : ''}>${esc(etiket)}</a>`;

  const nisBolumu =
    nis === null
      ? ''
      : `<div class="raf-grup">
           <p class="raf-grup-baslik">${esc(nis.ad)}</p>
           <nav>
             ${bag(`/nis/${encodeURIComponent(nis.id)}`, 'Özet')}
             ${bag(`/nis/${encodeURIComponent(nis.id)}/firsatlar`, 'Fırsatlar')}
             ${bag(`/nis/${encodeURIComponent(nis.id)}/rakipler`, 'Rakipler')}
             ${bag(`/nis/${encodeURIComponent(nis.id)}/listingler`, 'Listingler')}
           </nav>
         </div>`;

  return `<aside class="raf">
    <p class="raf-baslik">Etsy Deep Analysis</p>
    <p class="raf-alt">Ölçülen veri, tahmin yok</p>
    <nav>${bag('/', 'Nişler')}</nav>
    ${nisBolumu}
  </aside>`;
}

export function sayfa(options: {
  baslik: string;
  icerik: string;
  nis?: NisBagi | null;
  aktif?: string;
}): string {
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(options.baslik)} · Etsy Deep Analysis</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/stil.css">
</head>
<body>
<div class="kabuk">
${raf(options.nis ?? null, options.aktif ?? '/')}
<main class="icerik">${options.icerik}</main>
</div>
</body>
</html>`;
}

export function hataSayfasi(baslik: string, mesaj: string): string {
  return sayfa({
    baslik,
    icerik: `<h1>${esc(baslik)}</h1><p class="sayfa-alt">${esc(mesaj)}</p>
      <p><a href="/">Nişlere dön</a></p>`,
  });
}

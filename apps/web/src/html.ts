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
 * Aracın dürüstlük iddiası bu ayrıma dayanıyor. Birim yalnızca ölçülmüş
 * değere eklenir — "— /gün" okunmaz bir şey olurdu.
 */
export function deger(
  value: number | null | undefined,
  tip: Tip = 'sayi',
  birim?: string,
): string {
  const olculdu = value !== null && value !== undefined && Number.isFinite(value);
  const metin = esc(bicimleyici[tip](value));
  if (!olculdu) {
    return `<span class="tnum olculemedi" title="Bu değer ölçülemedi">${metin}</span>`;
  }
  return `<span class="tnum">${metin}${birim === undefined ? '' : ` ${esc(birim)}`}</span>`;
}

/** Sayı şeridindeki tek hücre. */
export function sayiHucresi(
  etiket: string,
  degerHtml: string,
  alt?: string,
): string {
  return `<div class="sayi-hucre">
    <p class="sayi-etiket">${esc(etiket)}</p>
    <div class="sayi-deger">${degerHtml}</div>
    ${alt === undefined ? '' : `<p class="sayi-alt">${esc(alt)}</p>`}
  </div>`;
}

/**
 * Rapor bölümü.
 *
 * Varsayılan: sol etiket sütunu + içerik. `genis` verildiğinde etiket
 * üste çıkar ve gövde tam genişliği kullanır — grafikler için gerekli,
 * dar sütunda viewBox ölçeklenip yazılar okunmaz oluyordu.
 */
export function bolum(options: {
  baslik: string;
  altBaslik?: string;
  govde: string;
  genis?: boolean;
}): string {
  return `<section class="bolum${options.genis === true ? ' bolum-genis' : ''}">
    <div class="bolum-basi">
      <h2>${esc(options.baslik)}</h2>
      ${options.altBaslik === undefined ? '' : `<p>${esc(options.altBaslik)}</p>`}
    </div>
    <div class="bolum-govde">${options.govde}</div>
  </section>`;
}

/**
 * Ölçülemeyen bir bölümün gövdesi. Boş tablo "analiz bozuk" dedirtir;
 * onun yerine nedenini ve ne yapılacağını söyleriz.
 */
export function olculemediGovdesi(sebep: string, cozum?: string): string {
  return `<p class="olculemedi dar">${esc(sebep)}</p>
    ${cozum === undefined ? '' : `<p class="ikincil dar" style="margin-bottom:0">${esc(cozum)}</p>`}`;
}

export interface NisBagi {
  id: string;
  ad: string;
}

const AYLAR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

function bugun(): string {
  const d = new Date();
  return `${String(d.getDate())} ${AYLAR[d.getMonth()] ?? ''} ${String(d.getFullYear())}`;
}

function gezinti(nis: NisBagi | null, aktif: string): string {
  if (nis === null) return '';
  const kok = `/nis/${encodeURIComponent(nis.id)}`;
  const bag = (yol: string, etiket: string): string =>
    `<a href="${esc(yol)}"${aktif === yol ? ' aria-current="page"' : ''}>${esc(etiket)}</a>`;

  return `<nav class="gezinti">
    ${bag(kok, 'Özet')}
    ${bag(`${kok}/firsatlar`, 'Fırsatlar')}
    ${bag(`${kok}/rakipler`, 'Rakipler')}
    ${bag(`${kok}/listingler`, 'Listingler')}
    <span class="gezinti-bosluk"></span>
    <a href="/">Tüm nişler</a>
  </nav>`;
}

export function sayfa(options: {
  baslik: string;
  icerik: string;
  nis?: NisBagi | null;
  aktif?: string;
  kunyeNotu?: string;
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
<div class="sayfa">
  <header class="kunye">
    <span class="kunye-ad serif"><a href="/">Etsy Deep Analysis</a></span>
    <span class="kunye-tarih tnum">${esc(options.kunyeNotu ?? bugun())}</span>
  </header>
  ${gezinti(options.nis ?? null, options.aktif ?? '/')}
  ${options.icerik}
</div>
</body>
</html>`;
}

export function hataSayfasi(baslik: string, mesaj: string): string {
  return sayfa({
    baslik,
    icerik: `<h1>${esc(baslik)}</h1>
      <p class="giris">${esc(mesaj)}</p>
      <p style="margin-top:28px"><a href="/">Nişlere dön</a></p>`,
  });
}

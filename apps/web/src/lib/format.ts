/**
 * Ölçülemeyen değerin tek gösterimi.
 *
 * Sıfırdan kesin olarak ayrılır: 0 ölçülmüş bir değerdir ("hiç favori
 * kazanmadı"), tire ise "ölçemedik" demektir. Aracın dürüstlük iddiası
 * bu ayrıma dayanıyor.
 */
export const OLCULEMEDI = '—';

export function sayi(value: number | null | undefined, basamak = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return OLCULEMEDI;
  }
  return value.toFixed(basamak);
}

export function para(value: number | null | undefined): string {
  return sayi(value, 2);
}

export function yuzde(value: number | null | undefined, basamak = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return OLCULEMEDI;
  }
  return `${(value * 100).toFixed(basamak)}%`;
}

export function tamsayi(value: number | null | undefined): string {
  return sayi(value, 0);
}

/** '2026-09-16 13:22:01' -> '16 Eyl 2026, 13:22' */
export function tarih(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return OLCULEMEDI;
  const d = new Date(`${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return OLCULEMEDI;
  const aylar = [
    'Oca',
    'Şub',
    'Mar',
    'Nis',
    'May',
    'Haz',
    'Tem',
    'Ağu',
    'Eyl',
    'Eki',
    'Kas',
    'Ara',
  ];
  const gun = String(d.getUTCDate()).padStart(2, '0');
  const ay = aylar[d.getUTCMonth()] ?? '';
  const saat = String(d.getUTCHours()).padStart(2, '0');
  const dakika = String(d.getUTCMinutes()).padStart(2, '0');
  return `${gun} ${ay} ${String(d.getUTCFullYear())}, ${saat}:${dakika}`;
}

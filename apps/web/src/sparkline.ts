import { olcek } from './grafikler.js';

/**
 * Niş listesindeki minik hız eğrisi.
 *
 * Eksen, etiket ve ızgara yok: tek işi yönü göstermek. Sayıyı okumak
 * isteyen niş sayfasındaki tam grafiğe gidiyor.
 */
export function sparkline(degerler: number[]): string {
  if (degerler.length < 2) return '<span class="olculemedi">—</span>';

  const W = 68;
  const H = 20;
  const alt = Math.min(...degerler);
  const ust = Math.max(...degerler);

  const nokta = (v: number, i: number): [number, number] => [
    olcek(i, [0, degerler.length - 1], [1, W - 1]),
    olcek(v, [alt, ust], [H - 2, 2]),
  ];

  const yol = degerler
    .map((v, i) => {
      const [x, y] = nokta(v, i);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const son = degerler[degerler.length - 1] ?? 0;
  const [sx, sy] = nokta(son, degerler.length - 1);
  const etiket = `Favori hızının son ${String(degerler.length)} çekimdeki seyri`;

  return `<svg class="spark" viewBox="0 0 ${String(W)} ${String(H)}" role="img" aria-label="${etiket}">
    <path d="${yol}" fill="none" stroke="var(--seri-1)" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="2.2" fill="var(--seri-1)"/>
  </svg>`;
}

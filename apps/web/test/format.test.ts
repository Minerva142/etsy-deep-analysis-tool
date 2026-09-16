import { describe, expect, it } from 'vitest';
import { OLCULEMEDI, para, sayi, tamsayi, tarih, yuzde } from '../src/lib/format';

describe('biçimlendirme', () => {
  it('ölçülemeyen değeri tire olarak basar', () => {
    expect(sayi(null)).toBe(OLCULEMEDI);
    expect(para(null)).toBe(OLCULEMEDI);
    expect(yuzde(null)).toBe(OLCULEMEDI);
    expect(tamsayi(undefined)).toBe(OLCULEMEDI);
  });

  it('sıfırı tire ile karıştırmaz', () => {
    // 0 ölçülmüş bir değerdir; ölçülemeyenden ayrılmalı.
    expect(sayi(0)).toBe('0.00');
    expect(tamsayi(0)).toBe('0');
    expect(yuzde(0)).toBe('0.0%');
  });

  it('sayıyı istenen basamağa yuvarlar', () => {
    expect(sayi(3.14159, 2)).toBe('3.14');
    expect(sayi(10, 0)).toBe('10');
  });

  it('parayı iki basamakla basar', () => {
    expect(para(29.5)).toBe('29.50');
  });

  it('oranı yüzdeye çevirir', () => {
    expect(yuzde(0.375)).toBe('37.5%');
  });

  it('sonsuz ve NaN değerleri ölçülemedi sayar', () => {
    expect(sayi(Number.POSITIVE_INFINITY)).toBe(OLCULEMEDI);
    expect(sayi(Number.NaN)).toBe(OLCULEMEDI);
  });

  it('DuckDB zaman damgasını okunur tarihe çevirir', () => {
    expect(tarih('2026-09-16 13:22:01')).toBe('16 Eyl 2026, 13:22');
  });

  it('geçersiz tarihi ölçülemedi sayar', () => {
    expect(tarih(null)).toBe(OLCULEMEDI);
    expect(tarih('')).toBe(OLCULEMEDI);
    expect(tarih('abc')).toBe(OLCULEMEDI);
  });
});

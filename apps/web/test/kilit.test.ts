import { describe, expect, it } from 'vitest';
import { dosyaYokMu, kilitHatasiMi, sirayaAl } from '../src/lib/kilit';

const bekle = (ms: number): Promise<void> =>
  new Promise((coz) => setTimeout(coz, ms));

describe('sirayaAl', () => {
  it('işleri üst üste bindirmez', async () => {
    const olaylar: string[] = [];

    const is = (ad: string, sure: number) => async (): Promise<void> => {
      olaylar.push(`${ad}-basladi`);
      await bekle(sure);
      olaylar.push(`${ad}-bitti`);
    };

    await Promise.all([
      sirayaAl(is('a', 20)),
      sirayaAl(is('b', 5)),
      sirayaAl(is('c', 1)),
    ]);

    // Sırayla: her iş bir öncekinin bitmesini bekler.
    expect(olaylar).toEqual([
      'a-basladi',
      'a-bitti',
      'b-basladi',
      'b-bitti',
      'c-basladi',
      'c-bitti',
    ]);
  });

  it('sonucu geri döndürür', async () => {
    expect(await sirayaAl(async () => 42)).toBe(42);
  });

  it('bir iş hata verse de sıra ilerler', async () => {
    const hatali = sirayaAl(async () => {
      throw new Error('patladı');
    });
    await expect(hatali).rejects.toThrow('patladı');

    // Sıra kilitlenmemeli.
    expect(await sirayaAl(async () => 'devam')).toBe('devam');
  });
});

describe('hata sınıflandırması', () => {
  it('DuckDB kilit hatasını tanır', () => {
    const e = new Error(
      'IO Error: Cannot open file "x.duckdb": File is already open in node.exe (PID 1)',
    );
    expect(kilitHatasiMi(e)).toBe(true);
    // Kilit hatası "dosya yok" sayılmamalı: mesajı yanlış yönlendiriyordu.
    expect(dosyaYokMu(e)).toBe(false);
  });

  it('Windows kilit metnini de tanır', () => {
    expect(
      kilitHatasiMi(new Error('being used by another process')),
    ).toBe(true);
  });

  it('gerçekten eksik dosyayı ayırt eder', () => {
    const e = new Error('IO Error: Cannot open file "yok.duckdb": No such file');
    expect(kilitHatasiMi(e)).toBe(false);
    expect(dosyaYokMu(e)).toBe(true);
  });

  it('alakasız hatayı ikisine de sokmaz', () => {
    const e = new Error('Binder Error: column not found');
    expect(kilitHatasiMi(e)).toBe(false);
    expect(dosyaYokMu(e)).toBe(false);
  });
});

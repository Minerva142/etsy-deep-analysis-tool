import { describe, expect, it } from 'vitest';
import { parseArgs } from '../src/index.js';

describe('parseArgs', () => {
  it('zorunlu argümanlarla snapshot komutunu ayrıştırır', () => {
    const parsed = parseArgs([
      'snapshot',
      '--niche',
      'mug',
      '--name',
      'Seramik kupa',
      '--keywords',
      'mug',
    ]);
    expect(parsed.command).toBe('snapshot');
    expect(parsed.niche.nicheId).toBe('mug');
    expect(parsed.niche.name).toBe('Seramik kupa');
    expect(parsed.niche.keywords).toBe('mug');
  });

  it('opsiyonel fiyat aralığını sayıya çevirir', () => {
    const parsed = parseArgs([
      'snapshot',
      '--niche',
      'mug',
      '--name',
      'x',
      '--min-price',
      '10',
      '--max-price',
      '50',
    ]);
    expect(parsed.niche.minPrice).toBe(10);
    expect(parsed.niche.maxPrice).toBe(50);
  });

  it('verilmeyen opsiyonel alanlar null olur', () => {
    const parsed = parseArgs(['snapshot', '--niche', 'mug', '--name', 'x']);
    expect(parsed.niche.keywords).toBeNull();
    expect(parsed.niche.taxonomyId).toBeNull();
  });

  it('bilinmeyen komutu reddeder', () => {
    expect(() => parseArgs(['analyze'])).toThrow(/Bilinmeyen komut/);
  });

  it('--niche eksikse hata verir', () => {
    expect(() => parseArgs(['snapshot', '--name', 'x'])).toThrow(/--niche gerekli/);
  });
});

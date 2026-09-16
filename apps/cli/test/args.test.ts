import { describe, expect, it } from 'vitest';
import { parseArgs, type ParsedArgs } from '../src/index.js';

/** parseArgs ayrımlı birleşim döndürüyor; testler snapshot dalını daraltır. */
function snapshotArgs(argv: string[]): Extract<ParsedArgs, { command: 'snapshot' }> {
  const parsed = parseArgs(argv);
  if (parsed.command !== 'snapshot') {
    throw new Error(`snapshot bekleniyordu, ${parsed.command} geldi`);
  }
  return parsed;
}

describe('parseArgs — snapshot', () => {
  it('zorunlu argümanlarla snapshot komutunu ayrıştırır', () => {
    const parsed = snapshotArgs([
      'snapshot',
      '--niche',
      'mug',
      '--name',
      'Seramik kupa',
      '--keywords',
      'mug',
    ]);
    expect(parsed.niche.nicheId).toBe('mug');
    expect(parsed.niche.name).toBe('Seramik kupa');
    expect(parsed.niche.keywords).toBe('mug');
  });

  it('opsiyonel fiyat aralığını sayıya çevirir', () => {
    const parsed = snapshotArgs([
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
    const parsed = snapshotArgs(['snapshot', '--niche', 'mug', '--name', 'x']);
    expect(parsed.niche.keywords).toBeNull();
    expect(parsed.niche.taxonomyId).toBeNull();
  });

  it('sıralama varsayılanı score olur', () => {
    const parsed = snapshotArgs(['snapshot', '--niche', 'mug', '--name', 'x']);
    expect(parsed.niche.sortOn).toBe('score');
  });

  it('açık --sort-on değerine uyar', () => {
    const parsed = snapshotArgs([
      'snapshot',
      '--niche',
      'mug',
      '--name',
      'x',
      '--sort-on',
      'created',
    ]);
    expect(parsed.niche.sortOn).toBe('created');
  });

  it('kota sınırlarını okur', () => {
    const parsed = snapshotArgs([
      'snapshot',
      '--niche',
      'mug',
      '--name',
      'x',
      '--max-pages',
      '2',
      '--max-shops',
      '5',
      '--max-review-listings',
      '3',
    ]);
    expect(parsed.limits.maxPages).toBe(2);
    expect(parsed.limits.maxShops).toBe(5);
    expect(parsed.limits.maxReviewListings).toBe(3);
  });

  it('kota sınırı verilmezse null olur', () => {
    const parsed = snapshotArgs(['snapshot', '--niche', 'mug', '--name', 'x']);
    expect(parsed.limits.maxPages).toBeNull();
  });

  it('--niche eksikse hata verir', () => {
    expect(() => parseArgs(['snapshot', '--name', 'x'])).toThrow(/--niche gerekli/);
  });

  it('sayısal olmayan sınırı reddeder', () => {
    expect(() =>
      parseArgs(['snapshot', '--niche', 'mug', '--name', 'x', '--max-pages', 'abc']),
    ).toThrow(/--max-pages sayı olmalı/);
  });
});

describe('parseArgs — report', () => {
  it('report komutunu ayrıştırır', () => {
    const parsed = parseArgs(['report', '--niche', 'mug']);
    expect(parsed.command).toBe('report');
    if (parsed.command === 'report') expect(parsed.nicheId).toBe('mug');
  });

  it('report için --name istemez', () => {
    expect(() => parseArgs(['report', '--niche', 'mug'])).not.toThrow();
  });

  it('report için --niche zorunludur', () => {
    expect(() => parseArgs(['report'])).toThrow(/--niche gerekli/);
  });

  it('bilinmeyen komutu reddeder', () => {
    expect(() => parseArgs(['analyze'])).toThrow(/Bilinmeyen komut/);
  });
});

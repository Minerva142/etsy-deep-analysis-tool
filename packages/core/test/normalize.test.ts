import { describe, expect, it } from 'vitest';
import { normalizeListing } from '../src/ingest/normalize.js';

const base = {
  listing_id: 1234567890,
  shop_id: 11111,
  title: 'Handmade Ceramic Mug',
  description: 'A cozy mug.',
  state: 'active',
  quantity: 10,
  url: 'https://www.etsy.com/listing/1234567890',
  num_favorers: 42,
  taxonomy_id: 1633,
  tags: ['mug', 'ceramic'],
  created_timestamp: 1735689600,
  price: { amount: 2499, divisor: 100, currency_code: 'USD' },
};

describe('normalizeListing', () => {
  it('fiyatı amount/divisor olarak hesaplar', () => {
    expect(normalizeListing(base).observation.price_amount).toBe(24.99);
  });

  it('divisor 1 olduğunda fiyatı bozmaz', () => {
    const result = normalizeListing({
      ...base,
      price: { amount: 30, divisor: 1, currency_code: 'TRY' },
    });
    expect(result.observation.price_amount).toBe(30);
    expect(result.observation.currency_code).toBe('TRY');
  });

  it('fiyat yoksa null döner', () => {
    const result = normalizeListing({ ...base, price: null });
    expect(result.observation.price_amount).toBeNull();
    expect(result.observation.currency_code).toBeNull();
  });

  it("created_timestamp’i saniyeden Date’e çevirir", () => {
    const result = normalizeListing(base);
    expect(result.listing.created_timestamp?.toISOString()).toBe(
      '2025-01-01T00:00:00.000Z',
    );
  });

  it('etiketleri küçük harfe indirir ve tekilleştirir', () => {
    const result = normalizeListing({ ...base, tags: ['Mug', 'mug', 'CERAMIC'] });
    expect(result.tags).toEqual(['mug', 'ceramic']);
  });

  it('etiket yoksa boş dizi döner', () => {
    expect(normalizeListing({ ...base, tags: null }).tags).toEqual([]);
  });

  it('opsiyonel alanlar eksikken null üretir', () => {
    const result = normalizeListing({ listing_id: 5 });
    expect(result.listing.shop_id).toBeNull();
    expect(result.listing.title).toBeNull();
    expect(result.observation.num_favorers).toBeNull();
  });
});

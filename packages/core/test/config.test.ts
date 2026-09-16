import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('varsayılan olarak fixture modunu seçer', () => {
    const config = loadConfig({});
    expect(config.etsyMode).toBe('fixture');
    expect(config.duckdbPath).toBe('./data/etsy.duckdb');
    expect(config.etsyApiKey).toBeNull();
  });

  it('live modda API key zorunludur', () => {
    expect(() => loadConfig({ ETSY_MODE: 'live' })).toThrow(
      /ETSY_MODE=live için ETSY_API_KEY gerekli/,
    );
  });

  it('live modda shared secret zorunludur', () => {
    expect(() => loadConfig({ ETSY_MODE: 'live', ETSY_API_KEY: 'abc123' })).toThrow(
      /ETSY_MODE=live için ETSY_SHARED_SECRET gerekli/,
    );
  });

  it('live modda her iki değer verilince yapılandırmayı döner', () => {
    const config = loadConfig({
      ETSY_MODE: 'live',
      ETSY_API_KEY: 'abc123',
      ETSY_SHARED_SECRET: 'sec456',
    });
    expect(config.etsyMode).toBe('live');
    expect(config.etsyApiKey).toBe('abc123');
    expect(config.etsySharedSecret).toBe('sec456');
  });

  it("x-api-key header'ını keystring:secret olarak birleştirir", () => {
    const config = loadConfig({
      ETSY_MODE: 'live',
      ETSY_API_KEY: 'abc123',
      ETSY_SHARED_SECRET: 'sec456',
    });
    // Etsy v3 keystring'i tek başına 403 ile reddediyor.
    expect(config.etsyApiKeyHeader).toBe('abc123:sec456');
  });

  it('shared secret yoksa header sadece keystring olur', () => {
    const config = loadConfig({ ETSY_API_KEY: 'abc123' });
    expect(config.etsyApiKeyHeader).toBe('abc123');
  });

  it('geçersiz modu reddeder', () => {
    expect(() => loadConfig({ ETSY_MODE: 'prod' })).toThrow();
  });
});

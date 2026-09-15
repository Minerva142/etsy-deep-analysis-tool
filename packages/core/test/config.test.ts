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

  it('live modda API key verilince yapılandırmayı döner', () => {
    const config = loadConfig({ ETSY_MODE: 'live', ETSY_API_KEY: 'abc123' });
    expect(config.etsyMode).toBe('live');
    expect(config.etsyApiKey).toBe('abc123');
  });

  it('geçersiz modu reddeder', () => {
    expect(() => loadConfig({ ETSY_MODE: 'prod' })).toThrow();
  });
});

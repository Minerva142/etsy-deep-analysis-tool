import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { HttpCache } from '../src/etsy/cache.js';
import { RateLimiter } from '../src/etsy/rate-limiter.js';
import { EtsyApiError, EtsyClient } from '../src/etsy/client.js';

interface ActiveListingsResponse {
  count: number;
  results: { listing_id: number }[];
}

describe('EtsyClient', () => {
  let db: Db;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
  });

  const build = (env: NodeJS.ProcessEnv, fetchImpl?: typeof fetch): EtsyClient =>
    new EtsyClient({
      config: loadConfig(env),
      db,
      cache: new HttpCache(db),
      limiter: new RateLimiter(db),
      fetchImpl,
      sleep: async () => {},
    });

  /** İsteğin header'larını yakalayan, sabit yanıt döndüren bir fetch yerine geçer. */
  const capturingFetch = (
    body: string,
    init?: ResponseInit,
  ): { fetchImpl: typeof fetch; headers: () => Headers } => {
    let captured = new Headers();
    const fetchImpl = (async (_input: unknown, requestInit?: RequestInit) => {
      captured = new Headers(requestInit?.headers);
      return new Response(body, init ?? { status: 200 });
    }) as unknown as typeof fetch;
    return { fetchImpl, headers: () => captured };
  };

  it('fixture modunda diskten okur, ağ çağrısı yapmaz', async () => {
    const fetchImpl = vi.fn();
    const client = build({ ETSY_MODE: 'fixture' }, fetchImpl as unknown as typeof fetch);

    const result = await client.request<ActiveListingsResponse>({
      path: '/v3/application/listings/active',
      params: { keywords: 'mug', offset: 0 },
      ttlSeconds: 3600,
    });

    expect(result.count).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("live modda x-api-key header’ı gönderir", async () => {
    const { fetchImpl, headers } = capturingFetch('{"count":0,"results":[]}');
    const client = build({ ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc', ETSY_SHARED_SECRET: 'sec-1' }, fetchImpl);

    await client.request({ path: '/v3/application/shops', ttlSeconds: 60 });

    expect(headers().get('x-api-key')).toBe('key-abc:sec-1');
    expect(headers().get('authorization')).toBeNull();
  });

  it('oauth isteğinde Bearer token ekler', async () => {
    const { fetchImpl, headers } = capturingFetch('{}');
    const client = build(
      {
        ETSY_MODE: 'live',
        ETSY_API_KEY: 'key-abc',
        ETSY_SHARED_SECRET: 'sec-1',
        ETSY_OAUTH_ACCESS_TOKEN: 'tok-1',
      },
      fetchImpl,
    );

    await client.request({
      path: '/v3/application/users/me',
      ttlSeconds: 60,
      auth: 'oauth',
    });

    expect(headers().get('authorization')).toBe('Bearer tok-1');
    expect(headers().get('x-api-key')).toBe('key-abc:sec-1');
  });

  it("ikinci özdeş istekte cache’ten okur", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ count: 1, results: [{ listing_id: 1 }] }), {
          status: 200,
        }),
    );
    const client = build(
      { ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc', ETSY_SHARED_SECRET: 'sec-1' },
      fetchImpl as unknown as typeof fetch,
    );
    const req = {
      path: '/v3/application/shops',
      params: { shop_name: 'x' },
      ttlSeconds: 600,
    };

    await client.request(req);
    await client.request(req);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('429 sonrası yeniden dener ve başarıya ulaşır', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = build(
      { ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc', ETSY_SHARED_SECRET: 'sec-1' },
      fetchImpl as unknown as typeof fetch,
    );

    const result = await client.request<{ ok: boolean }>({
      path: '/v3/application/shops',
      ttlSeconds: 60,
    });

    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('404 için yeniden denemeden hata fırlatır', async () => {
    const fetchImpl = vi.fn(async () => new Response('not found', { status: 404 }));
    const client = build(
      { ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc', ETSY_SHARED_SECRET: 'sec-1' },
      fetchImpl as unknown as typeof fetch,
    );

    await expect(
      client.request({ path: '/v3/application/shops/0', ttlSeconds: 60 }),
    ).rejects.toBeInstanceOf(EtsyApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rate limit header’larını limiter’a yazar", async () => {
    const { fetchImpl } = capturingFetch('{}', {
      status: 200,
      headers: { 'x-remaining-today': '9000', 'x-remaining-this-secon': '5' },
    });
    const client = build({ ETSY_MODE: 'live', ETSY_API_KEY: 'key-abc', ETSY_SHARED_SECRET: 'sec-1' }, fetchImpl);

    await client.request({ path: '/v3/application/shops', ttlSeconds: 60 });

    const rows = await db.query<{ remaining_today: string }>(
      'select remaining_today from rate_limit_state',
    );
    expect(Number(rows[0]?.remaining_today)).toBe(9000);
  });
});

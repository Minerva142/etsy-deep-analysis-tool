import type { Config } from '../config.js';
import type { Db } from '../db/connection.js';
import { buildCacheKey, type HttpCache } from './cache.js';
import { parseRateLimitHeaders, type RateLimiter } from './rate-limiter.js';
import { loadFixture } from './fixtures.js';

const BASE_URL = 'https://openapi.etsy.com';
const MAX_ATTEMPTS = 5;

export class EtsyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'EtsyApiError';
  }
}

export interface EtsyRequest {
  path: string;
  params?: Record<string, string | number | undefined>;
  ttlSeconds: number;
  auth?: 'apiKey' | 'oauth';
}

export interface EtsyClientOptions {
  config: Config;
  db: Db;
  cache: HttpCache;
  limiter: RateLimiter;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export class EtsyClient {
  private readonly config: Config;
  private readonly cache: HttpCache;
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: EtsyClientOptions) {
    this.config = options.config;
    this.cache = options.cache;
    this.limiter = options.limiter;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep =
      options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async request<T>(request: EtsyRequest): Promise<T> {
    const params = request.params ?? {};

    if (this.config.etsyMode === 'fixture') {
      return (await loadFixture(request.path, params)) as T;
    }

    const key = buildCacheKey(request.path, params);
    const cached = await this.cache.get(key);
    if (cached !== null) return cached as T;

    const body = await this.fetchWithRetry(request.path, params, request.auth ?? 'apiKey');
    await this.cache.set(key, body, request.ttlSeconds);
    return body as T;
  }

  private buildHeaders(auth: 'apiKey' | 'oauth'): Headers {
    const headers = new Headers({ accept: 'application/json' });
    if (this.config.etsyApiKey !== null) {
      headers.set('x-api-key', this.config.etsyApiKey);
    }
    if (auth === 'oauth') {
      if (this.config.etsyOauthAccessToken === null) {
        throw new Error('OAuth isteği için ETSY_OAUTH_ACCESS_TOKEN gerekli');
      }
      headers.set('authorization', `Bearer ${this.config.etsyOauthAccessToken}`);
    }
    return headers;
  }

  private buildUrl(
    path: string,
    params: Record<string, string | number | undefined>,
  ): string {
    const url = new URL(path, BASE_URL);
    for (const [name, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(name, String(value));
    }
    return url.toString();
  }

  private async fetchWithRetry(
    path: string,
    params: Record<string, string | number | undefined>,
    auth: 'apiKey' | 'oauth',
  ): Promise<unknown> {
    const url = this.buildUrl(path, params);
    const headers = this.buildHeaders(auth);
    let lastError: EtsyApiError | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      await this.limiter.acquire();
      const response = await this.fetchImpl(url, { method: 'GET', headers });
      await this.limiter.syncFromHeaders(parseRateLimitHeaders(response.headers));

      if (response.ok) {
        return (await response.json()) as unknown;
      }

      const retryable = response.status === 429 || response.status >= 500;
      const error = new EtsyApiError(
        `Etsy isteği başarısız (${String(response.status)}): ${path}`,
        response.status,
      );
      if (!retryable) throw error;

      lastError = error;
      await this.sleep(1000 * 2 ** attempt);
    }

    throw lastError ?? new EtsyApiError(`Etsy isteği başarısız: ${path}`, 0);
  }
}

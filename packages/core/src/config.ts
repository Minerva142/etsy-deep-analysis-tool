import { z } from 'zod';

const envSchema = z.object({
  ETSY_API_KEY: z.string().min(1).optional(),
  ETSY_SHARED_SECRET: z.string().min(1).optional(),
  ETSY_MODE: z.enum(['fixture', 'live']).default('fixture'),
  ETSY_OAUTH_ACCESS_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  DUCKDB_PATH: z.string().min(1).default('./data/etsy.duckdb'),
});

export interface Config {
  etsyApiKey: string | null;
  etsySharedSecret: string | null;
  /**
   * `x-api-key` header'ına konacak değer.
   *
   * Etsy v3 bu header'da keystring'i TEK BAŞINA kabul etmiyor; ölçülen
   * davranış (2026-09-16):
   *   keystring        -> 403 "Shared secret is required in x-api-key header."
   *   shared secret    -> 403 "API key not found or not active..."
   *   keystring:secret -> 200
   */
  etsyApiKeyHeader: string | null;
  etsyMode: 'fixture' | 'live';
  etsyOauthAccessToken: string | null;
  anthropicApiKey: string | null;
  duckdbPath: string;
}

/**
 * Varsa yerel .env dosyasını process.env'e yükler.
 *
 * Komut satırı bayrağı yerine kod içinde yapılıyor: Node'un --env-file
 * bayrağı dosya yoksa hata veriyor ve container'da .env bulunmuyor
 * (değişkenler compose'un env_file'ı ile geliyor). Böylece aynı komut
 * hem yerelde hem container'da çalışıyor.
 */
export function loadDotEnvIfPresent(path = '.env'): void {
  try {
    process.loadEnvFile(path);
  } catch {
    // Dosya yok ya da okunamadı: değişkenler başka yoldan gelmiş olabilir.
  }
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.parse(env);

  const apiKey = parsed.ETSY_API_KEY ?? null;
  const sharedSecret = parsed.ETSY_SHARED_SECRET ?? null;

  if (parsed.ETSY_MODE === 'live') {
    if (apiKey === null) {
      throw new Error('ETSY_MODE=live için ETSY_API_KEY gerekli');
    }
    if (sharedSecret === null) {
      throw new Error('ETSY_MODE=live için ETSY_SHARED_SECRET gerekli');
    }
  }

  return {
    etsyApiKey: apiKey,
    etsySharedSecret: sharedSecret,
    etsyApiKeyHeader:
      apiKey !== null && sharedSecret !== null ? `${apiKey}:${sharedSecret}` : apiKey,
    etsyMode: parsed.ETSY_MODE,
    etsyOauthAccessToken: parsed.ETSY_OAUTH_ACCESS_TOKEN ?? null,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY ?? null,
    duckdbPath: parsed.DUCKDB_PATH,
  };
}

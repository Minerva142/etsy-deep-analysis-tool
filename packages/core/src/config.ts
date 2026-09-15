import { z } from 'zod';

const envSchema = z.object({
  ETSY_API_KEY: z.string().min(1).optional(),
  ETSY_MODE: z.enum(['fixture', 'live']).default('fixture'),
  ETSY_OAUTH_ACCESS_TOKEN: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  DUCKDB_PATH: z.string().min(1).default('./data/etsy.duckdb'),
});

export interface Config {
  etsyApiKey: string | null;
  etsyMode: 'fixture' | 'live';
  etsyOauthAccessToken: string | null;
  anthropicApiKey: string | null;
  duckdbPath: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = envSchema.parse(env);

  if (parsed.ETSY_MODE === 'live' && !parsed.ETSY_API_KEY) {
    throw new Error('ETSY_MODE=live için ETSY_API_KEY gerekli');
  }

  return {
    etsyApiKey: parsed.ETSY_API_KEY ?? null,
    etsyMode: parsed.ETSY_MODE,
    etsyOauthAccessToken: parsed.ETSY_OAUTH_ACCESS_TOKEN ?? null,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY ?? null,
    duckdbPath: parsed.DUCKDB_PATH,
  };
}

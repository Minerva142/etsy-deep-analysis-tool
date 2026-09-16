import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// SDK'nin zodOutputFormat'i zod v4 tiplerini bekliyor. zod 3.25'te v4 API'si
// bu alt yolda; Etsy semalari v3 API'sinde kalmaya devam ediyor.
import type { z } from 'zod/v4';
import { MAX_TOKENS, MODEL, SISTEM_PROMPTU } from './model.js';

/**
 * Bir AI çağrısının dört olası sonucu.
 *
 * Hepsini `null`'a indirmek arayüzün doğru mesajı yazmasını imkânsız
 * kılardı: "anahtar yok" kullanıcının çözebileceği bir şey, "şema tutmadı"
 * bizim hatamız, "reddedildi" ise başka bir şey.
 */
export type AiSonuc<T> =
  | { durum: 'tamam'; veri: T; model: string }
  | { durum: 'kapali' }
  | { durum: 'reddedildi'; sebep: string }
  | { durum: 'cozulemedi' };

export interface AiIstek<T> {
  /** Modele verilen agregatlar ve soru. */
  istem: string;
  sema: z.ZodType<T>;
}

export interface AiIstemci {
  uret<T>(istek: AiIstek<T>): Promise<AiSonuc<T>>;
}

/** Anahtar yoksa hiçbir çağrı yapmayan, hep 'kapali' dönen istemci. */
const KAPALI_ISTEMCI: AiIstemci = {
  uret: async () => ({ durum: 'kapali' }),
};

export function anthropicIstemcisi(apiKey: string | null): AiIstemci {
  if (apiKey === null || apiKey.trim() === '') return KAPALI_ISTEMCI;

  const client = new Anthropic({ apiKey });

  return {
    async uret<T>(istek: AiIstek<T>): Promise<AiSonuc<T>> {
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // Sabit sistem promptu önekte: prompt cache'e giren kısım burası.
        system: SISTEM_PROMPTU,
        messages: [{ role: 'user', content: istek.istem }],
        output_config: { format: zodOutputFormat(istek.sema) },
      });

      if (response.stop_reason === 'refusal') {
        return {
          durum: 'reddedildi',
          sebep: response.stop_details?.explanation ?? 'Model isteği reddetti.',
        };
      }

      // parsed_output şema doğrulanamazsa null döner.
      const veri = response.parsed_output as T | null;
      if (veri === null || veri === undefined) return { durum: 'cozulemedi' };

      return { durum: 'tamam', veri, model: response.model };
    },
  };
}

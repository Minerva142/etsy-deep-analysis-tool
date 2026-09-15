import { readFile } from 'node:fs/promises';

/** Bir URL olarak tutulur: `new URL(dosyaAdi, fixturesDir)` ancak böyle çalışır. */
const fixturesDir = new URL('../../fixtures/', import.meta.url);

/**
 * Fixture dosya adı, endpoint yolunun son iki parçası ve ayırt edici
 * parametrelerden türetilir:
 *   /v3/application/listings/active + {keywords: 'mug', offset: 0}
 *     -> listings-active-mug-offset0.json
 *   /v3/application/shops/11111
 *     -> shops-11111.json
 */
export function fixtureFileName(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const segments = path.split('/').filter(Boolean).slice(-2).join('-');
  const keywords = params.keywords === undefined ? null : String(params.keywords);
  const offset = params.offset === undefined ? null : `offset${String(params.offset)}`;
  const suffix = [keywords, offset].filter((part) => part !== null).join('-');
  return suffix.length > 0 ? `${segments}-${suffix}.json` : `${segments}.json`;
}

export async function loadFixture(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<unknown> {
  const fileName = fixtureFileName(path, params);
  try {
    const raw = await readFile(new URL(fileName, fixturesDir), 'utf8');
    return JSON.parse(raw) as unknown;
  } catch (cause) {
    // Gerçek nedeni koru: "dosya yok" ile "bozuk JSON" farklı sorunlardır.
    throw new Error(`Fixture okunamadı: ${fileName} (${path})`, { cause });
  }
}

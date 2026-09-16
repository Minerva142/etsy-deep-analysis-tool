import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import {
  loadConfig,
  loadDotEnvIfPresent,
  openDb,
  type Db,
} from '@etsy-analysis/core/analysis';

/**
 * DUCKDB_PATH göreli verildiğinde depo köküne göre çözülür.
 *
 * Next sunucusu apps/web dizininden çalışıyor, CLI ise kökten. İkisi de aynı
 * ./data/etsy.duckdb dosyasını göstermeli. Kökü pnpm-workspace.yaml'ı arayarak
 * buluyoruz; Docker'da cwd zaten kök olduğu için ilk adımda bulunur.
 */
export function veritabaniYolu(configPath: string): string {
  if (isAbsolute(configPath)) return configPath;

  let dizin = process.cwd();
  for (;;) {
    if (existsSync(resolve(dizin, 'pnpm-workspace.yaml'))) {
      return resolve(dizin, configPath);
    }
    const ust = dirname(dizin);
    if (ust === dizin) break;
    dizin = ust;
  }

  // Kök bulunamadıysa cwd'ye göre çöz; hata mesajı yolu içerdiği için
  // sessizce yanlış dosyaya bağlanmaktan iyidir.
  return resolve(process.cwd(), configPath);
}

/**
 * İstek başına bir bağlantı açar ve her durumda kapatır.
 *
 * Dashboard bir OKUYUCU: şemayı oluşturmaz, migrate çalıştırmaz. Şemayı
 * yazan taraf (CLI snapshot komutu) kurar. Bağlantıyı kısa ömürlü tutmak
 * dashboard açıkken snapshot alınabilmesini de sağlıyor.
 */
export async function withDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  loadDotEnvIfPresent();
  const config = loadConfig(process.env);
  // Panel yalnizca okuyor: salt-okunur acmak CLI'in ayni anda yazmasina izin verir.
  const db = await openDb(veritabaniYolu(config.duckdbPath), { readOnly: true });
  try {
    return await fn(db);
  } finally {
    await db.close();
  }
}

/**
 * Henüz hiç snapshot alınmamışsa tablolar yoktur. Sorgu patlatmak yerine
 * bunu önceden sorup boş ekran gösteriyoruz.
 */
export async function semaHazirMi(db: Db): Promise<boolean> {
  const rows = await db.query<{ n: string }>(
    `select count(*) as n from information_schema.tables
      where table_schema = 'main' and table_name = 'niches'`,
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

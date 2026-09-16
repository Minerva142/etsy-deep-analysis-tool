import type { z } from 'zod/v4';
import { toDbTimestamp, type Db } from '../db/connection.js';
import type { InsightTipi } from './semalar.js';

/**
 * Üretilen insight'lar snapshot bazında saklanır.
 *
 * Sebep: bir snapshot'ın verisi değişmez, dolayısıyla yorumu da değişmez.
 * Panelin her açılışında yeniden üretmek para yakmak olurdu — bu yüzden
 * panel yalnızca buradan okur, hiç API çağırmaz.
 */
export async function insightOku<T>(
  db: Db,
  snapshotId: string,
  tip: InsightTipi,
  sema: z.ZodType<T>,
): Promise<{ veri: T; model: string | null; uretildi: string } | null> {
  const rows = await db.query<{
    payload_json: string;
    model: string | null;
    created_at: string;
  }>(
    `select payload_json, model, created_at
       from ai_insights
      where snapshot_id = $snapshot and insight_type = $tip`,
    { snapshot: snapshotId, tip },
  );

  const row = rows[0];
  if (row === undefined) return null;

  const parsed = sema.safeParse(JSON.parse(row.payload_json));
  if (!parsed.success) {
    // Şema değişmiş olabilir; bozuk cache'i yok sayıp yeniden üretilmesine
    // izin veriyoruz. Sessizce yanlış şekilli veri döndürmekten iyidir.
    return null;
  }

  return { veri: parsed.data, model: row.model, uretildi: row.created_at };
}

export async function insightYaz(
  db: Db,
  snapshotId: string,
  tip: InsightTipi,
  veri: unknown,
  model: string,
  now: Date = new Date(),
): Promise<void> {
  await db.runStatement(
    `insert or replace into ai_insights
       (snapshot_id, insight_type, payload_json, model, created_at)
     values ($snapshot, $tip, $payload, $model, $createdAt::TIMESTAMP)`,
    {
      snapshot: snapshotId,
      tip,
      payload: JSON.stringify(veri),
      model,
      createdAt: toDbTimestamp(now),
    },
  );
}

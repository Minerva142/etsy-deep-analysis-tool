import type { Db } from '../db/connection.js';

/** Niş için son tamamlanmış snapshot'ın kimliği; hiç yoksa null. */
export async function getLatestSnapshotId(
  db: Db,
  nicheId: string,
): Promise<string | null> {
  const rows = await db.query<{ snapshot_id: string }>(
    'select snapshot_id from v_latest_snapshot where niche_id = $niche',
    { niche: nicheId },
  );
  return rows[0]?.snapshot_id ?? null;
}

/**
 * Nişin tamamlanmış snapshot sayısı.
 *
 * Favori hızına dayanan analizler en az iki snapshot gerektirir; rapor
 * bu sayıya bakıp kullanıcıyı uyarır.
 */
export async function countSnapshots(db: Db, nicheId: string): Promise<number> {
  const rows = await db.query<{ n: string }>(
    `select count(*) as n from snapshots
      where niche_id = $niche and status = 'complete'`,
    { niche: nicheId },
  );
  return Number(rows[0]?.n ?? 0);
}

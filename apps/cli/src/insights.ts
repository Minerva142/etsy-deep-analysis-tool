import {
  anthropicIstemcisi,
  firsatAciklamasiUret,
  getFreshness,
  getGapMatrix,
  getLatestSnapshotId,
  getMarketOverview,
  getPriceDemandCurve,
  getReviewStats,
  getTagQuadrant,
  getTopRisers,
  getVelocitySeries,
  nisOzetiUret,
  yorumTemalariUret,
  type AiSonuc,
  type Config,
  type Db,
} from '@etsy-analysis/core';

/** Her sonuç durumu için kullanıcıya ne yapacağını söyleyen tek satır. */
function durumSatiri(etiket: string, sonuc: AiSonuc<unknown> & { cacheten?: boolean }): string {
  switch (sonuc.durum) {
    case 'tamam':
      return `  ${etiket}: ${sonuc.cacheten === true ? 'cache’ten okundu' : 'üretildi'}`;
    case 'kapali':
      return `  ${etiket}: atlandı (ANTHROPIC_API_KEY tanımlı değil)`;
    case 'reddedildi':
      return `  ${etiket}: model reddetti — ${sonuc.sebep}`;
    case 'cozulemedi':
      return `  ${etiket}: yanıt beklenen şemaya uymadı`;
  }
}

export async function insightsCalistir(options: {
  db: Db;
  config: Config;
  nicheId: string;
  force: boolean;
}): Promise<void> {
  const { db, config, nicheId, force } = options;

  const nisler = await db.query<{ name: string }>(
    'select name from niches where niche_id = $id',
    { id: nicheId },
  );
  const nis = nisler[0];
  if (nis === undefined) {
    throw new Error(`Niş bulunamadı: ${nicheId}`);
  }

  const snapshotId = await getLatestSnapshotId(db, nicheId);
  if (snapshotId === null) {
    throw new Error(
      `Bu niş için tamamlanmış snapshot yok. Önce: pnpm snapshot --niche ${nicheId} ...`,
    );
  }

  const istemci = anthropicIstemcisi(config.anthropicApiKey);

  const [ozet, tazelik, seri, yukselenler, bantlar, etiketler, hucreler, yorumlar] =
    await Promise.all([
      getMarketOverview(db, nicheId),
      getFreshness(db, nicheId),
      getVelocitySeries(db, nicheId),
      getTopRisers(db, nicheId),
      getPriceDemandCurve(db, nicheId),
      getTagQuadrant(db, nicheId),
      getGapMatrix(db, nicheId),
      getReviewStats(db, nicheId),
    ]);

  const satirlar: string[] = [`Insight üretimi: ${nis.name} (snapshot ${snapshotId})`];

  const ozetSonucu = await nisOzetiUret({
    db,
    istemci,
    snapshotId,
    force,
    girdi: { nisAdi: nis.name, ozet, tazelik, seri, yukselenler },
  });
  satirlar.push(durumSatiri('niş özeti', ozetSonucu));

  const firsatSonucu = await firsatAciklamasiUret({
    db,
    istemci,
    snapshotId,
    force,
    girdi: {
      nisAdi: nis.name,
      bantlar,
      firsatEtiketleri: etiketler.filter((t) => t.quadrant === 'firsat'),
      hucreler,
    },
  });
  satirlar.push(durumSatiri('fırsat açıklaması', firsatSonucu));

  if (yorumlar.lowRated.length === 0) {
    satirlar.push('  yorum temaları: atlandı (düşük puanlı yorum yok)');
  } else {
    const yorumSonucu = await yorumTemalariUret({
      db,
      istemci,
      snapshotId,
      force,
      girdi: {
        nisAdi: nis.name,
        dusukPuanli: yorumlar.lowRated.map((r) => ({ rating: r.rating, text: r.text })),
      },
    });
    satirlar.push(durumSatiri('yorum temaları', yorumSonucu));
  }

  if (config.anthropicApiKey === null) {
    satirlar.push(
      '',
      'AI katmanı kapalı. Açmak için .env dosyasına ANTHROPIC_API_KEY ekleyin.',
      'Araç anahtar olmadan da tam çalışır; yalnızca yorum katmanı devre dışı kalır.',
    );
  }

  process.stdout.write(`${satirlar.join('\n')}\n`);
}

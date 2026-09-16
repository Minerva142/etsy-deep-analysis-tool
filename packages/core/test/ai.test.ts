import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { insightOku, insightYaz } from '../src/ai/cache.js';
import {
  INSIGHT_TIPLERI,
  nisOzetiSemasi,
  type NisOzeti,
} from '../src/ai/semalar.js';
import { anthropicIstemcisi, type AiIstemci } from '../src/ai/client.js';
import {
  cachetenOku,
  nisOzetiUret,
  yorumTemalariUret,
  type NisOzetiGirdisi,
} from '../src/ai/insights.js';
import { seedTwoSnapshots } from './helpers/seed.js';

const ORNEK_OZET: NisOzeti = {
  durum: 'Niş parçalı, 146 satıcı var.',
  trendler: ['Medyan fiyat 29.50'],
  aksiyonlar: [{ baslik: 'Alt banda gir', gerekce: 'Listing başına talep orada yüksek.' }],
};

/** Gerçek API'ye çıkmayan, ne döndüreceği sabit istemci. */
function sahteIstemci(
  sonuc: Awaited<ReturnType<AiIstemci['uret']>> = {
    durum: 'tamam',
    veri: ORNEK_OZET,
    model: 'test-model',
  },
): AiIstemci & { cagrilar: string[] } {
  const cagrilar: string[] = [];
  return {
    cagrilar,
    uret: vi.fn(async (istek: { istem: string }) => {
      cagrilar.push(istek.istem);
      return sonuc;
    }) as unknown as AiIstemci['uret'],
  };
}

describe('anthropicIstemcisi', () => {
  it('anahtar yokken hiç çağrı yapmadan kapalı döner', async () => {
    const istemci = anthropicIstemcisi(null);
    const sonuc = await istemci.uret({ istem: 'x', sema: nisOzetiSemasi });
    expect(sonuc.durum).toBe('kapali');
  });

  it('boş anahtarı da kapalı sayar', async () => {
    const sonuc = await anthropicIstemcisi('   ').uret({
      istem: 'x',
      sema: nisOzetiSemasi,
    });
    expect(sonuc.durum).toBe('kapali');
  });
});

describe('insight cache', () => {
  let db: Db;
  let snapshotB: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ snapshotB } = await seedTwoSnapshots(db));
  });

  it('yazılan insight geri okunur', async () => {
    await insightYaz(db, snapshotB, INSIGHT_TIPLERI.nisOzeti, ORNEK_OZET, 'test-model');
    const okunan = await insightOku(db, snapshotB, INSIGHT_TIPLERI.nisOzeti, nisOzetiSemasi);
    expect(okunan?.veri.durum).toBe(ORNEK_OZET.durum);
    expect(okunan?.model).toBe('test-model');
  });

  it('bilinmeyen snapshot için null döner', async () => {
    expect(
      await insightOku(db, 'yok', INSIGHT_TIPLERI.nisOzeti, nisOzetiSemasi),
    ).toBeNull();
  });

  it('şemaya uymayan cache satırını yok sayar', async () => {
    // Şema değişmiş olabilir; bozuk veriyi döndürmek sessiz hata olurdu.
    await db.runStatement(
      `insert into ai_insights (snapshot_id, insight_type, payload_json, model, created_at)
       values ($s, $t, '{"beklenmeyen":1}', 'm', now())`,
      { s: snapshotB, t: INSIGHT_TIPLERI.nisOzeti },
    );
    expect(
      await insightOku(db, snapshotB, INSIGHT_TIPLERI.nisOzeti, nisOzetiSemasi),
    ).toBeNull();
  });
});

describe('nisOzetiUret', () => {
  let db: Db;
  let snapshotB: string;

  const girdi: NisOzetiGirdisi = {
    nisAdi: 'Test niş',
    ozet: {
      listingCount: 199,
      sellerCount: 146,
      medianPrice: 29.5,
      p25Price: 18.21,
      p75Price: 45.99,
      avgVelocity: null,
      totalFavorers: 21629,
      priceCurrency: 'USD',
      pricedCount: 199,
    },
    tazelik: { medianAgeDays: 128, newLast30Days: 65, newLast90Days: 75 },
    seri: [],
    yukselenler: [],
  };

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ snapshotB } = await seedTwoSnapshots(db));
  });

  it('ölçülmüş sayıları prompt’a koyar', async () => {
    const istemci = sahteIstemci();
    await nisOzetiUret({ db, istemci, snapshotId: snapshotB, girdi });

    const istem = istemci.cagrilar[0] ?? '';
    expect(istem).toContain('199');
    expect(istem).toContain('29.50');
    expect(istem).toContain('Test niş');
  });

  it('ölçülemeyen değeri sayı gibi göstermez', async () => {
    const istemci = sahteIstemci();
    await nisOzetiUret({ db, istemci, snapshotId: snapshotB, girdi });
    // avgVelocity null; prompt'a uydurma bir sayı girmemeli.
    expect(istemci.cagrilar[0]).toContain('ortalama favori hızı (adet/gün): ölçülemedi');
  });

  it('sonucu cache’e yazar', async () => {
    const istemci = sahteIstemci();
    await nisOzetiUret({ db, istemci, snapshotId: snapshotB, girdi });

    const okunan = await insightOku(db, snapshotB, INSIGHT_TIPLERI.nisOzeti, nisOzetiSemasi);
    expect(okunan?.veri.durum).toBe(ORNEK_OZET.durum);
  });

  it('ikinci çağrıda API’ye gitmez', async () => {
    const birinci = sahteIstemci();
    await nisOzetiUret({ db, istemci: birinci, snapshotId: snapshotB, girdi });

    const ikinci = sahteIstemci();
    const sonuc = await nisOzetiUret({ db, istemci: ikinci, snapshotId: snapshotB, girdi });

    expect(ikinci.cagrilar).toHaveLength(0);
    expect(sonuc.cacheten).toBe(true);
  });

  it('force ile cache atlanır', async () => {
    const birinci = sahteIstemci();
    await nisOzetiUret({ db, istemci: birinci, snapshotId: snapshotB, girdi });

    const ikinci = sahteIstemci();
    await nisOzetiUret({ db, istemci: ikinci, snapshotId: snapshotB, girdi, force: true });

    expect(ikinci.cagrilar).toHaveLength(1);
  });

  it('anahtar kapalıyken cache’e yazmaz', async () => {
    const istemci = sahteIstemci({ durum: 'kapali' });
    const sonuc = await nisOzetiUret({ db, istemci, snapshotId: snapshotB, girdi });

    expect(sonuc.durum).toBe('kapali');
    expect(
      await insightOku(db, snapshotB, INSIGHT_TIPLERI.nisOzeti, nisOzetiSemasi),
    ).toBeNull();
  });

  it('reddedilen isteği cache’e yazmaz', async () => {
    const istemci = sahteIstemci({ durum: 'reddedildi', sebep: 'test' });
    const sonuc = await nisOzetiUret({ db, istemci, snapshotId: snapshotB, girdi });

    expect(sonuc.durum).toBe('reddedildi');
    expect(
      await insightOku(db, snapshotB, INSIGHT_TIPLERI.nisOzeti, nisOzetiSemasi),
    ).toBeNull();
  });
});

describe('yorumTemalariUret', () => {
  let db: Db;
  let snapshotB: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ snapshotB } = await seedTwoSnapshots(db));
  });

  it('yorum sayısını 60 ile sınırlar', async () => {
    const istemci = sahteIstemci({
      durum: 'tamam',
      veri: { temalar: [], urun_firsatlari: [] },
      model: 'test-model',
    });

    await yorumTemalariUret({
      db,
      istemci,
      snapshotId: snapshotB,
      girdi: {
        nisAdi: 'Test',
        dusukPuanli: Array.from({ length: 100 }, (_, i) => ({
          rating: 2,
          text: `yorum-${String(i)}`,
        })),
      },
    });

    const istem = istemci.cagrilar[0] ?? '';
    expect(istem).toContain('yorum-59');
    expect(istem).not.toContain('yorum-60');
  });
});

describe('cachetenOku', () => {
  let db: Db;
  let snapshotB: string;

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    ({ snapshotB } = await seedTwoSnapshots(db));
  });

  it('hiç insight yokken üçü de null döner', async () => {
    const hepsi = await cachetenOku(db, snapshotB);
    expect(hepsi.nisOzeti).toBeNull();
    expect(hepsi.yorumTemalari).toBeNull();
    expect(hepsi.firsatAciklamasi).toBeNull();
  });

  it('yazılmış insight’ı döndürür', async () => {
    await insightYaz(db, snapshotB, INSIGHT_TIPLERI.nisOzeti, ORNEK_OZET, 'test-model');
    const hepsi = await cachetenOku(db, snapshotB);
    expect(hepsi.nisOzeti?.durum).toBe(ORNEK_OZET.durum);
  });
});

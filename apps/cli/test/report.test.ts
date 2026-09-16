import { describe, expect, it } from 'vitest';
import { formatReport, type ReportData } from '../src/report.js';

const bosVeri: ReportData = {
  nicheName: 'Test niş',
  snapshotCount: 1,
  overview: null,
  freshness: null,
  series: [],
  risers: [],
  bands: [],
  gaps: [],
  tags: [],
  sellers: [],
  concentration: null,
  reviews: { ratingDistribution: [], lowRated: [] },
};

describe('formatReport', () => {
  it('niş adını başlığa koyar', () => {
    expect(formatReport(bosVeri)).toContain('Test niş');
  });

  it('tek snapshot varken hız analizlerinin ölçülemediğini söyler', () => {
    expect(formatReport(bosVeri)).toContain('en az iki snapshot');
  });

  it('iki snapshot varken uyarıyı basmaz', () => {
    expect(formatReport({ ...bosVeri, snapshotCount: 2 })).not.toContain(
      'en az iki snapshot',
    );
  });

  it('pazar görünümü sayılarını basar', () => {
    const cikti = formatReport({
      ...bosVeri,
      snapshotCount: 2,
      overview: {
        listingCount: 100,
        sellerCount: 81,
        medianPrice: 16.19,
        p25Price: 10.83,
        p75Price: 21.9,
        avgVelocity: 1.5,
        totalFavorers: 4200,
      },
    });
    expect(cikti).toContain('100');
    expect(cikti).toContain('16.19');
    expect(cikti).toContain('Pazar görünümü');
  });

  it('yalnızca fırsat kadranındaki etiketleri vurgular', () => {
    const cikti = formatReport({
      ...bosVeri,
      snapshotCount: 2,
      tags: [
        { tag: 'custom name mug', usageCount: 5, avgVelocity: 104, quadrant: 'firsat' },
        { tag: 'coffee', usageCount: 90, avgVelocity: 0.2, quadrant: 'dusuk-getiri' },
      ],
    });
    expect(cikti).toContain('custom name mug');
    expect(cikti).not.toContain('coffee');
  });

  it('ölçülemeyen değerleri tire ile gösterir', () => {
    const cikti = formatReport({
      ...bosVeri,
      snapshotCount: 2,
      overview: {
        listingCount: 5,
        sellerCount: 5,
        medianPrice: null,
        p25Price: null,
        p75Price: null,
        avgVelocity: null,
        totalFavorers: 0,
      },
    });
    expect(cikti).toContain('—');
  });

  it('düşük puanlı yorumları örnekler', () => {
    const cikti = formatReport({
      ...bosVeri,
      snapshotCount: 2,
      reviews: {
        ratingDistribution: [{ rating: 2, count: 3 }],
        lowRated: [{ listingId: 1, rating: 2, text: 'Kulpu kırık geldi' }],
      },
    });
    expect(cikti).toContain('Kulpu kırık geldi');
  });
});

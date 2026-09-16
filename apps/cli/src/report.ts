import type {
  Concentration,
  Freshness,
  GapCell,
  MarketOverview,
  PriceBand,
  ReviewStats,
  RiserRow,
  SellerRow,
  TagRow,
  VelocityPoint,
} from '@etsy-analysis/core';

export interface ReportData {
  nicheName: string;
  snapshotCount: number;
  overview: MarketOverview | null;
  freshness: Freshness | null;
  series: VelocityPoint[];
  risers: RiserRow[];
  bands: PriceBand[];
  gaps: GapCell[];
  tags: TagRow[];
  sellers: SellerRow[];
  concentration: Concentration | null;
  reviews: ReviewStats;
}

const para = (value: number | null): string => (value === null ? '—' : value.toFixed(2));
const sayi = (value: number | null, basamak = 2): string =>
  value === null ? '—' : value.toFixed(basamak);

function baslik(metin: string): string {
  return `\n${metin}\n${'─'.repeat(metin.length)}`;
}

export function formatReport(data: ReportData): string {
  const satirlar: string[] = [`Niş: ${data.nicheName}`];

  if (data.snapshotCount < 2) {
    satirlar.push(
      '',
      `Uyarı: bu nişte ${String(data.snapshotCount)} snapshot var.`,
      'Favori hızına dayanan analizler için en az iki snapshot gerekiyor;',
      'aşağıdaki hız değerleri ölçülemedi. İkinci snapshot alındığında dolacak.',
    );
  }

  if (data.overview !== null) {
    const o = data.overview;
    satirlar.push(
      baslik('Pazar görünümü'),
      `  listing            ${String(o.listingCount)}`,
      `  satıcı             ${String(o.sellerCount)}`,
      `  medyan fiyat       ${para(o.medianPrice)}`,
      `  fiyat aralığı      ${para(o.p25Price)} – ${para(o.p75Price)}  (p25–p75)`,
      `  toplam favori      ${String(o.totalFavorers)}`,
      `  ort. favori hızı   ${sayi(o.avgVelocity)} /gün`,
    );
  }

  if (data.freshness !== null) {
    const f = data.freshness;
    satirlar.push(
      baslik('Tazelik'),
      `  medyan yaş         ${sayi(f.medianAgeDays, 0)} gün`,
      `  son 30 günde yeni  ${String(f.newLast30Days)}`,
      `  son 90 günde yeni  ${String(f.newLast90Days)}`,
    );
  }

  if (data.risers.length > 0) {
    satirlar.push(baslik('En hızlı yükselen listingler'));
    for (const r of data.risers.slice(0, 10)) {
      satirlar.push(
        `  ${sayi(r.velocity).padStart(8)} /gün  ${para(r.price).padStart(8)}  ` +
          `${(r.title ?? '(başlıksız)').slice(0, 52)}`,
      );
    }
  }

  if (data.bands.length > 0) {
    satirlar.push(
      baslik('Fiyat–talep eğrisi'),
      '  bant     fiyat aralığı        arz     talep   talep/listing',
    );
    for (const b of data.bands) {
      satirlar.push(
        `  ${String(b.band).padStart(4)}  ${para(b.minPrice).padStart(8)}–${para(b.maxPrice).padEnd(8)}` +
          `${String(b.supply).padStart(5)}  ${sayi(b.demand).padStart(8)}  ${sayi(b.demandPerListing).padStart(10)}`,
      );
    }
  }

  // Hiz olculemediginde kadran anlamsiz: hepsi 0 olan etiketleri
  // "firsat" diye sunmak yaniltici olur.
  const firsatlar =
    data.snapshotCount < 2 ? [] : data.tags.filter((t) => t.quadrant === 'firsat');
  if (firsatlar.length > 0) {
    satirlar.push(baslik('Etiket fırsatları (yüksek getiri, düşük kullanım)'));
    for (const t of firsatlar.slice(0, 10)) {
      satirlar.push(
        `  ${sayi(t.avgVelocity).padStart(8)} /gün  ${String(t.usageCount).padStart(4)} listing  ${t.tag}`,
      );
    }
  }

  if (data.snapshotCount >= 2 && data.gaps.length > 0) {
    satirlar.push(baslik('Boşluk matrisi (en yüksek talep/arz oranı)'));
    for (const g of data.gaps.slice(0, 8)) {
      satirlar.push(
        `  oran ${sayi(g.ratio).padStart(7)}  bant ${String(g.band)}  arz ${String(g.supply).padStart(4)}  ` +
          `${(g.taxonomyPath ?? String(g.taxonomyId ?? '—')).slice(0, 48)}`,
      );
    }
  }

  if (data.sellers.length > 0) {
    satirlar.push(baslik('Satıcılar'));
    for (const s of data.sellers.slice(0, 10)) {
      satirlar.push(
        `  ${String(s.listingCount).padStart(3)} listing  ${sayi(s.avgVelocity).padStart(8)} /gün  ` +
          `puan ${sayi(s.reviewAverage, 1).padStart(4)}  ${s.shopName ?? String(s.shopId)}`,
      );
    }
  }

  if (data.concentration !== null) {
    const c = data.concentration;
    satirlar.push(
      baslik('Rekabet yoğunluğu'),
      `  satıcı sayısı      ${String(c.sellerCount)}`,
      `  top-10 payı        ${(c.top10Share * 100).toFixed(1)}%`,
      `  HHI                ${sayi(c.hhi, 4)}`,
    );
  }

  if (data.reviews.ratingDistribution.length > 0) {
    satirlar.push(baslik('Yorumlar'));
    for (const r of data.reviews.ratingDistribution) {
      satirlar.push(`  ${String(r.rating)} yıldız   ${String(r.count)}`);
    }
    if (data.reviews.lowRated.length > 0) {
      satirlar.push('', '  Düşük puanlı yorumlardan örnekler:');
      for (const r of data.reviews.lowRated.slice(0, 5)) {
        satirlar.push(`    (${String(r.rating)}) ${r.text.slice(0, 70)}`);
      }
    }
  }

  return `${satirlar.join('\n')}\n`;
}

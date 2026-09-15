# Etsy Deep Analysis Tool

Etsy pazarını sistematik olarak analiz eden, local çalışan bir araç. Etsy Open API v3 üzerinden periyodik **snapshot**'lar alır, tarihçe biriktirir ve bu tarihçe üzerinde talep/fiyat/rekabet analizleri çalıştırır.

## Ne yapar

- **Talep hızı** — listing'lerin favori sayısındaki değişimi zaman içinde ölçer
- **Fiyat–talep eğrisi** — hangi fiyat bandında arz az, ilgi yüksek
- **Etiket fırsat kadranı** — getirisine göre az kullanılan etiketler
- **Boşluk matrisi** — kategori × fiyat bandı bazında talep/arz oranı
- **Rekabet analizi** — satıcı konsantrasyonu, yükselen satıcılar
- **Yorum madenciliği** — düşük puanlı yorumlarda tekrar eden temalar

Sonuçlar bir dashboard üzerinden görüntülenir ve bir MCP server aracılığıyla LLM'lere araç olarak sunulur.

## Ne yapmaz

- Satış adedi veya gelir **tahmini üretmez**. Etsy public API'si satış ve görüntülenme verisi vermez; araç yalnızca ölçülmüş veriyi gösterir, tek talep sinyali `num_favorers`'tır.
- Etsy'yi scrape etmez — tüm veri resmî Open API v3'ten, rate limit'lere uyularak alınır.
- Otomatik listing yayınlamaz veya düzenlemez.

## Durum

Tasarım aşaması. Detaylı tasarım dokümanı: [`docs/superpowers/specs/2026-09-16-etsy-deep-analysis-tool-design.md`](docs/superpowers/specs/2026-09-16-etsy-deep-analysis-tool-design.md)

## Teknoloji

TypeScript monorepo (pnpm workspace) — paylaşılan `core` paketi, Next.js dashboard, MCP server, DuckDB depolama.

## Kurulum

Henüz implementasyon başlamadı. Yapılandırma `.env` üzerinden yapılacak; örnek için `.env.example` dosyasına bakın.

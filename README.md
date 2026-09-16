# Etsy Deep Analysis Tool

Etsy pazarını sistematik olarak analiz eden, local çalışan bir araç. Etsy Open API v3 üzerinden periyodik **snapshot**'lar alır, tarihçe biriktirir ve bu tarihçe üzerinde talep/fiyat/rekabet analizleri çalıştırır.

## Ne yapar

- **Talep hızı** — listing'lerin favori sayısındaki değişimi zaman içinde ölçer
- **Fiyat–talep eğrisi** — hangi fiyat bandında arz az, ilgi yüksek
- **Etiket fırsat kadranı** — getirisine göre az kullanılan etiketler
- **Boşluk matrisi** — kategori × fiyat bandı bazında talep/arz oranı
- **Rekabet analizi** — satıcı konsantrasyonu, yükselen satıcılar
- **Yorum madenciliği** — düşük puanlı yorumlarda tekrar eden temalar

## Ne yapmaz

- Satış adedi veya gelir **tahmini üretmez**. Etsy public API'si satış ve görüntülenme verisi vermez; araç yalnızca ölçülmüş veriyi gösterir, tek talep sinyali `num_favorers`'tır.
- Etsy'yi scrape etmez — tüm veri resmî Open API v3'ten, rate limit'lere uyularak alınır.
- Otomatik listing yayınlamaz veya düzenlemez.

## Durum

**Faz 0 tamam:** veri boru hattı çalışıyor — Etsy'den çekim, rate limiting, cache, DuckDB'ye snapshot yazma. Canlı API'ye karşı doğrulandı.

Sıradaki: Faz 1, analiz katmanı. Yol haritası [tasarım dokümanında](docs/superpowers/specs/2026-09-16-etsy-deep-analysis-tool-design.md).

## Kurulum

Gereken: Node >= 20.17 ve pnpm >= 9 (ya da sadece Docker).

```bash
pnpm install
cp .env.example .env
```

`.env` içine Etsy developer panelindeki değerleri yaz:

```
ETSY_API_KEY=<keystring>
ETSY_SHARED_SECRET=<shared secret>
ETSY_MODE=live
```

> **Dikkat:** Etsy v3, `x-api-key` header'ında keystring'i tek başına kabul etmiyor —
> `<keystring>:<shared secret>` biçimini bekliyor. Araç bu birleştirmeyi kendisi yapar,
> sen iki değeri ayrı ayrı vermen yeterli. `ETSY_MODE=fixture` ile API anahtarı olmadan,
> kayıtlı örnek yanıtlarla da çalışabilir.

## Kullanım

```bash
# Bir niş için snapshot al
pnpm snapshot --niche ceramic-mug --name "Ceramic mugs" --keywords "ceramic mug"

# Kotayı sınırla (ilk denemelerde önerilir)
pnpm snapshot --niche ceramic-mug --name "Ceramic mugs" --keywords "ceramic mug" \
  --max-pages 1 --max-shops 3 --max-review-listings 3

# Toplanan veriye hızlı bak
pnpm inspect
```

Diğer seçenekler: `--taxonomy-id`, `--min-price`, `--max-price`.

**Favori hızı için en az iki snapshot gerekir.** Tek snapshot yalnızca anlık bir görüntü verir; analizlerin değerli kısmı ardışık snapshot'lar arasındaki değişimden gelir. Günlük çalıştırmak makul bir başlangıç.

## Docker

```bash
docker compose build
docker compose run --rm cli snapshot --niche ceramic-mug --name "Ceramic mugs" --keywords "ceramic mug"
docker compose run --rm cli test
```

Anahtarlar imaja gömülmez; çalışma anında host'taki `.env`'den okunur. DuckDB dosyası `./data` volume'unda host'ta durur, yani container silinse de tarihçe kaybolmaz — yerelde ve container'da çalıştırılan snapshot'lar aynı veritabanında birikir.

## Geliştirme

```bash
pnpm test        # 73 test, ağ erişimi gerektirmez (fixture modu)
pnpm typecheck
```

Testler Etsy'ye hiç istek atmaz; `packages/core/fixtures/` altındaki kayıtlı yanıtları kullanır.

## Teknoloji

TypeScript monorepo (pnpm workspace) — paylaşılan `core` paketi, CLI, DuckDB depolama. Dashboard (Faz 2) ve MCP server (Faz 4) yol haritasında.

# Etsy Deep Analysis Tool

Etsy pazarını sistematik olarak analiz eden, local çalışan bir araç. Etsy Open API v3 üzerinden periyodik **snapshot**'lar alır, tarihçe biriktirir ve bu tarihçe üzerinde talep/fiyat/rekabet analizleri çalıştırır.

## Ne yapar

- **Talep hızı** — listing'lerin favori sayısındaki değişimi zaman içinde ölçer
- **Fiyat–talep eğrisi** — hangi fiyat bandında arz az, ilgi yüksek
- **Etiket fırsat kadranı** — getirisine göre az kullanılan etiketler
- **Boşluk matrisi** — kategori × fiyat bandı bazında talep/arz oranı
- **Rekabet analizi** — satıcı konsantrasyonu (HHI), yükselen satıcılar
- **Tazelik** — listing'lerin gerçek yaşı, nişe yeni giriş hızı
- **Yorum madenciliği** — puan dağılımı ve düşük puanlı yorumlar

## Ne yapmaz

- Satış adedi veya gelir **tahmini üretmez**. Etsy public API'si satış ve görüntülenme verisi vermez; tek talep sinyali `num_favorers` ve onun zaman içindeki türevidir.
- Etsy'yi scrape etmez — tüm veri resmî Open API v3'ten, rate limit'lere uyularak alınır.
- Otomatik listing yayınlamaz veya düzenlemez.
- **Ölçemediği şeyi uydurmaz.** Tek snapshot varken hız analizleri boş tablo değil, açık bir uyarı gösterir.

## Durum

**Faz 0, 1, 2 ve 3 tamam:** veri boru hattı, analiz katmanı, web paneli ve AI yorum katmanı çalışıyor, canlı API'ye karşı doğrulandı.
Sıradaki: Faz 4, MCP server. Yol haritası [tasarım dokümanında](docs/superpowers/specs/2026-09-16-etsy-deep-analysis-tool-design.md).

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
> `<keystring>:<shared secret>` biçimini bekliyor. Araç bu birleştirmeyi kendisi yapar.
> `ETSY_MODE=fixture` ile API anahtarı olmadan, kayıtlı örnek yanıtlarla da çalışır.

## Kullanım

```bash
# Snapshot al
pnpm snapshot --niche ceramic-mug --name "Ceramic mugs" --keywords "ceramic mug"

# Kotayı sınırla (ilk denemelerde önerilir)
pnpm snapshot --niche ceramic-mug --name "Ceramic mugs" --keywords "ceramic mug" \
  --max-pages 2 --max-shops 8 --max-review-listings 8

# Analiz raporunu bas
pnpm report --niche ceramic-mug
```

Diğer seçenekler: `--taxonomy-id`, `--min-price`, `--max-price`, `--sort-on`.

### İki şeyi bilmek gerekiyor

**1. Favori hızı için en az iki snapshot gerekir.** Tek snapshot anlık bir görüntü verir; analizlerin değerli kısmı ardışık snapshot'lar arasındaki değişimden gelir. Günlük çalıştırmak makul bir başlangıç.

**2. Snapshot'lar arası en az bir saat olmalı.** Hız formülü güne böldüğü için beş dakikalık aralıktaki tek bir favori artışı 288/gün gibi anlamsız bir değere dönüşürdü. Araç bir saatten kısa aralıkları ölçülemez sayar.

**Örnekleme notu:** Snapshot'lar varsayılan olarak `sort_on=score` ile alınır. Etsy'nin kendi varsayılanı (`created`) her gün "o gün oluşturulan ya da yenilenen" listing'leri verir — örneklem her gün tamamen değiştiği için aynı listing iki snapshot'ta görünmez ve hız hiç hesaplanamaz.

## Dashboard

```bash
pnpm dashboard        # http://localhost:3000
```

Beş ekran: **Nişler**, **Niş Özeti**, **Fırsatlar**, **Rakipler**, **Listing Gezgini**.

Panel bir okuyucudur: veritabanını salt-okunur açar ve şema oluşturmaz, böylece
açıkken snapshot alınabilir. Derleme adımı yok — CLI gibi doğrudan çalışır.

Arayüzün taşıyıcı kuralı, aracın kendi kuralıyla aynı: **ölçülemeyen değer
uydurulmaz.** Ölçülen sayı tam mürekkeple, ölçülemeyen soluk bir tireyle
(`—`) yazılır; sıfırdan kesin olarak ayrılır çünkü sıfır ölçülmüş bir
değerdir. Tek snapshot varken hıza dayanan bölümler boş tablo göstermek
yerine neden ölçülemediğini ve ne yapılacağını söyler.

## AI katmanı

```bash
pnpm insights --niche ceramic-mug            # cache varsa API'ye gitmez
pnpm insights --niche ceramic-mug --force    # yeniden üretir
```

Üç yorum üretir: **niş özeti** (durum, trendler, üç aksiyon), **fırsat açıklaması**
(fırsat, neden boş olabileceği, riskler, güven düzeyi) ve **yorum temaları**
(düşük puanlı yorumlarda tekrar eden şikâyetler, ürün fırsatları).

Temel kural: **sayıyı SQL üretir, model yorumlar.** Modele yalnızca ölçülmüş
agregatlar verilir ve çıktı şemalarında serbest sayı alanı yoktur — model
uydurma bir rakam yazabileceği bir yer bulamaz. Sistem promptu tahmini satış,
gelir ve pazar büyüklüğü söylemesini açıkça yasaklar.

Sonuçlar `ai_insights` tablosunda snapshot bazında saklanır. Bir snapshot'ın
verisi değişmediği için yorumu da değişmez; **panel yalnızca cache'ten okur ve
hiçbir sayfa açılışı API çağırmaz.**

`ANTHROPIC_API_KEY` yoksa araç tam çalışmaya devam eder, yalnızca yorum
katmanı kapalı kalır ve arayüz bunu açıkça söyler.

## Docker
```bash
docker compose build
docker compose run --rm cli snapshot --niche ceramic-mug --name "Ceramic mugs" --keywords "ceramic mug"
docker compose run --rm cli report --niche ceramic-mug
docker compose run --rm cli test

docker compose up web      # http://localhost:3000
```

Anahtarlar imaja gömülmez; çalışma anında host'taki `.env`'den okunur. DuckDB dosyası `./data` volume'unda host'ta durur — container silinse de tarihçe kaybolmaz ve yerelde/container'da alınan snapshot'lar aynı veritabanında birikir.

## Geliştirme

```bash
pnpm test        # 152 test, ağ erişimi gerektirmez (fixture modu)
pnpm typecheck
pnpm inspect     # ham veriye hızlı bakış
```

Testler Etsy'ye hiç istek atmaz; `packages/core/fixtures/` altındaki kayıtlı yanıtları ve bilinen bir seed veri setini kullanır. Analiz hesapları (medyan, favori hızı, HHI, kadranlar) bu seed üzerinde birebir doğrulanır.

## Teknoloji

TypeScript monorepo (pnpm workspace) — paylaşılan `core` paketi, CLI, düz Node HTTP paneli, DuckDB depolama. Grafikler elle yazılmış SVG — grafik kütüphanesi ve derleme adımı yok. MCP server (Faz 4) yol haritasında.

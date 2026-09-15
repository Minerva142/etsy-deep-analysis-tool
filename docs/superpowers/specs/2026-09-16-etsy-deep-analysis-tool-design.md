# Etsy Deep Analysis Tool — Tasarım Dokümanı

**Tarih:** 2026-09-16
**Durum:** Onaylandı, implementasyon planı bekliyor
**Repo:** https://github.com/Minerva142/etsy-deep-analysis-tool

---

## 1. Amaç ve kapsam

Etsy pazarını sistematik olarak analiz eden, tek kullanıcı tarafından local çalıştırılan bir araç. Cevaplamak istediği sorular:

- Bu nişte talep nereye gidiyor, hangi ürünler hızlanıyor?
- Hangi fiyat bandında arz az, ilgi yüksek?
- Hangi etiketler getirisine göre az kullanılıyor?
- Rekabet ne kadar yoğun, kimler yükseliyor?
- Alıcılar mevcut ürünlerde neyden şikâyet ediyor?

Kapsam **dışı:** çok kullanıcılı SaaS, satış tahmini üretmek, Etsy'yi scrape etmek, otomatik listing yayınlamak.

---

## 2. Kısıtlar ve doğrulanmış API gerçekleri

Etsy Open API v3 (`https://openapi.etsy.com`) OpenAPI spec'i üzerinden doğrulandı (2026-09-15).

### Sadece API key ile erişilebilen uçlar (pazar analizi)

| Endpoint | operationId | Kullanım |
|---|---|---|
| `GET /v3/application/listings/active` | `findAllListingsActive` | `keywords`, `taxonomy_id`, `min_price`, `max_price`, `sort_on` (`created\|price\|updated\|score`), `sort_order`, `limit` (max 100), `offset` |
| `GET /v3/application/shops` | `findShops` | Mağaza adına göre arama |
| `GET /v3/application/shops/{shop_id}/listings/active` | — | Rakip mağazanın aktif listing'leri |
| `GET /v3/application/listings/{listing_id}/reviews` | `getReviewsByListing` | Listing yorumları |
| `GET /v3/application/shops/{shop_id}/reviews` | `getReviewsByShop` | Mağaza yorumları |
| `GET /v3/application/seller-taxonomy/nodes` | `getSellerTaxonomyNodes` | Kategori ağacı |

`ShopListing` şemasında bulunan ve analizde kullanacağımız alanlar: `listing_id`, `shop_id`, `title`, `description`, `price` (amount/divisor/currency_code), `tags`, `taxonomy_id`, `num_favorers`, `quantity`, `state`, `created_timestamp`, `updated_timestamp`, `url`.

### OAuth gerektiren uçlar (sadece kendi mağaza — Faz 5)

Scope'lar: `listings_r`, `shops_r`, `transactions_r`, `profile_r`.
Receipts, ledger entries, shop stats, listing düzenleme.

### Mevcut olmayan veriler — tasarımı bunlar şekillendiriyor

- **Satış adedi yok.** Public API listing başına satış sayısı vermiyor.
- **Görüntülenme (views) yok.** Public listing yanıtında yer almıyor.
- **Tek talep sinyali `num_favorers`.** Statik hali zayıf; snapshot'lar üzerinden *türevi* (favori/gün) anlamlı sinyal.

Araç hiçbir yerde tahmini satış rakamı üretmeyecek. Gösterilen her sayı ölçülmüş olacak.

### Rate limit

App başına QPS + QPD. Her başarılı yanıt şu header'ları taşır:
`x-limit-per-second`, `x-remaining-this-secon`, `x-limit-per-day`, `x-remaining-today`.
Bu değerler okunup kalıcı olarak saklanacak; limiter bunlara göre kendini ayarlayacak.

---

## 3. Mimari

Snapshot temelli: araç periyodik olarak niş sorgularını çalıştırır, sonucu tarihçeye yazar, tüm analizler bu tarihçe üzerinde çalışır.

```
Etsy API ──► EtsyClient ──► Ingest ──► DuckDB ──► Analysis (SQL) ──┬──► apps/web
             rate limit    snapshot                                ├──► apps/mcp
             cache         job                                     └──► ai/
             retry
```

### Paket yapısı (pnpm workspace, TypeScript)

```
packages/core
  src/etsy/       client.ts · rate-limiter.ts · cache.ts · fixtures.ts
                  endpoints/{listings,shops,reviews,taxonomy}.ts
  src/db/         connection.ts · schema.sql · migrations/
  src/ingest/     niche-snapshot.ts · shop-snapshot.ts · normalize.ts
  src/analysis/   queries/*.sql + typed wrapper'lar
  src/ai/         insights.ts · schemas.ts · cache.ts
apps/cli          snapshot çalıştırma, rapor çıktısı
apps/web          Next.js (App Router) dashboard
apps/mcp          MCP server
```

İş mantığı yalnızca `core`'da yaşar. Üç uygulama da onu tüketir; hiçbiri Etsy'ye doğrudan istek atmaz, hiçbiri kendi SQL'ini yazmaz.

---

## 4. Veri modeli (DuckDB — `data/etsy.duckdb`)

Dimension/fact ayrımı. Dimension tablolar upsert edilir (son bilinen hal), fact tablolar append-only (tarihçe).

| Tablo | Tip | Anahtar alanlar |
|---|---|---|
| `niches` | dimension | `niche_id`, `name`, `keywords`, `taxonomy_id`, `min_price`, `max_price`, `created_at`, `is_active` |
| `snapshots` | fact | `snapshot_id`, `niche_id`, `started_at`, `finished_at`, `listing_count`, `api_calls`, `status` |
| `listings` | dimension | `listing_id` (PK), `shop_id`, `title`, `description`, `taxonomy_id`, `url`, `created_timestamp`, `first_seen_at`, `last_seen_at` |
| `listing_observations` | fact | `snapshot_id`, `listing_id`, `price_amount`, `currency_code`, `num_favorers`, `quantity`, `state`, `observed_at` — PK: (`snapshot_id`, `listing_id`) |
| `listing_tags` | dimension | `listing_id`, `tag` — listing güncellendiğinde yeniden yazılır |
| `shops` | dimension | `shop_id` (PK), `shop_name`, `url`, `first_seen_at`, `last_seen_at` |
| `shop_observations` | fact | `snapshot_id`, `shop_id`, `num_favorers`, `listing_active_count`, `review_count`, `review_average` |
| `reviews` | fact | `review_id`, `listing_id`, `shop_id`, `rating`, `review_text`, `language`, `created_timestamp` |
| `taxonomy_nodes` | dimension | `taxonomy_id` (PK), `name`, `level`, `parent_id`, `full_path` |
| `ai_insights` | cache | `snapshot_id`, `insight_type`, `payload_json`, `model`, `created_at` |
| `http_cache` | cache | `cache_key`, `response_json`, `fetched_at`, `expires_at` |
| `rate_limit_state` | state | `window_key`, `remaining_today`, `remaining_this_second`, `updated_at` |

Faz 5'te eklenecek: `receipts`, `receipt_transactions`, `ledger_entries`, `own_shop_listings`.

**Saklama politikası (opsiyonel, Faz 1'de karar):** 180 günden eski `listing_observations` satırları haftalık agregata indirgenip ham satırlar silinebilir. Etsy API Developer Terms'teki veri saklama kısıtlarına karşı güvenlik payı.

---

## 5. Etsy erişim katmanı

### Client

Tek `EtsyClient` sınıfı. İstek bazında auth modunu bilir:
- Public uçlar → `x-api-key: <ETSY_API_KEY>` header'ı
- Kendi mağaza uçları → `Authorization: Bearer <access_token>` + `x-api-key`

Tüm istekler rate limiter ve cache katmanlarından geçer. 429 ve 5xx'te üstel backoff (max 5 deneme). 4xx'te (429 hariç) hemen hata fırlatır.

### Rate limiter

Kalıcı token bucket (`rate_limit_state` tablosu). Her yanıtın `x-remaining-*` header'larıyla senkronlanır — kendi sayacına değil, sunucunun bildirdiğine güvenir. QPD tükendiğinde snapshot job'ı `status='paused'` ile durur ve pencere yenilendiğinde kaldığı `offset`'ten devam eder.

### Cache

`http_cache` tablosu, endpoint bazlı TTL:

| Endpoint | TTL |
|---|---|
| `seller-taxonomy/nodes` | 30 gün |
| `listings/{id}` detay | 24 saat |
| `listings/active` arama | 6 saat |
| reviews | 24 saat |

Geliştirme sırasında aynı sorgunun tekrarı kotayı harcamaz.

### Fixture modu

`ETSY_MODE=fixture` → `packages/core/fixtures/` altındaki kaydedilmiş JSON yanıtlarından okur.
`ETSY_MODE=live` → gerçek API.

Fixture'lar gerçek yanıt şekline birebir uyar. Tüm testler fixture modunda çalışır; CI'da ağ erişimi gerekmez. API key henüz alınmadığı için Faz 0 ve 1'in büyük kısmı bu modda geliştirilir.

---

## 6. Analiz katmanı

Her analiz `packages/core/src/analysis/queries/` altında adlandırılmış bir SQL dosyası + tipli wrapper. Hepsi bir `niche_id` ve opsiyonel tarih aralığı alır.

**Ortak tanım — favori hızı (favorite velocity):**
Ardışık iki snapshot arasında
`velocity = (num_favorers[t] - num_favorers[t-1]) / gün_farkı`
Listing ilk kez görülüyorsa velocity `NULL` (geriye dönük veri yok). Negatif değerler (favori kaldırma) olduğu gibi korunur.

### 6.1 Pazar görünümü
Aktif listing sayısı, benzersiz satıcı sayısı, fiyat medyanı ve p25/p75, ortalama favori hızı, toplam yorum sayısı. Önceki snapshot'a göre değişim yüzdeleri.

### 6.2 Talep hızı
Niş toplamı favori hızının zaman serisi. Ayrıca listing bazında ilk 20 "en hızlı yükselen" (velocity desc), ve "yeni ve hızlı" (first_seen_at son 30 gün içinde + yüksek velocity).

### 6.3 Fiyat–talep eğrisi
Fiyat bantları: niş fiyat dağılımının decile'ları (10 bant). Her bant için:
- arz = listing sayısı
- talep = bandaki listing'lerin toplam favori hızı
- listing başına talep = talep / arz

Listing başına talebi yüksek, arzı düşük bantlar fiyatlama fırsatı.

### 6.4 Etiket fırsat kadranı
Her `tag` için:
- `usage_count` = o etiketi taşıyan listing sayısı
- `avg_velocity` = o etiketi taşıyan listing'lerin ortalama favori hızı

Medyan bölmesiyle dört kadran. Hedef kadran: `avg_velocity > medyan` **ve** `usage_count < medyan`. En az 5 listing'de geçen etiketler dahil edilir (gürültü filtresi).

### 6.5 Boşluk matrisi
`taxonomy_id` (alt kategori) × fiyat bandı ısı haritası. Hücre değeri `talep / arz`. Yüksek oranlı hücreler nişe giriş noktası adayı.

### 6.6 Satıcı tablosu ve konsantrasyon
Satıcı başına: aktif listing sayısı, toplam favori, ortalama favori hızı, yorum ortalaması.
Konsantrasyon: top-10 satıcının listing payı + satıcı listing paylarının HHI'ı.
"Yükselenler": son 30 günde listing sayısı veya favori hızı en çok artan satıcılar.

### 6.7 Tazelik
`created_timestamp` dağılımı, listing medyan yaşı, son 30/90 günde nişe giren listing sayısı. Doyum sinyali: yeni listing oranı düşerken favori hızının da düşmesi.

### 6.8 Yorum madenciliği
SQL kısmı: puan dağılımı, düşük puanlı (≤3) yorumların listelenmesi.
Tema çıkarımı AI katmanında (§8).

---

## 7. Ekranlar (Next.js, Faz 2)

| Ekran | İçerik |
|---|---|
| **Nişler** | Takip edilen nişler, son snapshot zamanı/durumu, yeni niş tanımlama formu (keywords + taxonomy + fiyat aralığı), manuel snapshot tetikleme |
| **Niş Özeti** | KPI kartları (§6.1), favori hızı zaman serisi (§6.2), en hızlı yükselen listing'ler, AI özeti (§8) |
| **Fırsatlar** | Fiyat–talep eğrisi (§6.3), etiket kadranı scatter (§6.4), boşluk matrisi ısı haritası (§6.5) |
| **Rakipler** | Satıcı tablosu, konsantrasyon göstergeleri, yükselenler (§6.6) |
| **Listing Gezgini** | Filtrelenebilir/sıralanabilir tablo; satır detayında listing bilgisi + yorumlar |

Kural: her grafik agregat SQL sonucu tüketir, ham listing satırları tarayıcıya gönderilmez. Grafik uygulaması `dataviz` yönergesine göre yapılır.

Faz 5'te eklenecek: **Kendi Mağazam**. İleri fazda: **Ayarlar** (kota durumu, snapshot zamanlaması) — başlangıçta `.env` + CLI yeterli.

---

## 8. AI katmanı

**Temel kural: sayıyı SQL üretir, LLM yorumlar.** Prompt'a yalnızca agregat sonuçlar verilir; sistem promptunda modelin verilen agregatların dışında sayı üretmesi açıkça yasaklanır. Tüm çıktılar structured output ile şemaya bağlanır.

### Fonksiyonlar

| Fonksiyon | Girdi | Çıktı şeması |
|---|---|---|
| `summarizeNiche` | §6.1–6.2 agregatları | `{ durum: string, trendler: string[], aksiyonlar: {baslik, gerekce}[] }` |
| `mineReviews` | düşük puanlı yorum metinleri (batch) | `{ temalar: {tema, siklik, ornek_alintilar}[], urun_firsatlari: string[] }` |
| `explainOpportunity` | §6.3–6.5 çıktıları | `{ firsat: string, neden_bos, riskler: string[], guven: "dusuk\|orta\|yuksek" }` |
| `suggestListingCopy` | kazanan etiket/başlık kalıpları | `{ baslik_onerileri: string[], tag_onerileri: string[] }` *(Faz 5)* |

### Teknik

- SDK: `@anthropic-ai/sdk`
- Model: `claude-opus-5`
- `thinking: { type: "adaptive" }`
- Structured output: `output_config: { format: {...} }`, yanıt `client.messages.parse()` ile doğrulanır
- Refusal fallback varsayılan açık: `betas: ["server-side-fallback-2026-07-01"]` + `fallbacks: "default"`
- Uzun çıktılarda streaming + `.finalMessage()`
- Prompt caching: sabit sistem promptu ve şema prefix'te tutulur, değişken agregatlar son breakpoint'ten sonra
- Sonuçlar `ai_insights` tablosunda `(snapshot_id, insight_type)` anahtarıyla cache'lenir; aynı snapshot için ikinci çağrı ücretsiz

Maliyet notu: Opus 5 $5/$25 per MTok. Girdi agregat olduğu için istek başına token küçük kalır. Daha ucuz model kullanımı kullanıcının kararıdır, varsayılan değiştirilmez.

---

## 9. MCP server (`apps/mcp`)

Aynı `core` paketini tüketir. Araçlar:

| Araç | Tip | Açıklama |
|---|---|---|
| `list_niches` | read | Takip edilen nişler ve son snapshot durumu |
| `get_niche_overview` | read | §6.1–6.2 agregatları |
| `find_opportunities` | read | §6.3–6.5 birleşik çıktısı |
| `search_listings` | read | Filtrelenebilir listing sorgusu |
| `get_review_insights` | read | §6.8 + varsa cache'li AI teması |
| `run_snapshot` | write | Yeni snapshot çalıştırır — API kotası harcar, bu yüzden ayrı ve açıkça yazma aracı |

Read araçları DB'den okur, API'ye gitmez; dolayısıyla ücretsiz ve hızlı.

---

## 10. Test stratejisi

TDD. Ağ bağımlılığı sıfır.

| Katman | Yaklaşım |
|---|---|
| Etsy client | Fixture yanıtları; auth header seçimi, sayfalama, hata yolları |
| Rate limiter | Sahte saat; QPS/QPD tükenmesi, header senkronizasyonu, duraklat/devam et |
| Cache | TTL süresi dolma, cache hit/miss, anahtar üretimi |
| Normalize | Ham Etsy JSON → tablo satırı dönüşümü, para birimi/divisor işlemesi |
| Analiz SQL'leri | DuckDB'ye bilinen seed veri yüklenir, beklenen sonuç assert edilir — medyan, velocity, kadran ve HHI hesapları burada kanıtlanır |
| AI katmanı | Şema doğrulama; model yanıtı mock'lanır, gerçek API çağrısı yapılmaz |

---

## 11. Fazlar

Her faz kendi başına çalışan bir çıktı bırakır.

| Faz | Kapsam | Bitti sayılma ölçütü |
|---|---|---|
| **0** | Monorepo iskeleti, DuckDB şeması + migration, EtsyClient + rate limiter + cache + fixture modu, `niche-snapshot` job, test altyapısı | Fixture verisiyle bir snapshot uçtan uca DB'ye yazılıyor, testler yeşil |
| **1** | §6'daki sekiz analiz, `apps/cli` ile rapor çıktısı. Ekran yok. | Bir niş için tüm analizler terminalde okunabilir çıktı veriyor; gerçek API key geldiğinde canlı veriyle doğrulanıyor |
| **2** | Next.js dashboard, beş ekran | Beş ekran gerçek DB verisiyle çalışıyor |
| **3** | AI katmanı, dört fonksiyon + cache | Niş Özeti ekranında AI özeti görünüyor, ikinci açılış ücretsiz |
| **4** | MCP server, altı araç | Claude Code'dan niş analizi konuşarak yapılabiliyor |
| **5** | OAuth akışı, kendi mağaza verisi, "Kendi Mağazam" ekranı | Kendi mağaza metrikleri pazar medyanıyla karşılaştırılabiliyor |

Faz 1'in ekransız olması bilinçli: analizlerin değerli olup olmadığı beş ekran yazılmadan önce öğrenilir.

---

## 12. Konfigürasyon

`.env` (gitignore'da), `.env.example` commit'li:

```
ETSY_API_KEY=
ETSY_MODE=fixture          # fixture | live
ETSY_OAUTH_ACCESS_TOKEN=   # Faz 5
ETSY_OAUTH_REFRESH_TOKEN=  # Faz 5
ANTHROPIC_API_KEY=
DUCKDB_PATH=./data/etsy.duckdb
```

`data/` dizini ve `.env` git'e girmez. Hiçbir sır repoya commit edilmez.

---

## 13. Riskler ve açık kararlar

| Konu | Durum |
|---|---|
| **Etsy API key henüz yok** | Developer app kaydı yapılacak, repo linki uygulama URL'i olarak kullanılacak. Faz 0–1 fixture modunda geliştirilir. |
| **API Developer Terms — veri saklama** | Snapshot'lar kalıcı tarihçe biriktiriyor. Key alınırken terms okunacak; gerekirse §4'teki 180 günlük saklama politikası devreye alınacak. **Faz 1 sonunda karara bağlanacak.** |
| **`num_favorers` tek sinyal** | Satış ve görüntülenme yok. Araç tahmini rakam üretmeyecek; tüm çıktılar "favori bazlı" olarak etiketlenecek. |
| **`offset` derinliği** | Etsy `listings/active` için pratik bir offset tavanı uygulayabilir. Faz 0'da canlı testle ölçülüp snapshot job'ın sayfalama stratejisi buna göre sınırlanacak. |
| **Snapshot sıklığı** | Favori hızının anlamlı olması için en az günlük. Başlangıçta manuel/CLI tetikleme; zamanlama Faz 2+ konusu. |

# Faz 3 — AI Katmanı Implementasyon Planı

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Faz 1'in ölçtüğü sayıları yorumlayan üç AI fonksiyonu; sonuçlar cache'lenir, CLI ve panelde görünür.

**Architecture:** `packages/core/src/ai/` altında Anthropic SDK üzerine kurulu üç fonksiyon. Her biri **agregat** alır (ham satır değil), **zod şemasına bağlı** yapılandırılmış çıktı döner, sonucu `ai_insights` tablosuna `(snapshot_id, insight_type)` anahtarıyla yazar.

**Tech Stack:** `@anthropic-ai/sdk`, `claude-opus-5`, adaptive thinking, `client.messages.parse()` + `zodOutputFormat()`, zod (zaten bağımlılık).

**Spec:** `docs/superpowers/specs/2026-09-16-etsy-deep-analysis-tool-design.md` §8

## Global Constraints

- Faz 0/1/2 kısıtları geçerli.
- **Sayıyı SQL üretir, LLM yorumlar.** Prompt'a yalnızca agregat verilir; sistem promptu modelin verilen sayıların dışında rakam üretmesini açıkça yasaklar. Şemada serbest sayı alanı yoktur — model yalnızca metin ve kendisine verilen değerlere yapılan atıflar üretir.
- **Anahtar yoksa araç çalışmaya devam eder.** `ANTHROPIC_API_KEY` yoksa AI fonksiyonları hata fırlatmaz; `null` döner ve arayüz "AI özeti kapalı" der. Bu, aracın ölçüldü/ölçülemedi ilkesinin AI'a uzantısıdır.
- **Her çağrı cache'lenir.** Aynı `(snapshot_id, insight_type)` için ikinci çağrı API'ye gitmez. Yeniden üretim `--force` ile.
- **Testler API'ye çıkmaz.** Anthropic istemcisi enjekte edilebilir; testler sahte istemci kullanır.
- Model sabiti tek yerde: `packages/core/src/ai/model.ts`.

## Ölçülmüş API şekli

`claude-api` skill'inin TypeScript referansından (2026-09-16):

```ts
const response = await client.messages.parse({
  model: 'claude-opus-5',
  max_tokens: 16000,
  system: [...],
  messages: [...],
  output_config: { format: zodOutputFormat(Schema) },
});
response.parsed_output; // şema doğrulanamazsa null
response.stop_reason;   // 'refusal' olabilir
```

- `claude-opus-5`'te thinking varsayılan olarak açık; `thinking` alanı gönderilmez.
- `budget_tokens` bu modelde 400 döndürür, kullanılmaz.
- **Refusal fallback eklenmiyor.** Dokümante edilmiş `messages.parse` yardımcısı beta olmayan namespace'te, `fallbacks` ise beta'da; ikisinin birleşimi TypeScript için dokümante değil. Onun yerine `stop_reason === 'refusal'` açıkça yakalanıp "üretilemedi" olarak yüzeye çıkarılır.

---

## Dosya Yapısı

| Dosya | Sorumluluk |
|---|---|
| `packages/core/src/ai/model.ts` | Model kimliği ve ortak istek ayarları |
| `packages/core/src/ai/client.ts` | İstemci oluşturma, çağrı sarmalayıcı, refusal yakalama |
| `packages/core/src/ai/cache.ts` | `ai_insights` okuma/yazma |
| `packages/core/src/ai/semalar.ts` | Üç çıktı şeması (zod) |
| `packages/core/src/ai/insights.ts` | Üç fonksiyon: özet, yorum madenciliği, fırsat açıklaması |
| `apps/cli/src/index.ts` | `insights` komutu |
| `apps/web/src/sayfalar.ts` | Panelde AI bölümleri |

---

## Task 1: İstemci, şemalar ve cache

**Files:**
- Create: `packages/core/src/ai/{model,client,cache,semalar}.ts`
- Modify: `packages/core/package.json` (`@anthropic-ai/sdk`)
- Test: `packages/core/test/ai-cache.test.ts`, `packages/core/test/ai-client.test.ts`

**Interfaces:**
- `interface AiIstemci { uret<T>(istek: AiIstek<T>): Promise<AiSonuc<T>> }`
- `type AiSonuc<T> = { durum: 'tamam'; veri: T; model: string } | { durum: 'kapali' } | { durum: 'reddedildi'; sebep: string } | { durum: 'cozulemedi' }`
- `anthropicIstemcisi(apiKey: string | null): AiIstemci`
- `insightOku<T>(db, snapshotId, tip, sema): Promise<T | null>`
- `insightYaz(db, snapshotId, tip, veri, model): Promise<void>`

**Neden `AiSonuc` bir birleşim:** "anahtar yok", "model reddetti", "şema tutmadı" ve "başarılı" farklı durumlar. Hepsini `null`'a indirmek arayüzün doğru mesajı yazmasını imkânsız kılardı.

- [ ] **Step 1: Failing test yaz** — cache yazma/okuma, şema doğrulaması, bilinmeyen tip için `null`.
- [ ] **Step 2:** Çalıştır, başarısız olduğunu gör.
- [ ] **Step 3:** `pnpm --filter @etsy-analysis/core add @anthropic-ai/sdk`
- [ ] **Step 4:** Dört modülü yaz.
- [ ] **Step 5:** Testleri geçir, commit.

---

## Task 2: Üç insight fonksiyonu

**Files:**
- Create: `packages/core/src/ai/insights.ts`
- Test: `packages/core/test/insights.test.ts` (sahte istemci)

| Fonksiyon | Girdi (agregat) | Çıktı şeması |
|---|---|---|
| `nisOzetiUret` | `MarketOverview`, `Freshness`, `VelocityPoint[]`, top 10 `RiserRow` | `{ durum: string; trendler: string[]; aksiyonlar: {baslik, gerekce}[] }` |
| `yorumTemalari` | düşük puanlı yorum metinleri (en fazla 60) | `{ temalar: {tema, siklik_tahmini, ornek_alinti}[]; urun_firsatlari: string[] }` |
| `firsatAciklamasi` | `PriceBand[]`, fırsat kadranındaki `TagRow[]`, top 8 `GapCell[]` | `{ firsat: string; neden_bos: string; riskler: string[]; guven: 'dusuk'\|'orta'\|'yuksek' }` |

**Sistem promptu (üçünde ortak, sabit → prompt cache'e girer):**

> Sen bir Etsy pazar analisti asistanısın. Sana yalnızca ölçülmüş agregatlar veriliyor.
> Kurallar: (1) Verilen sayıların dışında hiçbir rakam üretme; tahmini satış, gelir ya da
> pazar büyüklüğü söyleme. (2) Bir şey verilen veriden çıkmıyorsa "veri bunu göstermiyor"
> de. (3) Türkçe yaz, kısa ve somut ol. (4) Aksiyon önerirken hangi sayıya dayandığını söyle.

- [ ] **Step 1:** Sahte istemciyle failing test — agregatın prompt'a girdiği, şemanın doğrulandığı, `durum: 'kapali'` yolunun sessizce geçtiği.
- [ ] **Step 2–4:** Çalıştır, yaz, geçir.
- [ ] **Step 5:** Commit.

---

## Task 3: CLI komutu ve panel entegrasyonu

**Files:**
- Modify: `apps/cli/src/index.ts`, `apps/web/src/sayfalar.ts`, `packages/core/src/{index,analysis-entry}.ts`
- Modify: `package.json`, `README.md`

```
pnpm insights --niche ceramic-mug            # cache varsa API'ye gitmez
pnpm insights --niche ceramic-mug --force    # yeniden üretir
```

Panelde: **Niş Özeti**'nde durum + trendler + aksiyonlar; **Fırsatlar**'da fırsat açıklaması; **Rakipler**'de yorum temaları. Üçü de yalnızca cache'ten okur — panel asla API çağırmaz, çünkü sayfa açmak para harcamamalı.

Cache boşsa panel şunu yazar: *"Bu snapshot için AI özeti üretilmemiş. `pnpm insights --niche <id>` ile üretebilirsiniz."*

- [ ] **Step 1:** CLI komutu + testleri.
- [ ] **Step 2:** Panel bölümleri.
- [ ] **Step 3:** Gerçek anahtarla uçtan uca dene (anahtar varsa).
- [ ] **Step 4:** Docker'da doğrula, README, commit, push.

---

## Faz 3 bitti sayılma ölçütü

- [ ] `pnpm test` ve `pnpm typecheck` yeşil; hiçbir test API'ye çıkmıyor
- [ ] `ANTHROPIC_API_KEY` yokken CLI ve panel hata vermeden "kapalı" diyor
- [ ] Anahtar varken üç insight üretiliyor ve `ai_insights` tablosuna yazılıyor
- [ ] İkinci çağrı API'ye gitmiyor (cache)
- [ ] Panel cache'ten okuyor, hiçbir sayfa açılışı API çağırmıyor
- [ ] Model çıktısında verilen agregatların dışında rakam yok

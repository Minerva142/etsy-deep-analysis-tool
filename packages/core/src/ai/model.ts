/**
 * Model kimliği ve ortak istek ayarları tek yerde.
 *
 * claude-opus-5'te thinking varsayılan olarak açıktır; `thinking` alanı
 * gönderilmez. `budget_tokens` bu modelde 400 döndürdüğü için hiç
 * kullanılmaz.
 */
export const MODEL = 'claude-opus-5';

export const MAX_TOKENS = 16000;

/**
 * Üç insight fonksiyonunda da aynı. Sabit olması iki işe yarıyor:
 * prompt cache'in önekini bozmamak, ve kuralların tek yerde durması.
 */
export const SISTEM_PROMPTU = `Sen bir Etsy pazar analisti asistanısın. Sana yalnızca ölçülmüş agregatlar veriliyor.

Kurallar:
1. Verilen sayıların dışında hiçbir rakam üretme. Tahmini satış adedi, gelir ya da pazar büyüklüğü söyleme — bu veriler elimizde yok.
2. Bir sonuç verilen veriden çıkmıyorsa "veri bunu göstermiyor" de. Boşluğu doldurma.
3. Türkçe yaz. Kısa ve somut ol; genel geçer pazarlama tavsiyesi verme.
4. Bir aksiyon önerirken hangi sayıya dayandığını açıkça söyle.
5. Talep sinyalimiz yalnızca favori sayısı ve onun zaman içindeki değişimi. Favoriyi satışla eş tutma.`;

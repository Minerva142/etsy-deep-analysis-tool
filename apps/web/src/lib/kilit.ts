/**
 * Süreç içinde veritabanı erişimini sıraya sokar.
 *
 * DuckDB bir dosyayı aynı süreçte ikinci kez açmayı reddediyor. Panel her
 * isteği kısa ömürlü bir bağlantıyla karşıladığı için iki istek çakıştığında
 * ikincisi "file is already open" ile düşüyordu — tarayıcı sayfayı ve
 * varlıkları paralel isterken, ya da bir çekim sürerken kullanıcı gezinirken.
 *
 * Çözüm, kilit değil sıra: her erişim bir öncekinin bitmesini bekliyor.
 * Tek kullanıcılık yerel bir araçta sıranın maliyeti fark edilmiyor;
 * çekim gibi uzun işler zaten tek başına çalışmalı.
 */
let sira: Promise<unknown> = Promise.resolve();

export function sirayaAl<T>(is: () => Promise<T>): Promise<T> {
  // Önceki iş hata verse bile sıra ilerlemeli.
  const sonuc = sira.then(is, is);
  sira = sonuc.then(
    () => undefined,
    () => undefined,
  );
  return sonuc;
}

/** DuckDB'nin dosya kilidi hatası mı? */
export function kilitHatasiMi(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /already open|being used by another process|Conflicting lock/i.test(
    error.message,
  );
}

/** Veritabanı dosyası gerçekten yok mu? */
export function dosyaYokMu(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (kilitHatasiMi(error)) return false;
  return /Cannot open file|does not exist|No such file/i.test(error.message);
}

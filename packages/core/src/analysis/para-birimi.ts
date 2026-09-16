/**
 * Fiyat istatistiklerini tek bir para birimine kısıtlayan ortak SQL parçaları.
 *
 * Etsy her listing'i satıcının kendi para biriminde döndürüyor. Tek bir nişte
 * yirmiden fazla birim bir arada olabiliyor ve bunları toplamak sessizce yanlış
 * sayı üretiyordu: ceramic-mug nişinde karışık medyan 29.00 çıkarken yalnız
 * USD gözlemlerin medyanı 21.10. Kur çevirmek doğrulanamayan bir sayı
 * uydurmak olurdu; onun yerine nişin baskın para birimini seçip fiyat
 * istatistiklerini oraya kısıtlıyor, hangi birim olduğunu ekranda söylüyoruz.
 *
 * Her iki parça da kaynak CTE'sinin `son` adında olmasını ve `currency_code`
 * ile `price_amount` kolonlarını taşımasını bekler.
 */

/** `baskin as (${BASKIN_KUR})` — nişin en çok listing'i olan para birimi. */
export const BASKIN_KUR = `
  select currency_code as kur
    from son
   where currency_code is not null and price_amount is not null
   group by currency_code
   order by count(*) desc, currency_code
   limit 1`;

/** Toplama fonksiyonlarına eklenen `filter (...)` gövdesi. */
export const KURDA = `where currency_code = (select kur from baskin)`;

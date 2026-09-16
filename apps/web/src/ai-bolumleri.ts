import type {
  FirsatAciklamasi,
  NisOzeti,
  YorumTemalari,
} from '@etsy-analysis/core/analysis';
import { bolum, esc, olculemediGovdesi } from './html.js';

/**
 * Panel AI'ı asla çağırmaz; yalnızca üretilmiş sonucu gösterir.
 * Sayfa açmak para harcamamalı.
 */
function uretilmemis(nicheId: string): string {
  return olculemediGovdesi(
    'Bu çekim için AI yorumu üretilmemiş.',
    `Niş sayfasındaki “AI yorumu üret” düğmesiyle ya da komut satırından üretebilirsiniz: pnpm insights --niche ${nicheId}`,
  );
}

export function nisOzetiBolumu(ozet: NisOzeti | null, nicheId: string): string {
  if (ozet === null) {
    return bolum({ baslik: 'AI özeti', govde: uretilmemis(nicheId) });
  }

  return bolum({
    baslik: 'AI özeti',
    altBaslik: 'ölçülen sayılardan',
    govde: `<p class="dar" style="margin-top:0">${esc(ozet.durum)}</p>
      ${
        ozet.trendler.length === 0
          ? ''
          : `<p class="alt-satir" style="margin:22px 0 8px">Trendler</p>
             <ul class="dar" style="padding-left:18px;margin:0">
               ${ozet.trendler.map((t) => `<li>${esc(t)}</li>`).join('')}
             </ul>`
      }
      ${
        ozet.aksiyonlar.length === 0
          ? ''
          : `<p class="alt-satir" style="margin:22px 0 8px">Öneriler</p>
             <ol class="adimlar dar">
               ${ozet.aksiyonlar
                 .map(
                   (a) =>
                     `<li>${esc(a.baslik)}<br><span class="ikincil">${esc(a.gerekce)}</span></li>`,
                 )
                 .join('')}
             </ol>`
      }`,
  });
}

export function firsatAciklamasiBolumu(
  aciklama: FirsatAciklamasi | null,
  nicheId: string,
): string {
  if (aciklama === null) {
    return bolum({ baslik: 'AI yorumu', govde: uretilmemis(nicheId) });
  }

  const guven = { dusuk: 'düşük', orta: 'orta', yuksek: 'yüksek' }[aciklama.guven];

  return bolum({
    baslik: 'AI yorumu',
    altBaslik: `güven: ${guven}`,
    govde: `<p class="dar" style="margin-top:0">${esc(aciklama.firsat)}</p>
      <p class="dar ikincil" style="margin:18px 0 0">
        <span class="olculemedi">Bu alan neden boş olabilir:</span> ${esc(aciklama.neden_bos)}
      </p>
      ${
        aciklama.riskler.length === 0
          ? ''
          : `<p class="alt-satir" style="margin:22px 0 8px">Riskler</p>
             <ul class="dar" style="padding-left:18px;margin:0">
               ${aciklama.riskler.map((r) => `<li>${esc(r)}</li>`).join('')}
             </ul>`
      }
      <p class="alt-satir" style="margin:22px 0 0">
        Bu yorum yalnızca ölçülmüş agregatlara dayanıyor; satış ve gelir verisi elimizde yok.
      </p>`,
  });
}

export function yorumTemalariBolumu(
  temalar: YorumTemalari | null,
  nicheId: string,
): string {
  if (temalar === null) {
    return bolum({ baslik: 'AI yorum analizi', govde: uretilmemis(nicheId) });
  }

  return bolum({
    baslik: 'AI yorum analizi',
    altBaslik: 'düşük puanlı yorumlardan',
    govde: `${
      temalar.temalar.length === 0
        ? '<p class="olculemedi dar" style="margin-top:0">Tekrar eden tema bulunamadı.</p>'
        : `<div class="kaydir"><table>
             <thead><tr><th>Tema</th><th>Sıklık</th><th>Örnek</th></tr></thead>
             <tbody>${temalar.temalar
               .map(
                 (t) =>
                   `<tr><td>${esc(t.tema)}</td><td>${esc(t.siklik)}</td><td class="ikincil">${esc(t.ornek_alinti.slice(0, 110))}</td></tr>`,
               )
               .join('')}</tbody>
           </table></div>`
    }
    ${
      temalar.urun_firsatlari.length === 0
        ? ''
        : `<p class="alt-satir" style="margin:22px 0 8px">Ürün fırsatları</p>
           <ul class="dar" style="padding-left:18px;margin:0">
             ${temalar.urun_firsatlari.map((u) => `<li>${esc(u)}</li>`).join('')}
           </ul>`
    }`,
  });
}

import type {
  FirsatAciklamasi,
  NisOzeti,
  YorumTemalari,
} from '@etsy-analysis/core/analysis';
import { esc } from './html.js';

/**
 * Panel AI'ı asla çağırmaz; yalnızca üretilmiş sonucu gösterir.
 * Sayfa açmak para harcamamalı.
 */
function uretilmemis(nicheId: string): string {
  return `<p class="olculemedi dar">Bu snapshot için AI özeti üretilmemiş.</p>
    <p class="ikincil dar" style="margin-top:6px">Üretmek için:
      <code style="font-size:12.5px">pnpm insights --niche ${esc(nicheId)}</code>
    </p>`;
}

export function nisOzetiBolumu(ozet: NisOzeti | null, nicheId: string): string {
  if (ozet === null) {
    return `<section class="kart"><h2>AI özeti</h2>${uretilmemis(nicheId)}</section>`;
  }

  return `<section class="kart">
    <h2>AI özeti</h2>
    <p class="dar">${esc(ozet.durum)}</p>
    ${
      ozet.trendler.length === 0
        ? ''
        : `<h2 style="margin-top:18px">Trendler</h2>
           <ul class="dar" style="padding-left:18px;margin:0">
             ${ozet.trendler.map((t) => `<li>${esc(t)}</li>`).join('')}
           </ul>`
    }
    ${
      ozet.aksiyonlar.length === 0
        ? ''
        : `<h2 style="margin-top:18px">Aksiyonlar</h2>
           <ol class="dar" style="padding-left:18px;margin:0">
             ${ozet.aksiyonlar
               .map(
                 (a) =>
                   `<li><strong>${esc(a.baslik)}</strong><div class="ikincil">${esc(a.gerekce)}</div></li>`,
               )
               .join('')}
           </ol>`
    }
  </section>`;
}

export function firsatAciklamasiBolumu(
  aciklama: FirsatAciklamasi | null,
  nicheId: string,
): string {
  if (aciklama === null) {
    return `<section class="kart"><h2>AI yorumu</h2>${uretilmemis(nicheId)}</section>`;
  }

  const guvenEtiketi = { dusuk: 'düşük', orta: 'orta', yuksek: 'yüksek' }[aciklama.guven];

  return `<section class="kart">
    <h2>AI yorumu <span class="firsat-rozet">güven: ${esc(guvenEtiketi)}</span></h2>
    <p class="dar">${esc(aciklama.firsat)}</p>
    <h2 style="margin-top:18px">Bu alan neden boş olabilir</h2>
    <p class="dar ikincil">${esc(aciklama.neden_bos)}</p>
    ${
      aciklama.riskler.length === 0
        ? ''
        : `<h2 style="margin-top:18px">Riskler</h2>
           <ul class="dar" style="padding-left:18px;margin:0">
             ${aciklama.riskler.map((r) => `<li>${esc(r)}</li>`).join('')}
           </ul>`
    }
  </section>`;
}

export function yorumTemalariBolumu(
  temalar: YorumTemalari | null,
  nicheId: string,
): string {
  if (temalar === null) {
    return `<section class="kart"><h2>AI yorum analizi</h2>${uretilmemis(nicheId)}</section>`;
  }

  return `<section class="kart">
    <h2>AI yorum analizi</h2>
    ${
      temalar.temalar.length === 0
        ? '<p class="olculemedi dar">Tekrar eden tema bulunamadı.</p>'
        : `<div class="kaydir"><table>
             <thead><tr><th>Tema</th><th>Sıklık</th><th>Örnek</th></tr></thead>
             <tbody>${temalar.temalar
               .map(
                 (t) =>
                   `<tr><td>${esc(t.tema)}</td><td>${esc(t.siklik)}</td><td class="ikincil">${esc(t.ornek_alinti.slice(0, 90))}</td></tr>`,
               )
               .join('')}</tbody>
           </table></div>`
    }
    ${
      temalar.urun_firsatlari.length === 0
        ? ''
        : `<h2 style="margin-top:18px">Ürün fırsatları</h2>
           <ul class="dar" style="padding-left:18px;margin:0">
             ${temalar.urun_firsatlari.map((u) => `<li>${esc(u)}</li>`).join('')}
           </ul>`
    }
  </section>`;
}

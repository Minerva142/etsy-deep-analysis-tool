import { z } from 'zod/v4';

/*
  Şemalarda serbest sayı alanı YOK.
  Model yalnızca metin üretir; her rakam SQL'den gelip prompt'a konur.
  Bir alan `number` olsaydı model oraya uydurma bir değer yazabilirdi.
*/

export const nisOzetiSemasi = z.object({
  durum: z.string().describe('Nişin şu anki durumunu iki üç cümleyle anlat.'),
  trendler: z
    .array(z.string())
    .describe('Veride görünen belirgin hareketler. Her madde bir cümle.'),
  aksiyonlar: z
    .array(
      z.object({
        baslik: z.string().describe('Kısa, emir kipinde bir aksiyon.'),
        gerekce: z
          .string()
          .describe('Bu aksiyonu hangi ölçülmüş sayıya dayandırdığını söyle.'),
      }),
    )
    .describe('En fazla üç somut aksiyon.'),
});

export type NisOzeti = z.infer<typeof nisOzetiSemasi>;

export const yorumTemalariSemasi = z.object({
  temalar: z
    .array(
      z.object({
        tema: z.string().describe('Tekrar eden şikâyet konusu.'),
        siklik: z
          .enum(['nadir', 'orta', 'yaygin'])
          .describe('Verilen yorumlar içinde ne sıklıkta geçtiği.'),
        ornek_alinti: z.string().describe('Bu temayı gösteren kısa bir alıntı.'),
      }),
    )
    .describe('Düşük puanlı yorumlarda tekrar eden temalar.'),
  urun_firsatlari: z
    .array(z.string())
    .describe('Bu şikâyetleri çözen ürün iyileştirmeleri.'),
});

export type YorumTemalari = z.infer<typeof yorumTemalariSemasi>;

export const firsatAciklamasiSemasi = z.object({
  firsat: z.string().describe('Veride görünen en belirgin fırsat, bir paragraf.'),
  neden_bos: z
    .string()
    .describe('Bu alanın neden doldurulmamış olabileceğine dair olası açıklama.'),
  riskler: z.array(z.string()).describe('Bu fırsata girmenin riskleri.'),
  guven: z
    .enum(['dusuk', 'orta', 'yuksek'])
    .describe('Verinin bu sonucu ne kadar güçlü desteklediği.'),
});

export type FirsatAciklamasi = z.infer<typeof firsatAciklamasiSemasi>;

export const INSIGHT_TIPLERI = {
  nisOzeti: 'nis_ozeti',
  yorumTemalari: 'yorum_temalari',
  firsatAciklamasi: 'firsat_aciklamasi',
} as const;

export type InsightTipi = (typeof INSIGHT_TIPLERI)[keyof typeof INSIGHT_TIPLERI];

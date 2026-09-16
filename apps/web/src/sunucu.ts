import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import { hataSayfasi } from './html.js';
import {
  firsatlarSayfasi,
  listinglerSayfasi,
  nisOzetiSayfasi,
  nislerSayfasi,
  rakiplerSayfasi,
} from './sayfalar.js';
import { insightUret, nisEkle, nisSil, snapshotAl, type EylemSonucu } from './eylemler.js';
import { dosyaYokMu, kilitHatasiMi } from './lib/kilit.js';

const PORT = Number(process.env.PORT ?? 3000);
const stilYolu = new URL('./stil.css', import.meta.url);

/** Form gövdesi için üst sınır; bu panel tek kullanıcılık ve yerel. */
const GOVDE_SINIRI = 64 * 1024;

function parcala(yol: string): string[] {
  return yol
    .split('/')
    .filter((p) => p.length > 0)
    .map(decodeURIComponent);
}

async function govdeyiOku(istek: IncomingMessage): Promise<URLSearchParams> {
  const parcalar: Buffer[] = [];
  let boyut = 0;
  for await (const parca of istek) {
    const buf = parca as Buffer;
    boyut += buf.length;
    if (boyut > GOVDE_SINIRI) throw new Error('Form gövdesi çok büyük.');
    parcalar.push(buf);
  }
  return new URLSearchParams(Buffer.concat(parcalar).toString('utf8'));
}

async function sayfaYonlendir(
  yol: string,
  sorgu: URLSearchParams,
): Promise<string | null> {
  const p = parcala(yol);
  const bildirim = sorgu.get('bildirim');
  const hata = sorgu.get('hata') === '1';

  if (p.length === 0) return nislerSayfasi(bildirim, hata);

  if (p[0] === 'nis' && p[1] !== undefined) {
    const id = p[1];
    const alt = p[2];
    if (alt === undefined) return nisOzetiSayfasi(id, bildirim, hata);
    if (alt === 'firsatlar') return firsatlarSayfasi(id);
    if (alt === 'rakipler') return rakiplerSayfasi(id);
    if (alt === 'listingler') {
      return listinglerSayfasi(id, {
        sirala: sorgu.get('sirala') ?? 'hiz',
        ara: sorgu.get('ara'),
        minFiyat: sorgu.get('min'),
        maxFiyat: sorgu.get('max'),
      });
    }
  }

  return null;
}

async function eylemYonlendir(
  yol: string,
  form: URLSearchParams,
): Promise<EylemSonucu | null> {
  const p = parcala(yol);

  if (p[0] === 'nis' && p[1] === 'ekle') return nisEkle(form);

  if (p[0] === 'nis' && p[1] !== undefined && p[2] !== undefined) {
    const id = p[1];
    if (p[2] === 'snapshot') return snapshotAl(id, form);
    if (p[2] === 'insight') return insightUret(id);
    if (p[2] === 'sil') return nisSil(id);
  }

  return null;
}

/** Eylemden sonra GET'e döneriz: yenilemede işlem tekrarlanmasın. */
function bildirimliYol(sonuc: EylemSonucu): string {
  const url = new URL(sonuc.yol, 'http://yerel');
  url.searchParams.set('bildirim', sonuc.mesaj);
  if (!sonuc.basarili) url.searchParams.set('hata', '1');
  return `${url.pathname}${url.search}`;
}

const sunucu = createServer((istek, yanit) => {
  void (async (): Promise<void> => {
    const url = new URL(istek.url ?? '/', `http://${istek.headers.host ?? 'localhost'}`);

    if (url.pathname === '/stil.css') {
      const css = await readFile(stilYolu, 'utf8');
      yanit.writeHead(200, {
        'content-type': 'text/css; charset=utf-8',
        'cache-control': 'no-cache',
      });
      yanit.end(css);
      return;
    }

    try {
      if (istek.method === 'POST') {
        const form = await govdeyiOku(istek);
        const sonuc = await eylemYonlendir(url.pathname, form);
        if (sonuc === null) {
          yanit.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
          yanit.end(hataSayfasi('Bulunamadı', 'Böyle bir işlem yok.'));
          return;
        }
        yanit.writeHead(303, { location: bildirimliYol(sonuc) });
        yanit.end();
        return;
      }

      const html = await sayfaYonlendir(url.pathname, url.searchParams);
      if (html === null) {
        yanit.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
        yanit.end(
          hataSayfasi(
            'Sayfa bulunamadı',
            'Aradığınız niş ya da sayfa yok. Niş listesinden devam edebilirsiniz.',
          ),
        );
        return;
      }
      yanit.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      });
      yanit.end(html);
    } catch (error) {
      // Hatayı yutmuyoruz: günlüğe tam haliyle, kullanıcıya ne yapacağını
      // söyleyen kısa bir mesaj.
      process.stderr.write(
        `İstek başarısız (${istek.method ?? 'GET'} ${url.pathname}): ${
          error instanceof Error ? (error.stack ?? error.message) : String(error)
        }\n`,
      );
      // Kilit hatasını "veritabanı yok" diye göstermek yanlış yönlendiriyordu:
      // sebep tam tersi, veritabanı o anda BAŞKA bir iş tarafından kullanılıyor.
      if (kilitHatasiMi(error)) {
        yanit.writeHead(503, {
          'content-type': 'text/html; charset=utf-8',
          'retry-after': '5',
        });
        yanit.end(
          hataSayfasi(
            'Veritabanı şu an meşgul',
            'Muhtemelen bir çekim sürüyor ya da CLI komutu çalışıyor. Birkaç saniye sonra sayfayı yenileyin.',
          ),
        );
        return;
      }

      const dosyaYok = dosyaYokMu(error);
      yanit.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      yanit.end(
        hataSayfasi(
          dosyaYok ? 'Veritabanı bulunamadı' : 'Bir şeyler ters gitti',
          dosyaYok
            ? 'Henüz hiç çekim yapılmamış görünüyor. Nişler ekranından bir niş ekleyip çekim başlatabilirsiniz.'
            : 'Ayrıntı sunucu günlüğünde. Sayfayı yenilemeyi deneyin.',
        ),
      );
    }
  })();
});

sunucu.listen(PORT, () => {
  process.stdout.write(`Dashboard hazır: http://localhost:${String(PORT)}\n`);
});

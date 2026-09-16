import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { hataSayfasi } from './html.js';
import {
  firsatlarSayfasi,
  listinglerSayfasi,
  nisOzetiSayfasi,
  nislerSayfasi,
  rakiplerSayfasi,
} from './sayfalar.js';

const PORT = Number(process.env.PORT ?? 3000);
const stilYolu = new URL('./stil.css', import.meta.url);

/** '/nis/abc/firsatlar' -> ['nis', 'abc', 'firsatlar'] */
function parcala(yol: string): string[] {
  return yol.split('/').filter((p) => p.length > 0).map(decodeURIComponent);
}

async function yonlendir(yol: string, sorgu: URLSearchParams): Promise<string | null> {
  const p = parcala(yol);

  if (p.length === 0) return nislerSayfasi();

  if (p[0] === 'nis' && p[1] !== undefined) {
    const id = p[1];
    const alt = p[2];
    if (alt === undefined) return nisOzetiSayfasi(id);
    if (alt === 'firsatlar') return firsatlarSayfasi(id);
    if (alt === 'rakipler') return rakiplerSayfasi(id);
    if (alt === 'listingler') {
      return listinglerSayfasi(id, sorgu.get('sirala') ?? 'hiz');
    }
  }

  return null;
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
      const html = await yonlendir(url.pathname, url.searchParams);
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
      // Hatayı yutmuyoruz: sunucu günlüğüne tam haliyle, kullanıcıya
      // ne yapacağını söyleyen kısa bir mesaj.
      process.stderr.write(
        `İstek başarısız (${url.pathname}): ${
          error instanceof Error ? (error.stack ?? error.message) : String(error)
        }\n`,
      );
      const eksikVeri =
        error instanceof Error && /Cannot open file|does not exist|not found/i.test(error.message);
      yanit.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
      yanit.end(
        hataSayfasi(
          eksikVeri ? 'Veritabanı bulunamadı' : 'Bir şeyler ters gitti',
          eksikVeri
            ? 'Henüz hiç snapshot alınmamış görünüyor. Önce: pnpm snapshot --niche <id> --name "<ad>" --keywords "<kelime>"'
            : 'Ayrıntı sunucu günlüğünde. Sayfayı yenilemeyi deneyin.',
        ),
      );
    }
  })();
});

sunucu.listen(PORT, () => {
  process.stdout.write(`Dashboard hazır: http://localhost:${String(PORT)}\n`);
});

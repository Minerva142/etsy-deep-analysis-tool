import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { RateLimiter, parseRateLimitHeaders } from '../src/etsy/rate-limiter.js';

describe('parseRateLimitHeaders', () => {
  it("Etsy header’larını okur", () => {
    const headers = new Headers({
      'x-limit-per-second': '150',
      'x-remaining-this-secon': '149',
      'x-limit-per-day': '10000',
      'x-remaining-today': '9998',
    });
    expect(parseRateLimitHeaders(headers)).toEqual({
      limitPerSecond: 150,
      remainingThisSecond: 149,
      limitPerDay: 10000,
      remainingToday: 9998,
    });
  });

  it("tam yazımlı saniye header’ını da kabul eder", () => {
    const headers = new Headers({ 'x-remaining-this-second': '7' });
    expect(parseRateLimitHeaders(headers).remainingThisSecond).toBe(7);
  });

  it("eksik header’lar için null döner", () => {
    expect(parseRateLimitHeaders(new Headers())).toEqual({
      limitPerSecond: null,
      remainingThisSecond: null,
      limitPerDay: null,
      remainingToday: null,
    });
  });
});

describe('RateLimiter', () => {
  let db: Db;
  let clock: Date;
  let slept: number[];

  beforeEach(async () => {
    db = await openDb(':memory:');
    await migrate(db);
    clock = new Date('2026-09-16T10:00:00.000Z');
    slept = [];
  });

  const limiter = () =>
    new RateLimiter(
      db,
      () => clock,
      async (ms) => {
        slept.push(ms);
        clock = new Date(clock.getTime() + ms);
      },
    );

  it('kota bilgisi yokken beklemeden geçer', async () => {
    await limiter().acquire();
    expect(slept).toEqual([]);
  });

  it('saniyelik kota bittiğinde sonraki saniyeye kadar bekler', async () => {
    const rl = limiter();
    await rl.syncFromHeaders({
      limitPerSecond: 150,
      remainingThisSecond: 0,
      limitPerDay: 10000,
      remainingToday: 5000,
    });
    await rl.acquire();
    expect(slept).toEqual([1000]);
  });

  it('günlük kota bittiğinde isDayExhausted true döner', async () => {
    const rl = limiter();
    await rl.syncFromHeaders({
      limitPerSecond: 150,
      remainingThisSecond: 100,
      limitPerDay: 10000,
      remainingToday: 0,
    });
    expect(await rl.isDayExhausted()).toBe(true);
  });

  it('durum veritabanında kalıcıdır', async () => {
    await limiter().syncFromHeaders({
      limitPerSecond: 150,
      remainingThisSecond: 10,
      limitPerDay: 10000,
      remainingToday: 42,
    });
    const rows = await db.query<{ remaining_today: string }>(
      'select remaining_today from rate_limit_state',
    );
    expect(Number(rows[0]?.remaining_today)).toBe(42);
  });
});

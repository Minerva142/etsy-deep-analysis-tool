import { toDbTimestamp, type Db } from '../db/connection.js';

const STATE_KEY = 'etsy';

export interface RateLimitHeaders {
  limitPerSecond: number | null;
  remainingThisSecond: number | null;
  limitPerDay: number | null;
  remainingToday: number | null;
}

function readNumber(headers: Headers, ...names: string[]): number | null {
  for (const name of names) {
    const raw = headers.get(name);
    if (raw !== null && raw.trim() !== '') {
      const value = Number(raw);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

export function parseRateLimitHeaders(headers: Headers): RateLimitHeaders {
  return {
    limitPerSecond: readNumber(headers, 'x-limit-per-second'),
    // Etsy dokümanında header adı 'x-remaining-this-secon' olarak geçiyor
    // (eksik harf onların dokümanındaki haliyle). Her iki yazım da okunur.
    remainingThisSecond: readNumber(
      headers,
      'x-remaining-this-secon',
      'x-remaining-this-second',
    ),
    limitPerDay: readNumber(headers, 'x-limit-per-day'),
    remainingToday: readNumber(headers, 'x-remaining-today'),
  };
}

interface RateLimitState {
  remainingToday: number | null;
  remainingThisSecond: number | null;
}

export class RateLimiter {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  private async readState(): Promise<RateLimitState> {
    const rows = await this.db.query<{
      remaining_today: string | null;
      remaining_this_second: string | null;
    }>(
      `select remaining_today, remaining_this_second
         from rate_limit_state
        where window_key = $key`,
      { key: STATE_KEY },
    );
    const row = rows[0];
    if (!row) {
      return { remainingToday: null, remainingThisSecond: null };
    }
    return {
      remainingToday:
        row.remaining_today === null ? null : Number(row.remaining_today),
      remainingThisSecond:
        row.remaining_this_second === null ? null : Number(row.remaining_this_second),
    };
  }

  async syncFromHeaders(headers: RateLimitHeaders): Promise<void> {
    await this.db.runStatement(
      `insert or replace into rate_limit_state
         (window_key, remaining_today, remaining_this_second, updated_at)
       values ($key, $today, $second, $updatedAt::TIMESTAMP)`,
      {
        key: STATE_KEY,
        today: headers.remainingToday,
        second: headers.remainingThisSecond,
        updatedAt: toDbTimestamp(this.now()),
      },
    );
  }

  async isDayExhausted(): Promise<boolean> {
    const state = await this.readState();
    return state.remainingToday !== null && state.remainingToday <= 0;
  }

  async acquire(): Promise<void> {
    const state = await this.readState();
    if (state.remainingThisSecond !== null && state.remainingThisSecond <= 0) {
      await this.sleep(1000);
    }
  }
}

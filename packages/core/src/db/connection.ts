import {
  DuckDBInstance,
  type DuckDBConnection,
  type DuckDBValue,
} from '@duckdb/node-api';

/** Sorgu parametreleri DuckDB'nin kabul ettiği değer tiplerine sınırlıdır. */
export type DbParams = Record<string, DuckDBValue>;

/**
 * DuckDB bir JS `Date` nesnesini parametre olarak kabul etmiyor. Zaman
 * damgaları bu biçimde string olarak geçirilir ve SQL içinde `$param::TIMESTAMP`
 * ile cast edilir. Üretilen değer her zaman UTC'dir.
 *
 *   toDbTimestamp(new Date('2026-09-16T10:00:00Z')) === '2026-09-16 10:00:00.000'
 */
export function toDbTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/** `getRowObjectsJson()` zaman damgalarını UTC string olarak döndürür. */
export function fromDbTimestamp(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: DbParams): Promise<T[]>;
  runStatement(sql: string, params?: DbParams): Promise<void>;
  close(): Promise<void>;
}

class DuckDb implements Db {
  constructor(private readonly connection: DuckDBConnection) {}

  async query<T = Record<string, unknown>>(
    sql: string,
    params?: DbParams,
  ): Promise<T[]> {
    const reader = params
      ? await this.connection.runAndReadAll(sql, params)
      : await this.connection.runAndReadAll(sql);
    return reader.getRowObjectsJson() as T[];
  }

  async runStatement(sql: string, params?: DbParams): Promise<void> {
    if (params) {
      await this.connection.run(sql, params);
    } else {
      await this.connection.run(sql);
    }
  }

  async close(): Promise<void> {
    this.connection.closeSync();
  }
}

export async function openDb(path: string): Promise<Db> {
  const instance = await DuckDBInstance.create(path);
  const connection = await instance.connect();
  return new DuckDb(connection);
}

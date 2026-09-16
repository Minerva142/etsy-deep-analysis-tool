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
  constructor(
    private readonly connection: DuckDBConnection,
    private readonly instance: DuckDBInstance,
  ) {}

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

  /**
   * Bağlantıyı VE instance'ı kapatır.
   *
   * Yalnızca bağlantıyı kapatmak dosya kilidini bırakmıyor: aynı süreç
   * içinde ikinci bir açılış "file is already open" ile düşüyor. Tek
   * seferlik CLI koşusunda fark etmiyordu, istek başına açan sunucuda
   * ilk istekten sonrasını bozuyordu.
   */
  async close(): Promise<void> {
    this.connection.closeSync();
    this.instance.closeSync();
  }
}

export interface OpenDbOptions {
  /** Panel gibi yalnızca okuyan tüketiciler için. */
  readOnly?: boolean;
}

export async function openDb(path: string, options: OpenDbOptions = {}): Promise<Db> {
  const config: Record<string, string> =
    options.readOnly === true && path !== ':memory:' ? { access_mode: 'READ_ONLY' } : {};
  const instance = await DuckDBInstance.create(path, config);
  const connection = await instance.connect();
  return new DuckDb(connection, instance);
}

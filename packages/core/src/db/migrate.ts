import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Db } from './connection.js';

const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

export async function migrate(db: Db): Promise<void> {
  const schema = await readFile(schemaPath, 'utf8');
  for (const statement of schema.split(';')) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) {
      await db.runStatement(trimmed);
    }
  }
}

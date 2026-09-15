import type { Db } from '../db/connection.js';
import type { EtsyClient } from '../etsy/client.js';
import { fetchTaxonomyNodes } from '../etsy/endpoints/taxonomy.js';
import type { SellerTaxonomyNode } from '../etsy/types.js';

export interface TaxonomyRow {
  taxonomy_id: number;
  name: string;
  level: number;
  parent_id: number | null;
  full_path: string;
}

function collect(nodes: SellerTaxonomyNode[], into: SellerTaxonomyNode[]): void {
  for (const node of nodes) {
    into.push(node);
    collect(node.children, into);
  }
}

export function flattenTaxonomy(nodes: SellerTaxonomyNode[]): TaxonomyRow[] {
  const all: SellerTaxonomyNode[] = [];
  collect(nodes, all);

  // full_path'i yazabilmek için önce tüm ağaçtan bir id -> ad haritası kurulur.
  const nameById = new Map<number, string>();
  for (const node of all) nameById.set(node.id, node.name);

  return all.map((node) => ({
    taxonomy_id: node.id,
    name: node.name,
    level: node.level,
    parent_id: node.parent_id,
    full_path: node.full_path_taxonomy_ids
      .map((id) => nameById.get(id) ?? String(id))
      .join(' > '),
  }));
}

export async function ingestTaxonomy(options: {
  db: Db;
  client: EtsyClient;
}): Promise<{ nodeCount: number }> {
  const rows = flattenTaxonomy(await fetchTaxonomyNodes(options.client));

  for (const row of rows) {
    await options.db.runStatement(
      `insert or replace into taxonomy_nodes
         (taxonomy_id, name, level, parent_id, full_path)
       values ($taxonomyId, $name, $level, $parentId, $fullPath)`,
      {
        taxonomyId: row.taxonomy_id,
        name: row.name,
        level: row.level,
        parentId: row.parent_id,
        fullPath: row.full_path,
      },
    );
  }

  return { nodeCount: rows.length };
}

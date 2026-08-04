import { ekg } from '../src/ekg/graph';
import { graph } from '../src/ekg/graph';
import { db } from '../src/lib/db';

async function main() {
  const nodes = ekg.listNodes();
  const allRels = graph.relationships.filter((r) => !r.validTo);

  console.log(`Syncing ${nodes.length} nodes + ${allRels.length} relationships to PostgreSQL...`);

  let nodeCount = 0;
  for (const node of nodes) {
    try {
      await db.graphNode.upsert({
        where: { id: node.id },
        create: {
          id: node.id, kind: node.kind, label: node.label,
          labels: node.labels ? JSON.stringify(node.labels) : null,
          properties: JSON.stringify(node.properties),
          validFrom: new Date(node.validFrom),
          validTo: node.validTo ? new Date(node.validTo) : null,
          previousVersionId: node.previousVersionId ?? null,
        },
        update: {},
      });
      nodeCount++;
    } catch { /* skip */ }
  }

  let relCount = 0;
  for (const rel of allRels) {
    try {
      await db.graphRelationship.upsert({
        where: { id: rel.id },
        create: {
          id: rel.id, fromId: rel.from, toId: rel.to, type: rel.type,
          properties: JSON.stringify(rel.properties),
          validFrom: new Date(rel.validFrom),
          validTo: rel.validTo ? new Date(rel.validTo) : null,
        },
        update: {},
      });
      relCount++;
    } catch { /* skip */ }
  }

  console.log(`✓ Synced ${nodeCount} nodes + ${relCount} relationships to PostgreSQL`);
  const dbNodes = await db.graphNode.count({ where: { validTo: null } });
  const dbRels = await db.graphRelationship.count({ where: { validTo: null } });
  console.log(`PostgreSQL now has ${dbNodes} current nodes + ${dbRels} current relationships`);
}

main().catch(console.error).finally(() => process.exit(0));

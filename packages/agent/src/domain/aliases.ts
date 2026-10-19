import type { Board } from '@designroom/domain';

// The model never sees our ids. Real ids are UUIDs (36 characters): costly in tokens, and a small
// model copies them wrong. It sees n1, n2… for nodes and z1, z2… for zones, in board order, and
// the agent translates back. New nodes get the next alias, so the model can connect to them.

export type Aliases = {
  nodeId(alias: string): string | undefined;
  nodeAlias(id: string): string | undefined;
  zoneAlias(id: string): string | undefined;
  /** All node aliases, in order: listed in error messages so the model can pick a real one. */
  nodeAliases(): string[];
  /** A copy that also knows `id`, under the next free alias. */
  withNode(id: string): Aliases;
};

const build = (nodeIds: readonly string[], zoneIds: readonly string[]): Aliases => {
  const aliasOf = new Map(nodeIds.map((id, i) => [id, `n${i + 1}`]));
  const idOf = new Map(nodeIds.map((id, i) => [`n${i + 1}`, id]));
  const zoneAliasOf = new Map(zoneIds.map((id, i) => [id, `z${i + 1}`]));
  return {
    nodeId: (alias) => idOf.get(alias),
    nodeAlias: (id) => aliasOf.get(id),
    zoneAlias: (id) => zoneAliasOf.get(id),
    nodeAliases: () => [...idOf.keys()],
    withNode: (id) => build([...nodeIds, id], zoneIds),
  };
};

export const createAliases = (board: Board): Aliases =>
  build(
    board.nodes.map((n) => n.id),
    (board.zones ?? []).map((z) => z.id),
  );

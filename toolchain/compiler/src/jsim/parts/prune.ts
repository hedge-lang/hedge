import type * as JSIM from "../ast.js";

/**
 * Drops each top-level function named in `prunable` that no retained item
 * reaches, directly or through another reached prunable function.
 * Reachability is by name over every string in an item's tree, so witness
 * slots, call callees and plain identifiers all count without a per-node-kind
 * walk; a stray equal string only ever keeps a function, never drops one.
 */
export function pruneUnreferencedFunctions(
  items: readonly JSIM.Item[],
  prunable: ReadonlySet<string>,
): JSIM.Item[] {
  const pending = new Map<string, JSIM.FunctionDef>();
  const retained: JSIM.Item[] = [];
  for (const item of items) {
    if (item.kind === "Function" && prunable.has(item.name)) {
      pending.set(item.name, item);
    } else {
      retained.push(item);
    }
  }
  const reached = new Set<string>();
  const queue: JSIM.Item[] = [...retained];
  for (const item of queue) {
    for (const name of referencedNames(item, pending)) {
      const fn = pending.get(name);
      if (fn !== undefined && !reached.has(name)) {
        reached.add(name);
        queue.push(fn);
      }
    }
  }
  return items.filter(
    (item) =>
      item.kind !== "Function" ||
      !prunable.has(item.name) ||
      reached.has(item.name),
  );
}

function referencedNames(
  root: unknown,
  wanted: ReadonlyMap<string, unknown>,
): Set<string> {
  const found = new Set<string>();
  const stack: unknown[] = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node === "string") {
      if (wanted.has(node)) found.add(node);
    } else {
      stack.push(...childrenOf(node));
    }
  }
  return found;
}

function childrenOf(node: unknown): readonly unknown[] {
  if (Array.isArray(node)) return unknownArray(node);
  if (typeof node === "object" && node !== null) {
    return unknownArray(Object.values(node));
  }
  return [];
}

function unknownArray(values: readonly unknown[]): readonly unknown[] {
  return values;
}

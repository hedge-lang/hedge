/**
 * @module
 *
 * Backward liveness dataflow over a `ControlFlowGraph`: a place (binding) is
 * live at a point if some path forward from that point reaches a use of it
 * before any redefinition. Computed at block granularity -
 * `LiveIn(B) = Use(B) union (LiveOut(B) - Def(B))`,
 * `LiveOut(B) = union of LiveIn(successors of B)` - via the standard worklist
 * fixpoint, not a single reverse-topological pass: Hedge's CFG is currently a
 * DAG (no loops until ROADMAP Slice 6), but the worklist is the textbook
 * shape for any CFG dataflow and needs no rewrite once back-edges exist.
 *
 * This only resolves cross-block liveness at block boundaries; the exact
 * point *within* a block where a borrow's extent ends (last use, per
 * specification/0005-borrows.md) is a finer-grained question for the NLL
 * borrow checker itself to answer using this module's LiveIn/LiveOut as its
 * cross-block boundary conditions.
 */

import type {
  BasicBlock,
  BindingId,
  ControlFlowGraph,
} from "./control-flow-graph.js";
import { collectDeclarations } from "./control-flow-graph.js";

export interface BlockLiveness {
  readonly liveIn: ReadonlySet<BindingId>;
  readonly liveOut: ReadonlySet<BindingId>;
}

export interface Liveness {
  readonly graph: ControlFlowGraph;
  /** Keyed by `BasicBlock.id`. */
  readonly blocks: ReadonlyMap<number, BlockLiveness>;
}

function union(sets: readonly ReadonlySet<BindingId>[]): Set<BindingId> {
  return new Set(sets.flatMap((set) => [...set]));
}

function minus(
  set: ReadonlySet<BindingId>,
  exclude: ReadonlySet<BindingId>,
): Set<BindingId> {
  return new Set([...set].filter((id) => !exclude.has(id)));
}

function setsEqual(
  a: ReadonlySet<BindingId>,
  b: ReadonlySet<BindingId>,
): boolean {
  if (a.size !== b.size) {
    return false;
  }
  for (const id of a) {
    if (!b.has(id)) {
      return false;
    }
  }
  return true;
}

/** Every block's predecessors, derived from the graph's own successor edges. */
function predecessorsOf(
  graph: ControlFlowGraph,
): ReadonlyMap<number, readonly number[]> {
  const predecessors = new Map<number, number[]>(
    graph.blocks.map((block) => [block.id, []]),
  );
  for (const block of graph.blocks) {
    for (const successor of block.successors) {
      predecessors.get(successor)?.push(block.id);
    }
  }
  return predecessors;
}

/**
 * Backward worklist fixpoint (see the module doc for the LiveIn/LiveOut
 * formula). Converges because the lattice (finite sets of `BindingId`) is
 * finite and each step only ever grows a set, never shrinks it.
 */
export function computeLiveness(graph: ControlFlowGraph): Liveness {
  const blockById = new Map<number, BasicBlock>(
    graph.blocks.map((block) => [block.id, block]),
  );
  const predecessors = predecessorsOf(graph);
  const liveIn = new Map<number, Set<BindingId>>(
    graph.blocks.map((block) => [block.id, new Set()]),
  );
  const liveOut = new Map<number, Set<BindingId>>(
    graph.blocks.map((block) => [block.id, new Set()]),
  );

  const worklist = graph.blocks.map((block) => block.id);
  while (worklist.length > 0) {
    const id = worklist.pop();
    if (id === undefined) {
      continue;
    }
    const block = blockById.get(id);
    if (block === undefined) {
      continue;
    }

    const newLiveOut = union(
      block.successors.map((successor) => liveIn.get(successor) ?? new Set()),
    );
    const newLiveIn = union([block.uses, minus(newLiveOut, block.defs)]);

    const currentLiveIn = liveIn.get(id) ?? new Set();
    if (!setsEqual(currentLiveIn, newLiveIn)) {
      liveIn.set(id, newLiveIn);
      liveOut.set(id, newLiveOut);
      for (const predecessor of predecessors.get(id) ?? []) {
        worklist.push(predecessor);
      }
    } else {
      liveOut.set(id, newLiveOut);
    }
  }

  const blocks = new Map<number, BlockLiveness>(
    graph.blocks.map((block) => [
      block.id,
      {
        liveIn: liveIn.get(block.id) ?? new Set(),
        liveOut: liveOut.get(block.id) ?? new Set(),
      },
    ]),
  );
  return { graph, blocks };
}

function nameOf(names: ReadonlyMap<BindingId, string>, id: BindingId): string {
  return names.get(id) ?? `#${String(id)}`;
}

function formatSet(
  names: ReadonlyMap<BindingId, string>,
  set: ReadonlySet<BindingId>,
): string {
  return `{${[...set]
    .map((id) => nameOf(names, id))
    .sort()
    .join(", ")}}`;
}

/**
 * Render each block's LiveIn/LiveOut by source-level name, for inspecting
 * checker decisions during development - not a stable/parseable format.
 */
export function dumpLiveness(liveness: Liveness): string {
  const names = new Map(
    collectDeclarations(liveness.graph).map((decl) => [decl.id, decl.name]),
  );
  return liveness.graph.blocks
    .flatMap((block) => {
      const blockLiveness = liveness.blocks.get(block.id);
      return [
        `block ${String(block.id)}:`,
        `  liveIn:  ${formatSet(names, blockLiveness?.liveIn ?? new Set())}`,
        `  liveOut: ${formatSet(names, blockLiveness?.liveOut ?? new Set())}`,
      ];
    })
    .join("\n");
}

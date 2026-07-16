import { describe, expect, it } from "vitest";

import { assert } from "../assert.js";
import type * as Semantics from "../semantics/ast.js";
import { analyzeSource } from "../testing/analyze-source.js";
import type { BindingId, ControlFlowGraph } from "./control-flow-graph.js";
import {
  buildControlFlowGraph,
  collectDeclarations,
} from "./control-flow-graph.js";
import type { BlockLiveness, Liveness } from "./liveness.js";
import { computeLiveness, dumpLiveness } from "./liveness.js";

function mainGraph(source: string): ControlFlowGraph {
  const { program } = analyzeSource(source);
  const main = program.items.find(
    (item): item is Semantics.FunctionDecl =>
      item.kind === "Function" && item.name.text === "main",
  );
  assert(main !== undefined, "Expected a main function");
  return buildControlFlowGraph(main);
}

function idNamed(graph: ControlFlowGraph, name: string): BindingId {
  const ids = collectDeclarations(graph)
    .filter((d) => d.name === name)
    .map((d) => d.id);
  assert(ids.length === 1, `Expected exactly one declaration named ${name}`);
  const id = ids[0];
  assert(id !== undefined);
  return id;
}

function livenessOf(liveness: Liveness, blockId: number): BlockLiveness {
  const blockLiveness = liveness.blocks.get(blockId);
  assert(blockLiveness !== undefined, `Expected liveness for block ${blockId}`);
  return blockLiveness;
}

describe("computeLiveness", (): void => {
  it("marks a used variable live-in at the block it's read in", (): void => {
    const graph = mainGraph(`
      fn main(p: i32) {
        let a = p;
      }
    `);
    const liveness = computeLiveness(graph);
    const block = livenessOf(liveness, graph.entry);
    expect(block.liveIn.has(idNamed(graph, "p"))).toBe(true);
  });

  it("has an empty liveOut at the function's own exit block", (): void => {
    const graph = mainGraph(`
      fn main(p: i32) {
        let a = p;
      }
    `);
    const liveness = computeLiveness(graph);
    const block = livenessOf(liveness, graph.entry);
    expect(block.liveOut.size).toBe(0);
  });

  it("propagates a variable used only in the then-branch back into the forking block's liveOut", (): void => {
    const graph = mainGraph(`
      fn main(q: i32) {
        if true {
          let a = q;
        }
        let done = true;
      }
    `);
    const liveness = computeLiveness(graph);
    const preLiveness = livenessOf(liveness, graph.entry);
    expect(preLiveness.liveOut.has(idNamed(graph, "q"))).toBe(true);
  });

  it("never marks an unused declared variable live anywhere in the graph", (): void => {
    const graph = mainGraph(`
      fn main(p: i32) {
        let unused = p;
      }
    `);
    const liveness = computeLiveness(graph);
    const unused = idNamed(graph, "unused");
    for (const blockLiveness of liveness.blocks.values()) {
      expect(blockLiveness.liveIn.has(unused)).toBe(false);
      expect(blockLiveness.liveOut.has(unused)).toBe(false);
    }
  });

  it("never tracks a wildcard binding as a place, while still tracking its initializer's own uses", (): void => {
    const graph = mainGraph(`
      fn main(p: i32) {
        let _ = p;
      }
    `);
    const liveness = computeLiveness(graph);
    const block = livenessOf(liveness, graph.entry);
    expect(block.liveIn.has(idNamed(graph, "p"))).toBe(true);
  });

  describe("dumpLiveness", (): void => {
    it("renders each block's liveIn/liveOut by source-level variable name", (): void => {
      const graph = mainGraph(`
        fn main(p: i32) {
          let a = p;
        }
      `);
      const dump = dumpLiveness(computeLiveness(graph));
      expect(dump).toContain(`block ${String(graph.entry)}:`);
      expect(dump).toContain("liveIn:  {p}");
      expect(dump).toContain("liveOut: {}");
    });

    it("renders a fork block's liveOut as the union of both branches' liveIn", (): void => {
      const graph = mainGraph(`
        fn main(q: i32) {
          if true {
            let a = q;
          }
          let done = true;
        }
      `);
      const dump = dumpLiveness(computeLiveness(graph));
      const lines = dump.split("\n");
      const blockLine = lines.indexOf(`block ${String(graph.entry)}:`);
      assert(blockLine !== -1, "Expected a dump line for the entry block");
      expect(lines[blockLine + 2]).toBe("  liveOut: {q}");
    });
  });
});

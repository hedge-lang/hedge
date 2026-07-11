import { describe, expect, it } from "vitest";

import { assert } from "../assert.js";
import { isSome } from "../option.js";
import type * as Semantics from "../semantics/ast.js";
import { analyzeSource } from "../testing/analyze-source.js";
import type { BasicBlock, ControlFlowGraph } from "./control-flow-graph.js";
import { buildControlFlowGraph } from "./control-flow-graph.js";

function mainGraph(source: string): ControlFlowGraph {
  const { program } = analyzeSource(source);
  const main = program.items.find(
    (item): item is Semantics.FunctionDecl =>
      item.kind === "Function" && item.name.text === "main",
  );
  assert(main !== undefined, "Expected a main function");
  return buildControlFlowGraph(main);
}

function scopeExitNames(block: BasicBlock): readonly string[] {
  assert(isSome(block.scopeExit), "Expected a scope exit on this block");
  return block.scopeExit.value.declarations.map((d) => d.name);
}

describe("buildControlFlowGraph", (): void => {
  it("builds a single block for a straight-line body", (): void => {
    const graph = mainGraph(`
      struct Boxed { value: i32 }
      fn main() {
        let a = 1;
        let b = Boxed { value: 2 };
      }
    `);
    expect(graph.blocks).toHaveLength(1);
    const block = graph.blocks[0];
    assert(block !== undefined);
    expect(block.successors).toEqual([]);
    expect(scopeExitNames(block)).toEqual(["a", "b"]);
  });

  it("seeds the root scope's declarations with the function's own parameters, before any body-level let", (): void => {
    const graph = mainGraph(`
      struct Boxed { value: i32 }
      fn main(p: Boxed) {
        let a = 1;
      }
    `);
    expect(graph.blocks).toHaveLength(1);
    const block = graph.blocks[0];
    assert(block !== undefined);
    expect(scopeExitNames(block)).toEqual(["p", "a"]);
  });

  it("records whether each declaration is mutable", (): void => {
    const graph = mainGraph(`
      fn main(p: i32) {
        let a = 1;
        let mut b = 2;
      }
    `);
    const block = graph.blocks[0];
    assert(block !== undefined);
    assert(isSome(block.scopeExit), "Expected a scope exit on this block");
    const byName = new Map(
      block.scopeExit.value.declarations.map((d) => [d.name, d.mutable]),
    );
    expect(byName.get("p")).toBe(false);
    expect(byName.get("a")).toBe(false);
    expect(byName.get("b")).toBe(true);
  });

  it("does not include a wildcard parameter in the root scope's declarations", (): void => {
    const graph = mainGraph(`
      fn main(_: i32) {
        let a = 1;
      }
    `);
    const block = graph.blocks[0];
    assert(block !== undefined);
    expect(scopeExitNames(block)).toEqual(["a"]);
  });

  it("builds 4 blocks for if/else as a statement", (): void => {
    const graph = mainGraph(`
      fn main() {
        let mut cond = true;
        if cond {
          let a = 1;
        } else {
          let b = 2;
        }
        let done = true;
      }
    `);
    expect(graph.blocks).toHaveLength(4);
    const pre = graph.blocks.find((b) => b.id === graph.entry);
    assert(pre !== undefined, "Expected entry block");
    expect(pre.successors).toHaveLength(2);
    const [thenId, elseId] = pre.successors;
    const thenBlock = graph.blocks.find((b) => b.id === thenId);
    const elseBlock = graph.blocks.find((b) => b.id === elseId);
    assert(thenBlock !== undefined && elseBlock !== undefined);
    expect(thenBlock.successors).toEqual(elseBlock.successors);
    expect(thenBlock.successors).toHaveLength(1);
    const joinId = thenBlock.successors[0];
    expect(graph.blocks.some((b) => b.id === joinId)).toBe(true);
  });

  it("records the if condition on the forking block", (): void => {
    const graph = mainGraph(`
      fn main() {
        let mut cond = true;
        if cond {
          let a = 1;
        } else {
          let b = 2;
        }
        let done = true;
      }
    `);
    const pre = graph.blocks.find((b) => b.id === graph.entry);
    assert(pre !== undefined, "Expected entry block");
    assert(
      isSome(pre.forkCondition),
      "Expected the fork condition to be recorded",
    );
    expect(pre.forkCondition.value.kind).toBe("PathExpression");
  });

  it("does not set a fork condition on a non-forking block", (): void => {
    const graph = mainGraph(`
      fn main() {
        let a = 1;
      }
    `);
    const block = graph.blocks[0];
    assert(block !== undefined);
    expect(isSome(block.forkCondition)).toBe(false);
  });

  it("accumulates a scope's declarations across the blocks an if forks it into", (): void => {
    const graph = mainGraph(`
      fn main() {
        let mut cond = true;
        if cond {
          let a = 1;
        } else {
          let b = 2;
        }
        let done = true;
      }
    `);
    const pre = graph.blocks.find((b) => b.id === graph.entry);
    assert(pre !== undefined, "Expected entry block");
    const [thenId] = pre.successors;
    const thenBlock = graph.blocks.find((b) => b.id === thenId);
    assert(thenBlock !== undefined);
    const [joinId] = thenBlock.successors;
    const joinBlock = graph.blocks.find((b) => b.id === joinId);
    assert(joinBlock !== undefined, "Expected a join block");
    // `cond` is declared before the fork and `done` after it, but both
    // belong to the function body's single Semantics.Block scope, so the
    // join block's own scopeExit must list both, in declaration order.
    expect(scopeExitNames(joinBlock)).toEqual(["cond", "done"]);
  });

  it("builds 3 blocks for if with no else", (): void => {
    const graph = mainGraph(`
      fn main() {
        let mut cond = true;
        if cond {
          let a = 1;
        }
        let done = true;
      }
    `);
    expect(graph.blocks).toHaveLength(3);
    const pre = graph.blocks.find((b) => b.id === graph.entry);
    assert(pre !== undefined);
    expect(pre.successors).toHaveLength(2);
    const [thenId, joinId] = pre.successors;
    expect(thenId).not.toBe(joinId);
    const thenBlock = graph.blocks.find((b) => b.id === thenId);
    assert(thenBlock !== undefined);
    expect(thenBlock.successors).toEqual([joinId]);
  });

  it("chains a nested if inside a then-branch without dangling exits", (): void => {
    const graph = mainGraph(`
      fn main() {
        let mut cond = true;
        let mut inner = true;
        if cond {
          if inner {
            let a = 1;
          } else {
            let b = 2;
          }
          let innerDone = true;
        } else {
          let c = 3;
        }
        let done = true;
      }
    `);
    // pre, outer-then(pre for inner if), inner-then, inner-else, inner-join, outer-else, outer-join
    expect(graph.blocks).toHaveLength(7);
    const scopeExits = graph.blocks.filter((b) => isSome(b.scopeExit));
    // outer-then's own scope closes at inner-join, outer-else closes itself,
    // and the function body closes at outer-join: 3 distinct scope exits minimum.
    expect(scopeExits.length).toBeGreaterThanOrEqual(3);
  });

  it("gives a nested bare block its own distinct scope exit", (): void => {
    const graph = mainGraph(`
      fn main() {
        {
          let a = 1;
        }
        let b = 2;
      }
    `);
    const scopeExits = graph.blocks.filter((b) => isSome(b.scopeExit));
    expect(scopeExits).toHaveLength(2);
    const inner = scopeExits.find((b) => scopeExitNames(b).includes("a"));
    const outer = scopeExits.find((b) => scopeExitNames(b).includes("b"));
    expect(inner).toBeDefined();
    expect(outer).toBeDefined();
    expect(inner?.id).not.toBe(outer?.id);
  });
});

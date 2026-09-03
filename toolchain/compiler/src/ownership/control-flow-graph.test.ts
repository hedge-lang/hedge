import { describe, expect, it } from "vitest";

import { assert } from "../assert.js";
import { isSome } from "../option.js";
import type * as Semantics from "../semantics/ast.js";
import { analyzeSource } from "../testing/analyze-source.js";
import type {
  BasicBlock,
  BindingId,
  ControlFlowGraph,
} from "./control-flow-graph.js";
import {
  buildControlFlowGraph,
  collectDeclarations,
} from "./control-flow-graph.js";

function mainGraph(source: string): ControlFlowGraph {
  const { program } = analyzeSource(source);
  const main = program.items.find(
    (item): item is Semantics.FunctionDef =>
      item.kind === "Function" && item.signature.name.text === "main",
  );
  assert(main !== undefined, "Expected a main function");
  return buildControlFlowGraph(main);
}

function scopeExitNames(block: BasicBlock): readonly string[] {
  assert(isSome(block.scopeExit), "Expected a scope exit on this block");
  return block.scopeExit.value.declarations.map((d) => d.name);
}

/** The `BindingId`s of every declaration named `name`, in CFG-visitation order. */
function idsNamed(graph: ControlFlowGraph, name: string): readonly BindingId[] {
  return collectDeclarations(graph)
    .filter((d) => d.name === name)
    .map((d) => d.id);
}

/** The single `BindingId` declared for `name`; fails if there isn't exactly one. */
function idNamed(graph: ControlFlowGraph, name: string): BindingId {
  const ids = idsNamed(graph, name);
  assert(ids.length === 1, `Expected exactly one declaration named ${name}`);
  const id = ids[0];
  assert(id !== undefined);
  return id;
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

  describe("uses/defs (place-level GEN/KILL)", (): void => {
    it("records a use for a variable read in a let initializer", (): void => {
      const graph = mainGraph(`
        fn main(p: i32) {
          let a = p;
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined);
      expect(block.uses.has(idNamed(graph, "p"))).toBe(true);
    });

    it("records a def for a let-declared variable itself", (): void => {
      const graph = mainGraph(`
        fn main() {
          let a = 1;
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined);
      expect(block.defs.has(idNamed(graph, "a"))).toBe(true);
    });

    it("records a reassignment as a def only, never a use, of the overwritten variable", (): void => {
      const graph = mainGraph(`
        fn main(p: i32) {
          let mut n = p;
          n = 2;
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined);
      const p = idNamed(graph, "p");
      const n = idNamed(graph, "n");
      expect(block.uses.has(p)).toBe(true);
      expect(block.uses.has(n)).toBe(false);
      expect(block.defs.has(n)).toBe(true);
    });

    it("records a compound assignment as both a use and a def of the target", (): void => {
      const graph = mainGraph(`
        fn main(mut n: i32) {
          n += 2;
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined);
      const n = idNamed(graph, "n");
      expect(block.uses.has(n)).toBe(true);
      expect(block.defs.has(n)).toBe(true);
    });

    it("does not record a use for a name shadowed and then read within the same block", (): void => {
      const graph = mainGraph(`
        fn main(x: i32) {
          let y = x;
          let x = 2;
          let z = x;
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined);
      const [paramX, shadowX] = idsNamed(graph, "x");
      assert(paramX !== undefined && shadowX !== undefined);
      expect(block.uses.has(paramX)).toBe(true);
      expect(block.uses.has(shadowX)).toBe(false);
      expect(block.defs.has(shadowX)).toBe(true);
    });

    it("records a field access's object as a use of the base binding", (): void => {
      const graph = mainGraph(`
        struct Boxed { value: i32 }
        fn main(b: Boxed) {
          let v = b.value;
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined);
      expect(block.uses.has(idNamed(graph, "b"))).toBe(true);
    });

    it("records a call's arguments as uses", (): void => {
      const graph = mainGraph(`
        fn main(p: i32) {
          print(p);
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined, "Expected a block");
      expect(block.uses.has(idNamed(graph, "p"))).toBe(true);
    });

    it("records a method call's receiver and arguments as uses", (): void => {
      const graph = mainGraph(`
        struct P { v: i32 }
        impl P { fn foo(&self, x: i32) -> i32 { 0 } }
        fn main(p: P, q: i32) {
          let r = p.foo(q);
          print(r);
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined, "Expected a block");
      expect(block.uses.has(idNamed(graph, "p"))).toBe(true);
      expect(block.uses.has(idNamed(graph, "q"))).toBe(true);
    });

    it("records a tuple literal's elements as uses", (): void => {
      const graph = mainGraph(`
        fn main(p: i32) {
          let t = (p, 2);
          print(t);
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined, "Expected a block");
      expect(block.uses.has(idNamed(graph, "p"))).toBe(true);
    });

    it("records an array literal's elements as uses", (): void => {
      const graph = mainGraph(`
        fn main(p: i32) {
          let a = [p, p];
          print(a);
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined, "Expected a block");
      expect(block.uses.has(idNamed(graph, "p"))).toBe(true);
    });

    it("records a range expression's start and end as uses", (): void => {
      const graph = mainGraph(`
        fn main(p: i32, q: i32) {
          let r = p..q;
          print(r);
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined, "Expected a block");
      expect(block.uses.has(idNamed(graph, "p"))).toBe(true);
      expect(block.uses.has(idNamed(graph, "q"))).toBe(true);
    });

    it("records a struct literal's field values as uses", (): void => {
      const graph = mainGraph(`
        struct Wrapper { inner: i32 }
        fn main(p: i32) {
          let w = Wrapper { inner: p };
          print(w);
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined, "Expected a block");
      expect(block.uses.has(idNamed(graph, "p"))).toBe(true);
    });

    it("records the if condition's uses on the forking block, not the then-branch", (): void => {
      const graph = mainGraph(`
        fn main(cond: bool) {
          if cond {
            let a = 1;
          }
          let done = true;
        }
      `);
      const pre = graph.blocks.find((b) => b.id === graph.entry);
      assert(pre !== undefined);
      const [thenId] = pre.successors;
      const thenBlock = graph.blocks.find((b) => b.id === thenId);
      assert(thenBlock !== undefined);
      const cond = idNamed(graph, "cond");
      expect(pre.uses.has(cond)).toBe(true);
      expect(thenBlock.uses.has(cond)).toBe(false);
    });

    it("does not leak a then-branch's shadowed binding into the else-branch's resolution", (): void => {
      const graph = mainGraph(`
        fn main(x: i32) {
          if x == 1 {
            let x = 2;
            let inner = x;
          } else {
            let outer = x;
          }
          let done = true;
        }
      `);
      const pre = graph.blocks.find((b) => b.id === graph.entry);
      assert(pre !== undefined);
      const [thenId, elseId] = pre.successors;
      const thenBlock = graph.blocks.find((b) => b.id === thenId);
      const elseBlock = graph.blocks.find((b) => b.id === elseId);
      assert(thenBlock !== undefined && elseBlock !== undefined);
      // idsNamed scans blocks in CFG order (then-branch before the join
      // block that carries the param's own scopeExit), not source order, so
      // pick the id the condition itself resolved to rather than assuming
      // array position.
      const outerX = idsNamed(graph, "x").find((id) => pre.uses.has(id));
      assert(
        outerX !== undefined,
        "Expected the param x to be used in the condition",
      );
      expect(thenBlock.uses.has(outerX)).toBe(false);
      expect(elseBlock.uses.has(outerX)).toBe(true);
    });

    it("resolves a name inside a nested bare block to its enclosing scope's binding", (): void => {
      const graph = mainGraph(`
        fn main(x: i32) {
          {
            let y = x;
          }
          let done = true;
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined);
      expect(block.uses.has(idNamed(graph, "x"))).toBe(true);
    });

    it("records uses inside a value-position if's confined branches", (): void => {
      const graph = mainGraph(`
        fn main(cond: bool, q: i32) {
          let v = if cond { q } else { 0 };
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined);
      expect(block.uses.has(idNamed(graph, "q"))).toBe(true);
    });

    it("records uses inside a value-position bare block's confined scope", (): void => {
      const graph = mainGraph(`
        fn main(p: i32) {
          let v = { let t = p; t };
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined);
      expect(block.uses.has(idNamed(graph, "p"))).toBe(true);
    });

    it("records a field-target assignment's base object as a use, not a def", (): void => {
      const graph = mainGraph(`
        struct Boxed { value: i32 }
        fn main(mut b: Boxed) {
          b.value = 1;
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined);
      expect(block.uses.has(idNamed(graph, "b"))).toBe(true);
    });

    it("does not leak a match arm's struct-pattern-bound name into an outer binding of the same name", (): void => {
      const graph = mainGraph(`
        struct Point { x: i32, y: i32 }
        fn main() {
          let y = 999;
          let p = Point { x: 1, y: 2 };
          match p {
            Point { x: renamed, y } => { print(renamed); print(y); }
          }
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined, "Expected a block");
      expect(block.uses.has(idNamed(graph, "y"))).toBe(false);
    });

    it("does not leak a match arm's slice-rest-bound name into an outer binding of the same name", (): void => {
      const graph = mainGraph(`
        fn main(arr: [i32; 3]) {
          let tail = 999;
          match arr {
            [first, ..tail] => { print(first); print(tail); }
          }
        }
      `);
      const block = graph.blocks[0];
      assert(block !== undefined, "Expected a block");
      expect(block.uses.has(idNamed(graph, "tail"))).toBe(false);
    });
  });
});

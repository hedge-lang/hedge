import { describe, expect, it } from "vitest";

import { assert } from "../assert.js";
import { tokenize } from "../lexer/lexer.js";
import { isSome } from "../option.js";
import { parse } from "../parser/parser.js";
import { analyze } from "../semantics/analyzer.js";
import type * as Semantics from "../semantics/ast.js";
import type { BasicBlock, ControlFlowGraph } from "./control-flow-graph.js";
import { buildControlFlowGraph } from "./control-flow-graph.js";

function mainGraph(source: string): ControlFlowGraph {
  const { tokens } = tokenize(source);
  const { program, diagnostics } = parse(tokens);
  assert(isSome(program), diagnostics[0]?.message ?? "Parse failed");
  const analysis = analyze(program.value, tokens);
  assert(
    analysis.diagnostics.every((d) => d.severity !== "error"),
    analysis.diagnostics.map((d) => d.message).join("; "),
  );
  const main = analysis.program.items.find(
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

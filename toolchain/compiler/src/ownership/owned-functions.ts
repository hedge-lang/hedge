import type * as Semantics from "../semantics/ast.js";

/**
 * Every `FunctionDef` the ownership passes should walk: the program's
 * top-level functions plus every trait/impl method body, recursing through
 * function and method bodies (a method body may itself declare a nested
 * `impl`). A nested `impl` reached only through an `if`/`match` block rather
 * than a direct body statement is not yet visited - a narrow known gap.
 */
export function collectOwnedFunctions(
  program: Semantics.Program,
): readonly Semantics.FunctionDef[] {
  const functions: Semantics.FunctionDef[] = [];
  const visit = (
    nodes: readonly (Semantics.Item | Semantics.Statement)[],
  ): void => {
    for (const node of nodes) {
      if (node.kind === "Function") {
        functions.push(node);
        visit(node.body.statements);
      } else if (node.kind === "Impl" || node.kind === "Trait") {
        for (const method of node.methodBodies) {
          functions.push(method);
          visit(method.body.statements);
        }
      }
    }
  };
  visit(program.items);
  return functions;
}

/**
 * Every `impl` block in the program, at any nesting depth (top-level, or
 * inside a function/method body's direct statements). Coherence makes a
 * block-local `impl` program-wide, so codegen emits its methods as top-level
 * free functions the same as a top-level `impl`'s. Same `if`/`match`-block
 * gap as {@link collectOwnedFunctions}.
 */
export function collectAllImpls(
  program: Semantics.Program,
): readonly Semantics.ImplDecl[] {
  const impls: Semantics.ImplDecl[] = [];
  const visit = (
    nodes: readonly (Semantics.Item | Semantics.Statement)[],
  ): void => {
    for (const node of nodes) {
      if (node.kind === "Function") {
        visit(node.body.statements);
      } else if (node.kind === "Impl") {
        impls.push(node);
        for (const method of node.methodBodies) visit(method.body.statements);
      } else if (node.kind === "Trait") {
        for (const method of node.methodBodies) visit(method.body.statements);
      }
    }
  };
  visit(program.items);
  return impls;
}

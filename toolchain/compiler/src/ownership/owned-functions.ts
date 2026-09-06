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

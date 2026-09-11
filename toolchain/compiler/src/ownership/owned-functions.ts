import { isSome } from "../option.js";
import type * as Semantics from "../semantics/ast.js";

type ItemNode =
  Semantics.FunctionDef | Semantics.ImplDecl | Semantics.TraitDecl;

/**
 * Calls `onNode` for every `Function` (top-level, method body, or nested),
 * `Impl`, and `Trait` node anywhere in the program - in a function/method
 * body including its trailing expression, or nested inside an `if`/`match`
 * arm or a value-position block. Document order, with a method body visited
 * right before its own body is descended. Coherence makes even a block-local
 * `impl` program-wide, so its methods must emit and be ownership-checked the
 * same as a top-level one's.
 */
function eachItemNode(
  program: Semantics.Program,
  onNode: (node: ItemNode) => void,
): void {
  const visitBlock = (block: Semantics.Block): void => {
    visitStatements(block.statements);
    if (isSome(block.trailingExpression)) {
      visitExpression(block.trailingExpression.value);
    }
  };
  const visitExpression = (expr: Semantics.Expression): void => {
    switch (expr.kind) {
      case "Block":
        visitBlock(expr);
        break;
      case "IfExpression":
        visitBlock(expr.thenBranch);
        if (isSome(expr.elseBranch)) {
          const elseBranch = expr.elseBranch.value;
          if (elseBranch.kind === "IfExpression") {
            visitExpression(elseBranch);
          } else {
            visitBlock(elseBranch);
          }
        }
        break;
      case "MatchExpression":
        for (const arm of expr.arms) visitExpression(arm.body);
        break;
      default:
        break;
    }
  };
  const visitStatements = (
    nodes: readonly (Semantics.Item | Semantics.Statement)[],
  ): void => {
    for (const node of nodes) {
      if (node.kind === "Function") {
        onNode(node);
        visitBlock(node.body);
      } else if (node.kind === "Impl" || node.kind === "Trait") {
        onNode(node);
        for (const method of node.methodBodies) {
          onNode(method);
          visitBlock(method.body);
        }
      } else if (node.kind === "ExpressionStatement") {
        visitExpression(node.expression);
      } else if (node.kind === "LetStatement" && isSome(node.initializer)) {
        visitExpression(node.initializer.value);
      }
    }
  };
  visitStatements(program.items);
}

/**
 * Every `FunctionDef` the ownership passes should walk: the program's
 * top-level functions plus every trait/impl method body, at any nesting
 * depth (a method body may itself declare a nested `impl`).
 */
export function collectOwnedFunctions(
  program: Semantics.Program,
): readonly Semantics.FunctionDef[] {
  const functions: Semantics.FunctionDef[] = [];
  eachItemNode(program, (node) => {
    if (node.kind === "Function") functions.push(node);
  });
  return functions;
}

/**
 * Every `impl` and `trait` in the program with methods codegen must emit
 * (an impl's provided methods, a trait's default bodies), at any nesting
 * depth.
 */
export function collectMethodOwners(
  program: Semantics.Program,
): readonly (Semantics.ImplDecl | Semantics.TraitDecl)[] {
  const owners: (Semantics.ImplDecl | Semantics.TraitDecl)[] = [];
  eachItemNode(program, (node) => {
    if (node.kind !== "Function") owners.push(node);
  });
  return owners;
}

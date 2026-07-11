/**
 * @module
 *
 * Builds a trivial control-flow graph over one function body: a flat list of
 * BasicBlocks connected by successor edges, forking at statement-position
 * `if`/`else` and splitting at nested bare `{ }` statements so that every
 * block closes at most one lexical scope.
 *
 * This is still a single forward walk with no back-edges and no fixpoint
 * iteration until loops are implemented.
 */

import { assertNever } from "../assert.js";
import { none, some, type Option } from "../option.js";
import type * as Semantics from "../semantics/ast.js";

/**
 * A binding's declaration site. Identified by its declaring Identifier's
 * tokenId, so shadowing (a new `let` reusing a name) always gets a distinct
 * id even though the source name repeats.
 */
export type BindingId = number;

export interface Declaration {
  readonly id: BindingId;
  readonly name: string;
  readonly type: Semantics.Type;
  readonly tokenId: number;
  readonly mutable: boolean;
}

interface ScopeExit {
  /**
   * The tokenId of the `Semantics.Block` whose lexical scope closes here.
   */
  readonly scopeTokenId: number;
  /**
   * All `let` declarations owned by that scope, in declaration order.
   */
  readonly declarations: readonly Declaration[];
}

export interface BasicBlock {
  readonly id: number;
  readonly statements: readonly Semantics.Statement[];
  /**
   * Set only on the block where a `Semantics.Block`'s own trailing
   * value expression is evaluated.
   */
  readonly trailingExpression: Option<Semantics.Expression>;
  /**
   * `let`-bindings introduced directly by this block's own statements.
   */
  readonly declarations: readonly Declaration[];
  readonly scopeExit: Option<ScopeExit>;
  /**
   * Successor block ids: empty at function exit, one for fallthrough,
   * two `[then, else-or-join]` at a fork.
   */
  readonly successors: readonly number[];
  /**
   * Set only on a forking block (`successors.length === 2`), to the `if`
   * expression's own condition. Without this, a consumer walking only
   * `statements`/`trailingExpression` to find uses or moves would silently
   * miss anything evaluated in the condition itself (e.g. `if consume(x)`)
   * — the condition is evaluated as part of this block's own control flow,
   * but isn't a statement or a trailing expression, so it has nowhere else
   * to live on the block.
   */
  readonly forkCondition: Option<Semantics.Expression>;
}

export interface ControlFlowGraph {
  readonly entry: number;
  readonly blocks: readonly BasicBlock[];
}

interface MutableBlock {
  id: number;
  statements: Semantics.Statement[];
  trailingExpression: Option<Semantics.Expression>;
  declarations: Declaration[];
  scopeExit: Option<ScopeExit>;
  successors: number[];
  forkCondition: Option<Semantics.Expression>;
}

function blockAt(blocks: MutableBlock[], id: number): MutableBlock {
  const block = blocks[id];
  if (block === undefined) {
    throw new Error(`Unknown block ${id}`);
  }
  return block;
}

function pushBlock(blocks: MutableBlock[]): number {
  const id = blocks.length;
  blocks.push({
    id,
    statements: [],
    trailingExpression: none(),
    declarations: [],
    scopeExit: none(),
    successors: [],
    forkCondition: none(),
  });
  return id;
}

/**
 * `none()` for a wildcard `_` pattern because it binds no name, so
 * it is never move-tracked or drop-annotated.
 */
export function declarationOf(
  pattern: Semantics.BindingPattern,
  mutable: boolean,
): Option<Declaration> {
  if (pattern.name.text === "_") {
    return none();
  }
  return some({
    id: pattern.name.tokenId,
    name: pattern.name.text,
    type: pattern.name.type,
    tokenId: pattern.name.tokenId,
    mutable,
  });
}

/**
 * Function parameters are treated as declared before the body, so they seed
 * the root scope's declarations list (see `buildControlFlowGraph`) — the
 * body's own locals then drop before them, matching real drop order.
 */
function paramDeclarations(params: readonly Semantics.Param[]): Declaration[] {
  const declarations: Declaration[] = [];
  for (const param of params) {
    const declaration = declarationOf(param.pattern, param.mutable);
    if (declaration.kind === "Some") {
      declarations.push(declaration.value);
    }
  }
  return declarations;
}

/**
 * `let` never forks. It only appends to the current block and,
 * unless it's a wildcard, records itself as a declaration owned
 * by the enclosing scope.
 */
function lowerLet(
  statement: Semantics.LetStatement,
  blocks: MutableBlock[],
  currentId: number,
  declarations: Declaration[],
): void {
  const current = blockAt(blocks, currentId);
  current.statements.push(statement);
  const declaration = declarationOf(statement.pattern, statement.mutable);
  if (declaration.kind === "Some") {
    current.declarations.push(declaration.value);
    declarations.push(declaration.value);
  }
}

/**
 * Lower a nested bare-block statement (`{ ... }` with no `if`). It doesn't
 * fork, but its lexical scope still closes independently of the enclosing
 * one, and a block can carry only one `scopeExit` — so this shares the
 * current block chain for the inner block's own content, then splits into a
 * fresh, otherwise-empty continuation block for whatever follows in the
 * outer scope.
 */
function lowerNestedBlock(
  scope: Semantics.Block,
  blocks: MutableBlock[],
  currentId: number,
): number {
  const scopeExitId = lowerScope(scope, blocks, currentId);
  const nextId = pushBlock(blocks);
  blockAt(blocks, scopeExitId).successors.push(nextId);
  return nextId;
}

/**
 * Routes an `ExpressionStatement` to a fork, a nested-scope split,
 * or a plain append, by its expression's kind.
 */
function lowerExpressionStatement(
  statement: Semantics.ExpressionStatement,
  blocks: MutableBlock[],
  currentId: number,
): number {
  const { expression } = statement;
  if (expression.kind === "IfExpression") {
    return lowerIf(expression, blocks, currentId);
  }
  if (expression.kind === "Block") {
    return lowerNestedBlock(expression, blocks, currentId);
  }
  blockAt(blocks, currentId).statements.push(statement);
  return currentId;
}

/**
 * Lower a statement list onto the block chain starting at `startId`, forking
 * at statement-position `if` expressions and splitting at nested bare-block
 * statements (so each block carries at most one `scopeExit`). Value-position
 * `if`/`Block` expressions (inside a `let` initializer, call argument, etc.)
 * are not lowered into the CFG structure — only statement-position control
 * flow forks the graph; a value-position `if`/`Block` stays an ordinary
 * nested expression on whichever statement contains it.
 */
function lowerStatements(
  statements: readonly Semantics.Statement[],
  blocks: MutableBlock[],
  startId: number,
  declarations: Declaration[],
): number {
  let currentId = startId;
  for (const statement of statements) {
    switch (statement.kind) {
      case "LetStatement":
        lowerLet(statement, blocks, currentId, declarations);
        break;
      case "ExpressionStatement":
        currentId = lowerExpressionStatement(statement, blocks, currentId);
        break;
      case "Function":
      case "Struct":
        // Local item declarations have no CFG effect in Slice 1 (they don't
        // use outer bindings — see the equivalent TODO in ownership/borrowck.ts).
        blockAt(blocks, currentId).statements.push(statement);
        break;
      default:
        assertNever(
          statement,
          `Unexpected statement: ${JSON.stringify(statement)}`,
        );
    }
  }
  return currentId;
}

/**
 * Lower one lexical scope (a `Semantics.Block`) onto the chain starting at
 * `currentId`, and close its own scope by attaching a `scopeExit` to the
 * final block in that chain. Returns that final block's id.
 *
 * `declarations` accumulates across every block this scope's statements land
 * in, not just the final one: an `if` mid-scope forks the chain, so a
 * function body like `let a; if c {..} else {..} let b;` splits `a` and `b`
 * across two different blocks even though both belong to the same
 * `Semantics.Block`. The final `scopeExit` still lists both, in declaration
 * order, because it's this whole call's `declarations` array, not the exit
 * block's own local `declarations` field.
 */
function lowerScope(
  scope: Semantics.Block,
  blocks: MutableBlock[],
  currentId: number,
  initialDeclarations: readonly Declaration[] = [],
): number {
  const declarations: Declaration[] = [...initialDeclarations];
  const exitId = lowerStatements(
    scope.statements,
    blocks,
    currentId,
    declarations,
  );
  const exitBlock = blockAt(blocks, exitId);
  if (exitBlock.trailingExpression.kind === "None") {
    exitBlock.trailingExpression = scope.trailingExpression;
  }
  exitBlock.scopeExit = some({
    scopeTokenId: scope.tokenId,
    declarations: [...declarations],
  });
  return exitId;
}

/**
 * Lower an `if`/`else` fork starting at `preId`, returning the join block's
 * id. An `else if` is a nested `IfExpression` in `elseBranch`, so it's lowered
 * by recursing into `lowerIf` with the `else` block as its own `preId` — the
 * chain of `else if`s becomes a chain of forks, not a special case. When
 * there is no `else` at all, the false path has nowhere to go but straight to
 * `join`, so `preId` itself gets a direct edge there alongside the edge to
 * `then` — that's the "3 blocks, pre.successors = [then, join]" shape.
 */
function lowerIf(
  expression: Semantics.IfExpression,
  blocks: MutableBlock[],
  preId: number,
): number {
  const pre = blockAt(blocks, preId);
  pre.forkCondition = some(expression.condition);

  const thenId = pushBlock(blocks);
  pre.successors.push(thenId);
  const thenExitId = lowerScope(expression.thenBranch, blocks, thenId);

  let elseExitId: number | undefined;
  if (expression.elseBranch.kind === "Some") {
    const elseId = pushBlock(blocks);
    pre.successors.push(elseId);
    const elseBranch = expression.elseBranch.value;
    elseExitId =
      elseBranch.kind === "Block"
        ? lowerScope(elseBranch, blocks, elseId)
        : lowerIf(elseBranch, blocks, elseId);
  }

  const joinId = pushBlock(blocks);
  blockAt(blocks, thenExitId).successors.push(joinId);
  if (elseExitId !== undefined) {
    blockAt(blocks, elseExitId).successors.push(joinId);
  } else {
    pre.successors.push(joinId);
  }
  return joinId;
}

/**
 * Build a trivial control-flow graph over a function body. Slice 1 has no
 * loops, so a single forward walk with fork-at-`if`/join-after-`if` is
 * sufficient — no fixpoint iteration is needed.
 */
export function buildControlFlowGraph(
  fn: Semantics.FunctionDecl,
): ControlFlowGraph {
  const blocks: MutableBlock[] = [];
  const entry = pushBlock(blocks);
  lowerScope(fn.body, blocks, entry, paramDeclarations(fn.params));
  return { entry, blocks };
}

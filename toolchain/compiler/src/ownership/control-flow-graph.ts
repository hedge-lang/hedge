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
 *
 * The same walk also resolves every `PathExpression` to a `BindingId` and
 * records each block's own place-level GEN/KILL sets (`uses`/`defs`) - one
 * combined pass rather than a second independent tree-walk, so block ids and
 * use/def sets can't drift out of sync.
 */

import { assertNever } from "../assert.js";
import { isSome, none, some, type Option } from "../option.js";
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
  /** This block's GEN set for the backward liveness dataflow in `liveness.ts` (see `recordUse`). */
  readonly uses: ReadonlySet<BindingId>;
  /** This block's KILL set - includes a `let`'s own declaration, not only reassignment (see `recordDef`). */
  readonly defs: ReadonlySet<BindingId>;
}

export interface ControlFlowGraph {
  readonly entry: number;
  readonly blocks: readonly BasicBlock[];
}

/**
 * Every `Declaration` reachable anywhere in the graph, params included, for
 * resolving a `BindingId` back to a source-level name (e.g. for a debug
 * dump). Reads only `scopeExit.declarations` - also scanning a block's own
 * `.declarations` would double-count.
 */
export function collectDeclarations(
  graph: ControlFlowGraph,
): readonly Declaration[] {
  return graph.blocks.flatMap((block) =>
    isSome(block.scopeExit) ? block.scopeExit.value.declarations : [],
  );
}

interface MutableBlock {
  id: number;
  statements: Semantics.Statement[];
  trailingExpression: Option<Semantics.Expression>;
  declarations: Declaration[];
  scopeExit: Option<ScopeExit>;
  successors: number[];
  forkCondition: Option<Semantics.Expression>;
  uses: Set<BindingId>;
  defs: Set<BindingId>;
}

/** Lexical scope stack for resolving a `PathExpression` to a `BindingId`; innermost frame wins (matches move-check.ts's `resolve`). */
type ScopeStack = Map<string, BindingId>[];

function resolveName(
  scopeStack: ScopeStack,
  name: string,
): BindingId | undefined {
  for (let i = scopeStack.length - 1; i >= 0; i -= 1) {
    const id = scopeStack[i]?.get(name);
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

function registerScopeName(
  scopeStack: ScopeStack,
  name: string,
  id: BindingId,
): void {
  const frame = scopeStack[scopeStack.length - 1];
  if (frame === undefined) {
    throw new Error("No active scope frame");
  }
  frame.set(name, id);
}

/**
 * There's no module system yet, so a multi-segment path never resolves to a
 * local binding anyway (mirrors move-check.ts's `singleSegmentName`).
 */
function resolvePathExpression(
  pathExpr: Semantics.PathExpression,
  scopeStack: ScopeStack,
): BindingId | undefined {
  const { segments } = pathExpr.path;
  const name = segments.length === 1 ? segments[0] : undefined;
  return name === undefined ? undefined : resolveName(scopeStack, name);
}

/** Standard forward GEN/KILL: a read only contributes to `uses` (GEN) if not already defined (KILL) earlier in this block. */
function recordUse(block: MutableBlock, id: BindingId): void {
  if (!block.defs.has(id)) {
    block.uses.add(id);
  }
}

function recordDef(block: MutableBlock, id: BindingId): void {
  block.defs.add(id);
}

/**
 * Record every place-use reachable from `expression` onto `target`, without
 * creating any new BasicBlock. A value-position `if`/`Block` is handled here
 * too, via `recordConfinedScope`.
 */
// eslint-disable-next-line complexity -- routing function, mirrors move-check.ts's walkExpression
function recordExpressionUses(
  target: MutableBlock,
  scopeStack: ScopeStack,
  expression: Semantics.Expression,
): void {
  switch (expression.kind) {
    case "PathExpression": {
      const id = resolvePathExpression(expression, scopeStack);
      if (id !== undefined) {
        recordUse(target, id);
      }
      return;
    }
    case "CallExpression":
      recordExpressionUses(target, scopeStack, expression.callee);
      for (const argument of expression.arguments) {
        recordExpressionUses(target, scopeStack, argument);
      }
      return;
    case "ReferenceExpression":
    case "DereferenceExpression":
      recordExpressionUses(target, scopeStack, expression.operand);
      return;
    case "BinaryExpression":
      recordExpressionUses(target, scopeStack, expression.left);
      recordExpressionUses(target, scopeStack, expression.right);
      return;
    case "UnaryExpression":
      recordExpressionUses(target, scopeStack, expression.operand);
      return;
    case "AssignExpression":
      // A bare-path lhs is a def only (mirrors move-check.ts's `reassign`);
      // anything else (e.g. a field target) is an ordinary read.
      recordExpressionUses(target, scopeStack, expression.rhs);
      if (expression.lhs.kind === "PathExpression") {
        const id = resolvePathExpression(expression.lhs, scopeStack);
        if (id !== undefined) {
          recordDef(target, id);
        }
      } else {
        recordExpressionUses(target, scopeStack, expression.lhs);
      }
      return;
    case "CompoundAssignExpression":
      // `x += expr` reads then writes `x`; the use must land before the def.
      recordExpressionUses(target, scopeStack, expression.rhs);
      if (expression.lhs.kind === "PathExpression") {
        const id = resolvePathExpression(expression.lhs, scopeStack);
        if (id !== undefined) {
          recordUse(target, id);
          recordDef(target, id);
        }
      } else {
        recordExpressionUses(target, scopeStack, expression.lhs);
      }
      return;
    case "FieldAccessExpression":
      // The object is a use, not a def - Slice 1/2 don't track field-level
      // places (mirrors move-check.ts).
      recordExpressionUses(target, scopeStack, expression.object);
      return;
    case "MethodCallExpression":
      recordExpressionUses(target, scopeStack, expression.receiver);
      for (const argument of expression.arguments) {
        recordExpressionUses(target, scopeStack, argument);
      }
      return;
    case "IndexExpression":
      recordExpressionUses(target, scopeStack, expression.object);
      recordExpressionUses(target, scopeStack, expression.index);
      return;
    case "TupleExpression":
      for (const element of expression.elements) {
        recordExpressionUses(target, scopeStack, element);
      }
      return;
    case "ArrayExpression":
      for (const element of expression.elements) {
        recordExpressionUses(target, scopeStack, element);
      }
      return;
    case "ArrayRepeatExpression":
      recordExpressionUses(target, scopeStack, expression.value);
      return;
    case "RangeExpression":
      if (isSome(expression.start)) {
        recordExpressionUses(target, scopeStack, expression.start.value);
      }
      if (isSome(expression.end)) {
        recordExpressionUses(target, scopeStack, expression.end.value);
      }
      return;
    case "StructExpression":
      for (const field of expression.fields) {
        if (isSome(field.value)) {
          recordExpressionUses(target, scopeStack, field.value.value);
        }
      }
      if (isSome(expression.base)) {
        recordExpressionUses(target, scopeStack, expression.base.value);
      }
      return;
    case "IfExpression":
      recordExpressionUses(target, scopeStack, expression.condition);
      recordConfinedScope(target, scopeStack, expression.thenBranch);
      if (isSome(expression.elseBranch)) {
        const elseBranch = expression.elseBranch.value;
        if (elseBranch.kind === "Block") {
          recordConfinedScope(target, scopeStack, elseBranch);
        } else {
          recordExpressionUses(target, scopeStack, elseBranch);
        }
      }
      return;
    case "Block":
      recordConfinedScope(target, scopeStack, expression);
      return;
    case "StringLiteral":
    case "IntLiteral":
    case "FloatLiteral":
    case "BoolLiteral":
    case "CharLiteral":
      return;
    default:
      assertNever(
        expression,
        `Unexpected expression: ${JSON.stringify(expression)}`,
      );
  }
}

/**
 * Confined counterpart of `lowerStatements`, for a value-position scope that
 * never forks the graph. A new `Semantics.Statement` kind needs a case here
 * too, not just in `lowerStatements` - the two dispatches don't share code
 * since one may fork the block chain and the other never does.
 */
function recordConfinedStatement(
  target: MutableBlock,
  scopeStack: ScopeStack,
  statement: Semantics.Statement,
): void {
  switch (statement.kind) {
    case "LetStatement": {
      if (isSome(statement.initializer)) {
        recordExpressionUses(target, scopeStack, statement.initializer.value);
      }
      const declaration = declarationOf(statement.pattern, statement.mutable);
      if (declaration.kind === "Some") {
        recordDef(target, declaration.value.id);
        registerScopeName(
          scopeStack,
          declaration.value.name,
          declaration.value.id,
        );
      }
      return;
    }
    case "ExpressionStatement":
      recordExpressionUses(target, scopeStack, statement.expression);
      return;
    case "Function":
    case "Struct":
    case "Const":
    case "Static":
      // Local item declarations have no CFG effect in Slice 1 (see the
      // equivalent note in lowerStatements below).
      return;
    default:
      assertNever(
        statement,
        `Unexpected statement: ${JSON.stringify(statement)}`,
      );
  }
}

/**
 * Confined counterpart of `lowerScope`, for a value-position scope that
 * never forks the graph. See {@link recordConfinedStatement}.
 */
function recordConfinedScope(
  target: MutableBlock,
  scopeStack: ScopeStack,
  scope: Semantics.Block,
): void {
  scopeStack.push(new Map());
  for (const statement of scope.statements) {
    recordConfinedStatement(target, scopeStack, statement);
  }
  if (isSome(scope.trailingExpression)) {
    recordExpressionUses(target, scopeStack, scope.trailingExpression.value);
  }
  scopeStack.pop();
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
    uses: new Set(),
    defs: new Set(),
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
  scopeStack: ScopeStack,
): void {
  const current = blockAt(blocks, currentId);
  current.statements.push(statement);
  if (isSome(statement.initializer)) {
    recordExpressionUses(current, scopeStack, statement.initializer.value);
  }
  const declaration = declarationOf(statement.pattern, statement.mutable);
  if (declaration.kind === "Some") {
    current.declarations.push(declaration.value);
    declarations.push(declaration.value);
    recordDef(current, declaration.value.id);
    registerScopeName(scopeStack, declaration.value.name, declaration.value.id);
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
  scopeStack: ScopeStack,
): number {
  const scopeExitId = lowerScope(scope, blocks, currentId, scopeStack);
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
  scopeStack: ScopeStack,
): number {
  const { expression } = statement;
  if (expression.kind === "IfExpression") {
    return lowerIf(expression, blocks, currentId, scopeStack);
  }
  if (expression.kind === "Block") {
    return lowerNestedBlock(expression, blocks, currentId, scopeStack);
  }
  const current = blockAt(blocks, currentId);
  recordExpressionUses(current, scopeStack, expression);
  current.statements.push(statement);
  return currentId;
}

/**
 * Lower a statement list onto the block chain starting at `startId`, forking
 * at statement-position `if` expressions and splitting at nested bare-block
 * statements (so each block carries at most one `scopeExit`). Value-position
 * `if`/`Block` expressions (inside a `let` initializer, call argument, etc.)
 * are not lowered into the CFG structure — only statement-position control
 * flow forks the graph; a value-position `if`/`Block` stays an ordinary
 * nested expression on whichever statement contains it, handled by
 * `recordConfinedStatement` instead. A new `Semantics.Statement` kind needs a
 * case in both places.
 */
function lowerStatements(
  statements: readonly Semantics.Statement[],
  blocks: MutableBlock[],
  startId: number,
  declarations: Declaration[],
  scopeStack: ScopeStack,
): number {
  let currentId = startId;
  for (const statement of statements) {
    switch (statement.kind) {
      case "LetStatement":
        lowerLet(statement, blocks, currentId, declarations, scopeStack);
        break;
      case "ExpressionStatement":
        currentId = lowerExpressionStatement(
          statement,
          blocks,
          currentId,
          scopeStack,
        );
        break;
      case "Function":
      case "Struct":
      case "Const":
      case "Static":
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
  scopeStack: ScopeStack,
  initialDeclarations: readonly Declaration[] = [],
  pushFrame: boolean = true,
): number {
  if (pushFrame) {
    scopeStack.push(new Map());
  }
  const declarations: Declaration[] = [...initialDeclarations];
  const exitId = lowerStatements(
    scope.statements,
    blocks,
    currentId,
    declarations,
    scopeStack,
  );
  const exitBlock = blockAt(blocks, exitId);
  if (exitBlock.trailingExpression.kind === "None") {
    exitBlock.trailingExpression = scope.trailingExpression;
    if (isSome(scope.trailingExpression)) {
      recordExpressionUses(
        exitBlock,
        scopeStack,
        scope.trailingExpression.value,
      );
    }
  }
  exitBlock.scopeExit = some({
    scopeTokenId: scope.tokenId,
    declarations: [...declarations],
  });
  if (pushFrame) {
    scopeStack.pop();
  }
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
  scopeStack: ScopeStack,
): number {
  const pre = blockAt(blocks, preId);
  pre.forkCondition = some(expression.condition);
  recordExpressionUses(pre, scopeStack, expression.condition);

  const thenId = pushBlock(blocks);
  pre.successors.push(thenId);
  const thenExitId = lowerScope(
    expression.thenBranch,
    blocks,
    thenId,
    scopeStack,
  );

  let elseExitId: number | undefined;
  if (expression.elseBranch.kind === "Some") {
    const elseId = pushBlock(blocks);
    pre.successors.push(elseId);
    const elseBranch = expression.elseBranch.value;
    elseExitId =
      elseBranch.kind === "Block"
        ? lowerScope(elseBranch, blocks, elseId, scopeStack)
        : lowerIf(elseBranch, blocks, elseId, scopeStack);
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
  const scopeStack: ScopeStack = [new Map<string, BindingId>()];
  const paramDecls = paramDeclarations(fn.params);
  for (const declaration of paramDecls) {
    registerScopeName(scopeStack, declaration.name, declaration.id);
  }
  lowerScope(fn.body, blocks, entry, scopeStack, paramDecls, false);
  return { entry, blocks };
}

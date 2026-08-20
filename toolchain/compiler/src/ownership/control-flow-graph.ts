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
   * - the condition is evaluated as part of this block's own control flow,
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

/** Uses in a call-like expression's callee/receiver and its arguments - shared by `CallExpression` and `MethodCallExpression`. */
function recordCallLikeUses(
  target: MutableBlock,
  scopeStack: ScopeStack,
  callee: Semantics.Expression,
  args: readonly Semantics.Expression[],
): void {
  recordExpressionUses(target, scopeStack, callee);
  for (const argument of args) {
    recordExpressionUses(target, scopeStack, argument);
  }
}

function recordAssignExpressionUses(
  target: MutableBlock,
  scopeStack: ScopeStack,
  expression: Semantics.AssignExpression,
): void {
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
}

function recordCompoundAssignExpressionUses(
  target: MutableBlock,
  scopeStack: ScopeStack,
  expression: Semantics.CompoundAssignExpression,
): void {
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
}

function recordRangeExpressionUses(
  target: MutableBlock,
  scopeStack: ScopeStack,
  expression: Semantics.RangeExpression,
): void {
  if (isSome(expression.start)) {
    recordExpressionUses(target, scopeStack, expression.start.value);
  }
  if (isSome(expression.end)) {
    recordExpressionUses(target, scopeStack, expression.end.value);
  }
}

function recordStructExpressionUses(
  target: MutableBlock,
  scopeStack: ScopeStack,
  expression: Semantics.StructExpression,
): void {
  for (const field of expression.fields) {
    if (isSome(field.value)) {
      recordExpressionUses(target, scopeStack, field.value.value);
    }
  }
  if (isSome(expression.base)) {
    recordExpressionUses(target, scopeStack, expression.base.value);
  }
}

function recordIfExpressionUses(
  target: MutableBlock,
  scopeStack: ScopeStack,
  expression: Semantics.IfExpression,
): void {
  recordExpressionUses(target, scopeStack, expression.condition);
  if (expression.condition.kind === "LetExpression") {
    scopeStack.push(new Map());
    registerPatternBindings(scopeStack, expression.condition.pattern);
    recordConfinedScope(target, scopeStack, expression.thenBranch);
    scopeStack.pop();
  } else {
    recordConfinedScope(target, scopeStack, expression.thenBranch);
  }
  if (isSome(expression.elseBranch)) {
    const elseBranch = expression.elseBranch.value;
    if (elseBranch.kind === "Block") {
      recordConfinedScope(target, scopeStack, elseBranch);
    } else {
      recordExpressionUses(target, scopeStack, elseBranch);
    }
  }
}

function recordMatchExpressionUses(
  target: MutableBlock,
  scopeStack: ScopeStack,
  expression: Semantics.MatchExpression,
): void {
  recordExpressionUses(target, scopeStack, expression.scrutinee);
  for (const arm of expression.arms) {
    scopeStack.push(new Map());
    registerPatternBindings(scopeStack, arm.pattern);
    if (isSome(arm.guard)) {
      recordExpressionUses(target, scopeStack, arm.guard.value);
    }
    recordExpressionUses(target, scopeStack, arm.body);
    scopeStack.pop();
  }
}

/**
 * Record every place-use reachable from `expression` onto `target`, without
 * creating any new BasicBlock. A value-position `if`/`Block` is handled here
 * too, via `recordConfinedScope`.
 */
// eslint-disable-next-line complexity -- routing function
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
      recordCallLikeUses(
        target,
        scopeStack,
        expression.callee,
        expression.arguments,
      );
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
      recordAssignExpressionUses(target, scopeStack, expression);
      return;
    case "CompoundAssignExpression":
      recordCompoundAssignExpressionUses(target, scopeStack, expression);
      return;
    case "FieldAccessExpression":
      // The object is a use, not a def - Slice 1/2 don't track field-level
      // places (mirrors move-check.ts).
      recordExpressionUses(target, scopeStack, expression.object);
      return;
    case "MethodCallExpression":
      recordCallLikeUses(
        target,
        scopeStack,
        expression.receiver,
        expression.arguments,
      );
      return;
    case "IndexExpression":
      recordExpressionUses(target, scopeStack, expression.object);
      recordExpressionUses(target, scopeStack, expression.index);
      return;
    case "TupleExpression":
    case "ArrayExpression":
      for (const element of expression.elements) {
        recordExpressionUses(target, scopeStack, element);
      }
      return;
    case "ArrayRepeatExpression":
      recordExpressionUses(target, scopeStack, expression.value);
      return;
    case "RangeExpression":
      recordRangeExpressionUses(target, scopeStack, expression);
      return;
    case "StructExpression":
      recordStructExpressionUses(target, scopeStack, expression);
      return;
    case "IfExpression":
      recordIfExpressionUses(target, scopeStack, expression);
      return;
    case "LetExpression":
      // Only the scrutinee's uses are recorded here - the pattern's names
      // aren't in scope until IfExpression pushes a frame for thenBranch.
      recordExpressionUses(target, scopeStack, expression.scrutinee);
      return;
    case "MatchExpression":
      recordMatchExpressionUses(target, scopeStack, expression);
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
 * Registers every name a match-arm pattern binds into the current
 * (innermost) `scopeStack` frame, so a guard/body reference to a
 * pattern-bound name resolves to that fresh binding rather than falling
 * through to an outer binding of the same name (see `resolvePathExpression`).
 * Mirrors `declarationOf` below, generalized to the richer
 * `Semantics.Pattern` union - a `let`/`Param`'s `BindingPattern` binds at
 * most one name, so that helper only ever needs one.
 * `SlicePattern` is real (against a fixed-length array
 * scrutinee); `TuplePattern` still isn't (no real tuple value type exists
 * yet) - `analyzer.ts`'s `analyzePattern` always substitutes a
 * `WildcardPattern` for it (see `analyzePatternGuardrail`), so that one case
 * alone stays unreached.
 */
function registerStructPatternBindings(
  scopeStack: ScopeStack,
  pattern: Semantics.StructPattern,
): void {
  for (const field of pattern.fields) {
    if (isSome(field.pattern)) {
      registerPatternBindings(scopeStack, field.pattern.value);
    } else {
      registerScopeName(scopeStack, field.name.text, field.name.tokenId);
    }
  }
}

function registerSlicePatternBindings(
  scopeStack: ScopeStack,
  pattern: Semantics.SlicePattern,
): void {
  for (const element of pattern.elements) {
    if (element.kind === "RestPattern") {
      if (isSome(element.name)) {
        registerScopeName(
          scopeStack,
          element.name.value.text,
          element.name.value.tokenId,
        );
      }
    } else {
      registerPatternBindings(scopeStack, element);
    }
  }
}

// eslint-disable-next-line complexity -- Routing function over the full Pattern union
function registerPatternBindings(
  scopeStack: ScopeStack,
  pattern: Semantics.Pattern,
): void {
  switch (pattern.kind) {
    case "WildcardPattern":
    case "LiteralPattern":
    case "RangePattern":
    case "PathPattern":
      return;
    case "BindingPattern":
      if (pattern.name.text !== "_") {
        registerScopeName(scopeStack, pattern.name.text, pattern.name.tokenId);
      }
      if (isSome(pattern.subpattern)) {
        registerPatternBindings(scopeStack, pattern.subpattern.value);
      }
      return;
    case "OrPattern":
      for (const alt of pattern.alternatives) {
        registerPatternBindings(scopeStack, alt);
      }
      return;
    case "TuplePattern":
    case "TupleStructPattern":
      for (const element of pattern.elements) {
        registerPatternBindings(scopeStack, element);
      }
      return;
    case "StructPattern":
      registerStructPatternBindings(scopeStack, pattern);
      return;
    case "SlicePattern":
      registerSlicePatternBindings(scopeStack, pattern);
      return;
    default:
      assertNever(pattern, `Unexpected pattern: ${JSON.stringify(pattern)}`);
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
      for (const declaration of declarationsOf(statement.pattern)) {
        recordDef(target, declaration.id);
        registerScopeName(scopeStack, declaration.name, declaration.id);
      }
      return;
    }
    case "ExpressionStatement":
      recordExpressionUses(target, scopeStack, statement.expression);
      return;
    case "Function":
    case "FunctionSignature":
    case "Struct":
    case "Enum":
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
 * Every name a `let`/`Param` pattern binds, each with its own place-level
 * `Declaration` - move/drop tracking needs one per binding, not one for the
 * whole pattern. Generalizes the old single-binding `declarationOf` to the
 * same `Semantics.Pattern` union `registerPatternBindings` above already
 * walks for match arms; a `_` name (wildcard or an explicit `_`-named
 * binding/field) contributes no declaration, since it is never move-tracked
 * or drop-annotated. Each `BindingPattern`'s own `mutable` flag is
 * authoritative for that one binding - there's no single pattern-wide
 * `mutable` anymore, since a destructuring pattern can mix
 * mutable and immutable bindings in one `let`/parameter
 * (`Point { x: mut x, y }`). A struct pattern's shorthand field binding
 * (`Point { x }`, no explicit sub-pattern) is always immutable - the
 * grammar has no sigil position for shorthand fields, only the explicit
 * `x: mut x` form can carry one (see `parser/pattern.ts`).
 * `SlicePattern` is real (against a fixed-length array
 * scrutinee); `TuplePattern` still isn't (no real tuple value type exists
 * yet) - `analyzer.ts`'s `analyzePattern` always substitutes a
 * `WildcardPattern` for it (see `analyzePatternGuardrail`), so that one case
 * alone stays unreached, mirroring `registerPatternBindings`'s own note.
 */
// eslint-disable-next-line complexity -- Routing function over the full Pattern union
export function declarationsOf(
  pattern: Semantics.Pattern,
): readonly Declaration[] {
  switch (pattern.kind) {
    case "WildcardPattern":
    case "LiteralPattern":
    case "RangePattern":
    case "PathPattern":
      return [];
    case "BindingPattern": {
      // A `byRef` binding's own `mutable` sigil (`&mut name`) means "this is
      // a mutable *borrow*", not "this local slot is reassignable" - see
      // `analyzer.ts`'s `effectiveBindingType`, the single source of truth
      // this mirrors (`localMutable: byRef ? false : mutable`).
      const own: Declaration[] =
        pattern.name.text === "_"
          ? []
          : [
              {
                id: pattern.name.tokenId,
                name: pattern.name.text,
                type: pattern.name.type,
                tokenId: pattern.name.tokenId,
                mutable: !pattern.byRef && pattern.mutable,
              },
            ];
      return isSome(pattern.subpattern)
        ? [...own, ...declarationsOf(pattern.subpattern.value)]
        : own;
    }
    case "OrPattern":
      return pattern.alternatives.flatMap((alt) => declarationsOf(alt));
    case "TuplePattern":
    case "TupleStructPattern":
      return pattern.elements.flatMap((element) => declarationsOf(element));
    case "StructPattern":
      return pattern.fields.flatMap((field): readonly Declaration[] => {
        if (isSome(field.pattern)) return declarationsOf(field.pattern.value);
        if (field.name.text === "_") return [];
        return [
          {
            id: field.name.tokenId,
            name: field.name.text,
            type: field.name.type,
            tokenId: field.name.tokenId,
            mutable: false,
          },
        ];
      });
    case "SlicePattern":
      return pattern.elements.flatMap((element): readonly Declaration[] => {
        if (element.kind === "RestPattern") {
          if (!isSome(element.name)) return [];
          return [
            {
              id: element.name.value.tokenId,
              name: element.name.value.text,
              type: element.name.value.type,
              tokenId: element.name.value.tokenId,
              mutable: !element.byRef && element.mutable,
            },
          ];
        }
        return declarationsOf(element);
      });
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

/**
 * Function parameters are treated as declared before the body, so they seed
 * the root scope's declarations list (see `buildControlFlowGraph`) - the
 * body's own locals then drop before them, matching real drop order.
 */
function paramDeclarations(params: readonly Semantics.Param[]): Declaration[] {
  return params.flatMap((param) => declarationsOf(param.pattern));
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
  for (const declaration of declarationsOf(statement.pattern)) {
    current.declarations.push(declaration);
    declarations.push(declaration);
    recordDef(current, declaration.id);
    registerScopeName(scopeStack, declaration.name, declaration.id);
  }
}

/**
 * Lower a nested bare-block statement (`{ ... }` with no `if`). It doesn't
 * fork, but its lexical scope still closes independently of the enclosing
 * one, and a block can carry only one `scopeExit` - so this shares the
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
 * are not lowered into the CFG structure - only statement-position control
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
      case "FunctionSignature":
      case "Struct":
      case "Enum":
      case "Const":
      case "Static":
        // Local item declarations have no CFG effect in Slice 1: they don't
        // use outer bindings.
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
 * by recursing into `lowerIf` with the `else` block as its own `preId` - the
 * chain of `else if`s becomes a chain of forks, not a special case. When
 * there is no `else` at all, the false path has nowhere to go but straight to
 * `join`, so `preId` itself gets a direct edge there alongside the edge to
 * `then` - that's the "3 blocks, pre.successors = [then, join]" shape.
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
  let thenExitId: number;
  if (expression.condition.kind === "LetExpression") {
    // Pattern bindings are declarations of thenBranch alone - pushed here
    // (mirrors buildControlFlowGraph's param registration), popped after
    // thenBranch, invisible to elseBranch below.
    scopeStack.push(new Map());
    const patternDeclarations = declarationsOf(expression.condition.pattern);
    for (const declaration of patternDeclarations) {
      registerScopeName(scopeStack, declaration.name, declaration.id);
    }
    thenExitId = lowerScope(
      expression.thenBranch,
      blocks,
      thenId,
      scopeStack,
      patternDeclarations,
      false,
    );
    scopeStack.pop();
  } else {
    thenExitId = lowerScope(expression.thenBranch, blocks, thenId, scopeStack);
  }

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
 * sufficient - no fixpoint iteration is needed.
 */
export function buildControlFlowGraph(
  fn: Semantics.FunctionDef,
): ControlFlowGraph {
  const blocks: MutableBlock[] = [];
  const entry = pushBlock(blocks);
  const scopeStack: ScopeStack = [new Map<string, BindingId>()];
  const paramDecls = paramDeclarations(fn.signature.params);
  for (const declaration of paramDecls) {
    registerScopeName(scopeStack, declaration.name, declaration.id);
  }
  lowerScope(fn.body, blocks, entry, scopeStack, paramDecls, false);
  return { entry, blocks };
}

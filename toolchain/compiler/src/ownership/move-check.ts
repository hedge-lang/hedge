/**
 * @module
 *
 * Move/use-before-init checking and scope-end drop-point computation
 *
 * This is a second, independent recursive walk over the same
 * Semantics.FunctionDecl that buildControlFlowGraph() lowers. Merging
 * state at an `if`/`else` join requires knowing which block is the matching
 * join for a given fork; reconstructing that from a flat successors[] array
 * is fiddly, whereas recursing over the AST's own branch structure gets it
 * for free.
 *
 * {@link walkIf}'s two branches are just two function calls that return,
 * and merging happens the instant both come back (see {@link walkIf} and
 * {@link mergeStates}). The graph is still built and returned per function
 * (as {@link FunctionOwnership.graph}) so a future NLL borrow checker has
 * the necessary CFG to work with, but this pass doesn't use it for anything.
 *
 * The Semantics AST resolves every expression's type but not which
 * declaration a name refers to, so this pass re-derives name resolution
 * itself via a scope stack keyed by BindingId (a declaration's own tokenId,
 * so shadowing can never collide; see {@link resolve}/{@link registerBinding}).
 * See {@link useOrMove} for the core move/use state transition.
 */

import { assertNever } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
import type { Span, Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import { hasCapability } from "../semantics/type-capabilities.js";
import type * as Semantics from "../semantics/ast.js";
import type {
  BindingId,
  ControlFlowGraph,
  Declaration,
} from "./control-flow-graph.js";
import { buildControlFlowGraph } from "./control-flow-graph.js";

/**
 * A binding's move state within one function body. This vocabulary is
 * specific to this pass, not spec-quoted: the full post-Slice-2 region
 * lattice (specification/0002-execution-model.md, 0004-mutability.md) is
 * OWNED/SHARED/EXCLUSIVE-BORROW/UNBOUND with `let` eagerly OWNED. Slice 1
 * adds UNINITIALIZED because it alone has deferred-init bindings
 * (`let mut x: i32;` with no initializer).
 */
type MoveState =
  | { readonly kind: "Uninitialized" }
  | { readonly kind: "Owned" }
  | { readonly kind: "Unbound"; readonly moveSite: Span };

type StateMap = Map<BindingId, MoveState>;
type ScopeStack = Map<string, BindingId>[];

interface FunctionOwnership {
  readonly graph: ControlFlowGraph;
  /**
   * Drop points keyed by the owning `Semantics.Block`'s own tokenId,
   * in reverse declaration order.
   */
  readonly drops: ReadonlyMap<number, readonly Declaration[]>;
}

export interface OwnershipCheckResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly functions: ReadonlyMap<string, FunctionOwnership>;
}

interface Ctx {
  readonly tokens: readonly Token[];
  readonly diagnostics: Diagnostic[];
  readonly drops: Map<number, Declaration[]>;
}

function tokenSpan(tokens: readonly Token[], tokenId: number): Span {
  return tokens[tokenId]?.span ?? { start: 0, end: 0 };
}

function diagnosticSpan(
  tokens: readonly Token[],
  tokenId: number,
): Option<Span> {
  const token = tokens[tokenId];
  return token !== undefined ? some(token.span) : none();
}

function emitDiagnostic(ctx: Ctx, message: string, tokenId: number): void {
  ctx.diagnostics.push({
    severity: "error",
    message,
    span: diagnosticSpan(ctx.tokens, tokenId),
  });
}

/**
 * Innermost frame wins, matching how the language actually resolves shadowing.
 */
function resolve(scopeStack: ScopeStack, name: string): BindingId | undefined {
  for (let i = scopeStack.length - 1; i >= 0; i -= 1) {
    const id = scopeStack[i]?.get(name);
    if (id !== undefined) {
      return id;
    }
  }
  return undefined;
}

/**
 * Add `identifier` to the current scope frame and seed its move state.
 * Wildcard (`_`) patterns bind no name and are silently skipped — they can
 * never be read back, so there is nothing to track.
 */
function registerBinding(
  state: StateMap,
  scopeStack: ScopeStack,
  identifier: Semantics.Identifier,
  initialized: boolean,
): void {
  if (identifier.text === "_") {
    return;
  }
  const frame = scopeStack[scopeStack.length - 1];
  if (frame === undefined) {
    throw new Error("No active scope frame");
  }
  frame.set(identifier.text, identifier.tokenId);
  state.set(
    identifier.tokenId,
    initialized ? { kind: "Owned" } : { kind: "Uninitialized" },
  );
}

/**
 * There's no module system yet, so a multi-segment path never resolves
 * to a local binding anyway.
 */
function singleSegmentName(path: {
  readonly segments: readonly string[];
}): string | undefined {
  return path.segments.length === 1 ? path.segments[0] : undefined;
}

/**
 * Process a use of `pathExpr`. Requires the binding be `Owned` (else emits
 * use-after-move/use-before-init and poisons to `Owned` to avoid cascading).
 * When `asMove` is true and the binding's type has no `copy` capability, the
 * binding transitions to `Unbound`. Copy-typed bindings never transition
 * regardless of `asMove` — a "move" of a Copy value is a duplication.
 * Silently does nothing for names that don't resolve to a tracked local
 * binding (function names, builtins, already-diagnosed unresolved names).
 */
function useOrMove(
  ctx: Ctx,
  pathExpr: Semantics.PathExpression,
  state: StateMap,
  scopeStack: ScopeStack,
  asMove: boolean,
): void {
  const name = singleSegmentName(pathExpr.path);
  if (name === undefined) {
    return;
  }
  const id = resolve(scopeStack, name);
  if (id === undefined) {
    return;
  }
  const current = state.get(id);
  if (current === undefined) {
    return;
  }
  if (current.kind === "Uninitialized") {
    emitDiagnostic(
      ctx,
      `use of uninitialized binding \`${name}\``,
      pathExpr.tokenId,
    );
    state.set(id, { kind: "Owned" });
    return;
  }
  if (current.kind === "Unbound") {
    const { moveSite } = current;
    emitDiagnostic(
      ctx,
      `use of moved value \`${name}\`: moved at offset [${moveSite.start}, ${moveSite.end})`,
      pathExpr.tokenId,
    );
    state.set(id, { kind: "Owned" });
    return;
  }
  if (asMove && !hasCapability(pathExpr.type, "copy")) {
    state.set(id, {
      kind: "Unbound",
      moveSite: tokenSpan(ctx.tokens, pathExpr.tokenId),
    });
  }
}

/** `x = value;` resets `x` to `Owned` unconditionally, regardless of prior state. */
function reassign(
  pathExpr: Semantics.PathExpression,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  const name = singleSegmentName(pathExpr.path);
  if (name === undefined) {
    return;
  }
  const id = resolve(scopeStack, name);
  if (id === undefined) {
    return;
  }
  state.set(id, { kind: "Owned" });
}

function cloneState(state: StateMap): StateMap {
  return new Map(state);
}

/**
 * Branch-merge (meet) rule: `Owned` only if every predecessor is `Owned`;
 * else `Unbound` (carrying the first `Unbound` predecessor's move site) if
 * any predecessor is `Unbound`; else `Uninitialized`.
 */
function mergeStates(a: StateMap, b: StateMap): StateMap {
  const merged: StateMap = new Map();
  const ids = new Set<BindingId>([...a.keys(), ...b.keys()]);
  for (const id of ids) {
    const av = a.get(id);
    const bv = b.get(id);
    if (av === undefined || bv === undefined) {
      // Declared only within one branch's own (now-closed) scope; its name
      // is no longer resolvable outside that branch, so the merged value
      // here is never looked up again.
      merged.set(id, av ?? bv ?? { kind: "Uninitialized" });
      continue;
    }
    if (av.kind === "Owned" && bv.kind === "Owned") {
      merged.set(id, { kind: "Owned" });
    } else if (av.kind === "Unbound") {
      merged.set(id, av);
    } else if (bv.kind === "Unbound") {
      merged.set(id, bv);
    } else {
      merged.set(id, { kind: "Uninitialized" });
    }
  }
  return merged;
}

/**
 * Recurse through `expression`, walking every sub-expression through the
 * same `asMove: true` path a bare `PathExpression` gets (see `useOrMove`).
 * This is safe to apply almost uniformly because Hedge's type-capability
 * system already restricts which types can appear where: only `Copy` types
 * can be arithmetic/comparison operands, so walking `x` inside `x + 1` as a
 * "move" is a no-op — `useOrMove` only actually transitions a binding to
 * `Unbound` when its type has no `copy` capability, and a non-`Copy` struct
 * could never legally reach a `BinaryExpression` operand in the first place.
 * The one deliberate exception is `FieldAccessExpression`: the object being
 * read is a *use*, not a move, since Slice 1 doesn't track partial
 * (field-level) moves out of a struct.
 */
// eslint-disable-next-line complexity -- This is a routing function
function walkExpression(
  ctx: Ctx,
  expression: Semantics.Expression,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  switch (expression.kind) {
    case "PathExpression":
      useOrMove(ctx, expression, state, scopeStack, true);
      return;
    case "FieldAccessExpression":
      // The object is a *use*, not a move: Slice 1 does not track partial
      // (field-level) moves out of a struct.
      if (expression.object.kind === "PathExpression") {
        useOrMove(ctx, expression.object, state, scopeStack, false);
      } else {
        walkExpression(ctx, expression.object, state, scopeStack);
      }
      return;
    case "CallExpression":
      walkExpression(ctx, expression.callee, state, scopeStack);
      for (const argument of expression.arguments) {
        walkExpression(ctx, argument, state, scopeStack);
      }
      return;
    case "AssignExpression":
      walkExpression(ctx, expression.rhs, state, scopeStack);
      if (expression.lhs.kind === "PathExpression") {
        reassign(expression.lhs, state, scopeStack);
      } else {
        walkExpression(ctx, expression.lhs, state, scopeStack);
      }
      return;
    case "CompoundAssignExpression":
      walkExpression(ctx, expression.rhs, state, scopeStack);
      walkExpression(ctx, expression.lhs, state, scopeStack);
      return;
    case "BinaryExpression":
      walkExpression(ctx, expression.left, state, scopeStack);
      walkExpression(ctx, expression.right, state, scopeStack);
      return;
    case "UnaryExpression":
      walkExpression(ctx, expression.operand, state, scopeStack);
      return;
    case "ReferenceExpression":
      walkExpression(ctx, expression.operand, state, scopeStack);
      return;
    case "MethodCallExpression":
      walkExpression(ctx, expression.receiver, state, scopeStack);
      for (const argument of expression.arguments) {
        walkExpression(ctx, argument, state, scopeStack);
      }
      return;
    case "IndexExpression":
      walkExpression(ctx, expression.object, state, scopeStack);
      walkExpression(ctx, expression.index, state, scopeStack);
      return;
    case "TupleExpression":
      for (const element of expression.elements) {
        walkExpression(ctx, element, state, scopeStack);
      }
      return;
    case "StructExpression":
      for (const field of expression.fields) {
        if (isSome(field.value)) {
          walkExpression(ctx, field.value.value, state, scopeStack);
        }
      }
      if (isSome(expression.base)) {
        walkExpression(ctx, expression.base.value, state, scopeStack);
      }
      return;
    case "IfExpression":
      walkIf(ctx, expression, state, scopeStack);
      return;
    case "Block":
      walkScope(ctx, expression, state, scopeStack, true);
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
 * Clone the incoming state once per branch, walk each branch to completion
 * against its own clone, then merge the two results back into `state` via
 * the meet rule (`mergeStates`). Cloning means the two branches can never
 * see each other's moves — e.g. moving `x` in `then` cannot affect the
 * state `else` starts from. A missing `else` still gets an `elseState`
 * clone of the pre-`if` state (unmodified), representing the "condition was
 * false, nothing in the body ran" path.
 */
function walkIf(
  ctx: Ctx,
  expression: Semantics.IfExpression,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  walkExpression(ctx, expression.condition, state, scopeStack);

  const thenState = cloneState(state);
  walkScope(ctx, expression.thenBranch, thenState, scopeStack, true);

  const elseState = cloneState(state);
  if (expression.elseBranch.kind === "Some") {
    const elseBranch = expression.elseBranch.value;
    if (elseBranch.kind === "Block") {
      walkScope(ctx, elseBranch, elseState, scopeStack, true);
    } else {
      walkIf(ctx, elseBranch, elseState, scopeStack);
    }
  }

  const merged = mergeStates(thenState, elseState);
  state.clear();
  for (const [id, moveState] of merged) {
    state.set(id, moveState);
  }
}

function walkStatement(
  ctx: Ctx,
  statement: Semantics.Statement,
  state: StateMap,
  scopeStack: ScopeStack,
  declarations: Declaration[],
): void {
  switch (statement.kind) {
    case "LetStatement": {
      // The initializer is walked *before* registerBinding, so `let x = x;`
      // resolves the rhs `x` against whatever `x` was already in scope
      // (shadowing an outer binding, if any) rather than the new one being
      // declared — the new binding doesn't exist yet as far as `resolve` is
      // concerned.
      if (isSome(statement.initializer)) {
        walkExpression(ctx, statement.initializer.value, state, scopeStack);
      }
      const { name } = statement.pattern;
      registerBinding(state, scopeStack, name, isSome(statement.initializer));
      if (name.text !== "_") {
        declarations.push({
          id: name.tokenId,
          name: name.text,
          type: name.type,
          tokenId: name.tokenId,
        });
      }
      return;
    }
    case "ExpressionStatement": {
      const { expression } = statement;
      if (expression.kind === "IfExpression") {
        walkIf(ctx, expression, state, scopeStack);
      } else if (expression.kind === "Block") {
        walkScope(ctx, expression, state, scopeStack, true);
      } else {
        walkExpression(ctx, expression, state, scopeStack);
      }
      return;
    }
    case "Function":
    case "Struct":
      // Local item declarations don't use outer bindings in Slice 1 (mirrors
      // the equivalent TODO in ownership/borrowck.ts).
      return;
    default:
      assertNever(
        statement,
        `Unexpected statement: ${JSON.stringify(statement)}`,
      );
  }
}

/**
 * Reverse-order walk over `declarations` gives reverse-declaration-order
 * dropping for free (AC5). Skipping `Copy` types and keeping only bindings
 * still `Owned` needs no special-casing for moved-away values (AC6) or
 * values moved out via a trailing/return expression: both leave the binding
 * `Unbound` by the time this runs — walkScope calls this only after walking
 * the scope's trailing expression, so a `fn f() -> Boxed { let x = ...; x }`
 * body has already marked `x` `Unbound` (moved out to the caller) before its
 * drop list is computed, and it's correctly excluded.
 */
function recordDrops(
  ctx: Ctx,
  scopeTokenId: number,
  declarations: readonly Declaration[],
  state: StateMap,
): void {
  const drops: Declaration[] = [];
  for (let i = declarations.length - 1; i >= 0; i -= 1) {
    const declaration = declarations[i];
    if (declaration === undefined || hasCapability(declaration.type, "copy")) {
      continue;
    }
    if (state.get(declaration.id)?.kind === "Owned") {
      drops.push(declaration);
    }
  }
  ctx.drops.set(scopeTokenId, drops);
}

/**
 * Walk one lexical scope's statements and trailing expression, then close
 * its scope by recording drop annotations for its still-owned declarations.
 * `pushFrame` is false only for a function's own top-level body, whose
 * bindings share the parameters' scope frame.
 */
function walkScope(
  ctx: Ctx,
  scope: Semantics.Block,
  state: StateMap,
  scopeStack: ScopeStack,
  pushFrame: boolean,
): void {
  if (pushFrame) {
    scopeStack.push(new Map());
  }
  const declarations: Declaration[] = [];
  for (const statement of scope.statements) {
    walkStatement(ctx, statement, state, scopeStack, declarations);
  }
  if (isSome(scope.trailingExpression)) {
    walkExpression(ctx, scope.trailingExpression.value, state, scopeStack);
  }
  recordDrops(ctx, scope.tokenId, declarations, state);
  if (pushFrame) {
    scopeStack.pop();
  }
}

/**
 * Fresh `state`/`scopeStack` per call — move state never crosses a function
 * boundary, so two functions can freely reuse the same binding name without
 * interference. Parameters are always seeded `Owned` (never `Uninitialized`):
 * a function can't be called without its arguments already existing.
 */
function walkFunction(ctx: Ctx, fn: Semantics.FunctionDecl): void {
  const state: StateMap = new Map();
  const scopeStack: ScopeStack = [new Map<string, BindingId>()];
  for (const param of fn.params) {
    registerBinding(state, scopeStack, param.pattern.name, true);
  }
  walkScope(ctx, fn.body, state, scopeStack, false);
}

/**
 * Ownership analysis for Slice 1: move/use-before-init checking and
 * scope-end drop-point computation over a trivial CFG (ADR 0002). Runs on
 * the type-annotated `Semantics.Program`, one function at a time — move
 * state never crosses a function boundary.
 */
export function analyzeOwnership(
  program: Semantics.Program,
  tokens: readonly Token[],
): OwnershipCheckResult {
  const diagnostics: Diagnostic[] = [];
  const functions = new Map<string, FunctionOwnership>();
  for (const item of program.items) {
    if (item.kind !== "Function") {
      continue;
    }
    const graph = buildControlFlowGraph(item);
    const drops = new Map<number, Declaration[]>();
    const ctx: Ctx = { tokens, diagnostics, drops };
    walkFunction(ctx, item);
    functions.set(item.name.text, { graph, drops });
  }
  return { diagnostics, functions };
}

/**
 * Driver-facing subset of `analyzeOwnership`'s result: just the diagnostics.
 * The driver doesn't yet consume the per-function drop annotations — that's
 * the not-yet-filed Slice 1 codegen ticket's job (ADR 0003); it will call
 * `analyzeOwnership` directly instead.
 */
export function checkOwnership(
  program: Semantics.Program,
  tokens: readonly Token[],
): readonly Diagnostic[] {
  return analyzeOwnership(program, tokens).diagnostics;
}

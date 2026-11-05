/**
 * @module
 *
 * Move/use-before-init checking and scope-end drop-point computation
 *
 * This is a second, independent recursive walk over the same
 * Semantics.FunctionDef that buildControlFlowGraph() lowers. Merging
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

import { assert, assertNever } from "../assert.js";
import {
  type Diagnostic,
  type DiagnosticKind,
  type RelatedSpan,
  errorDiagnostic,
  renderDiagnosticMessage,
  warningDiagnostic,
} from "../diagnostics/index.js";
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
import { collectOwnedFunctions } from "./owned-functions.js";

/**
 * A binding's move state within one function body. This vocabulary is
 * specific to this pass, not spec-quoted: the full post-Slice-2 region
 * lattice (specification/0002-execution-model.md, 0004-mutability.md) is
 * OWNED/SHARED/EXCLUSIVE-BORROW/UNBOUND with `let` eagerly OWNED. Slice 1
 * adds UNINITIALIZED because it alone has deferred-init bindings
 * (`let mut x: i32;` with no initializer).
 *
 * `Unbound` and `ConditionallyMoved` are deliberately distinct states, not
 * one state with a comment explaining the difference: `Unbound` means moved
 * on every reachable path (nothing to drop, unambiguously);
 * `ConditionallyMoved` means moved on some reachable path but not others -
 * the binding may still be Owned depending on which branch actually ran.
 * `Uninitialized` and `PossiblyUninitialized` are the same distinction on
 * the other axis: `Uninitialized` means never constructed on any reachable
 * path; `PossiblyUninitialized` means constructed on some path but not
 * others - the binding may still be Owned depending on which branch ran.
 * Slice 1 has no drop-flag mechanism (that's Slice 2, per ROADMAP.md), so it
 * cannot correctly decide whether to drop a `ConditionallyMoved` or
 * `PossiblyUninitialized` binding; collapsing either into its "definitely
 * gone" sibling (`Unbound`/`Uninitialized`) would silently under-drop on the
 * branch that did construct it. Keeping these separate `kind`s forces every
 * consumer of `MoveState` (see `useOrMove`, `dropDecision`) to make an
 * explicit decision via exhaustive matching instead of one being able to
 * quietly forget them.
 */
type MoveState =
  | { readonly kind: "Uninitialized" }
  | { readonly kind: "Owned" }
  | {
      readonly kind: "Unbound";
      readonly moveSite: Span;
      readonly moveStatementTokenId: number;
    }
  | {
      readonly kind: "ConditionallyMoved";
      readonly moveSite: Span;
      readonly moveStatementTokenId: number;
    }
  | { readonly kind: "PossiblyUninitialized" }
  | { readonly kind: "PartiallyMoved"; readonly moved: readonly MovedPlace[] };

/**
 * A field path moved out of a binding, e.g. `["i", "x"]` for `o.i.x`.
 * `siblings[k]` is every declared field of the struct that owns `path[k]`,
 * so the fields a partial move leaves behind can be computed without a
 * second struct lookup.
 */
interface MovedPlace {
  readonly path: readonly string[];
  readonly siblings: readonly (readonly Semantics.OwnerField[])[];
  readonly moveSite: Span;
  readonly moveStatementTokenId: number;
  /** Set once a branch merge has reported this place as moved on only some paths, so an enclosing merge does not report it again. */
  readonly conditional?: true;
}

type StateMap = Map<BindingId, MoveState>;
type ScopeStack = Map<string, BindingId>[];

/**
 * A declaration whose scope-end drop can't be statically decided: it was
 * moved on some reachable path but not others (see the `MoveState` doc
 * comment's `ConditionallyMoved` case), and unlike `BranchDrop` below, no
 * single fork's branches can be shown to fully account for it (chiefly:
 * loops, ROADMAP Slice 6 -- a value moved on some iterations but not others
 * can't be attributed to a specific static branch, since the same code point
 * is reached with different history across iterations). `moveStatementTokenId`
 * names the exact statement whose move makes this ambiguous, so JSIM lowering
 * can inject the flag-clear write immediately after it. Currently unreachable
 * without loops -- see `attributeConditionalMoves`, which resolves every
 * fork-local conditional move statically before it ever reaches here.
 */
export interface ConditionalDrop {
  readonly declaration: Declaration;
  readonly moveStatementTokenId: number;
}

/**
 * A conditional move fully resolved by static duplication (matches rustc's
 * drop elaboration): `declaration` is Owned on exactly one side of the `if`
 * named by `ifTokenId` and definitely moved on the other, so the drop is
 * attributed directly to the still-owning `branch` instead of needing a
 * runtime flag. See `attributeConditionalMoves`.
 */
export interface BranchDrop {
  readonly declaration: Declaration;
  readonly ifTokenId: number;
  readonly branch: "then" | "else";
}

/**
 * A binding with some fields moved out: it is not disposed whole, only the
 * fields still owned at scope end are, each at `declaration`'s own position
 * in the drop order. `remaining` is in field declaration order, one entry
 * per owned field path that has something to release.
 */
export interface PartialDrop {
  readonly declaration: Declaration;
  readonly remaining: readonly (readonly string[])[];
}

export interface FunctionOwnership {
  readonly graph: ControlFlowGraph;
  /**
   * Drop points keyed by the owning `Semantics.Block`'s own tokenId,
   * in reverse declaration order.
   */
  readonly drops: ReadonlyMap<number, readonly Declaration[]>;
  /**
   * Conditionally-dropped declarations, keyed the same way as `drops`.
   * These need a drop-flag guard at codegen instead of a plain `using`.
   * Currently always empty without loops -- see `ConditionalDrop`.
   */
  readonly conditionalDrops: ReadonlyMap<number, readonly ConditionalDrop[]>;
  /** Partially-moved declarations, keyed the same way as `drops`. */
  readonly partialDrops: ReadonlyMap<number, readonly PartialDrop[]>;
  /** Conditional moves resolved via static duplication. See `BranchDrop`. */
  readonly branchDrops: readonly BranchDrop[];
}

export interface OwnershipCheckResult {
  readonly diagnostics: readonly Diagnostic[];
  readonly functions: ReadonlyMap<string, FunctionOwnership>;
}

interface Ctx {
  readonly tokens: readonly Token[];
  readonly diagnostics: Diagnostic[];
  readonly drops: Map<number, Declaration[]>;
  readonly conditionalDrops: Map<number, ConditionalDrop[]>;
  readonly partialDrops: Map<number, PartialDrop[]>;
  readonly branchDrops: BranchDrop[];
  /**
   * Every declaration in the function currently being walked, keyed by its
   * own `BindingId`. Populated incrementally as `walkStatement`'s
   * `LetStatement` case and `walkFunction`'s param loop each discover a
   * real `Declaration` -- not derived from `collectDeclarations(graph)`,
   * which only reads a `BasicBlock`'s own `scopeExit.declarations` and so
   * has a documented blind spot for declarations made inside a confined
   * (value-position) scope (see `control-flow-graph.ts`'s
   * `recordConfinedScope`, which never sets a `scopeExit` at all). This
   * walk visits every `LetStatement` uniformly regardless of confinement,
   * so building the map here has no equivalent gap.
   */
  readonly declarationsById: Map<BindingId, Declaration>;
  /** See `CompileOptions.warnDropFlags` in driver.ts. */
  readonly warnDropFlags: boolean;
  readonly hasDropImpl: (type: Semantics.StructType) => boolean;
  /**
   * The tokenId of the statement currently being walked, updated at the top
   * of `walkStatement`. Read by `useOrMove` to stamp a move's
   * `moveStatementTokenId` -- the granularity JSIM lowering needs to inject a
   * drop-flag-clear write right after the statement that performed the move.
   */
  currentStatementTokenId: number;
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

function emitDiagnostic(
  ctx: Ctx,
  kind: DiagnosticKind,
  tokenId: number,
  relatedSpans?: readonly RelatedSpan[],
): void {
  ctx.diagnostics.push({
    ...errorDiagnostic(kind, diagnosticSpan(ctx.tokens, tokenId)),
    relatedSpans: relatedSpans ?? [],
  });
}

function emitWarning(ctx: Ctx, kind: DiagnosticKind, tokenId: number): void {
  ctx.diagnostics.push(
    warningDiagnostic(kind, diagnosticSpan(ctx.tokens, tokenId)),
  );
}

/**
 * The --warn-drop-flags message for a conditionally dropped declaration
 * (see CompileOptions.warnDropFlags in driver.ts). A pure function, kept
 * independently testable from the code path that calls it -- which, with no
 * loops yet (ROADMAP Slice 6), no program compilable today can reach; see
 * ConditionalDrop's own doc comment.
 */
export function conditionalDropFlagWarning(name: string): string {
  return renderDiagnosticMessage({ kind: "OwnConditionalDropFlag", name });
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
 * Wildcard (`_`) patterns bind no name and are silently skipped - they can
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
  const frame = scopeStack.at(-1);
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
function singleSegmentName(path: Semantics.Path): string | undefined {
  return path.segments.length === 1 ? path.segments[0] : undefined;
}

interface ResolvedBinding {
  readonly id: BindingId;
  readonly name: string;
}

/**
 * Combines `singleSegmentName` and `resolve`: `undefined` for a
 * multi-segment path or a name that doesn't resolve to a tracked local
 * binding (function names, builtins, already-diagnosed unresolved names).
 */
function resolveBinding(
  pathExpr: Semantics.PathExpression,
  scopeStack: ScopeStack,
): ResolvedBinding | undefined {
  const name = singleSegmentName(pathExpr.path);
  if (name === undefined) {
    return undefined;
  }
  const id = resolve(scopeStack, name);
  if (id === undefined) {
    return undefined;
  }
  return { id, name };
}

/**
 * Process a use of `pathExpr`. Requires the binding be `Owned` (else emits
 * use-after-move/use-before-init and poisons to `Owned` to avoid cascading).
 * When `asMove` is true and the binding's type has no `copy` capability, the
 * binding transitions to `Unbound`. Copy-typed bindings never transition
 * regardless of `asMove` - a "move" of a Copy value is a duplication.
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
  const resolved = resolveBinding(pathExpr, scopeStack);
  if (resolved === undefined) {
    return;
  }
  const { id, name } = resolved;
  const current = state.get(id);
  if (current === undefined) {
    return;
  }
  switch (current.kind) {
    case "Uninitialized":
      emitDiagnostic(
        ctx,
        { kind: "OwnUseOfUninitializedBinding", name },
        pathExpr.tokenId,
      );
      state.set(id, { kind: "Owned" });
      return;
    case "Unbound":
      emitDiagnostic(
        ctx,
        { kind: "OwnUseOfMovedValue", name },
        pathExpr.tokenId,
        [{ span: current.moveSite, label: { kind: "LabelMovedHere" } }],
      );
      state.set(id, { kind: "Owned" });
      return;
    case "ConditionallyMoved":
      emitDiagnostic(
        ctx,
        { kind: "OwnUseOfPossiblyMovedValue", name },
        pathExpr.tokenId,
      );
      state.set(id, { kind: "Owned" });
      return;
    case "PossiblyUninitialized":
      emitDiagnostic(
        ctx,
        { kind: "OwnUseOfPossiblyUninitializedBinding", name },
        pathExpr.tokenId,
      );
      state.set(id, { kind: "Owned" });
      return;
    case "PartiallyMoved": {
      const [first] = current.moved;
      assert(first !== undefined, "PartiallyMoved carries a moved place");
      emitDiagnostic(
        ctx,
        {
          kind: "OwnUseOfPartiallyMovedValue",
          name,
          moved: placeDescription(name, first.path),
        },
        pathExpr.tokenId,
        [{ span: first.moveSite, label: { kind: "LabelMovedHere" } }],
      );
      state.set(id, { kind: "Owned" });
      return;
    }
    case "Owned":
      if (asMove && !hasCapability(pathExpr.type, "copy")) {
        state.set(id, {
          kind: "Unbound",
          moveSite: tokenSpan(ctx.tokens, pathExpr.tokenId),
          moveStatementTokenId: ctx.currentStatementTokenId,
        });
      }
      return;
    default:
      assertNever(current);
  }
}

/** `x = value;` resets `x` to `Owned` unconditionally, regardless of prior state. */
function reassign(
  pathExpr: Semantics.PathExpression,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  const resolved = resolveBinding(pathExpr, scopeStack);
  if (resolved === undefined) {
    return;
  }
  state.set(resolved.id, { kind: "Owned" });
}

function cloneState(state: StateMap): StateMap {
  return new Map(state);
}

/**
 * Combine two predecessor states for the same binding at a branch merge.
 * Exhaustive over both sides' `kind` (nested switch, each with an
 * `assertNever` default) so a future 6th `MoveState` can't be silently
 * half-handled here - see the `MoveState` doc comment for why `Unbound`/
 * `ConditionallyMoved` and `Uninitialized`/`PossiblyUninitialized` must each
 * stay distinct rather than collapsing into their "definitely gone" sibling.
 *
 * The one invariant every branch here must preserve: if either side "could
 * still be Owned" (that's `Owned` itself, or either ambiguous state), the
 * result must also "could still be Owned" - never silently resolve to a
 * side that's definitely-not-owned (`Uninitialized`/`Unbound`) just because
 * the OTHER side happens to be definitely-not-owned too but for a different
 * reason. `Owned` + `Uninitialized` collapsing to plain `Uninitialized` was
 * exactly this mistake in an earlier version of this function - it silently
 * discarded the fact that the binding genuinely was constructed on one path.
 */
// eslint-disable-next-line complexity -- exhaustive over a 5x5 state pairing, not incidental branching
function combineStates(av: MoveState, bv: MoveState): MoveState {
  if (av.kind === "PartiallyMoved" || bv.kind === "PartiallyMoved") {
    return combinePartiallyMoved(av, bv);
  }
  switch (av.kind) {
    case "Owned":
      switch (bv.kind) {
        case "Owned":
          return { kind: "Owned" };
        case "Uninitialized":
          return { kind: "PossiblyUninitialized" };
        case "Unbound":
        case "ConditionallyMoved":
          return {
            kind: "ConditionallyMoved",
            moveSite: bv.moveSite,
            moveStatementTokenId: bv.moveStatementTokenId,
          };
        case "PossiblyUninitialized":
          return { kind: "PossiblyUninitialized" };
        default:
          return assertNever(bv);
      }
    case "Uninitialized":
      switch (bv.kind) {
        case "Owned":
          return { kind: "PossiblyUninitialized" };
        case "Uninitialized":
          return { kind: "Uninitialized" };
        case "Unbound":
          // Neither path ever leaves the binding genuinely Owned (one never
          // constructed it, the other moved it away), so there is nothing
          // to drop either way - fold to Unbound rather than inventing a
          // third "doubly dead" state for a case with no drop-safety
          // consequence.
          return {
            kind: "Unbound",
            moveSite: bv.moveSite,
            moveStatementTokenId: bv.moveStatementTokenId,
          };
        case "ConditionallyMoved":
          // `bv` may still be Owned on one of its own sub-paths - that
          // possibility must survive the merge, not be discarded just
          // because `av` is definitely-uninitialized.
          return {
            kind: "ConditionallyMoved",
            moveSite: bv.moveSite,
            moveStatementTokenId: bv.moveStatementTokenId,
          };
        case "PossiblyUninitialized":
          return { kind: "PossiblyUninitialized" };
        default:
          return assertNever(bv);
      }
    case "Unbound":
      switch (bv.kind) {
        case "Uninitialized":
        case "Unbound":
          return {
            kind: "Unbound",
            moveSite: av.moveSite,
            moveStatementTokenId: av.moveStatementTokenId,
          };
        case "Owned":
        case "ConditionallyMoved":
          return {
            kind: "ConditionallyMoved",
            moveSite: av.moveSite,
            moveStatementTokenId: av.moveStatementTokenId,
          };
        case "PossiblyUninitialized":
          // `av` is definitely moved (never owned from here on); `bv` may
          // still be Owned on one of its own sub-paths, which must survive.
          return { kind: "PossiblyUninitialized" };
        default:
          return assertNever(bv);
      }
    case "ConditionallyMoved":
      switch (bv.kind) {
        case "Owned":
        case "Unbound":
        case "ConditionallyMoved":
        case "Uninitialized":
        case "PossiblyUninitialized":
          return {
            kind: "ConditionallyMoved",
            moveSite: av.moveSite,
            moveStatementTokenId: av.moveStatementTokenId,
          };
        default:
          return assertNever(bv);
      }
    case "PossiblyUninitialized":
      switch (bv.kind) {
        case "Owned":
        case "Uninitialized":
        case "Unbound":
          return { kind: "PossiblyUninitialized" };
        case "ConditionallyMoved":
          return {
            kind: "ConditionallyMoved",
            moveSite: bv.moveSite,
            moveStatementTokenId: bv.moveStatementTokenId,
          };
        case "PossiblyUninitialized":
          return { kind: "PossiblyUninitialized" };
        default:
          return assertNever(bv);
      }
    default:
      return assertNever(av);
  }
}

/**
 * The merge rule for a side that has had a field moved out. Two partial
 * sides keep every place either side moved; against `Owned` the partial
 * side stands unchanged; against any other state the weaker guarantee wins,
 * since the binding is no longer provably holding all its fields.
 */
function combinePartiallyMoved(av: MoveState, bv: MoveState): MoveState {
  if (av.kind === "PartiallyMoved" && bv.kind === "PartiallyMoved") {
    const extra = bv.moved.filter(
      (m) => !av.moved.some((a) => pathsOverlap(a.path, m.path)),
    );
    return { kind: "PartiallyMoved", moved: [...av.moved, ...extra] };
  }
  const partial = av.kind === "PartiallyMoved" ? av : bv;
  const other = av.kind === "PartiallyMoved" ? bv : av;
  switch (other.kind) {
    case "Owned":
    case "PartiallyMoved":
      return partial;
    case "Unbound":
    case "ConditionallyMoved":
      return {
        kind: "ConditionallyMoved",
        moveSite: other.moveSite,
        moveStatementTokenId: other.moveStatementTokenId,
      };
    case "Uninitialized":
    case "PossiblyUninitialized":
      return { kind: "PossiblyUninitialized" };
    default:
      return assertNever(other);
  }
}

function pathsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && pathStartsWith(a, b);
}

/** A moved place present on one side of a merge but not the other. */
function divergingMove(av: MoveState, bv: MoveState): MovedPlace | undefined {
  const movedOf = (state: MoveState): readonly MovedPlace[] | undefined => {
    if (state.kind === "PartiallyMoved") return state.moved;
    return state.kind === "Owned" ? [] : undefined;
  };
  const aMoved = movedOf(av);
  const bMoved = movedOf(bv);
  if (aMoved === undefined || bMoved === undefined) return undefined;
  const unmatched = (
    xs: readonly MovedPlace[],
    ys: readonly MovedPlace[],
  ): MovedPlace | undefined =>
    xs.find(
      (x) =>
        x.conditional !== true && !ys.some((y) => pathsEqual(x.path, y.path)),
    );
  return unmatched(aMoved, bMoved) ?? unmatched(bMoved, aMoved);
}

/**
 * Reports a field moved on only some of the paths merging into `id`, then
 * marks every moved place so an enclosing merge does not report it again.
 */
function resolveDivergingMove(
  ctx: Ctx,
  id: BindingId,
  av: MoveState,
  bv: MoveState,
  combined: MoveState,
): MoveState {
  const diverging = divergingMove(av, bv);
  if (diverging === undefined || combined.kind !== "PartiallyMoved") {
    return combined;
  }
  const name = ctx.declarationsById.get(id)?.name ?? "_";
  emitDiagnostic(
    ctx,
    {
      kind: "OwnConditionalPartialMove",
      place: placeDescription(name, diverging.path),
    },
    diverging.moveStatementTokenId,
  );
  return {
    kind: "PartiallyMoved",
    moved: combined.moved.map((m) => ({ ...m, conditional: true })),
  };
}

/** Branch-merge (meet) rule, applied per binding via `combineStates`. */
function mergeStates(ctx: Ctx, a: StateMap, b: StateMap): StateMap {
  const merged: StateMap = new Map();
  const ids = new Set<BindingId>([...a.keys(), ...b.keys()]);
  for (const id of ids) {
    const av = a.get(id);
    const bv = b.get(id);
    if (av === undefined || bv === undefined) {
      // Declared only within one branch's own (now-closed) scope; its name
      // is no longer resolvable outside that branch, so the merged value
      // here is never looked up again.
      const only = av ?? bv;
      assert(only !== undefined, "id came from a's or b's keys");
      merged.set(id, only);
      continue;
    }
    merged.set(
      id,
      resolveDivergingMove(ctx, id, av, bv, combineStates(av, bv)),
    );
  }
  return merged;
}

function walkStructExpression(
  ctx: Ctx,
  expression: Semantics.StructExpression,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  for (const field of expression.fields) {
    walkExpression(ctx, field.value, state, scopeStack);
  }
  if (isSome(expression.base)) {
    walkExpression(ctx, expression.base.value, state, scopeStack);
  }
}

function walkAssignExpression(
  ctx: Ctx,
  expression: Semantics.AssignExpression,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  walkExpression(ctx, expression.rhs, state, scopeStack);
  if (expression.lhs.kind === "PathExpression") {
    reassign(expression.lhs, state, scopeStack);
  } else {
    walkNonMovingPlace(ctx, expression.lhs, state, scopeStack);
  }
}

/** Name a dereferenced place for a move diagnostic, e.g. `*r`. Falls back to a generic description for an operand shape this pass doesn't name (full place-path rendering belongs to the borrow checker's own place model, not move-check's). */
function derefPlaceDescription(operand: Semantics.Expression): string {
  if (operand.kind === "PathExpression" && operand.path.segments.length === 1) {
    const name = operand.path.segments[0];
    if (name !== undefined) {
      return `\`*${name}\``;
    }
  }
  return "the dereferenced value";
}

/** Render a projection chain for a diagnostic, e.g. `o.i` or `a[_]`. */
// eslint-disable-next-line complexity -- Routing function over the full Expression union
function projectionDescription(expression: Semantics.Expression): string {
  switch (expression.kind) {
    case "PathExpression": {
      const name = expression.path.segments[0];
      return expression.path.segments.length === 1 && name !== undefined
        ? name
        : "_";
    }
    case "FieldAccessExpression":
      return `${projectionDescription(expression.object)}.${expression.field.text}`;
    case "IndexExpression":
      return `${projectionDescription(expression.object)}[_]`;
    case "DereferenceExpression":
      return `*${projectionDescription(expression.operand)}`;
    case "StringLiteral":
    case "IntLiteral":
    case "FloatLiteral":
    case "BoolLiteral":
    case "CharLiteral":
    case "CallExpression":
    case "ReferenceExpression":
    case "BinaryExpression":
    case "UnaryExpression":
    case "AssignExpression":
    case "CompoundAssignExpression":
    case "MethodCallExpression":
    case "TupleExpression":
    case "ArrayExpression":
    case "ArrayRepeatExpression":
    case "RangeExpression":
    case "StructExpression":
    case "IfExpression":
    case "LetExpression":
    case "MatchExpression":
    case "Block":
      return "_";
    default:
      return assertNever(
        expression,
        `Unexpected expression: ${JSON.stringify(expression)}`,
      );
  }
}

function placeDescription(name: string, path: readonly string[]): string {
  return [name, ...path].join(".");
}

function pathStartsWith(
  path: readonly string[],
  prefix: readonly string[],
): boolean {
  return prefix.every((segment, i) => path[i] === segment);
}

/** One path names the other or an ancestor of it: moving or using either one touches the other. */
function pathsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return pathStartsWith(a, b) || pathStartsWith(b, a);
}

interface FieldChain {
  readonly root: Semantics.PathExpression;
  readonly fields: readonly Semantics.FieldAccessExpression[];
}

/**
 * `o.a.b` rooted in a bare local, reached only through owned struct fields.
 * A hop through a reference is not a chain: moving out of one stays rejected
 * regardless of what the reference points to.
 */
function fieldChainOf(
  expression: Semantics.Expression,
  scopeStack: ScopeStack,
): FieldChain | undefined {
  const fields: Semantics.FieldAccessExpression[] = [];
  let current = expression;
  while (current.kind === "FieldAccessExpression") {
    if (current.object.type.kind === "ReferenceType") return undefined;
    fields.unshift(current);
    current = current.object;
  }
  if (current.kind !== "PathExpression" || fields.length === 0) {
    return undefined;
  }
  if (resolveBinding(current, scopeStack) === undefined) return undefined;
  return { root: current, fields };
}

function chainPath(chain: FieldChain): readonly string[] {
  return chain.fields.map((f) => f.field.text);
}

/**
 * Use of a field path rooted in a tracked local: fine unless it overlaps a
 * place already moved out of that binding. Anything else about the root's
 * state (moved whole, uninitialized, ...) reports through `useOrMove`.
 */
function useFieldPlace(
  ctx: Ctx,
  chain: FieldChain,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  usePlacePath(
    ctx,
    {
      root: chain.root,
      path: chainPath(chain),
      tokenId: chain.fields.at(-1)?.tokenId ?? chain.root.tokenId,
    },
    state,
    scopeStack,
  );
}

interface PlaceUse {
  readonly root: Semantics.PathExpression;
  readonly path: readonly string[];
  readonly tokenId: number;
}

function usePlacePath(
  ctx: Ctx,
  use: PlaceUse,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  const resolved = resolveBinding(use.root, scopeStack);
  const current = resolved === undefined ? undefined : state.get(resolved.id);
  if (resolved === undefined || current?.kind !== "PartiallyMoved") {
    useOrMove(ctx, use.root, state, scopeStack, false);
    return;
  }
  const clash = current.moved.find((m) => pathsOverlap(m.path, use.path));
  if (clash === undefined) return;
  const place = placeDescription(resolved.name, use.path);
  emitDiagnostic(
    ctx,
    clash.path.length > use.path.length
      ? {
          kind: "OwnUseOfPartiallyMovedValue",
          name: place,
          moved: placeDescription(resolved.name, clash.path),
        }
      : { kind: "OwnUseOfMovedValue", name: place },
    use.tokenId,
    [{ span: clash.moveSite, label: { kind: "LabelMovedHere" } }],
  );
}

/** The outermost struct among `owners` that has a `Drop` impl, if any. */
function dropImplOwnerOf(
  ctx: Ctx,
  owners: readonly Semantics.Type[],
): Semantics.StructType | undefined {
  for (const owner of owners) {
    if (owner.kind === "StructType" && ctx.hasDropImpl(owner)) return owner;
  }
  return undefined;
}

/** Why `place` cannot move out of `resolved`, given the structs along its path. */
function fieldMoveRejection(
  ctx: Ctx,
  resolved: ResolvedBinding,
  place: string,
  owners: readonly Semantics.Type[],
): DiagnosticKind | undefined {
  const dropOwner = dropImplOwnerOf(ctx, owners);
  if (dropOwner !== undefined) {
    return {
      kind: "OwnCannotMoveOutOfDropType",
      place,
      typeName: dropOwner.name.split("::").pop() ?? dropOwner.name,
    };
  }
  if (ctx.declarationsById.get(resolved.id)?.mutable === true) {
    return {
      kind: "OwnCannotMoveOutOfMutBinding",
      place,
      name: resolved.name,
    };
  }
  return undefined;
}

/** Record `moved` against the binding, unless it already overlaps a moved place. */
function recordMovedPlace(
  state: StateMap,
  id: BindingId,
  moved: MovedPlace,
): void {
  const current = state.get(id);
  if (current?.kind === "PartiallyMoved") {
    if (current.moved.some((m) => pathsOverlap(m.path, moved.path))) return;
    state.set(id, {
      kind: "PartiallyMoved",
      moved: [...current.moved, moved],
    });
  } else if (current?.kind === "Owned") {
    state.set(id, { kind: "PartiallyMoved", moved: [moved] });
  }
}

/** Move a non-`Copy` field path out of a tracked local, leaving its siblings owned. */
function moveFieldPlace(
  ctx: Ctx,
  chain: FieldChain,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  const resolved = resolveBinding(chain.root, scopeStack);
  const last = chain.fields.at(-1);
  if (resolved === undefined || last === undefined) return;
  const rejection = fieldMoveRejection(
    ctx,
    resolved,
    placeDescription(resolved.name, chainPath(chain)),
    chain.fields.map((f) => f.object.type),
  );
  if (rejection !== undefined) {
    emitDiagnostic(ctx, rejection, last.tokenId);
    return;
  }
  useFieldPlace(ctx, chain, state, scopeStack);
  recordMovedPlace(state, resolved.id, {
    path: chainPath(chain),
    siblings: chain.fields.map((f) => f.ownerFields),
    moveSite: tokenSpan(ctx.tokens, last.tokenId),
    moveStatementTokenId: ctx.currentStatementTokenId,
  });
}

/**
 * Moving a non-`Copy` value out of a field or element is not tracked: the
 * owner keeps its own drop obligation, so both it and the new binding would
 * dispose the same value. The borrow is named as the alternative since that
 * is what most callers want. A field path rooted in a local is tracked per
 * place instead (see `moveFieldPlace`); this remains for an element, or a
 * field reached through a reference.
 */
function checkProjectionMove(
  ctx: Ctx,
  expression: Semantics.FieldAccessExpression | Semantics.IndexExpression,
): void {
  if (hasCapability(expression.type, "copy")) return;
  const place = projectionDescription(expression);
  emitDiagnostic(
    ctx,
    expression.kind === "IndexExpression"
      ? { kind: "OwnCannotMoveOutOfElement", place }
      : { kind: "OwnCannotMoveOutBorrowInstead", place },
    expression.tokenId,
  );
}

function walkFieldAccessMove(
  ctx: Ctx,
  expression: Semantics.FieldAccessExpression,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  const chain = fieldChainOf(expression, scopeStack);
  if (chain === undefined) {
    checkProjectionMove(ctx, expression);
    walkNonMovingPlace(ctx, expression.object, state, scopeStack);
    return;
  }
  if (hasCapability(expression.type, "copy")) {
    useFieldPlace(ctx, chain, state, scopeStack);
    return;
  }
  moveFieldPlace(ctx, chain, state, scopeStack);
}

/**
 * Walk a place expression that is being read or written *through*, not
 * moved out of: a `FieldAccessExpression`'s object, a `ReferenceExpression`'s
 * operand, or an `AssignExpression`'s lhs. A bare `PathExpression` is a use,
 * not a move (see `useOrMove`'s `asMove: false`); a `DereferenceExpression`
 * recurses the same way, since `(*r).field` and `*r = value` both access the
 * referent without moving it out - only a `DereferenceExpression` reached
 * from a genuinely moving position (the default case in `walkExpression`)
 * needs the move-out check. Any other shape falls through to the ordinary
 * moving walk, unchanged from before this distinction existed.
 */
function walkNonMovingPlace(
  ctx: Ctx,
  expression: Semantics.Expression,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  if (expression.kind === "PathExpression") {
    useOrMove(ctx, expression, state, scopeStack, false);
    return;
  }
  if (expression.kind === "DereferenceExpression") {
    walkNonMovingPlace(ctx, expression.operand, state, scopeStack);
    return;
  }
  // A projection reached this way is being borrowed or written through, so
  // it keeps recursing non-movingly rather than tripping the move-out check
  // `walkExpression` applies to the same node.
  if (expression.kind === "FieldAccessExpression") {
    const chain = fieldChainOf(expression, scopeStack);
    if (chain !== undefined) {
      useFieldPlace(ctx, chain, state, scopeStack);
      return;
    }
    walkNonMovingPlace(ctx, expression.object, state, scopeStack);
    return;
  }
  if (expression.kind === "IndexExpression") {
    walkNonMovingPlace(ctx, expression.object, state, scopeStack);
    walkExpression(ctx, expression.index, state, scopeStack);
    return;
  }
  walkExpression(ctx, expression, state, scopeStack);
}

const COMPARISON_OPERATORS: ReadonlySet<
  Semantics.BinaryExpression["operator"]
> = new Set(["Eq", "Ne", "Lt", "Gt", "Le", "Ge"]);

/**
 * Recurse through `expression`, walking every sub-expression through the
 * same `asMove: true` path a bare `PathExpression` gets (see `useOrMove`).
 * This is safe to apply almost uniformly because Hedge's type-capability
 * system already restricts which types can appear where: only `Copy` types
 * can be an operand of an arithmetic, bitwise, or logical operator, so
 * walking `x` inside `x + 1` as a "move" is a no-op - `useOrMove` only
 * actually transitions a binding to `Unbound` when its type has no `copy`
 * capability. The comparison operators (`==`/`!=`/`<`/`>`/`<=`/`>=`) are the
 * exception among operators: a struct or enum operand reaches them
 * (dispatching through `PartialEq::eq`/`PartialOrd::partial_cmp`, both
 * `&self`/`&Self`), so `walkExpression`'s `BinaryExpression` case routes
 * every comparison operator's operands through `walkNonMovingPlace` - a
 * comparison borrows, never moves.
 * `FieldAccessExpression`/`ReferenceExpression`/`AssignExpression`/
 * `IndexExpression` are deliberate exceptions, routed through
 * `walkNonMovingPlace` instead: the object/operand/lhs being accessed is a
 * *use*, not a move, since Slice 1 doesn't track partial (field- or
 * element-level) moves out of a struct or array, and borrowing or writing
 * through a reference never moves its referent either.
 * `DereferenceExpression` is the remaining exception in the other direction:
 * unlike a `BinaryExpression` operand, a dereferenced place's referent *can*
 * be non-`Copy`, so reaching one here (a genuinely moving position - a call
 * argument, a `let` initializer, ...) is a real move-out-of-a-reference check,
 * not a no-op.
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
      walkFieldAccessMove(ctx, expression, state, scopeStack);
      return;
    case "CallExpression":
      walkExpression(ctx, expression.callee, state, scopeStack);
      for (const argument of expression.arguments) {
        walkExpression(ctx, argument, state, scopeStack);
      }
      return;
    case "AssignExpression":
      walkAssignExpression(ctx, expression, state, scopeStack);
      return;
    case "CompoundAssignExpression":
      // Unlike plain `=`, a compound assignment never replaces the LHS's own
      // identity - `x += y` desugars to a `&mut self` call, so the LHS is
      // always a borrow, never a whole-value reassignment eligible for
      // `walkAssignExpression`'s own `reassign` treatment.
      walkExpression(ctx, expression.rhs, state, scopeStack);
      walkNonMovingPlace(ctx, expression.lhs, state, scopeStack);
      return;
    case "BinaryExpression":
      if (COMPARISON_OPERATORS.has(expression.operator)) {
        // Every comparison operator borrows its operands (see this
        // function's doc comment).
        walkNonMovingPlace(ctx, expression.left, state, scopeStack);
        walkNonMovingPlace(ctx, expression.right, state, scopeStack);
        return;
      }
      walkExpression(ctx, expression.left, state, scopeStack);
      walkExpression(ctx, expression.right, state, scopeStack);
      return;
    case "UnaryExpression":
      walkExpression(ctx, expression.operand, state, scopeStack);
      return;
    case "ReferenceExpression":
      // Borrowing (`&`/`&mut`) is a *use*, not a move: the operand's
      // ownership never transfers, matching FieldAccessExpression's own
      // use-not-move treatment above.
      walkNonMovingPlace(ctx, expression.operand, state, scopeStack);
      return;
    case "DereferenceExpression":
      // Reached here only from a genuinely moving position (see this
      // function's own doc comment) - a non-`Copy` referent can't be moved
      // out through a reference, matching Rust's "cannot move out of a
      // reference" rule. `UnitType` (the error-recovery placeholder for a
      // deref of a non-reference type) is always `copy`, so a prior diagnostic
      // there never cascades into this one.
      if (!hasCapability(expression.type, "copy")) {
        emitDiagnostic(
          ctx,
          {
            kind: "OwnCannotMoveOutOfReference",
            place: derefPlaceDescription(expression.operand),
          },
          expression.tokenId,
        );
      }
      walkExpression(ctx, expression.operand, state, scopeStack);
      return;
    case "MethodCallExpression": {
      // A `self` (by-value) receiver moves the place it names, exactly like
      // passing it to a function; a `&self`/`&mut self` receiver only borrows
      // it. An unresolved call (`receiverKind` is `none()`) is treated as a
      // borrow so a prior resolution diagnostic doesn't cascade a move error.
      const byValueReceiver =
        isSome(expression.receiverKind) && !expression.receiverKind.value.byRef;
      if (byValueReceiver && expression.receiver.kind === "PathExpression") {
        useOrMove(ctx, expression.receiver, state, scopeStack, true);
      } else if (byValueReceiver) {
        walkExpression(ctx, expression.receiver, state, scopeStack);
      } else {
        walkNonMovingPlace(ctx, expression.receiver, state, scopeStack);
      }
      for (const argument of expression.arguments) {
        walkExpression(ctx, argument, state, scopeStack);
      }
      return;
    }
    case "IndexExpression":
      // The object is a *use*, not a move, mirroring FieldAccessExpression's
      // own treatment above: `arr[i]` reads through the array, it doesn't
      // move `arr` out.
      checkProjectionMove(ctx, expression);
      walkNonMovingPlace(ctx, expression.object, state, scopeStack);
      walkExpression(ctx, expression.index, state, scopeStack);
      return;
    case "TupleExpression":
    case "ArrayExpression":
      for (const element of expression.elements) {
        walkExpression(ctx, element, state, scopeStack);
      }
      return;
    case "ArrayRepeatExpression":
      walkExpression(ctx, expression.value, state, scopeStack);
      return;
    case "RangeExpression":
      if (isSome(expression.start)) {
        walkExpression(ctx, expression.start.value, state, scopeStack);
      }
      if (isSome(expression.end)) {
        walkExpression(ctx, expression.end.value, state, scopeStack);
      }
      return;
    case "StructExpression":
      walkStructExpression(ctx, expression, state, scopeStack);
      return;
    case "IfExpression":
      walkIf(ctx, expression, state, scopeStack);
      return;
    case "LetExpression":
      // Only the scrutinee is walked here - `walkIf` handles registering
      // the pattern's own bindings, scoped to `thenBranch` alone.
      walkScrutinee(
        ctx,
        expression.scrutinee,
        expression.pattern,
        state,
        scopeStack,
      );
      return;
    case "MatchExpression":
      walkMatchExpression(ctx, expression, state, scopeStack);
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

interface PatternDeclaration {
  readonly identifier: Semantics.Identifier;
  readonly mutable: boolean;
}

/**
 * `true` when binding `pattern` needs ownership of its scrutinee - `false`
 * only when it binds at least one name and every bound name is `Copy` (a
 * `byRef` sub-binding, or a plain `Copy` field like `Point { x, y }`'s
 * `i32`s). A pattern with no bindings (`_`) still counts as moving,
 * preserving prior behavior.
 */
function patternRequiresScrutineeMove(pattern: Semantics.Pattern): boolean {
  const declarations = collectPatternDeclarations(pattern);
  if (declarations.length === 0) return true;
  return declarations.some(
    ({ identifier }) => !hasCapability(identifier.type, "copy"),
  );
}

/**
 * Every name a pattern binds, deepest-first - shared by match arms and, as
 * `let`/`Param` too (mirroring `control-flow-graph.ts`'s own
 * `declarationsOf`, which returns the CFG's `Declaration` shape instead of
 * this file's own `PatternDeclaration`).
 * `SlicePattern` is real (against a fixed-length array
 * scrutinee); `TuplePattern` still isn't (no real tuple value type exists
 * yet) - `analyzer.ts`'s `analyzePattern` always substitutes a
 * `WildcardPattern` for it (see `analyzePatternGuardrail`), so that one case
 * alone stays unreached.
 */
// eslint-disable-next-line complexity -- Routing function over the full Pattern union
function collectPatternDeclarations(
  pattern: Semantics.Pattern,
): PatternDeclaration[] {
  switch (pattern.kind) {
    case "WildcardPattern":
    case "LiteralPattern":
    case "RangePattern":
    case "PathPattern":
      return [];
    case "BindingPattern": {
      if (pattern.name.text === "_") return [];
      const nested = isSome(pattern.subpattern)
        ? collectPatternDeclarations(pattern.subpattern.value)
        : [];
      // A `byRef` binding's own `mutable` sigil (`&mut name`) means "this is
      // a mutable *borrow*", not "this local slot is reassignable" - see
      // `analyzer.ts`'s `effectiveBindingType`, the single source of truth
      // this mirrors (`localMutable: byRef ? false : mutable`).
      return [
        {
          identifier: pattern.name,
          mutable: !pattern.byRef && pattern.mutable,
        },
        ...nested,
      ];
    }
    case "OrPattern":
      return pattern.alternatives.flatMap((alt) =>
        collectPatternDeclarations(alt),
      );
    case "TuplePattern":
    case "TupleStructPattern":
      return pattern.elements.flatMap((el) => collectPatternDeclarations(el));
    case "StructPattern":
      return pattern.fields.flatMap((field) =>
        isSome(field.pattern)
          ? collectPatternDeclarations(field.pattern.value)
          : [{ identifier: field.name, mutable: false }],
      );
    case "SlicePattern":
      return pattern.elements.flatMap((el) => {
        if (el.kind !== "RestPattern") {
          return collectPatternDeclarations(el);
        }

        if (isSome(el.name)) {
          return [
            {
              identifier: el.name.value,
              mutable: !el.byRef && el.mutable,
            },
          ];
        }

        return [];
      });
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

/**
 * Every binding a match arm's pattern introduces is seeded `Owned` (never
 * `Uninitialized`), mirroring `walkFunction`'s own parameter seeding - a
 * pattern only ever binds a name once its scrutinee has already been
 * matched against it.
 * TODO(Hedge-238): binding mode (spec 0016's `match x`/`&x`/`&mut x`) isn't
 * tracked, so every binding reads by value even under a reference scrutinee.
 */
function walkMatchExpression(
  ctx: Ctx,
  expression: Semantics.MatchExpression,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  // Special-cased like LetStatement (see walkLetInitializer) - moves only
  // if some arm binds a non-Copy name, checked across all arms up front
  // since this runs once before the fork.
  if (expression.scrutinee.kind === "PathExpression") {
    useOrMove(
      ctx,
      expression.scrutinee,
      state,
      scopeStack,
      expression.arms.some((arm) => patternRequiresScrutineeMove(arm.pattern)),
    );
  } else {
    walkExpression(ctx, expression.scrutinee, state, scopeStack);
  }

  // Arms are mutually exclusive alternatives, not a sequence -- mirroring
  // `walkIf`, each arm is walked against its own clone of the pre-match
  // state, and the resulting per-arm states are merged back together
  // afterward. Walking every arm against one shared `state` (as this used
  // to do) would let a move in one arm leak into the next arm's analysis
  // and into the post-match state, when at runtime at most one arm ever
  // actually executes.
  let merged: StateMap | undefined;
  for (const arm of expression.arms) {
    const armState = cloneState(state);
    scopeStack.push(new Map());
    const declarations: Declaration[] = [];
    for (const { identifier, mutable } of collectPatternDeclarations(
      arm.pattern,
    )) {
      registerBinding(armState, scopeStack, identifier, true);
      const declaration: Declaration = {
        id: identifier.tokenId,
        name: identifier.text,
        type: identifier.type,
        tokenId: identifier.tokenId,
        mutable,
      };
      declarations.push(declaration);
      ctx.declarationsById.set(declaration.id, declaration);
    }
    if (isSome(arm.guard)) {
      walkExpression(ctx, arm.guard.value, armState, scopeStack);
    }
    walkExpression(ctx, arm.body, armState, scopeStack);
    recordDrops(ctx, arm.tokenId, declarations, armState);
    scopeStack.pop();
    merged =
      merged === undefined ? armState : mergeStates(ctx, merged, armState);
  }

  if (merged !== undefined) {
    state.clear();
    for (const [id, moveState] of merged) {
      state.set(id, moveState);
    }
  }
}

/**
 * If exactly one of `tv`/`ev` is `Owned` and the other is definitely
 * `Unbound`, the branch still holding it is unambiguous -- that side is
 * where a static drop belongs. Anything else (both Owned, both Unbound,
 * either side still ambiguous itself, either side Uninitialized-flavored)
 * is left for the ordinary merge in `combineStates` to handle unchanged.
 */
function resolveAttributionBranch(
  tv: MoveState,
  ev: MoveState,
): "then" | "else" | undefined {
  if (tv.kind === "Owned" && ev.kind === "Unbound") {
    return "then";
  }
  if (ev.kind === "Owned" && tv.kind === "Unbound") {
    return "else";
  }
  return undefined;
}

/**
 * Static duplication, matching rustc's drop elaboration: when a binding is
 * Owned on exactly one side of this fork and definitely moved on the other,
 * the moved/not-moved decision is already fully known here -- no runtime
 * flag is needed. Push a `BranchDrop` onto the still-owning side and
 * collapse *both* sides' state for this binding to the real `Unbound` that
 * already exists on the moved side, so the merge that follows sees a plain,
 * unconditional "already accounted for" instead of an ambiguity -- and so
 * does every consumer downstream of it (an outer `if` around this one, or
 * the enclosing scope's own `recordDrops`).
 *
 * Because `walkIf` recurses depth-first (an `else if` chain resolves its
 * own inner forks before this function ever sees their merged result), this
 * only ever needs to look one fork at a time: by the time either `thenState`
 * or `elseState` reaches here, any ambiguity nested inside it has already
 * been resolved to a definite `Owned`/`Unbound` by a deeper call to this
 * same function. With no loops yet (ROADMAP Slice 6), that means a "pure"
 * move-based `ConditionallyMoved` can never actually survive to
 * `recordDrops` -- every case is resolvable here. `ConditionalDrop` (the
 * runtime-flag path) stays in place for when loops make that no longer true.
 */
function attributeConditionalMoves(
  ctx: Ctx,
  ifExpr: Semantics.IfExpression,
  thenState: StateMap,
  elseState: StateMap,
): void {
  const ids = new Set<BindingId>([...thenState.keys(), ...elseState.keys()]);
  for (const id of ids) {
    const tv = thenState.get(id);
    const ev = elseState.get(id);
    if (tv === undefined || ev === undefined) {
      continue;
    }
    const branch = resolveAttributionBranch(tv, ev);
    if (branch === undefined) {
      continue;
    }
    const declaration = ctx.declarationsById.get(id);
    if (declaration === undefined) {
      continue; // wildcard `_` binding -- never tracked, never dropped.
    }
    const movedState = branch === "then" ? ev : tv;
    assert(
      movedState.kind === "Unbound",
      "resolveAttributionBranch guarantees the non-owning side is Unbound",
    );
    ctx.branchDrops.push({ declaration, ifTokenId: ifExpr.tokenId, branch });
    thenState.set(id, movedState);
    elseState.set(id, movedState);
  }
}

/**
 * Clone the incoming state once per branch, walk each branch to completion
 * against its own clone, then merge the two results back into `state` via
 * the meet rule (`mergeStates`). Cloning means the two branches can never
 * see each other's moves - e.g. moving `x` in `then` cannot affect the
 * state `else` starts from. A missing `else` still gets an `elseState`
 * clone of the pre-`if` state (unmodified), representing the "condition was
 * false, nothing in the body ran" path. `attributeConditionalMoves` runs
 * before the merge so a resolvable conditional move never becomes ambiguous
 * in the first place -- see its own doc comment.
 */
function walkIf(
  ctx: Ctx,
  expression: Semantics.IfExpression,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  walkExpression(ctx, expression.condition, state, scopeStack);

  const thenState = cloneState(state);
  if (expression.condition.kind === "LetExpression") {
    // Pattern bindings are declarations of thenBranch alone - pushed here
    // (mirrors walkFunction's param registration), popped after
    // thenBranch, invisible to elseBranch below.
    scopeStack.push(new Map());
    const declarations: Declaration[] = [];
    for (const { identifier, mutable } of collectPatternDeclarations(
      expression.condition.pattern,
    )) {
      registerBinding(thenState, scopeStack, identifier, true);
      const declaration: Declaration = {
        id: identifier.tokenId,
        name: identifier.text,
        type: identifier.type,
        tokenId: identifier.tokenId,
        mutable,
      };
      declarations.push(declaration);
      ctx.declarationsById.set(declaration.id, declaration);
    }
    walkScope(
      ctx,
      expression.thenBranch,
      thenState,
      scopeStack,
      false,
      declarations,
    );
    scopeStack.pop();
  } else {
    walkScope(ctx, expression.thenBranch, thenState, scopeStack, true);
  }

  const elseState = cloneState(state);
  if (expression.elseBranch.kind === "Some") {
    const elseBranch = expression.elseBranch.value;
    if (elseBranch.kind === "Block") {
      walkScope(ctx, elseBranch, elseState, scopeStack, true);
    } else {
      walkIf(ctx, elseBranch, elseState, scopeStack);
    }
  }

  attributeConditionalMoves(ctx, expression, thenState, elseState);

  const merged = mergeStates(ctx, thenState, elseState);
  state.clear();
  for (const [id, moveState] of merged) {
    state.set(id, moveState);
  }
}

interface PatternMove {
  readonly path: readonly string[];
  readonly siblings: readonly (readonly Semantics.OwnerField[])[];
  readonly owners: readonly Semantics.Type[];
}

interface PatternEntry {
  readonly name: string;
  /** `undefined` for a shorthand field, which binds the field's own name. */
  readonly pattern: Semantics.Pattern | undefined;
  readonly shorthandType: Semantics.Type;
}

interface PatternLevel {
  readonly entries: PatternEntry[];
  readonly owner: Semantics.Type;
  readonly fields: readonly Semantics.OwnerField[];
}

/**
 * An array pattern names its elements by index. A named rest (`..tail`)
 * binds a view of several elements at once, which is not a single place, so
 * it is left to move the array whole.
 */
function slicePatternLevel(
  pattern: Semantics.SlicePattern,
): PatternLevel | undefined {
  const { type } = pattern;
  if (type.kind !== "ArrayType") return undefined;
  const restIndex = pattern.elements.findIndex(
    (el) => el.kind === "RestPattern",
  );
  const entries: PatternEntry[] = [];
  for (const [i, element] of pattern.elements.entries()) {
    if (element.kind === "RestPattern") {
      if (isSome(element.name)) return undefined;
      continue;
    }
    const index =
      restIndex === -1 || i < restIndex
        ? i
        : type.length - (pattern.elements.length - i);
    entries.push({
      name: String(index),
      pattern: element,
      shorthandType: element.type,
    });
  }
  const fields = Array.from({ length: type.length }, (_, i) => ({
    name: String(i),
    type: type.elementType,
  }));
  return { entries, owner: type, fields };
}

function patternLevel(pattern: Semantics.Pattern): PatternLevel | undefined {
  if (pattern.kind === "SlicePattern") return slicePatternLevel(pattern);
  if (pattern.type.kind !== "StructType") return undefined;
  if (pattern.kind === "StructPattern") {
    const entries = pattern.fields.map((field): PatternEntry => ({
      name: field.name.text,
      pattern: isSome(field.pattern) ? field.pattern.value : undefined,
      shorthandType: field.name.type,
    }));
    return { entries, owner: pattern.type, fields: pattern.ownerFields };
  }
  if (pattern.kind === "TupleStructPattern") {
    const entries = pattern.elements.map((element, i): PatternEntry => ({
      name: String(i),
      pattern: element,
      shorthandType: element.type,
    }));
    return { entries, owner: pattern.type, fields: pattern.ownerFields };
  }
  return undefined;
}

/**
 * The places one pattern entry moves out of its owner: itself for a bare or
 * renamed non-`Copy` binding, its descendants for a nested pattern, nothing
 * for a wildcard or `Copy` binding. `undefined` when the entry cannot be
 * accounted for field by field.
 */
function entryPatternMoves(
  entry: PatternEntry,
  here: PatternMove,
): PatternMove[] | undefined {
  const nested = entry.pattern;
  if (nested === undefined) {
    return hasCapability(entry.shorthandType, "copy") ? [] : [here];
  }
  if (nested.kind === "WildcardPattern") return [];
  if (nested.kind === "BindingPattern") {
    if (isSome(nested.subpattern)) return undefined;
    const binds =
      nested.name.text !== "_" && !hasCapability(nested.name.type, "copy");
    return binds ? [here] : [];
  }
  return structPatternMoves(nested, here.path, here.siblings, here.owners);
}

/**
 * The non-`Copy` field places a by-value struct or tuple-struct pattern moves
 * out of its scrutinee. `undefined` for any pattern shape this does not
 * account for field by field, which then moves the scrutinee whole as before.
 */
function structPatternMoves(
  pattern: Semantics.Pattern,
  prefix: readonly string[],
  siblings: readonly (readonly Semantics.OwnerField[])[],
  owners: readonly Semantics.Type[],
): PatternMove[] | undefined {
  const level = patternLevel(pattern);
  if (level === undefined) return undefined;
  const levelSiblings = [...siblings, level.fields];
  const levelOwners = [...owners, level.owner];
  const moves: PatternMove[] = [];
  for (const entry of level.entries) {
    const path = [...prefix, entry.name];
    const here = { path, siblings: levelSiblings, owners: levelOwners };
    const entryMoves = entryPatternMoves(entry, here);
    if (entryMoves === undefined) return undefined;
    moves.push(...entryMoves);
  }
  return moves;
}

interface StructPatternBinding {
  readonly root: Semantics.PathExpression;
  readonly pattern: Semantics.Pattern;
  readonly moves: readonly PatternMove[];
}

/** `let Pair { a, .. } = p;` moves only the fields it binds out of `p`. */
function moveStructPatternPlaces(
  ctx: Ctx,
  binding: StructPatternBinding,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  const { root, pattern, moves } = binding;
  const resolved = resolveBinding(root, scopeStack);
  if (resolved === undefined) return;
  const [first] = moves;
  if (first === undefined) {
    useOrMove(ctx, root, state, scopeStack, false);
    return;
  }
  const rejection = fieldMoveRejection(
    ctx,
    resolved,
    placeDescription(resolved.name, first.path),
    first.owners,
  );
  if (rejection !== undefined) {
    emitDiagnostic(ctx, rejection, pattern.tokenId);
    return;
  }
  for (const move of moves) {
    usePlacePath(
      ctx,
      { root, path: move.path, tokenId: pattern.tokenId },
      state,
      scopeStack,
    );
    recordMovedPlace(state, resolved.id, {
      path: move.path,
      siblings: move.siblings,
      moveSite: tokenSpan(ctx.tokens, pattern.tokenId),
      moveStatementTokenId: ctx.currentStatementTokenId,
    });
  }
}

function isPatternOwner(type: Semantics.Type): boolean {
  return type.kind === "StructType" || type.kind === "ArrayType";
}

function walkLetInitializer(
  ctx: Ctx,
  statement: Semantics.LetStatement,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  if (!isSome(statement.initializer)) return;
  const initializer = statement.initializer.value;
  if (initializer.kind === "PathExpression") {
    const moves = structPatternMoves(statement.pattern, [], [], []);
    if (moves !== undefined && isPatternOwner(initializer.type)) {
      moveStructPatternPlaces(
        ctx,
        { root: initializer, pattern: statement.pattern, moves },
        state,
        scopeStack,
      );
      return;
    }
  }
  walkScrutinee(
    ctx,
    statement.initializer.value,
    statement.pattern,
    state,
    scopeStack,
  );
}

/**
 * A bare-identifier scrutinee is special-cased so an all-Copy destructuring
 * pattern doesn't move it - `walkExpression`'s own `PathExpression` case
 * always moves, with no visibility into the pattern being bound against.
 * Shared by `let` and `if let`.
 */
function walkScrutinee(
  ctx: Ctx,
  scrutinee: Semantics.Expression,
  pattern: Semantics.Pattern,
  state: StateMap,
  scopeStack: ScopeStack,
): void {
  if (scrutinee.kind !== "PathExpression") {
    walkExpression(ctx, scrutinee, state, scopeStack);
    return;
  }
  useOrMove(
    ctx,
    scrutinee,
    state,
    scopeStack,
    patternRequiresScrutineeMove(pattern),
  );
}

// eslint-disable-next-line complexity -- Routing function over the full Statement union
function walkStatement(
  ctx: Ctx,
  statement: Semantics.Statement,
  state: StateMap,
  scopeStack: ScopeStack,
  declarations: Declaration[],
): void {
  ctx.currentStatementTokenId = statement.tokenId;
  switch (statement.kind) {
    case "LetStatement": {
      // Walked *before* registerBinding, so `let x = x;` resolves the rhs
      // `x` against whatever `x` was already in scope (shadowing an outer
      // binding, if any) rather than the new one being declared - the new
      // binding doesn't exist yet as far as `resolve` is concerned.
      walkLetInitializer(ctx, statement, state, scopeStack);
      for (const { identifier, mutable } of collectPatternDeclarations(
        statement.pattern,
      )) {
        registerBinding(
          state,
          scopeStack,
          identifier,
          isSome(statement.initializer),
        );
        const declaration: Declaration = {
          id: identifier.tokenId,
          name: identifier.text,
          type: identifier.type,
          tokenId: identifier.tokenId,
          mutable,
        };
        declarations.push(declaration);
        ctx.declarationsById.set(declaration.id, declaration);
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
    case "FunctionSignature":
    case "Struct":
    case "Enum":
    case "Trait":
    case "Impl":
    case "Const":
    case "Static":
      // Local item declarations don't use outer bindings in Slice 1.
      return;
    default:
      assertNever(
        statement,
        `Unexpected statement: ${JSON.stringify(statement)}`,
      );
  }
}

type DropDecision =
  "Drop" | "NoDrop" | "ConditionalDrop" | "PartialDrop" | "Ambiguous";

/**
 * Exhaustive over `MoveState["kind"]` so a still-`ConditionallyMoved`
 * binding can't be silently treated as safe to skip (that was the actual
 * bug Codacy found: collapsing an ambiguous branch-merge state into
 * `Unbound` meant a binding still `Owned` on the untaken branch silently
 * never appeared in the drop list either). `ConditionallyMoved` resolves to
 * `"ConditionalDrop"`: Slice 2 has a drop-flag mechanism for exactly this
 * case (specification/0007-drop-and-raii.md's "Conditional moves" section),
 * so the caller emits a flag-guarded drop instead of rejecting it.
 * `PossiblyUninitialized` stays `"Ambiguous"` and is handled by the caller as
 * a hard error -- that's a different question (nothing was ever constructed
 * on some path, so there's nothing a drop flag could conditionally dispose
 * of), not one a drop flag resolves.
 */
function dropDecision(state: MoveState | undefined): DropDecision {
  if (state === undefined) {
    return "NoDrop"; // Unreachable given seeding at declaration time; safe default.
  }
  switch (state.kind) {
    case "Owned":
      return "Drop";
    case "Uninitialized":
    case "Unbound":
      return "NoDrop";
    case "ConditionallyMoved":
      return "ConditionalDrop";
    case "PartiallyMoved":
      return "PartialDrop";
    case "PossiblyUninitialized":
      return "Ambiguous";
    default:
      return assertNever(state);
  }
}

/**
 * Only ever called for `PossiblyUninitialized` -- `recordDrops` routes
 * `ConditionallyMoved` to a flag-guarded drop instead (see `dropDecision`).
 */
function ambiguousDropKind(name: string, state: MoveState): DiagnosticKind {
  switch (state.kind) {
    case "PossiblyUninitialized":
      return { kind: "OwnAmbiguousDrop", name };
    case "Owned":
    case "Uninitialized":
    case "Unbound":
    case "ConditionallyMoved":
    case "PartiallyMoved":
      throw new Error(
        `ICE: ambiguousDropKind called with non-ambiguous state ${state.kind}`,
      );
    default:
      return assertNever(state);
  }
}

/** A type that is move-only for tracking purposes but has no scope-end
 * `using` to emit (which would throw at runtime for a value with no
 * disposer). A bare generic parameter (`T`) and an unresolved trait
 * projection (`T::Item`) are this abstract-type case. A `dyn Trait` binding
 * is always an owned box carrying a `[Symbol.dispose]` (`&dyn`/`&mut dyn` are
 * `ReferenceType`, already skipped), so it does get one. */
function hasNoScopeEndDrop(type: Semantics.Type): boolean {
  return type.kind === "NamedType" || type.kind === "Projection";
}

/**
 * Reverse-order walk over `declarations` gives reverse-declaration-order
 * dropping for free. Skipping `Copy` types and keeping only bindings
 * `dropDecision` reports as `"Drop"` needs no special-casing for moved-away
 * values or values moved out via a trailing/return expression: both
 * leave the binding `Unbound` by the time this runs - walkScope calls this
 * only after walking the scope's trailing expression, so a
 * `fn f() -> Boxed { let x = ...; x }` body has already marked `x` `Unbound`
 * (moved out to the caller) before its drop list is computed, and it's
 * correctly excluded. A binding still `"ConditionalDrop"` at scope close
 * (moved on some branch but not others, and never resolved by a later use or
 * reassignment) gets a flag-guarded drop instead of an unconditional
 * `Declaration` entry -- see `ConditionalDrop`. A binding still `"Ambiguous"`
 * (possibly-uninitialized) is rejected here rather than silently dropped or
 * silently skipped -- see `dropDecision`'s doc comment.
 */
function recordDrops(
  ctx: Ctx,
  scopeTokenId: number,
  declarations: readonly Declaration[],
  state: StateMap,
): void {
  const drops: Declaration[] = [];
  const conditionalDrops: ConditionalDrop[] = [];
  const partialDrops: PartialDrop[] = [];
  for (let i = declarations.length - 1; i >= 0; i -= 1) {
    const declaration = declarations[i];
    if (
      declaration === undefined ||
      hasCapability(declaration.type, "copy") ||
      hasNoScopeEndDrop(declaration.type)
    ) {
      continue;
    }
    const declState = state.get(declaration.id);
    const decision = dropDecision(declState);
    switch (decision) {
      case "Drop":
        drops.push(declaration);
        break;
      case "NoDrop":
        break;
      case "ConditionalDrop": {
        assert(
          declState?.kind === "ConditionallyMoved",
          "ConditionalDrop implies a ConditionallyMoved state",
        );
        conditionalDrops.push({
          declaration,
          moveStatementTokenId: declState.moveStatementTokenId,
        });
        if (ctx.warnDropFlags) {
          emitWarning(
            ctx,
            { kind: "OwnConditionalDropFlag", name: declaration.name },
            declaration.tokenId,
          );
        }
        break;
      }
      case "PartialDrop":
        partialDrops.push(partialDropOf(declaration, declState));
        break;
      case "Ambiguous": {
        assert(declState !== undefined, "Ambiguous implies a known state");
        emitDiagnostic(
          ctx,
          ambiguousDropKind(declaration.name, declState),
          declaration.tokenId,
        );
        break;
      }
      default:
        assertNever(decision);
    }
  }
  ctx.drops.set(scopeTokenId, drops);
  ctx.conditionalDrops.set(scopeTokenId, conditionalDrops);
  ctx.partialDrops.set(scopeTokenId, partialDrops);
}

function partialDropOf(
  declaration: Declaration,
  state: MoveState | undefined,
): PartialDrop {
  assert(
    state?.kind === "PartiallyMoved",
    "PartialDrop implies a PartiallyMoved state",
  );
  return { declaration, remaining: remainingFieldPaths(state.moved, []) };
}

/**
 * The owned, releasable field paths under `prefix` once every place in
 * `moved` is gone, in declaration order. A field that is itself the parent
 * of a moved place is expanded to its own remaining children instead of
 * being released whole.
 */
function remainingFieldPaths(
  moved: readonly MovedPlace[],
  prefix: readonly string[],
): readonly (readonly string[])[] {
  const beneath = moved.filter((m) => pathStartsWith(m.path, prefix));
  const fields = beneath[0]?.siblings[prefix.length] ?? [];
  return fields.flatMap((field): readonly (readonly string[])[] => {
    const path = [...prefix, field.name];
    if (
      beneath.some(
        (m) => m.path.length === path.length && pathStartsWith(m.path, path),
      )
    ) {
      return [];
    }
    if (beneath.some((m) => pathStartsWith(m.path, path))) {
      return remainingFieldPaths(moved, path);
    }
    return hasCapability(field.type, "copy") ? [] : [path];
  });
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
  initialDeclarations: readonly Declaration[] = [],
): void {
  if (pushFrame) {
    scopeStack.push(new Map());
  }
  const declarations: Declaration[] = [...initialDeclarations];
  for (const statement of scope.statements) {
    walkStatement(ctx, statement, state, scopeStack, declarations);
  }
  if (isSome(scope.trailingExpression)) {
    // currentStatementTokenId is otherwise only updated by walkStatement; a
    // move inside a trailing expression (never itself a statement) would
    // otherwise inherit whatever statement last ran, which can be a
    // completely unrelated point in the function. Untestable by real
    // analysis today, same as the rest of moveStatementTokenId's only
    // consumer (ConditionalDrop, see its own doc comment): unlike jsim.ts,
    // this module has no injectable synthetic-ownership seam to construct
    // an adversarial case against directly.
    ctx.currentStatementTokenId = scope.trailingExpression.value.tokenId;
    walkExpression(ctx, scope.trailingExpression.value, state, scopeStack);
  }
  recordDrops(ctx, scope.tokenId, declarations, state);
  if (pushFrame) {
    scopeStack.pop();
  }
}

/**
 * Fresh `state`/`scopeStack` per call - move state never crosses a function
 * boundary, so two functions can freely reuse the same binding name without
 * interference. Parameters are always seeded `Owned` (never `Uninitialized`):
 * a function can't be called without its arguments already existing.
 */
function walkFunction(ctx: Ctx, fn: Semantics.FunctionDef): void {
  const state: StateMap = new Map();
  const scopeStack: ScopeStack = [new Map<string, BindingId>()];
  const paramDeclarations: Declaration[] = [];
  for (const param of fn.signature.params) {
    for (const { identifier, mutable } of collectPatternDeclarations(
      param.pattern,
    )) {
      registerBinding(state, scopeStack, identifier, true);
      const declaration: Declaration = {
        id: identifier.tokenId,
        name: identifier.text,
        type: identifier.type,
        tokenId: identifier.tokenId,
        mutable,
      };
      paramDeclarations.push(declaration);
      ctx.declarationsById.set(declaration.id, declaration);
    }
  }
  walkScope(ctx, fn.body, state, scopeStack, false, paramDeclarations);
}

/**
 * Ownership analysis for Slice 1: move/use-before-init checking and
 * scope-end drop-point computation over a trivial CFG (ADR 0002). Runs on
 * the type-annotated `Semantics.Program`, one function at a time - move
 * state never crosses a function boundary.
 */
export interface OwnershipOptions {
  readonly warnDropFlags?: boolean;
  /** Whether a struct type has a `Drop` impl; a field cannot move out of one. */
  readonly hasDropImpl?: (type: Semantics.StructType) => boolean;
}

export function analyzeOwnership(
  program: Semantics.Program,
  tokens: readonly Token[],
  options: OwnershipOptions = {},
): OwnershipCheckResult {
  const diagnostics: Diagnostic[] = [];
  const functions = new Map<string, FunctionOwnership>();
  const ownershipOf = (fn: Semantics.FunctionDef): FunctionOwnership => {
    const graph = buildControlFlowGraph(fn);
    const drops = new Map<number, Declaration[]>();
    const conditionalDrops = new Map<number, ConditionalDrop[]>();
    const partialDrops = new Map<number, PartialDrop[]>();
    const branchDrops: BranchDrop[] = [];
    const declarationsById = new Map<BindingId, Declaration>();
    const ctx: Ctx = {
      tokens,
      diagnostics,
      drops,
      conditionalDrops,
      partialDrops,
      branchDrops,
      declarationsById,
      warnDropFlags: options.warnDropFlags ?? false,
      hasDropImpl: options.hasDropImpl ?? ((): boolean => false),
      currentStatementTokenId: fn.tokenId,
    };
    walkFunction(ctx, fn);
    return { graph, drops, conditionalDrops, partialDrops, branchDrops };
  };
  // A top-level function is keyed by name (codegen looks it up that way);
  // anything else `collectOwnedFunctions` returns - a method body, a nested
  // `fn` - is keyed by its own tokenId, since those names are not unique
  // program-wide. Codegen consumes the method-body entries via
  // `methodOwnershipKey`; every function is walked for diagnostics regardless.
  const topLevel = new Set(
    program.items.filter((item) => item.kind === "Function"),
  );
  for (const fn of collectOwnedFunctions(program)) {
    const ownership = ownershipOf(fn);
    functions.set(
      topLevel.has(fn)
        ? fn.signature.name.text
        : methodOwnershipKey(fn.tokenId),
      ownership,
    );
  }
  return { diagnostics, functions };
}

/** The `analyzeOwnership` / `JsimContext.ownership` key for a non-top-level
 * function body - its own `tokenId`, since such names are not unique
 * program-wide. */
export function methodOwnershipKey(methodTokenId: number): string {
  return `method#${methodTokenId}`;
}

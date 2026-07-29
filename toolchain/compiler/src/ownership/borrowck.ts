/**
 * @module
 *
 * NLL borrow checking (spec §0005, §0006, §0002): enforces the four borrow
 * rules over a per-function {@link ControlFlowGraph}/{@link Liveness} (from
 * `control-flow-graph.ts`/`liveness.ts`), so a borrow's extent ends at its
 * last use rather than its lexical scope, across block boundaries as well as
 * within one.
 *
 * A borrow's base is resolved to the {@link BindingId} it actually refers to
 * via {@link resolveBorrowBases}, a second, independent scope-stack walk over
 * the same {@link Semantics.FunctionDecl} - mirroring `move-check.ts`'s own
 * rationale for a separate walk: {@link collectBorrowsFromGraph} itself
 * iterates the already-built CFG's flat block list, which doesn't preserve
 * nested lexical scope, so two same-named bindings in different `if`-branches
 * {@link Semantics.IfExpression} would otherwise be indistinguishable by name
 * alone.
 */
import { assert, assertNever } from "../assert.js";
import type { Diagnostic } from "../diagnostics.js";
import type { Span, Token } from "../lexer/token.js";
import { isSome, none, some, type Option } from "../option.js";
import type * as Semantics from "../semantics/ast.js";
import type {
  BasicBlock,
  BindingId,
  ControlFlowGraph,
  Declaration,
} from "./control-flow-graph.js";
import {
  buildControlFlowGraph,
  collectDeclarations,
  declarationsOf,
} from "./control-flow-graph.js";
import { computeLiveness, type Liveness } from "./liveness.js";

/**
 * A single step in a place's projection chain, applied outward from the
 * base: `(*r).field` is `r`'s base with projections
 * `[Deref, Field("field")]`. `Index` deliberately carries no expression - conflict-checking
 * never needs to compare two index values (dynamic indices are never
 * statically provable distinct; see `placesOverlap`), and the borrow-check
 * pass has no use for the index expression's own runtime value.
 */
type Projection =
  | { readonly kind: "Field"; readonly name: string }
  | { readonly kind: "Index" }
  | { readonly kind: "Deref" };

/** A place's base identifier plus its projection chain, independent of whether the base resolved to a tracked `BindingId` - the shape `placeOf` produces and `describePlace`/`placesOverlap` consume. */
interface PlacePath {
  readonly baseName: string;
  readonly projections: readonly Projection[];
}

/** A `PlacePath` whose base has also been resolved to the `BindingId` it refers to at the point of borrow (see `resolveBorrowBases`), or `undefined` if it didn't resolve to a tracked local binding. */
interface Place extends PlacePath {
  readonly baseId: BindingId | undefined;
}

/**
 * Flatten a borrow operand's expression tree into its base identifier and
 * projection chain, or `undefined` if `expr` isn't a place expression at
 * all (mirrors `semantics/analyzer.ts`'s `isBorrowablePlace`, which already
 * guarantees every `&`/`&mut` operand reaching this pass is one). Projections
 * are discovered outer-to-inner while descending toward the base, so they're
 * collected in reverse application order and reversed once before returning.
 */
function placeOf(expr: Semantics.Expression): PlacePath | undefined {
  const projections: Projection[] = [];
  let current = expr;
  for (;;) {
    switch (current.kind) {
      case "PathExpression": {
        const { segments } = current.path;
        const baseName = segments.length === 1 ? segments[0] : undefined;
        if (baseName === undefined) {
          return undefined;
        }
        projections.reverse();
        return { baseName, projections };
      }
      case "FieldAccessExpression":
        projections.push({ kind: "Field", name: current.field.text });
        current = current.object;
        continue;
      case "IndexExpression":
        projections.push({ kind: "Index" });
        current = current.object;
        continue;
      case "DereferenceExpression":
        projections.push({ kind: "Deref" });
        current = current.operand;
        continue;
      default:
        return undefined;
    }
  }
}

/** Render a place path as diagnostic-facing source text, e.g. `s.a.b`, `*r`, `(*r).field`. Field/Index access on a `Deref`-rooted place needs parens (`*r.field` would otherwise mean `*(r.field)`); `Deref` itself never does, since unary `*` already binds looser than a following projection in Rust-like precedence. */
function describePlace(path: PlacePath): string {
  let rendered = path.baseName;
  for (const projection of path.projections) {
    switch (projection.kind) {
      case "Field":
        rendered = rendered.startsWith("*")
          ? `(${rendered}).${projection.name}`
          : `${rendered}.${projection.name}`;
        break;
      case "Index":
        rendered = rendered.startsWith("*")
          ? `(${rendered})[_]`
          : `${rendered}[_]`;
        break;
      case "Deref":
        rendered = `*${rendered}`;
        break;
      default:
        assertNever(projection);
    }
  }
  return rendered;
}

/**
 * Whether two places' projection chains can alias. Diverging at a `Field`
 * with different names proves disjointness (spec §0013 "Borrowing fields");
 * two `Index` projections at the same depth always overlap, since a dynamic
 * index is never statically provable distinct; `Deref` is transparent and
 * never itself introduces disjointness. One chain running out before the
 * other (a prefix relationship, including the equal-length case) means one
 * place contains or is exactly the other, which always overlaps.
 */
function placesOverlap(a: PlacePath, b: PlacePath): boolean {
  const len = Math.min(a.projections.length, b.projections.length);
  for (let i = 0; i < len; i += 1) {
    const pa = a.projections[i];
    const pb = b.projections[i];
    if (pa === undefined || pb === undefined) {
      break;
    }
    if (pa.kind === "Field" && pb.kind === "Field") {
      if (pa.name !== pb.name) {
        return false;
      }
      continue;
    }
    if (pa.kind === "Index" && pb.kind === "Index") {
      return true;
    }
    if (pa.kind === "Deref" && pb.kind === "Deref") {
      continue;
    }
    // Two places sharing the same base and both well-typed can't actually
    // diverge in projection *kind* at the same depth (the base's own type
    // fixes what kind of projection is even well-typed there) - unreached
    // in practice, but conservatively overlapping rather than silently
    // disjoint if it ever were.
    return true;
  }
  return true;
}

/** Whether two borrows share the same root binding - by resolved `BindingId` when both resolved, else by base name (the fallback for an unresolved base). */
function samePlaceBase(a: Place, b: Place): boolean {
  return a.baseId !== undefined && b.baseId !== undefined
    ? a.baseId === b.baseId
    : a.baseName === b.baseName;
}

/**
 * Whether a `&mut` borrow's operand is actually writable, mirroring
 * `semantics/analyzer.ts`'s `placeMutabilityViolation` (used for assignment
 * lhs) - taking `&mut` of a place and assigning through it require the same
 * capability, so the recursion shape is identical: a non-root place whose
 * own type is a reference decides write permission from that reference's
 * own mutability from that point on, regardless of what contains it
 * (`&mut (*r).x` is fine when `r: &mut T`, even if `r` itself isn't `let
 * mut` - the reference's own mutability governs, not the local variable
 * holding it). Reaching the root without ever crossing a reference type
 * defers to the existing root-binding-mut check (`checkCapabilities`'s
 * `root-mut-required` case), unchanged from before this ticket.
 */
type CapabilityDecision =
  | { readonly kind: "allowed" }
  | { readonly kind: "blocked"; readonly through: string }
  | { readonly kind: "root-mut-required" };

function capabilityDecision(
  expr: Semantics.Expression,
  isRoot: boolean,
): CapabilityDecision {
  const exprType = expr.type;
  if (!isRoot && exprType.kind === "ReferenceType") {
    return exprType.mutable
      ? { kind: "allowed" }
      : {
          kind: "blocked",
          through: describePlace(
            placeOf(expr) ?? { baseName: "_", projections: [] },
          ),
        };
  }
  switch (expr.kind) {
    case "FieldAccessExpression":
      return capabilityDecision(expr.object, false);
    case "IndexExpression":
      return capabilityDecision(expr.object, false);
    case "DereferenceExpression":
      return capabilityDecision(expr.operand, false);
    default:
      return { kind: "root-mut-required" };
  }
}

/**
 * A borrow introduced by `let r = &[mut] place;`, tagged with the CFG block
 * and intra-block statement index it was declared at (see `collectBorrowsFromGraph`).
 */
interface Borrow {
  /** The borrowing binding's own name. */
  readonly name: string;
  /** The borrowing binding's own `BindingId` (its declaration's tokenId). */
  readonly bindingId: BindingId;
  /** The borrowed place, for conflict-checking and diagnostic messages. */
  readonly place: Place;
  /** Whether this borrow's own write-capability is satisfied (see `capabilityDecision`); only consulted for a `mutable` borrow. */
  readonly capability: CapabilityDecision;
  readonly mutable: boolean;
  readonly blockId: number;
  /** Index into `block.statements` where this borrow's own `let` lands. */
  readonly declIndex: number;
  /** The token ID of the reference, used for diagnostics. */
  readonly tokenId: number;
}

/** Lexical scope stack for resolving a borrow's base name to the `BindingId` it refers to at that point; innermost frame wins (mirrors `move-check.ts`'s own `resolve`/`registerBinding`). */
type ScopeStack = Map<string, BindingId>[];

function resolveScopedName(
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

function registerScopedName(
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
 * Reference types are `Copy`, so `let s = r;` duplicates the pointer, not
 * the referent - `s` and `r` are two independently-named bindings that alias
 * the exact same underlying place once dereferenced. `aliases` maps a binding
 * straight to the earliest binding in its own copy-chain (never through the
 * copied-from binding's own *borrow*, only through further plain-copy `let`s),
 * so `&mut *r` and `&mut *s` resolve to the same base and can be compared for
 * conflict (without also making a borrow's own base; e.g. `x` in
 * `let r = &mut x;`) comparable against a reborrow taken through it, which
 * would wrongly flag `let r = &mut x; let a = &mut *r;` as self-conflicting
 * at the exact statement where `r`'s own extent ends and `a`'s begins.
 */
function recordAlias(
  statement: Semantics.LetStatement,
  scopeStack: ScopeStack,
  newId: BindingId,
  aliases: Map<BindingId, BindingId>,
): void {
  if (!isSome(statement.initializer)) {
    return;
  }
  const init = statement.initializer.value;
  if (init.kind !== "PathExpression" || init.type.kind !== "ReferenceType") {
    return;
  }
  const { segments } = init.path;
  const name = segments.length === 1 ? segments[0] : undefined;
  if (name === undefined) {
    return;
  }
  const id = resolveScopedName(scopeStack, name);
  if (id !== undefined) {
    aliases.set(newId, aliases.get(id) ?? id);
  }
}

function recordBorrowBase(
  statement: Semantics.LetStatement,
  scopeStack: ScopeStack,
  resolved: Map<Semantics.LetStatement, BindingId>,
  aliases: ReadonlyMap<BindingId, BindingId>,
): void {
  if (!isSome(statement.initializer)) {
    return;
  }
  const init = statement.initializer.value;
  if (init.kind !== "ReferenceExpression") {
    return;
  }
  const place = placeOf(init.operand);
  if (place === undefined) {
    return;
  }
  const id = resolveScopedName(scopeStack, place.baseName);
  if (id !== undefined) {
    resolved.set(statement, aliases.get(id) ?? id);
  }
}

function walkStatementForBorrowBases(
  statement: Semantics.Statement,
  scopeStack: ScopeStack,
  resolved: Map<Semantics.LetStatement, BindingId>,
  aliases: Map<BindingId, BindingId>,
): void {
  switch (statement.kind) {
    case "LetStatement": {
      recordBorrowBase(statement, scopeStack, resolved, aliases);
      for (const declaration of declarationsOf(statement.pattern)) {
        recordAlias(statement, scopeStack, declaration.id, aliases);
        registerScopedName(scopeStack, declaration.name, declaration.id);
      }
      return;
    }
    case "ExpressionStatement":
      walkStatementPositionExpression(
        statement.expression,
        scopeStack,
        resolved,
        aliases,
      );
      return;
    case "Function":
    case "Struct":
    case "Enum":
    case "Const":
    case "Static":
      return;
    default:
      assertNever(
        statement,
        `Unexpected AST node: ${JSON.stringify(statement)}`,
      );
  }
}

/**
 * Only statement-position `if`/nested `{ }` introduce lexical scope that
 * `collectBorrowsFromGraph`'s own CFG-block scan can see (see
 * `control-flow-graph.ts`'s "confined vs. forking" note) - a value-position
 * `if`/`Block` isn't reachable there either, so it's out of scope here too.
 */
function walkStatementPositionExpression(
  expression: Semantics.Expression,
  scopeStack: ScopeStack,
  resolved: Map<Semantics.LetStatement, BindingId>,
  aliases: Map<BindingId, BindingId>,
): void {
  if (expression.kind === "IfExpression") {
    walkScopeForBorrowBases(
      expression.thenBranch,
      scopeStack,
      resolved,
      aliases,
    );
    if (isSome(expression.elseBranch)) {
      const elseBranch = expression.elseBranch.value;
      if (elseBranch.kind === "Block") {
        walkScopeForBorrowBases(elseBranch, scopeStack, resolved, aliases);
      } else {
        walkStatementPositionExpression(
          elseBranch,
          scopeStack,
          resolved,
          aliases,
        );
      }
    }
    return;
  }
  if (expression.kind === "Block") {
    walkScopeForBorrowBases(expression, scopeStack, resolved, aliases);
  }
}

function walkScopeForBorrowBases(
  scope: Semantics.Block,
  scopeStack: ScopeStack,
  resolved: Map<Semantics.LetStatement, BindingId>,
  aliases: Map<BindingId, BindingId>,
): void {
  scopeStack.push(new Map<string, BindingId>());
  for (const statement of scope.statements) {
    walkStatementForBorrowBases(statement, scopeStack, resolved, aliases);
  }
  scopeStack.pop();
}

/**
 * Resolve every borrow's base `PathExpression` to the `BindingId` it refers
 * to at that point, keyed by the borrow's own `LetStatement` (object
 * identity - `buildControlFlowGraph` never clones nodes, so the same
 * statement objects appear in `graph.blocks[].statements`). Reference-typed
 * plain-copy aliases (see `recordAlias`) are resolved internally and never
 * exposed - callers only ever see the canonical `BindingId` a borrow's base
 * ultimately names.
 */
function resolveBorrowBases(
  fn: Semantics.FunctionDecl,
): ReadonlyMap<Semantics.LetStatement, BindingId> {
  const resolved = new Map<Semantics.LetStatement, BindingId>();
  const aliases = new Map<BindingId, BindingId>();
  const scopeStack: ScopeStack = [new Map<string, BindingId>()];
  for (const param of fn.params) {
    for (const declaration of declarationsOf(param.pattern)) {
      registerScopedName(scopeStack, declaration.name, declaration.id);
    }
  }
  for (const statement of fn.body.statements) {
    walkStatementForBorrowBases(statement, scopeStack, resolved, aliases);
  }
  return resolved;
}

/**
 * Collect the names of single-segment paths referenced in an expression.
 * Deliberately name-based, not `BindingId`-based: matching by resolved
 * binding identity is `collectDeclarations`' job for cross-scope capability
 * lookups, but a borrow's own last-use tracking only needs to know whether
 * its name is mentioned again later in the same block.
 */
// eslint-disable-next-line complexity -- This is a routing function
function collectUses(expression: Semantics.Expression, out: Set<string>): void {
  switch (expression.kind) {
    case "PathExpression": {
      const { segments } = expression.path;
      const name = segments.length === 1 ? segments[0] : undefined;
      if (name !== undefined) {
        out.add(name);
      }
      return;
    }
    case "CallExpression":
      collectUses(expression.callee, out);
      for (const argument of expression.arguments) {
        collectUses(argument, out);
      }
      return;
    case "ReferenceExpression":
    case "DereferenceExpression":
      collectUses(expression.operand, out);
      return;
    case "BinaryExpression":
      collectUses(expression.left, out);
      collectUses(expression.right, out);
      return;
    case "UnaryExpression":
      collectUses(expression.operand, out);
      return;
    case "AssignExpression":
    case "CompoundAssignExpression":
      collectUses(expression.lhs, out);
      collectUses(expression.rhs, out);
      return;
    case "FieldAccessExpression":
      collectUses(expression.object, out);
      return;
    case "MethodCallExpression":
      collectUses(expression.receiver, out);
      for (const argument of expression.arguments) collectUses(argument, out);
      return;
    case "IndexExpression":
      collectUses(expression.object, out);
      collectUses(expression.index, out);
      return;
    case "TupleExpression":
      for (const element of expression.elements) collectUses(element, out);
      return;
    case "ArrayExpression":
      for (const element of expression.elements) collectUses(element, out);
      return;
    case "ArrayRepeatExpression":
      collectUses(expression.value, out);
      return;
    case "RangeExpression":
      if (isSome(expression.start)) {
        collectUses(expression.start.value, out);
      }
      if (isSome(expression.end)) {
        collectUses(expression.end.value, out);
      }
      return;
    case "StructExpression":
      for (const field of expression.fields) {
        if (isSome(field.value)) collectUses(field.value.value, out);
      }
      if (isSome(expression.base)) collectUses(expression.base.value, out);
      return;
    case "IfExpression":
      collectUses(expression.condition, out);
      for (const stmt of expression.thenBranch.statements)
        statementUses(stmt, out);
      if (isSome(expression.thenBranch.trailingExpression)) {
        collectUses(expression.thenBranch.trailingExpression.value, out);
      }
      if (isSome(expression.elseBranch))
        collectUses(expression.elseBranch.value, out);
      return;
    case "MatchExpression":
      // Same unscoped, name-only over-approximation this file already
      // applies to a Block's own `let`-bound names (see `statementUses`'s
      // `LetStatement` case) - a pattern-bound name referenced in a guard
      // or body is collected the same as any other name, with no attempt
      // to distinguish it from an outer binding of the same name.
      collectUses(expression.scrutinee, out);
      for (const arm of expression.arms) {
        if (isSome(arm.guard)) collectUses(arm.guard.value, out);
        collectUses(arm.body, out);
      }
      return;
    case "Block":
      for (const stmt of expression.statements) statementUses(stmt, out);
      if (isSome(expression.trailingExpression)) {
        collectUses(expression.trailingExpression.value, out);
      }
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
        `Unexpected AST node: ${JSON.stringify(expression)}`,
      );
  }
}

/** Collect the names of single-segment paths referenced in a statement. */
function statementUses(statement: Semantics.Statement, out: Set<string>): void {
  switch (statement.kind) {
    case "LetStatement":
      if (isSome(statement.initializer)) {
        collectUses(statement.initializer.value, out);
      }
      return;
    case "ExpressionStatement":
      collectUses(statement.expression, out);
      return;
    case "Function":
    case "Struct":
    case "Enum":
    case "Const":
    case "Static":
      // Local item declarations do not directly use outer bindings in Slice 1/2.
      return;
    default:
      assertNever(
        statement,
        `Unexpected AST node: ${JSON.stringify(statement)}`,
      );
  }
}

/** Names used by a block's own fork condition and/or trailing expression - the "tail" past its own statement list. */
function tailUses(block: BasicBlock): Set<string> {
  const uses = new Set<string>();
  if (isSome(block.forkCondition)) {
    collectUses(block.forkCondition.value, uses);
  }
  if (isSome(block.trailingExpression)) {
    collectUses(block.trailingExpression.value, uses);
  }
  return uses;
}

/**
 * The last statement index (within `block.statements`) at which `name` is
 * used, starting the scan just after `declIndex`. Returns `block.statements.length`
 * (a sentinel past the last real index) if `name` is only used in the block's
 * own tail (fork condition / trailing expression), or `declIndex` itself if
 * `name` is never used again in this block.
 */
function localLastUseIndex(
  block: BasicBlock,
  name: string,
  declIndex: number,
): number {
  let last = declIndex;
  for (let index = declIndex + 1; index < block.statements.length; index += 1) {
    const statement = block.statements[index];
    if (statement === undefined) {
      continue;
    }
    const uses = new Set<string>();
    statementUses(statement, uses);
    if (uses.has(name)) {
      last = index;
    }
  }
  if (tailUses(block).has(name)) {
    last = block.statements.length;
  }
  return last;
}

/**
 * A binding's extent within a single block: its last use starting just after
 * `fromIndex` (see `localLastUseIndex`), or `+Infinity` if the binding is
 * still live out of this block (its extent continues into a successor
 * block, handled by `borrowsOverlap` via `reachSets`/`reachableWhileLive`).
 *
 * @param name - The binding's source name.
 * @param bindingId - The binding's own `BindingId`.
 * @param block - The block to compute the extent within.
 * @param liveness - The enclosing function's liveness dataflow result.
 * @param fromIndex - Where to start scanning for uses: the binding's own
 *   `declIndex` when `block` is where it was declared (`borrowLocalExtent`),
 *   or `-1` to scan the whole block when the binding merely enters `block`
 *   already live, from an earlier block (`borrowReachesInto`).
 *
 * @returns The last statement index at which `name` is used within `block`,
 *   or `Number.POSITIVE_INFINITY` if the binding remains live past it.
 */
function extentWithinBlock(
  name: string,
  bindingId: BindingId,
  block: BasicBlock,
  liveness: Liveness,
  fromIndex: number,
): number {
  const last = localLastUseIndex(block, name, fromIndex);
  const liveOut =
    liveness.blocks.get(block.id)?.liveOut ?? new Set<BindingId>();
  return liveOut.has(bindingId) ? Number.POSITIVE_INFINITY : last;
}

function borrowLocalExtent(
  borrow: Borrow,
  block: BasicBlock,
  liveness: Liveness,
): number {
  return extentWithinBlock(
    borrow.name,
    borrow.bindingId,
    block,
    liveness,
    borrow.declIndex,
  );
}

/**
 * Every block reachable from `startBlockId`'s successors while `bindingId`
 * remains live-in - the cross-block boundary condition `liveness.ts`'s module
 * doc describes as the missing half of NLL extent computation (the other half
 * being `borrowLocalExtent`'s intra-block last-use). Expansion stops the
 * moment a path's liveIn no longer contains `bindingId`, since that means the
 * binding is already dead along that path by the dataflow's own fixpoint.
 */
function requireBlock(
  blockById: ReadonlyMap<number, BasicBlock>,
  id: number,
): BasicBlock {
  const block = blockById.get(id);
  if (block === undefined) {
    throw new Error(`Unknown block ${String(id)}`);
  }
  return block;
}

function reachableWhileLive(
  startBlockId: number,
  bindingId: BindingId,
  blockById: ReadonlyMap<number, BasicBlock>,
  liveness: Liveness,
): ReadonlySet<number> {
  const visited = new Set<number>();
  const stack = [...requireBlock(blockById, startBlockId).successors];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || visited.has(id)) {
      continue;
    }
    const liveIn = liveness.blocks.get(id)?.liveIn ?? new Set<BindingId>();
    if (!liveIn.has(bindingId)) {
      continue;
    }
    visited.add(id);
    stack.push(...requireBlock(blockById, id).successors);
  }
  return visited;
}

/** Every borrow's own `reachableWhileLive` set, computed once so `checkExclusivity`'s pairwise loop never recomputes the same borrow's reach set against every other borrow it's compared to. */
function reachSetsOf(
  borrows: readonly Borrow[],
  blockById: ReadonlyMap<number, BasicBlock>,
  liveness: Liveness,
): ReadonlyMap<Borrow, ReadonlySet<number>> {
  return new Map(
    borrows.map((borrow) => [
      borrow,
      reachableWhileLive(borrow.blockId, borrow.bindingId, blockById, liveness),
    ]),
  );
}

/**
 * Whether `borrow` is still alive at `atBlock`'s own `declIndex`, for some
 * other borrow declared there. `reach` (from `reachableWhileLive`) only
 * establishes that `borrow` is live-in to `atBlock` - it says nothing about
 * *where within* `atBlock` `borrow` actually dies. Scanning `atBlock` from
 * its start (`extentWithinBlock(..., -1)`) answers that, so a borrow whose
 * last use falls early in a shared block isn't mistaken for still conflicting
 * with a later, unrelated borrow declared further down that same block.
 */
function borrowReachesInto(
  borrow: Borrow,
  reach: ReadonlySet<number>,
  atBlock: BasicBlock,
  declIndex: number,
  liveness: Liveness,
): boolean {
  if (!reach.has(atBlock.id)) {
    return false;
  }
  const extent = extentWithinBlock(
    borrow.name,
    borrow.bindingId,
    atBlock,
    liveness,
    -1,
  );
  return declIndex <= extent;
}

/**
 * Whether two borrows' extents overlap. Same-block borrows compare
 * declaration/end indices directly (`borrowLocalExtent`); cross-block borrows
 * overlap iff either borrow's binding is still live at the other's own
 * declaration point (`borrowReachesInto`), not merely live-in to its block.
 */
function borrowsOverlap(
  a: Borrow,
  b: Borrow,
  blockById: ReadonlyMap<number, BasicBlock>,
  liveness: Liveness,
  reachSets: ReadonlyMap<Borrow, ReadonlySet<number>>,
): boolean {
  if (a.blockId === b.blockId) {
    const block = requireBlock(blockById, a.blockId);
    const aEnd = borrowLocalExtent(a, block, liveness);
    const bEnd = borrowLocalExtent(b, block, liveness);
    return a.declIndex <= bEnd && b.declIndex <= aEnd;
  }
  const aReach = reachSets.get(a) ?? new Set<number>();
  const bReach = reachSets.get(b) ?? new Set<number>();
  return (
    borrowReachesInto(
      a,
      aReach,
      requireBlock(blockById, b.blockId),
      b.declIndex,
      liveness,
    ) ||
    borrowReachesInto(
      b,
      bReach,
      requireBlock(blockById, a.blockId),
      a.declIndex,
      liveness,
    )
  );
}

/**
 * Collect borrows created anywhere in the graph by `let r = &[mut] base;`.
 * Discovers borrows in every block, not just the entry block - fixes a real
 * gap where a borrow declared inside an `if`/`else` branch was previously
 * invisible to the checker entirely (see the module's own history).
 */
function collectBorrowsFromGraph(
  graph: ControlFlowGraph,
  baseIds: ReadonlyMap<Semantics.LetStatement, BindingId>,
): Borrow[] {
  const borrows: Borrow[] = [];
  for (const block of graph.blocks) {
    for (let index = 0; index < block.statements.length; index += 1) {
      const statement = block.statements[index];
      if (statement === undefined || statement.kind !== "LetStatement") {
        continue;
      }
      // A bare `&`/`&mut` borrow initializer only ever makes sense against a
      // pattern binding exactly one name - a destructuring pattern combined
      // with a `&expr` initializer (e.g. matching-by-reference through a
      // struct pattern) is real syntax (Hedge-47's binding-mode work) but a
      // distinct concern from this single-binding borrow list, so it's
      // conservatively skipped here rather than guessed at.
      const declarations = declarationsOf(statement.pattern);
      if (declarations.length !== 1) {
        continue;
      }
      const declaration = declarations[0];
      if (declaration === undefined) {
        continue;
      }
      const { initializer } = statement;
      if (!isSome(initializer)) {
        continue;
      }
      const init = initializer.value;
      if (init.kind !== "ReferenceExpression") {
        continue;
      }
      const path = placeOf(init.operand);
      if (path === undefined) {
        continue;
      }
      borrows.push({
        name: declaration.name,
        bindingId: declaration.id,
        place: { ...path, baseId: baseIds.get(statement) },
        capability: capabilityDecision(init.operand, true),
        mutable: init.mutable,
        blockId: block.id,
        declIndex: index,
        tokenId: init.tokenId,
      });
    }
  }
  return borrows;
}

/** Map each reachable declaration (params and every block-owned `let`) to whether it was declared with the `mut` capability, keyed by `BindingId` so same-named bindings in different scopes never collide (see the module doc). */
function capabilitiesFromDeclarations(
  declarations: readonly Declaration[],
): Map<BindingId, boolean> {
  const capabilities = new Map<BindingId, boolean>();
  for (const declaration of declarations) {
    capabilities.set(declaration.id, declaration.mutable);
  }
  return capabilities;
}

/**
 * Describe a borrow for diagnostic messages.
 */
function describeBorrow(borrow: Borrow): string {
  return borrow.mutable ? "&mut" : "&";
}

function spanOf(tokens: readonly Token[], id: number): Option<Span> {
  const token = tokens[id];
  return token !== undefined ? some(token.span) : none();
}

/** `id` always comes from a real parsed `ReferenceExpression`'s own `tokenId`, so a missing token here is unreachable given a well-formed compile - an ICE, not a legitimate "unknown offset" (offset `0` would otherwise look like a plausible real location). */
function offsetOf(tokens: readonly Token[], id: number): number {
  const token = tokens[id];
  assert(token !== undefined, `Unknown token ${String(id)}`);
  return token.span.start;
}

function checkCapabilities(
  borrows: readonly Borrow[],
  capabilities: ReadonlyMap<BindingId, boolean>,
  diagnostics: Diagnostic[],
  tokens: readonly Token[],
): void {
  for (const borrow of borrows) {
    if (!borrow.mutable) {
      continue;
    }
    switch (borrow.capability.kind) {
      case "allowed":
        continue;
      case "blocked":
        diagnostics.push({
          severity: "error",
          message: `cannot borrow \`${describePlace(borrow.place)}\` as mutable because \`${borrow.capability.through}\` is a shared reference.`,
          span: spanOf(tokens, borrow.tokenId),
          code: some("HEDGE-BORROW-CHECK-002"),
          relatedSpans: [],
        });
        continue;
      case "root-mut-required":
        if (
          borrow.place.baseId !== undefined &&
          capabilities.get(borrow.place.baseId) === false
        ) {
          diagnostics.push({
            severity: "error",
            message: `Cannot borrow "${borrow.place.baseName}" as &mut because it is not declared mut.`,
            span: spanOf(tokens, borrow.tokenId),
            code: some("HEDGE-BORROW-CHECK-002"),
            relatedSpans: [],
          });
        }
        continue;
      default:
        assertNever(borrow.capability);
    }
  }
}

/**
 * Conflicts are checked pairwise, over every borrow anywhere in the function
 * (not just its entry block - see `collectBorrowsFromGraph`), using
 * `borrowsOverlap` to combine intra-block last-use with cross-block liveness
 * as the extent's boundary condition.
 */
function checkExclusivity(
  borrows: readonly Borrow[],
  blockById: ReadonlyMap<number, BasicBlock>,
  liveness: Liveness,
  diagnostics: Diagnostic[],
  tokens: readonly Token[],
): void {
  const reachSets = reachSetsOf(borrows, blockById, liveness);
  for (let i = 0; i < borrows.length; i += 1) {
    const a = borrows[i];
    if (a === undefined) {
      continue;
    }
    for (let j = i + 1; j < borrows.length; j += 1) {
      const b = borrows[j];
      if (b === undefined || !samePlaceBase(a.place, b.place)) {
        continue;
      }
      if (!a.mutable && !b.mutable) {
        continue; // any number of shared borrows may coexist
      }
      if (!placesOverlap(a.place, b.place)) {
        continue; // statically distinct places (e.g. disjoint fields) never conflict
      }
      if (!borrowsOverlap(a, b, blockById, liveness, reachSets)) {
        continue; // the borrows are not simultaneously live
      }
      const firstBorrowSpan = spanOf(tokens, a.tokenId);
      diagnostics.push({
        severity: "error",
        message:
          `Conflicting borrows of "${describePlace(a.place)}": ${describeBorrow(a)} at offset ${String(offsetOf(tokens, a.tokenId))} ` +
          `and ${describeBorrow(b)} at offset ${String(offsetOf(tokens, b.tokenId))} are both live.`,
        span: spanOf(tokens, b.tokenId),
        code: some("HEDGE-BORROW-CHECK-001"),
        relatedSpans: isSome(firstBorrowSpan)
          ? [
              {
                span: firstBorrowSpan.value,
                label: `${describeBorrow(a)} borrow here`,
              },
            ]
          : [],
      });
    }
  }
}

function checkFunction(
  fn: Semantics.FunctionDecl,
  diagnostics: Diagnostic[],
  tokens: readonly Token[],
): void {
  const graph = buildControlFlowGraph(fn);
  const liveness = computeLiveness(graph);
  const blockById = new Map<number, BasicBlock>(
    graph.blocks.map((block) => [block.id, block]),
  );
  const baseIds = resolveBorrowBases(fn);
  const borrows = collectBorrowsFromGraph(graph, baseIds);
  const capabilities = capabilitiesFromDeclarations(collectDeclarations(graph));
  checkCapabilities(borrows, capabilities, diagnostics, tokens);
  checkExclusivity(borrows, blockById, liveness, diagnostics, tokens);
}

function checkItem(
  item: Semantics.Item,
  diagnostics: Diagnostic[],
  tokens: readonly Token[],
): void {
  if (item.kind === "Function") {
    checkFunction(item, diagnostics, tokens);
  }
}

/**
 * NLL ownership analysis: enforces `&mut` capability and borrow exclusivity
 * (at most one `&mut` xor any number of `&`) using per-function CFG/liveness
 * (`control-flow-graph.ts`/`liveness.ts`, from #21) so that borrow extents end
 * at last use across block boundaries, not just within one straight-line list.
 *
 * @param program The semantically analyzed program.
 * @param tokens The array of tokens.
 *
 * @returns An array of diagnostics indicating any borrow-checking violations found in the program.
 */
export function checkBorrows(
  program: Semantics.Program,
  tokens: readonly Token[],
): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const item of program.items) {
    checkItem(item, diagnostics, tokens);
  }
  return diagnostics;
}

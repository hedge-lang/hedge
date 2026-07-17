import { assertNever } from "../assert.js";
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
  declarationOf,
} from "./control-flow-graph.js";
import { computeLiveness, type Liveness } from "./liveness.js";

/**
 * A borrow introduced by `let r = &[mut] base;`, tagged with the CFG block
 * and intra-block statement index it was declared at (see `collectBorrowsFromGraph`).
 */
interface Borrow {
  /** The borrowing binding's own name. */
  readonly name: string;
  /** The borrowing binding's own `BindingId` (its declaration's tokenId). */
  readonly bindingId: BindingId;
  /** The borrowed variable's name. Not resolved to a `BindingId` - see the module doc. */
  readonly base: string;
  readonly mutable: boolean;
  readonly blockId: number;
  /** Index into `block.statements` where this borrow's own `let` lands. */
  readonly declIndex: number;
  /** The token ID of the reference, used for diagnostics. */
  readonly tokenId: number;
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
 * A borrow's extent within its own declaring block: its last intra-block use
 * (see `localLastUseIndex`), or `+Infinity` if the borrowing binding is still
 * live out of this block (its extent continues into a successor block, and
 * `borrowsOverlap` handles that continuation via `reachableWhileLive`).
 */
function borrowLocalExtent(
  borrow: Borrow,
  block: BasicBlock,
  liveness: Liveness,
): number {
  const last = localLastUseIndex(block, borrow.name, borrow.declIndex);
  const liveOut =
    liveness.blocks.get(block.id)?.liveOut ?? new Set<BindingId>();
  return liveOut.has(borrow.bindingId) ? Number.POSITIVE_INFINITY : last;
}

/**
 * Every block reachable from `startBlockId`'s successors while `bindingId`
 * remains live-in - the cross-block boundary condition `liveness.ts`'s module
 * doc describes as the missing half of NLL extent computation (the other half
 * being `borrowLocalExtent`'s intra-block last-use). Expansion stops the
 * moment a path's liveIn no longer contains `bindingId`, since that means the
 * binding is already dead along that path by the dataflow's own fixpoint.
 */
function reachableWhileLive(
  startBlockId: number,
  bindingId: BindingId,
  blockById: ReadonlyMap<number, BasicBlock>,
  liveness: Liveness,
): ReadonlySet<number> {
  const visited = new Set<number>();
  const start = blockById.get(startBlockId);
  if (start === undefined) {
    return visited;
  }
  const stack = [...start.successors];
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
    const block = blockById.get(id);
    if (block !== undefined) {
      stack.push(...block.successors);
    }
  }
  return visited;
}

/**
 * Whether two borrows' extents overlap. Same-block borrows compare
 * declaration/end indices directly (`borrowLocalExtent`); cross-block borrows
 * overlap iff either borrow's binding is still live by the time the other's
 * declaring block is reached (`reachableWhileLive`).
 */
function borrowsOverlap(
  a: Borrow,
  b: Borrow,
  blockById: ReadonlyMap<number, BasicBlock>,
  liveness: Liveness,
): boolean {
  if (a.blockId === b.blockId) {
    const block = blockById.get(a.blockId);
    if (block === undefined) {
      return false;
    }
    const aEnd = borrowLocalExtent(a, block, liveness);
    const bEnd = borrowLocalExtent(b, block, liveness);
    return a.declIndex <= bEnd && b.declIndex <= aEnd;
  }
  const aReach = reachableWhileLive(a.blockId, a.bindingId, blockById, liveness);
  const bReach = reachableWhileLive(b.blockId, b.bindingId, blockById, liveness);
  return aReach.has(b.blockId) || bReach.has(a.blockId);
}

/**
 * Collect borrows created anywhere in the graph by `let r = &[mut] base;`.
 * Discovers borrows in every block, not just the entry block - fixes a real
 * gap where a borrow declared inside an `if`/`else` branch was previously
 * invisible to the checker entirely (see the module's own history).
 */
function collectBorrowsFromGraph(graph: ControlFlowGraph): Borrow[] {
  const borrows: Borrow[] = [];
  for (const block of graph.blocks) {
    for (let index = 0; index < block.statements.length; index += 1) {
      const statement = block.statements[index];
      if (statement === undefined || statement.kind !== "LetStatement") {
        continue;
      }
      const declaration = declarationOf(statement.pattern, statement.mutable);
      if (!isSome(declaration)) {
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
      const { operand } = init;
      if (operand.kind !== "PathExpression") {
        continue;
      }
      const { segments } = operand.path;
      const base = segments.length === 1 ? segments[0] : undefined;
      if (base === undefined) {
        continue;
      }
      borrows.push({
        name: declaration.value.name,
        bindingId: declaration.value.id,
        base,
        mutable: init.mutable,
        blockId: block.id,
        declIndex: index,
        tokenId: init.tokenId,
      });
    }
  }
  return borrows;
}

/** Map each reachable declaration (params and every block-owned `let`) to whether it was declared with the `mut` capability. */
function capabilitiesFromDeclarations(
  declarations: readonly Declaration[],
): Map<string, boolean> {
  const capabilities = new Map<string, boolean>();
  for (const declaration of declarations) {
    capabilities.set(declaration.name, declaration.mutable);
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

function offsetOf(tokens: readonly Token[], id: number): number {
  return tokens[id]?.span.start ?? 0;
}

function checkCapabilities(
  borrows: readonly Borrow[],
  capabilities: ReadonlyMap<string, boolean>,
  diagnostics: Diagnostic[],
  tokens: readonly Token[],
): void {
  for (const borrow of borrows) {
    if (borrow.mutable && capabilities.get(borrow.base) === false) {
      diagnostics.push({
        severity: "error",
        message: `Cannot borrow "${borrow.base}" as &mut because it is not declared mut.`,
        span: spanOf(tokens, borrow.tokenId),
      });
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
  for (let i = 0; i < borrows.length; i += 1) {
    const a = borrows[i];
    if (a === undefined) {
      continue;
    }
    for (let j = i + 1; j < borrows.length; j += 1) {
      const b = borrows[j];
      if (b === undefined || a.base !== b.base) {
        continue;
      }
      if (!a.mutable && !b.mutable) {
        continue; // any number of shared borrows may coexist
      }
      if (!borrowsOverlap(a, b, blockById, liveness)) {
        continue; // the borrows are not simultaneously live
      }
      diagnostics.push({
        severity: "error",
        message:
          `Conflicting borrows of "${a.base}": ${describeBorrow(a)} at offset ${String(offsetOf(tokens, a.tokenId))} ` +
          `and ${describeBorrow(b)} at offset ${String(offsetOf(tokens, b.tokenId))} are both live.`,
        span: spanOf(tokens, b.tokenId),
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
  const borrows = collectBorrowsFromGraph(graph);
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

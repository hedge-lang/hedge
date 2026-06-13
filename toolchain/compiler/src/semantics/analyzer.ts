import type { Diagnostic } from "../diagnostics.js";
import type {
  Block,
  CallExpression,
  Expression,
  FunctionDecl,
  Item,
  LetStatement,
  PathExpression,
  Program,
  Statement,
} from "../parser/ast.js";

export interface AnalysisResult {
  readonly diagnostics: readonly Diagnostic[];
}

/** Names available before any user code. A slice-1 stand-in for the prelude. */
const BUILTINS: readonly string[] = ["print"];

function assertNever(value: never): never {
  throw new Error(`Unexpected AST node: ${JSON.stringify(value)}`);
}

/**
 * Walks the AST resolving names against a lexical scope stack and collecting
 * diagnostics. Slice-1 scope: a builtin prelude, then per-function and per-block
 * scopes; `let` binds into the current scope after its initializer is analyzed.
 */
class Analyzer {
  private readonly scopes: Set<string>[] = [new Set(BUILTINS)];
  private readonly diagnostics: Diagnostic[] = [];

  public run(program: Program): AnalysisResult {
    for (const item of program.items) {
      this.item(item);
    }
    return { diagnostics: this.diagnostics };
  }

  private item(item: Item): void {
    switch (item.kind) {
      case "Function":
        this.functionDecl(item);
        return;
      case "LetStatement":
      case "ExpressionStatement":
        this.statement(item);
        return;
      default:
        this.expression(item);
    }
  }

  private functionDecl(decl: FunctionDecl): void {
    this.block(decl.body);
  }

  private block(block: Block): void {
    this.scopes.push(new Set());
    for (const statement of block.statements) {
      this.statement(statement);
    }
    if (block.trailingExpression !== null) {
      this.expression(block.trailingExpression);
    }
    this.scopes.pop();
  }

  private statement(statement: Statement): void {
    switch (statement.kind) {
      case "LetStatement":
        this.letStatement(statement);
        return;
      case "ExpressionStatement":
        this.expression(statement.expression);
        return;
      default:
        assertNever(statement);
    }
  }

  private letStatement(statement: LetStatement): void {
    if (statement.initializer !== null) {
      this.expression(statement.initializer);
    }
    this.bind(statement.pattern.name.text);
  }

  private expression(expression: Expression): void {
    switch (expression.kind) {
      case "StringLiteral":
      case "IntLiteral":
        return;
      case "PathExpression":
        this.path(expression);
        return;
      case "CallExpression":
        this.call(expression);
        return;
      default:
        assertNever(expression);
    }
  }

  private call(call: CallExpression): void {
    this.expression(call.callee);
    for (const argument of call.arguments) {
      this.expression(argument);
    }
  }

  private path(path: PathExpression): void {
    const { segments } = path.path;
    // Multi-segment paths (modules, associated items) are a later slice.
    if (segments.length !== 1) {
      return;
    }
    const name = segments[0];
    if (name === undefined || this.resolve(name)) {
      return;
    }
    this.error(`Cannot find name "${name}" in this scope.`, path.tokenId);
  }

  private bind(name: string): void {
    const scope = this.scopes[this.scopes.length - 1];
    if (scope !== undefined) {
      scope.add(name);
    }
  }

  private resolve(name: string): boolean {
    for (let i = this.scopes.length - 1; i >= 0; i -= 1) {
      const scope = this.scopes[i];
      if (scope !== undefined && scope.has(name)) {
        return true;
      }
    }
    return false;
  }

  private error(message: string, tokenId: number): void {
    this.diagnostics.push({ severity: "error", message, tokenId });
  }
}

/** Run semantic analysis (name resolution) over a parsed program. */
export function analyze(program: Program): AnalysisResult {
  return new Analyzer().run(program);
}

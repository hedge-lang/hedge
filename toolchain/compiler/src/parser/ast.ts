import { assertNever } from "../assert.js";
import { none, some, type Option } from "../option.js";
import type { FloatSuffix, IntSuffix } from "../lexer/token.js";
export type { IntSuffix, FloatSuffix } from "../lexer/token.js";

/** Every AST node carries the index of the token that begins it. */
export interface AstNode {
  readonly tokenId: number;
}

export interface Program {
  readonly kind: "Program";
  readonly items: Item[];
  readonly attributes: readonly Attribute[];
}

export interface Attribute {
  readonly kind: "Attribute";
  readonly name: Identifier;
  readonly arguments: Option<
    { path: Option<Path>; literal: Option<StringLiteral | IntLiteral> }[]
  >;
}

/** A top-level entry. Slice 1 is lenient and also accepts bare statements. */
export type Item =
  | FunctionDecl
  | StructDecl
  | EnumDecl
  | ConstDecl
  | StaticDecl
  | Statement
  | Expression;

export type Statement =
  | LetStatement
  | ExpressionStatement
  | FunctionDecl
  | StructDecl
  | EnumDecl
  | ConstDecl
  | StaticDecl;

export type BinaryOperator =
  | "Add"
  | "Sub"
  | "Mul"
  | "Div"
  | "Rem"
  | "Shl"
  | "Shr"
  | "BitAnd"
  | "BitXor"
  | "BitOr"
  | "Eq"
  | "Ne"
  | "Lt"
  | "Gt"
  | "Le"
  | "Ge"
  | "And"
  | "Or";

export type CompoundAssignOperator =
  | "AddAssign"
  | "SubAssign"
  | "MulAssign"
  | "DivAssign"
  | "RemAssign"
  | "BitAndAssign"
  | "BitOrAssign"
  | "BitXorAssign"
  | "ShlAssign"
  | "ShrAssign";

export type Expression =
  | StringLiteral
  | IntLiteral
  | FloatLiteral
  | BoolLiteral
  | CharLiteral
  | PathExpression
  | CallExpression
  | ReferenceExpression
  | DereferenceExpression
  | BinaryExpression
  | UnaryExpression
  | AssignExpression
  | CompoundAssignExpression
  | FieldAccessExpression
  | MethodCallExpression
  | IndexExpression
  | TupleExpression
  | ArrayExpression
  | ArrayRepeatExpression
  | StructExpression
  | RangeExpression
  | IfExpression
  | LetExpression
  | MatchExpression
  | WhileExpression
  | Block
  | Identifier;

export interface Visibility {
  readonly kind: "Visibility";
  /** `none()` for bare `pub`; `some("package")` for `pub(package)`, etc. */
  readonly scope: Option<string>;
}

export interface Param extends AstNode {
  readonly kind: "Param";
  readonly pattern: Pattern;
  readonly type: Type;
}

export interface FunctionDecl extends AstNode {
  readonly kind: "Function";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly generics: readonly GenericParam[];
  readonly params: readonly Param[];
  readonly returnType: Option<Type>;
  readonly whereClause: Option<WhereClause>;
  readonly attributes: readonly Attribute[];
  readonly body: Block;
}

export interface StructDecl extends AstNode {
  readonly kind: "Struct";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly generics: readonly GenericParam[];
  readonly whereClause: Option<WhereClause>;
  readonly body: StructBody;
  readonly attributes: readonly Attribute[];
}

/**
 * `const NAME: Type = Expression;` - a compile-time constant. Legal at the
 * top level and inside a function body (see `parser/statement.ts`'s local
 * item dispatch).
 */
export interface ConstDecl extends AstNode {
  readonly kind: "Const";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly type: Type;
  readonly value: Expression;
  readonly attributes: readonly Attribute[];
}

/**
 * `static NAME: Type = Expression;` - a lazily-initialized, module-level
 * singleton. Only legal at the top level, unlike `ConstDecl` - a local
 * static's initializer could otherwise reference an enclosing function's
 * local variable, but the static only ever initializes once.
 */
export interface StaticDecl extends AstNode {
  readonly kind: "Static";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly type: Type;
  readonly value: Expression;
  readonly attributes: readonly Attribute[];
}

export type StructBody = NamedFieldsBody | TupleFieldsBody | UnitBody;

export interface NamedFieldsBody {
  readonly kind: "NamedFields";
  readonly fields: readonly StructField[];
}

export interface TupleFieldsBody {
  readonly kind: "TupleFields";
  readonly fields: readonly TupleField[];
}

export interface UnitBody {
  readonly kind: "Unit";
}

export interface StructField extends AstNode {
  readonly kind: "StructField";
  readonly attributes: readonly Attribute[];
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly type: Type;
}

export interface TupleField extends AstNode {
  readonly kind: "TupleField";
  readonly attributes: readonly Attribute[];
  readonly visibility: Option<Visibility>;
  readonly type: Type;
}

export interface EnumDecl extends AstNode {
  readonly kind: "Enum";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly generics: readonly GenericParam[];
  readonly whereClause: Option<WhereClause>;
  readonly variants: readonly Variant[];
  readonly attributes: readonly Attribute[];
}

/**
 * `body` is `none()` for a bare/unit variant - no `UnitBody` member is needed,
 * since the grammar's optionality already distinguishes a bare variant from an
 * explicit empty body (`Write {}` / `Move()`), which parses to `some(...)`
 * with zero fields.
 *
 * No `visibility` field: spec 0014 gives a variant no `pub` of its own - it
 * always shares its enum's visibility.
 */
export interface Variant extends AstNode {
  readonly kind: "Variant";
  readonly attributes: readonly Attribute[];
  readonly name: Identifier;
  readonly body: Option<NamedFieldsBody | TupleFieldsBody>;
}

export interface Block extends AstNode {
  readonly kind: "Block";
  readonly statements: Statement[];
  readonly trailingExpression: Option<Expression>;
  readonly innerAttributes: readonly Attribute[];
}

export interface LetStatement extends AstNode {
  readonly kind: "LetStatement";
  readonly attributes: readonly Attribute[];
  readonly pattern: Pattern;
  readonly type: Option<Type>;
  readonly initializer: Option<Expression>;
}

export type Pattern =
  | BindingPattern
  | WildcardPattern
  | LiteralPattern
  | RangePattern
  | OrPattern
  | TuplePattern
  | StructPattern
  | TupleStructPattern
  | PathPattern
  | SlicePattern;

export interface BindingPattern extends AstNode {
  readonly kind: "BindingPattern";
  readonly mutable: boolean;
  /** `true` for a leading `&`/`&mut` sigil (bind-by-borrow). */
  readonly byRef: boolean;
  readonly name: Identifier;
  /** `some(...)` for `name @ subpattern` - `none()` for a plain binding. */
  readonly subpattern: Option<Pattern>;
}

export interface WildcardPattern extends AstNode {
  readonly kind: "WildcardPattern";
}

/**
 * A bare literal used as a pattern (`match x { 1 => ..., "hi" => ... }`).
 * Reuses the same literal node types as expression position rather than a
 * parallel pattern-only literal AST, since a pattern literal's shape is
 * identical to an expression literal - only its position differs.
 */
export interface LiteralPattern extends AstNode {
  readonly kind: "LiteralPattern";
  /** `true` for a leading `-` (numeric literals only - see `parsePattern`). */
  readonly negative: boolean;
  readonly literal:
    StringLiteral | IntLiteral | FloatLiteral | CharLiteral | BoolLiteral;
}

/** A pattern-literal bound of a `RangePattern` (`1..=5`, `-5..=-1`). */
export interface RangePatternBound {
  readonly negative: boolean;
  readonly literal:
    StringLiteral | IntLiteral | FloatLiteral | CharLiteral | BoolLiteral;
}

export interface RangePattern extends AstNode {
  readonly kind: "RangePattern";
  readonly start: RangePatternBound;
  readonly end: RangePatternBound;
}

/**
 * `1 | 2 | 3`, `Ok(x) | Recovered(x)` - a flat list of alternatives, never a
 * right-nested tree of two-element `OrPattern`s (see `parser/pattern.ts`'s
 * `parsePattern`). Every alternative must bind the same names with the same
 * types and modes (spec 0016) - that consistency check is semantic
 * analysis's job, not parsing's.
 */
export interface OrPattern extends AstNode {
  readonly kind: "OrPattern";
  readonly alternatives: readonly Pattern[];
}

/**
 * `(a, b)` - zero elements is the unit pattern `()`, one element (with or
 * without a trailing comma) is a genuine one-element tuple pattern - the
 * grammar has no separate parenthesized-grouping production competing for
 * that shape (see `parser/pattern.ts`'s `parseTuplePattern`).
 */
export interface TuplePattern extends AstNode {
  readonly kind: "TuplePattern";
  readonly elements: readonly Pattern[];
}

/** `x` (shorthand, binds a new `x`) or `x: pattern` (explicit sub-pattern). */
export interface FieldPattern extends AstNode {
  readonly kind: "FieldPattern";
  readonly name: Identifier;
  readonly pattern: Option<Pattern>;
}

/**
 * `Point { x, y }`, `Point { x: a, .. }`. `path` can be multi-segment
 * (`Message::Move { x, y }`) since the parser routes any path immediately
 * followed by `{` here regardless of segment count - not just single-segment
 * struct names - even though there's no real module resolution yet
 * (Slice 7) to make a qualified path meaningfully different from an
 * unqualified one.
 */
export interface StructPattern extends AstNode {
  readonly kind: "StructPattern";
  readonly path: Path;
  /** `true` for a leading `mut` sigil - treats the whole
   * destructured value as mutable for binding-mode legality purposes (e.g.
   * a field's own `&mut` override), since the pattern itself binds no name
   * of its own to carry that mutability the way a plain `BindingPattern`
   * would. */
  readonly mutable: boolean;
  readonly fields: readonly FieldPattern[];
  /** `true` for a trailing `..` (ignore any unlisted fields). */
  readonly hasRest: boolean;
}

/**
 * `Point(a, b)`, `Message::Move(a, b)` - `path` is single-segment for a
 * plain tuple struct or multi-segment for an enum variant.
 */
export interface TupleStructPattern extends AstNode {
  readonly kind: "TupleStructPattern";
  readonly path: Path;
  /** See `StructPattern.mutable`'s doc comment. */
  readonly mutable: boolean;
  readonly elements: readonly Pattern[];
}

/**
 * A bare constructor path used as a pattern with no call/brace suffix -
 * e.g. a unit enum variant (`Message::Quit`). Only reachable for a
 * genuinely unambiguous path: multi-segment, or immediately followed by
 * `(`/`{` (which route to `TupleStructPattern`/`StructPattern` instead). A
 * bare single-segment identifier always parses as `BindingPattern` -
 * Hedge has no name resolution at parse time to tell a fresh binding
 * apart from a reference to a same-named constant or unit variant (see
 * spec 0016).
 */
export interface PathPattern extends AstNode {
  readonly kind: "PathPattern";
  readonly path: Path;
}

/**
 * `..`, `..tail`, `..&rest`, `..&mut rest` - a slice pattern's rest element.
 * Not itself a member of `Pattern`: it is only ever valid as one element of
 * a `SlicePattern`'s `elements` list, mirroring how `ArrayRepeatExpression`
 * isn't a general `Expression` either. Grammar (spec 0025, with the `..`-
 * before-binding order corrected - see `parser/pattern.ts`):
 *
 * ```text
 * RestPat ::= ".." ( "&" "mut"? Identifier | Identifier )?
 * ```
 *
 * Only the byRef alternative allows an optional `mut`; a bare (non-`&`)
 * rest binding never does, per the grammar as written.
 */
export interface RestPattern extends AstNode {
  readonly kind: "RestPattern";
  readonly byRef: boolean;
  readonly mutable: boolean;
  readonly name: Option<Identifier>;
}

/**
 * `[first, .., last]`, `[head, ..tail]`. At most one `RestPattern` element
 * is meaningful, but the parser does not enforce that arity - see
 * `parser/pattern.ts`'s `parseSlicePattern` doc comment.
 */
export interface SlicePattern extends AstNode {
  readonly kind: "SlicePattern";
  readonly elements: readonly (Pattern | RestPattern)[];
}

export function patternMutable(pattern: Pattern): boolean {
  switch (pattern.kind) {
    case "BindingPattern":
      return pattern.mutable;
    case "WildcardPattern":
    case "LiteralPattern":
    case "RangePattern":
    case "OrPattern":
    case "TuplePattern":
    case "StructPattern":
    case "TupleStructPattern":
    case "PathPattern":
    case "SlicePattern":
      return false;
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

export function patternBindingName(pattern: Pattern): Option<string> {
  switch (pattern.kind) {
    case "BindingPattern":
      return some(pattern.name.text);
    case "WildcardPattern":
    case "LiteralPattern":
    case "RangePattern":
    case "OrPattern":
    case "TuplePattern":
    case "StructPattern":
    case "TupleStructPattern":
    case "PathPattern":
    case "SlicePattern":
      return none();
    default:
      return assertNever(
        pattern,
        `Unexpected pattern: ${JSON.stringify(pattern)}`,
      );
  }
}

export interface ExpressionStatement extends AstNode {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
}

export interface Identifier extends AstNode {
  readonly kind: "Identifier";
  readonly text: string;
}

export interface StringLiteral extends AstNode {
  readonly kind: "StringLiteral";
  readonly value: string;
}

export interface IntLiteral extends AstNode {
  readonly kind: "IntLiteral";
  /** Digits only - no prefix, underscores stripped. */
  readonly value: string;
  readonly base: 10 | 16 | 8 | 2;
  readonly suffix: Option<IntSuffix>;
}

export interface FloatLiteral extends AstNode {
  readonly kind: "FloatLiteral";
  /** Full normalized text, underscores stripped. */
  readonly value: string;
  readonly suffix: Option<FloatSuffix>;
}

export interface BoolLiteral extends AstNode {
  readonly kind: "BoolLiteral";
  readonly value: boolean;
}

export interface CharLiteral extends AstNode {
  readonly kind: "CharLiteral";
  /** Resolved character (after escape decoding). */
  readonly value: string;
}

export interface Path {
  readonly absolute: boolean;
  readonly segments: string[];
}

export type Type = NamedType | UnitType | ReferenceType | ArrayType;

export interface NamedType extends AstNode {
  readonly kind: "NamedType";
  readonly path: Path;
}

export interface UnitType extends AstNode {
  readonly kind: "UnitType";
}

/**
 * `&T` / `&mut T` / `&'a T` / `&'a mut T`. `lifetime` is `none()` only
 * transiently between parsing and the lifetime-elision pass - every
 * `ReferenceType` in a `Program` returned by `parse()` has `some(...)` here,
 * either the source's explicit annotation or a synthesized one.
 */
export interface ReferenceType extends AstNode {
  readonly kind: "ReferenceType";
  readonly mutable: boolean;
  readonly lifetime: Option<Lifetime>;
  readonly referent: Type;
}

/**
 * `[T; N]` - a fixed-size array type. `length` is a general `Expression` per
 * the grammar, though semantic analysis currently accepts only a literal
 * integer (no const-evaluation exists yet). The distinct, semicolon-less
 * slice-type grammar `[T]` is a separate, still-unsupported construct
 * (`parseType`'s own guardrail), not a degenerate case of this type.
 */
export interface ArrayType extends AstNode {
  readonly kind: "ArrayType";
  readonly elementType: Type;
  readonly length: Expression;
}

/** `'a` - bare name, no leading `'`. May be a synthesized name (`_0`, `_1`, ...). */
export interface Lifetime extends AstNode {
  readonly kind: "Lifetime";
  readonly name: string;
}

export type GenericParam = LifetimeParam | TypeParam;

export interface LifetimeParam extends AstNode {
  readonly kind: "LifetimeParam";
  readonly lifetime: Lifetime;
}

export interface TypeParam extends AstNode {
  readonly kind: "TypeParam";
  readonly name: Identifier;
  readonly bounds: readonly TraitBound[];
}

export type TraitBound = PathTraitBound | LifetimeTraitBound;

/** `Draw`, `From<U>` - a trait name with optional type arguments (same
 * category as a turbofish's, see `parseTraitBoundTypeArguments`). A
 * compound argument (`Foo<Bar<Baz>>`) still hits the Type-position
 * generics guardrail one level down. */
export interface PathTraitBound extends AstNode {
  readonly kind: "PathTraitBound";
  readonly path: Path;
  readonly typeArguments: readonly Type[];
}

/** `'a` used as a bound (`T: 'a`). */
export interface LifetimeTraitBound extends AstNode {
  readonly kind: "LifetimeTraitBound";
  readonly lifetime: Lifetime;
}

export interface WhereClause {
  readonly kind: "WhereClause";
  readonly predicates: readonly WherePredicate[];
}

export interface WherePredicate extends AstNode {
  readonly kind: "WherePredicate";
  readonly type: Type;
  readonly bounds: readonly TraitBound[];
}

export interface PathExpression extends AstNode {
  readonly kind: "PathExpression";
  readonly path: Path;
  /** Explicit turbofish arguments (`first::<i32>`); empty for no turbofish. */
  readonly typeArguments: readonly Type[];
}

export interface CallExpression extends AstNode {
  readonly kind: "CallExpression";
  readonly callee: Expression;
  readonly arguments: Expression[];
}

export interface ReferenceExpression extends AstNode {
  readonly kind: "ReferenceExpression";
  /** `true` for `&mut` (exclusive), `false` for `&` (shared). */
  readonly mutable: boolean;
  readonly operand: Expression;
}

export interface DereferenceExpression extends AstNode {
  readonly kind: "DereferenceExpression";
  readonly operand: Expression;
}

export interface BinaryExpression extends AstNode {
  readonly kind: "BinaryExpression";
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
}

export interface UnaryExpression extends AstNode {
  readonly kind: "UnaryExpression";
  readonly operator: "Neg" | "Not";
  readonly operand: Expression;
}

export interface AssignExpression extends AstNode {
  readonly kind: "AssignExpression";
  readonly lhs: Expression;
  readonly rhs: Expression;
}

export interface CompoundAssignExpression extends AstNode {
  readonly kind: "CompoundAssignExpression";
  readonly operator: CompoundAssignOperator;
  readonly lhs: Expression;
  readonly rhs: Expression;
}

export interface FieldAccessExpression extends AstNode {
  readonly kind: "FieldAccessExpression";
  readonly object: Expression;
  readonly field: Identifier;
}

export interface MethodCallExpression extends AstNode {
  readonly kind: "MethodCallExpression";
  readonly receiver: Expression;
  readonly method: Identifier;
  /** Explicit turbofish arguments (`x.method::<i32>()`); empty for none. */
  readonly typeArguments: readonly Type[];
  readonly arguments: Expression[];
}

export interface IndexExpression extends AstNode {
  readonly kind: "IndexExpression";
  readonly object: Expression;
  readonly index: Expression;
}

export interface TupleExpression extends AstNode {
  readonly kind: "TupleExpression";
  /** Zero elements = unit `()`. One element with trailing comma = single-element tuple. */
  readonly elements: Expression[];
}

/** `[a, b, c]` - the list form of an array literal (grammar's `ArrayElems`, comma-separated branch). */
export interface ArrayExpression extends AstNode {
  readonly kind: "ArrayExpression";
  readonly elements: Expression[];
}

/** `[value; count]` - the repeat form of an array literal (grammar's `ArrayElems`, `Expression ";" Expression` branch). */
export interface ArrayRepeatExpression extends AstNode {
  readonly kind: "ArrayRepeatExpression";
  readonly value: Expression;
  readonly count: Expression;
}

export interface FieldInit extends AstNode {
  readonly kind: "FieldInit";
  readonly name: Identifier;
  /** `none()` for shorthand `Foo { x }` (value inferred from binding in scope). */
  readonly value: Option<Expression>;
}

export interface StructExpression extends AstNode {
  readonly kind: "StructExpression";
  readonly path: Path;
  readonly fields: FieldInit[];
  /** `some(expr)` for `Foo { x: 1, ..base }` spread. Semantic analysis is deferred. */
  readonly base: Option<Expression>;
}

export interface RangeExpression extends AstNode {
  readonly kind: "RangeExpression";
  readonly start: Option<Expression>;
  readonly end: Option<Expression>;
  readonly inclusive: boolean;
}

export interface IfExpression extends AstNode {
  readonly kind: "IfExpression";
  readonly condition: Expression;
  readonly thenBranch: Block;
  readonly elseBranch: Option<IfExpression | Block>;
}

/**
 * `let Pattern = Expression`: only legal as (or as a conjunct of) an `if`/
 * `while` condition, never in general expression position. This is enforced
 * structurally, not by an AST flag: the parser only ever constructs a
 * `LetExpression` from the dedicated if/while-condition parsing routine
 * (`parseCondition`), never from `parsePrimary`'s general dispatch, so a
 * stray `let` elsewhere in expression position falls through to the
 * ordinary "expected an expression" error, unchanged. Mirrors rustc's own
 * `ExprKind::Let`.
 */
export interface LetExpression extends AstNode {
  readonly kind: "LetExpression";
  readonly pattern: Pattern;
  readonly scrutinee: Expression;
}

/**
 * `while` `condition` `body`: currently only reachable via the `while let`
 * form (`condition` a `LetExpression`); a bare boolean `while cond {}` is
 * still a guardrail rejection (see `expression.ts`'s `parsePrimary` and
 * `statement.ts`'s block-statement dispatch, both of which only route to
 * `parseWhileExpression` for the exact unlabeled `while` `let` token
 * sequence). `loop`/`for` remain fully unimplemented.
 */
export interface WhileExpression extends AstNode {
  readonly kind: "WhileExpression";
  readonly condition: Expression;
  readonly body: Block;
}

export interface MatchArm extends AstNode {
  readonly kind: "MatchArm";
  readonly pattern: Pattern;
  readonly guard: Option<Expression>;
  readonly body: Expression;
}

export interface MatchExpression extends AstNode {
  readonly kind: "MatchExpression";
  readonly scrutinee: Expression;
  readonly arms: readonly MatchArm[];
}

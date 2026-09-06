// Mirrors parser/ast.ts structurally but every expression node extends
// DecoratedAstNode - the resolved Type field is the semantic layer's invariant.
// Duplication is intentional; do not merge these two ASTs.

import type { Option } from "../option.js";
import type { FloatSuffix, IntSuffix } from "../lexer/token.js";

/** Every AST node carries the index of the token that begins it. */
interface AstNode {
  readonly tokenId: number;
}

interface DecoratedAstNode extends AstNode {
  readonly type: Type;
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
  | FunctionDef
  | FunctionSignature
  | StructDecl
  | EnumDecl
  | TraitDecl
  | ImplDecl
  | TypeAliasDecl
  | ConstDecl
  | StaticDecl
  | Statement
  | Expression;

/**
 * A `const`'s fully compile-time-evaluated value. Unlike `Expression`, this
 * carries no unevaluated subtree - a `const` is inlined at each use site
 * (spec 0008 "Constants and statics"), so by the time analysis finishes a
 * `ConstDecl` there is nothing left to lower but this resolved value.
 */
export type ConstValue =
  | { readonly kind: "Int"; readonly value: bigint }
  | { readonly kind: "Float"; readonly value: number }
  | { readonly kind: "Bool"; readonly value: boolean }
  | { readonly kind: "Char"; readonly value: string }
  | { readonly kind: "Str"; readonly value: string };

export type Statement =
  | LetStatement
  | ExpressionStatement
  | FunctionDef
  | FunctionSignature
  | StructDecl
  | EnumDecl
  | TraitDecl
  | ImplDecl
  | ConstDecl
  | StaticDecl;

type BinaryOperator =
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

type CompoundAssignOperator =
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
  | RangeExpression
  | StructExpression
  | IfExpression
  | LetExpression
  | MatchExpression
  | Block;

/**
 * Every {@link Expression} discriminant. Spelled out rather than derived so
 * it ports directly to a Hedge enum.
 */
export type ExpressionKind =
  | "StringLiteral"
  | "IntLiteral"
  | "FloatLiteral"
  | "BoolLiteral"
  | "CharLiteral"
  | "PathExpression"
  | "CallExpression"
  | "ReferenceExpression"
  | "DereferenceExpression"
  | "BinaryExpression"
  | "UnaryExpression"
  | "AssignExpression"
  | "CompoundAssignExpression"
  | "FieldAccessExpression"
  | "MethodCallExpression"
  | "IndexExpression"
  | "TupleExpression"
  | "ArrayExpression"
  | "ArrayRepeatExpression"
  | "RangeExpression"
  | "StructExpression"
  | "IfExpression"
  | "LetExpression"
  | "MatchExpression"
  | "Block";

interface Visibility {
  readonly kind: "Visibility";
  /** `none()` for bare `pub`; `some("package")` for `pub(package)`, etc. */
  readonly scope: Option<string>;
}

export interface Param extends DecoratedAstNode {
  readonly kind: "Param";
  readonly pattern: Pattern;
  readonly type: Type;
}

/** A function signature with no implementation - `fn f(&self) -> i32;`. */
export interface FunctionSignature extends AstNode {
  readonly kind: "FunctionSignature";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly generics: readonly string[];
  readonly params: readonly Param[];
  readonly returnType: Option<Type>;
  readonly whereClause: Option<never>;
  readonly attributes: readonly Attribute[];
}

export interface FunctionDef extends AstNode {
  readonly kind: "Function";
  readonly signature: FunctionSignature;
  readonly body: Block;
}

export interface StructDecl extends DecoratedAstNode {
  readonly kind: "Struct";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly generics: readonly string[];
  readonly body: StructBody;
  readonly attributes: readonly Attribute[];
}

export interface EnumDecl extends DecoratedAstNode {
  readonly kind: "Enum";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly generics: readonly string[];
  readonly variants: readonly Variant[];
  readonly attributes: readonly Attribute[];
}

/**
 * `body` is `none()` for a bare/unit variant, mirroring `Parser.Variant`'s own
 * doc comment - no `UnitBody` member is needed, since the grammar's
 * optionality already distinguishes a bare variant from an explicit empty
 * body. No `visibility` field: a variant always shares its enum's visibility.
 */
export interface Variant extends DecoratedAstNode {
  readonly kind: "Variant";
  readonly attributes: readonly Attribute[];
  readonly name: Identifier;
  readonly body: Option<NamedFieldsBody | TupleFieldsBody>;
}

/**
 * `const NAME: Type = <folded value>;`. Only ever produced for a top-level
 * declaration - see `parser/ast.ts`'s `ConstDecl` doc comment.
 */
export interface ConstDecl extends DecoratedAstNode {
  readonly kind: "Const";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly value: ConstValue;
  readonly attributes: readonly Attribute[];
}

/**
 * `static NAME: Type = Expression;`. Unlike `ConstDecl`, `value` stays a real
 * `Expression` - a static's initializer runs once, at runtime, on first
 * access, and may call arbitrary functions (spec 0008).
 */
export interface StaticDecl extends DecoratedAstNode {
  readonly kind: "Static";
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly value: Expression;
  readonly attributes: readonly Attribute[];
}

/** A method's receiver, mirroring `Parser.Receiver`: `byRef` is true for
 * `&self`/`&mut self`, `mutable` for `mut self`/`&mut self`. `none()` for an
 * associated function with no receiver. */
export interface MethodReceiver {
  readonly byRef: boolean;
  readonly mutable: boolean;
}

/** One of a trait's own methods, in declaration order. `isDefault` is true
 * for a method with a body in the trait declaration (needs no override) and
 * false for a bodiless required one (an impl must provide it). `params`/
 * `returnType` are the method's own resolved signature types - a `Self`/
 * `Self::Assoc` mention resolves within this trait's own abstract Self
 * context (see analyzer.ts's `SelfContext`). */
export interface TraitMethod {
  readonly name: string;
  readonly isDefault: boolean;
  readonly receiver: Option<MethodReceiver>;
  readonly params: readonly Type[];
  readonly returnType: Type;
  /** This method's own declared type-parameter names (`fn map<U>` -> `["U"]`),
   * not the trait's - so a call site can skip type-checking an argument bound
   * to one, the same way an inherent generic method's are skipped. */
  readonly genericParams: readonly string[];
}

/**
 * `name`/`supertraits` carry just enough identity for supertrait-completeness
 * checking (does an impl of this trait also implement each trait it
 * requires). `methods` drives impl completeness checking and witness
 * construction, in the trait's own declaration order - a single ordered
 * list rather than separate required/default arrays, so an impl's witness
 * doesn't quietly reorder an interleaved trait body. `associatedTypes` is
 * every `type Name;` declared directly in this trait's own body (no value -
 * a defined alias, `type Name = ...;`, is a plain, still-unhandled
 * `TypeAliasDecl` item here, same as before).
 */
export interface TraitDecl extends AstNode {
  readonly kind: "Trait";
  readonly name: string;
  /** This trait's own scope-qualified `traitRegistry` key - the identity a
   * `dyn Trait`, a bound, or an `impl` resolves to, distinct per declaration
   * even when two traits share `name`. */
  readonly traitId: string;
  readonly supertraits: readonly string[];
  readonly methods: readonly TraitMethod[];
  readonly associatedTypes: readonly string[];
  /** A `FunctionDef` view of each bodied (default) method, `self` prepended
   * as a parameter, for the ownership passes to walk. */
  readonly methodBodies: readonly FunctionDef[];
}

/** One impl-provided method's own resolved signature - mirrors `TraitMethod`
 * minus `isDefault`, since every entry here is impl-provided by definition. */
export interface ImplMethod {
  readonly name: string;
  readonly receiver: Option<MethodReceiver>;
  readonly params: readonly Type[];
  readonly returnType: Type;
}

/**
 * `traitRef`/`targetTypeName`/`isBlanket`/`blanketBounds` carry just enough
 * identity for coherence and bound checking. `targetTypeName` is `none()`
 * for a target that isn't a plain named type (a reference/array impl
 * target) - coherence checking doesn't handle those shapes yet. For a
 * blanket impl (`impl<T: A> B for T`), `targetTypeName` holds the type
 * parameter's own name (`T`), which `isBlanket` distinguishes from an
 * equally-named concrete type, and `blanketBounds` holds that parameter's
 * own required trait names (`A`) - empty for a concrete impl, or an
 * unconstrained blanket impl. `providedMethods` is every bodied method this
 * impl itself declares, for completeness checking against its trait's own
 * `methods` (the non-default ones); `providedAssociatedTypes` is the same
 * idea for `type Name = Value;` definitions - both are cheap, name-only
 * lists usable during coherence's own flat prepass, before real resolution
 * exists. `resolvedMethods`/`associatedTypeDefs` carry the real, resolved
 * counterparts (`Self`/`Self::Assoc` already substituted against a concrete
 * impl target - see analyzer.ts's `SelfContext`), populated only once this
 * impl reaches its own real analysis pass.
 */
export interface ImplDecl extends AstNode {
  readonly kind: "Impl";
  readonly traitRef: Option<{
    readonly name: string;
    readonly tokenId: number;
  }>;
  readonly targetTypeName: Option<string>;
  readonly isBlanket: boolean;
  readonly blanketBounds: readonly string[];
  readonly providedMethods: readonly string[];
  readonly providedAssociatedTypes: readonly string[];
  readonly resolvedMethods: readonly ImplMethod[];
  readonly associatedTypeDefs: ReadonlyMap<string, Type>;
  /** A `FunctionDef` view of each bodied method, `self` prepended as a
   * parameter, for the ownership passes to walk. */
  readonly methodBodies: readonly FunctionDef[];
}

/** Carries no semantic content yet - a type alias's own value type is still
 * open work. Exists only so `analyzeItem`/`analyzeStatement` stay
 * exhaustive. */
interface TypeAliasDecl extends AstNode {
  readonly kind: "TypeAlias";
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

interface UnitBody {
  readonly kind: "Unit";
}

export interface StructField extends DecoratedAstNode {
  readonly kind: "StructField";
  readonly attributes: readonly Attribute[];
  readonly visibility: Option<Visibility>;
  readonly name: Identifier;
  readonly type: Type;
}

export interface TupleField extends DecoratedAstNode {
  readonly kind: "TupleField";
  readonly attributes: readonly Attribute[];
  readonly visibility: Option<Visibility>;
  readonly type: Type;
}

export interface Block extends DecoratedAstNode {
  readonly kind: "Block";
  readonly statements: Statement[];
  readonly trailingExpression: Option<Expression>;
  readonly innerAttributes: readonly Attribute[];
}

export interface LetStatement extends DecoratedAstNode {
  readonly kind: "LetStatement";
  readonly attributes: readonly Attribute[];
  readonly pattern: Pattern;
  readonly initializer: Option<Expression>;
}

export interface MatchExpression extends DecoratedAstNode {
  readonly kind: "MatchExpression";
  readonly scrutinee: Expression;
  readonly arms: readonly MatchArm[];
}

export interface MatchArm extends AstNode {
  readonly kind: "MatchArm";
  readonly pattern: Pattern;
  readonly guard: Option<Expression>;
  readonly body: Expression;
}

/**
 * A single `Pattern` union shared by match arms, `let` statements, and
 * function parameters - mirrors `Parser.Pattern` structurally.
 * `let`/`Param` only ever bind an irrefutable pattern (enforced by semantic
 * analysis, not the type system - see `analyzer.ts`'s refutability check),
 * but there's no separate reduced pattern shape for that position anymore:
 * a `let`/`Param` pattern is a real `Pattern`, exactly like a match arm's.
 */
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

export interface BindingPattern extends DecoratedAstNode {
  readonly kind: "BindingPattern";
  readonly mutable: boolean;
  readonly byRef: boolean;
  readonly name: Identifier;
  readonly subpattern: Option<Pattern>;
}

export interface WildcardPattern extends DecoratedAstNode {
  readonly kind: "WildcardPattern";
}

export interface LiteralPattern extends DecoratedAstNode {
  readonly kind: "LiteralPattern";
  readonly negative: boolean;
  readonly literal:
    StringLiteral | IntLiteral | FloatLiteral | CharLiteral | BoolLiteral;
}

export interface RangePatternBound {
  readonly negative: boolean;
  readonly literal:
    StringLiteral | IntLiteral | FloatLiteral | CharLiteral | BoolLiteral;
}

export interface RangePattern extends DecoratedAstNode {
  readonly kind: "RangePattern";
  readonly start: RangePatternBound;
  readonly end: RangePatternBound;
}

export interface OrPattern extends DecoratedAstNode {
  readonly kind: "OrPattern";
  readonly alternatives: readonly Pattern[];
}

/** Not exported: `Pattern` never actually constructs this kind today - a
 * `TuplePattern` in match position always falls through `analyzer.ts`'s
 * `analyzePatternGuardrail` (mirrors `let`/`Param`'s own scope boundary).
 * Exporting an unused declaration trips `knip`. */
interface TuplePattern extends DecoratedAstNode {
  readonly kind: "TuplePattern";
  readonly elements: readonly Pattern[];
}

export interface FieldPattern extends AstNode {
  readonly kind: "FieldPattern";
  readonly name: Identifier;
  readonly pattern: Option<Pattern>;
}

export interface StructPattern extends DecoratedAstNode {
  readonly kind: "StructPattern";
  readonly path: Path;
  /** See `Parser.StructPattern.mutable`'s doc comment. */
  readonly mutable: boolean;
  readonly fields: readonly FieldPattern[];
  readonly hasRest: boolean;
}

export interface TupleStructPattern extends DecoratedAstNode {
  readonly kind: "TupleStructPattern";
  readonly path: Path;
  /** See `Parser.StructPattern.mutable`'s doc comment. */
  readonly mutable: boolean;
  readonly elements: readonly Pattern[];
}

export interface PathPattern extends DecoratedAstNode {
  readonly kind: "PathPattern";
  readonly path: Path;
}

/** A slice pattern's own rest element (`..`, `..tail`, `..&rest`,
 * `..&mut rest`) - real only ever constructed against a
 * fixed-length `ArrayType` scrutinee (see `analyzer.ts`'s `analyzePattern`
 * `SlicePattern` case; a dynamic-length scrutinee still has no real type to
 * destructure against, so it stays guardrailed). */
export interface RestPattern extends AstNode {
  readonly kind: "RestPattern";
  readonly byRef: boolean;
  readonly mutable: boolean;
  readonly name: Option<Identifier>;
}

/** Real against a fixed-length `ArrayType` scrutinee only -
 * see `RestPattern`'s own doc comment. */
export interface SlicePattern extends DecoratedAstNode {
  readonly kind: "SlicePattern";
  readonly elements: readonly (Pattern | RestPattern)[];
}

export interface ExpressionStatement extends DecoratedAstNode {
  readonly kind: "ExpressionStatement";
  readonly expression: Expression;
}

export interface Identifier extends DecoratedAstNode {
  readonly kind: "Identifier";
  readonly text: string;
}

export interface StringLiteral extends DecoratedAstNode {
  readonly kind: "StringLiteral";
  readonly value: string;
}

export interface IntLiteral extends DecoratedAstNode {
  readonly kind: "IntLiteral";
  /** Digits only - no prefix, underscores stripped. */
  readonly value: string;
  readonly base: 10 | 16 | 8 | 2;
  readonly suffix: Option<IntSuffix>;
}

export interface FloatLiteral extends DecoratedAstNode {
  readonly kind: "FloatLiteral";
  /** Full normalized text, underscores stripped. */
  readonly value: string;
  readonly suffix: Option<FloatSuffix>;
}

export interface BoolLiteral extends DecoratedAstNode {
  readonly kind: "BoolLiteral";
  readonly value: boolean;
}

export interface CharLiteral extends DecoratedAstNode {
  readonly kind: "CharLiteral";
  /** Resolved character (after escape decoding). */
  readonly value: string;
}

export interface Path {
  readonly absolute: boolean;
  readonly segments: string[];
}

export type Type =
  | NamedType
  | UnitType
  | PrimitiveType
  | StructType
  | EnumType
  | FunctionType
  | ReferenceType
  | ArrayType
  | ProjectionType
  | DynType;

/**
 * `I::Item` where `I` isn't concrete yet - `Self` inside a trait's own
 * declaration, or a declared generic parameter bound to `traitName`. Once
 * `selfType` is concrete (inside a trait impl that defines the associated
 * type), resolution substitutes directly to the defined type instead of
 * producing this node at all - a `ProjectionType` only ever represents the
 * genuinely-unresolved case. `selfType` is always either `NamedType{path:
 * ["Self"]}` or `NamedType{path:[paramName]}`, the same representation
 * `analyzer.ts`'s `resolveDeclaredGenericParam` already gives a declared
 * generic parameter, rather than a dedicated marker type.
 */
interface ProjectionType extends AstNode {
  readonly kind: "Projection";
  readonly traitName: string;
  readonly assocName: string;
  readonly selfType: Type;
}

/**
 * `dyn Trait` - a trait object type. `traitId` is the trait's scope-qualified
 * `traitRegistry` key (`analyzer.ts`'s `scopedTypeName`), so a `dyn` of a
 * shadowed trait keeps a distinct identity - stripped to the bare name for
 * diagnostics, the same way `StructType`/`EnumType` handle `name`. No runtime
 * representation exists yet, so a program using this type passes analysis but
 * does not lower to JavaScript (`jsim.ts` throws).
 */
interface DynType extends AstNode {
  readonly kind: "DynType";
  readonly traitId: string;
}

/**
 * `[T; N]`, a fixed-size array. `length` is a resolved, non-negative integer
 * - the parser guarantees the source's own length expression is a literal
 * integer (no const-evaluation exists yet), so by the time a program reaches
 * this layer there's nothing left to evaluate.
 */
export interface ArrayType {
  readonly kind: "ArrayType";
  readonly elementType: Type;
  readonly length: number;
}

export interface FunctionType {
  readonly kind: "FunctionType";
  readonly params: readonly Type[];
  readonly returnType: Type;
  /**
   * Whether `params` is a stand-in rather than a signature a call site must
   * satisfy. True only for a builtin whose real signature cannot be
   * expressed yet, in which case calls to it are not argument-checked; every
   * user-declared function is `false`. See `BUILTIN_SCOPE` in `analyzer.ts`.
   */
  readonly paramsArePlaceholder: boolean;
  readonly genericParams: readonly string[];
  /** Each declared generic parameter's own required trait names (`T: Draw`),
   * keyed by parameter name; a parameter with no bounds still gets an empty
   * array, not a missing key. */
  readonly genericParamBounds: ReadonlyMap<string, readonly string[]>;
}

/**
 * `&T` / `&mut T`, erased of lifetime identity - nothing downstream of
 * parsing does lifetime-aware checking yet (the borrow checker still
 * consumes the parser-level `Program`, not this one), so only the mutability
 * and referent type are meaningful here.
 */
interface ReferenceType extends AstNode {
  readonly kind: "ReferenceType";
  readonly mutable: boolean;
  readonly referent: Type;
}

export type PrimitiveType =
  | PrimitiveIntType
  | PrimitiveUintType
  | PrimitiveFloatType
  | PrimitiveBooleanType
  | PrimitiveCharType
  | PrimitiveStringType;

/** Every integer-primitive discriminant, spelled out. */
export type PrimitiveIntegerTypeKind =
  | "PrimitiveI8Type"
  | "PrimitiveI16Type"
  | "PrimitiveI32Type"
  | "PrimitiveI64Type"
  | "PrimitiveIsizeType"
  | "PrimitiveU8Type"
  | "PrimitiveU16Type"
  | "PrimitiveU32Type"
  | "PrimitiveU64Type"
  | "PrimitiveUsizeType";
type PrimitiveUintType =
  | PrimitiveU8Type
  | PrimitiveU16Type
  | PrimitiveU32Type
  | PrimitiveU64Type
  | PrimitiveUsizeType;
type PrimitiveIntType =
  | PrimitiveI8Type
  | PrimitiveI16Type
  | PrimitiveI32Type
  | PrimitiveI64Type
  | PrimitiveIsizeType;
type PrimitiveFloatType = PrimitiveF32Type | PrimitiveF64Type;

interface PrimitiveU8Type {
  readonly kind: "PrimitiveU8Type";
}

interface PrimitiveU16Type {
  readonly kind: "PrimitiveU16Type";
}

interface PrimitiveU32Type {
  readonly kind: "PrimitiveU32Type";
}

interface PrimitiveU64Type {
  readonly kind: "PrimitiveU64Type";
}

interface PrimitiveUsizeType {
  readonly kind: "PrimitiveUsizeType";
}

interface PrimitiveI8Type {
  readonly kind: "PrimitiveI8Type";
}

interface PrimitiveI16Type {
  readonly kind: "PrimitiveI16Type";
}

interface PrimitiveI32Type {
  readonly kind: "PrimitiveI32Type";
}

interface PrimitiveI64Type {
  readonly kind: "PrimitiveI64Type";
}

interface PrimitiveF32Type {
  readonly kind: "PrimitiveF32Type";
}

interface PrimitiveF64Type {
  readonly kind: "PrimitiveF64Type";
}

interface PrimitiveIsizeType {
  readonly kind: "PrimitiveIsizeType";
}

interface PrimitiveBooleanType {
  readonly kind: "PrimitiveBooleanType";
}

interface PrimitiveCharType {
  readonly kind: "PrimitiveCharType";
}

interface PrimitiveStringType {
  readonly kind: "PrimitiveStringType";
}

export interface StructType {
  readonly kind: "StructType";
  readonly name: string;
}

export interface EnumType {
  readonly kind: "EnumType";
  readonly name: string;
}

interface NamedType extends AstNode {
  readonly kind: "NamedType";
  readonly path: Path;
}

export interface UnitType extends AstNode {
  readonly kind: "UnitType";
}

export interface PathExpression extends DecoratedAstNode {
  readonly kind: "PathExpression";
  readonly path: Path;
}

export interface CallExpression extends DecoratedAstNode {
  readonly kind: "CallExpression";
  readonly callee: Expression;
  readonly arguments: Expression[];
}

export interface ReferenceExpression extends DecoratedAstNode {
  readonly kind: "ReferenceExpression";
  /** `true` for `&mut` (exclusive), `false` for `&` (shared). */
  readonly mutable: boolean;
  readonly operand: Expression;
}

export interface DereferenceExpression extends DecoratedAstNode {
  readonly kind: "DereferenceExpression";
  readonly operand: Expression;
}

export interface BinaryExpression extends DecoratedAstNode {
  readonly kind: "BinaryExpression";
  readonly operator: BinaryOperator;
  readonly left: Expression;
  readonly right: Expression;
}

export interface UnaryExpression extends DecoratedAstNode {
  readonly kind: "UnaryExpression";
  readonly operator: "Neg" | "Not";
  readonly operand: Expression;
}

export interface AssignExpression extends DecoratedAstNode {
  readonly kind: "AssignExpression";
  readonly lhs: Expression;
  readonly rhs: Expression;
}

export interface CompoundAssignExpression extends DecoratedAstNode {
  readonly kind: "CompoundAssignExpression";
  readonly operator: CompoundAssignOperator;
  readonly lhs: Expression;
  readonly rhs: Expression;
}

export interface FieldAccessExpression extends DecoratedAstNode {
  readonly kind: "FieldAccessExpression";
  readonly object: Expression;
  readonly field: Identifier;
}

export interface MethodCallExpression extends DecoratedAstNode {
  readonly kind: "MethodCallExpression";
  readonly receiver: Expression;
  readonly method: Identifier;
  readonly arguments: Expression[];
  /** The resolved method's receiver form (`self` / `&self` / `&mut self`),
   * so the ownership passes can treat the receiver as a move or a borrow.
   * `none()` when the call did not resolve. */
  readonly receiverKind: Option<MethodReceiver>;
}

export interface IndexExpression extends DecoratedAstNode {
  readonly kind: "IndexExpression";
  readonly object: Expression;
  readonly index: Expression;
}

export interface TupleExpression extends DecoratedAstNode {
  readonly kind: "TupleExpression";
  /** Zero elements = unit `()`. One element with trailing comma = single-element tuple. */
  readonly elements: Expression[];
}

/** `[a, b, c]` - the list form of an array literal; `type` is always an `ArrayType`. */
export interface ArrayExpression extends DecoratedAstNode {
  readonly kind: "ArrayExpression";
  readonly elements: Expression[];
}

/** `[value; count]` - the repeat form of an array literal; `type` is always an `ArrayType`. */
export interface ArrayRepeatExpression extends DecoratedAstNode {
  readonly kind: "ArrayRepeatExpression";
  readonly value: Expression;
  /** Resolved element count, mirroring `ArrayType.length` - see that type's own doc comment. */
  readonly count: number;
}

export interface RangeExpression extends DecoratedAstNode {
  readonly kind: "RangeExpression";
  readonly start: Option<Expression>;
  readonly end: Option<Expression>;
  readonly inclusive: boolean;
}

export interface FieldInit extends DecoratedAstNode {
  readonly kind: "FieldInit";
  readonly name: Identifier;
  /** `none()` for shorthand `Foo { x }` (value inferred from binding in scope). */
  readonly value: Option<Expression>;
}

export interface StructExpression extends DecoratedAstNode {
  readonly kind: "StructExpression";
  readonly path: Path;
  readonly fields: FieldInit[];
  /** `some(expr)` for `Foo { x: 1, ..base }` spread. Semantic analysis is deferred. */
  readonly base: Option<Expression>;
}

export interface IfExpression extends DecoratedAstNode {
  readonly kind: "IfExpression";
  readonly condition: Expression;
  readonly thenBranch: Block;
  readonly elseBranch: Option<IfExpression | Block>;
}

/** Only ever an `IfExpression`'s own condition - `analyzeExpression` rejects
 * a bare one elsewhere, mirroring the parser's own restriction. */
export interface LetExpression extends DecoratedAstNode {
  readonly kind: "LetExpression";
  readonly pattern: Pattern;
  readonly scrutinee: Expression;
}

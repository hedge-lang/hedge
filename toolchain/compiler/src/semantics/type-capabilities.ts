import type * as Semantics from "./ast.js";

export type TypeCapability =
  "equality" | "ordering" | "arithmetic" | "bitwise" | "logical" | "copy";

const INTEGER_CAPS: ReadonlySet<TypeCapability> = new Set([
  "equality",
  "ordering",
  "arithmetic",
  "bitwise",
  "copy",
]);

const INTEGER_KINDS: readonly Semantics.PrimitiveIntegerType["kind"][] = [
  "PrimitiveI8Type",
  "PrimitiveI16Type",
  "PrimitiveI32Type",
  "PrimitiveI64Type",
  "PrimitiveIsizeType",
  "PrimitiveU8Type",
  "PrimitiveU16Type",
  "PrimitiveU32Type",
  "PrimitiveU64Type",
  "PrimitiveUsizeType",
];

/**
 * Static capability table for Slice-1 primitive types.
 * Slot for trait-based operator dispatch when traits land. Each entry will
 * become the set of traits the type implements. `StructType` has no entry,
 * so it is never `copy`. Every struct is move-only in Slice 1 (no `Copy`
 * derivation via all-fields-Copy-and-no-Drop yet; that needs the trait
 * machinery landing in Slice 4).
 *
 * `UnitType` is `copy`: it covers both a genuine zero-sized unit value and
 * the ambiguous placeholder type hard-coded onto Slice-1-not-yet-implemented
 * constructs (`TupleExpression`, `IndexExpression`, `MethodCallExpression`,
 * `ReferenceExpression`, `RangeExpression`, see `isAmbiguousUnitExpr` in
 * `analyzer.ts`). None of those constructs' codegen emits a `[Symbol.
 * dispose]` method, so without this entry `recordDrops` (ownership/move-
 * check.ts) would mark a `let`-bound value of one of these kinds for
 * scope-end `using`, producing a runtime `TypeError` on drop.
 *
 * Note: `copy` also suppresses use-after-move tracking for these same
 * constructs (see `useOrMove` in ownership/move-check.ts, the only other
 * `copy` call site); a `let`-bound Tuple/Index/MethodCall/Reference/Range
 * value can now be aliased across bindings without a move diagnostic, and
 * since their codegen lowers to JS reference types (arrays/objects), two
 * such bindings share the same underlying value. A real per-construct move
 * semantics design is still Slice 4+ work; this is an accepted interim gap,
 * not an intentional design choice.
 */
const TYPE_CAPABILITIES: ReadonlyMap<
  string,
  ReadonlySet<TypeCapability>
> = new Map<string, ReadonlySet<TypeCapability>>([
  ["PrimitiveBooleanType", new Set(["equality", "logical", "copy"])],
  ["PrimitiveCharType", new Set(["equality", "ordering", "copy"])],
  ["PrimitiveStringType", new Set(["equality", "copy"])],
  ["PrimitiveF32Type", new Set(["equality", "ordering", "arithmetic", "copy"])],
  ["PrimitiveF64Type", new Set(["equality", "ordering", "arithmetic", "copy"])],
  ["UnitType", new Set(["copy"])],
  // A reference is always Copy, regardless of what it points to - copying
  // `&T`/`&mut T` duplicates the reference itself (a pointer), never the
  // referent, and never changes ownership of the underlying value. Without
  // this entry, `recordDrops` (ownership/move-check.ts) would treat a
  // reference-typed parameter as move-only and mark it for scope-end
  // `using`, producing a runtime TypeError (plain values have no
  // `[Symbol.dispose]`).
  ["ReferenceType", new Set(["copy"])],
  ...INTEGER_KINDS.map((k): [string, ReadonlySet<TypeCapability>] => [
    k,
    INTEGER_CAPS,
  ]),
]);

export function hasCapability(
  type: Semantics.Type,
  cap: TypeCapability,
): boolean {
  return TYPE_CAPABILITIES.get(type.kind)?.has(cap) ?? false;
}

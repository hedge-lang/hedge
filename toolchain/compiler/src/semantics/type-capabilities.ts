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

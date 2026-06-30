import type * as Semantics from "./ast.js";

export type TypeCapability =
  "equality" | "ordering" | "arithmetic" | "bitwise" | "logical";

const INTEGER_CAPS: ReadonlySet<TypeCapability> = new Set([
  "equality",
  "ordering",
  "arithmetic",
  "bitwise",
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
 * Slot for trait-based operator dispatch when traits land — each entry will
 * become the set of traits the type implements.
 */
const TYPE_CAPABILITIES: ReadonlyMap<
  string,
  ReadonlySet<TypeCapability>
> = new Map<string, ReadonlySet<TypeCapability>>([
  ["PrimitiveBooleanType", new Set(["equality", "logical"])],
  ["PrimitiveCharType", new Set(["equality", "ordering"])],
  ["PrimitiveStringType", new Set(["equality"])],
  ["PrimitiveF32Type", new Set(["equality", "ordering", "arithmetic"])],
  ["PrimitiveF64Type", new Set(["equality", "ordering", "arithmetic"])],
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

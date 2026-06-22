/** Canonical mapping from Hedge primitive type names to their JS/TS type representations. */
export const HEDGE_PRIMITIVE_TYPES: Readonly<
  Record<string, "string" | "number" | "bigint" | "boolean" | "null">
> = {
  bool: "boolean",
  str: "string",
  char: "string",
  i8: "number",
  i16: "number",
  i32: "number",
  u8: "number",
  u16: "number",
  u32: "number",
  usize: "number",
  isize: "number",
  f32: "number",
  f64: "number",
  i64: "bigint",
  u64: "bigint",
};

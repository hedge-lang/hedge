import type { Diagnostic } from "../diagnostics.js";
import type { Program } from "../parser/ast.js";

export function checkBorrows(program: Program): readonly Diagnostic[] {
  return [];
}

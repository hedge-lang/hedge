import { isNone, isSome, none, type Option, some } from "../../option.js";
import type { Attribute } from "../../semantics/ast.js";
import type { DocComment } from "../ast.js";

export function toDocComment(
  attributes: readonly Attribute[],
): Option<DocComment> {
  const docAttributes = attributes
    .filter((a) => a.name.text === "doc")
    .flatMap((a) => (isSome(a.arguments) ? a.arguments.value : []))
    .flatMap((a) => (isNone(a.path) ? a.literal : []))
    .flatMap((a) => (isSome(a) ? a.value : []))
    .map((a) => a.value);

  if (docAttributes.length === 0) {
    return none();
  }

  return some({
    kind: "DocComment",
    text: docAttributes.join("\n"),
  });
}

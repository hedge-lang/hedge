import { describe, it, expect } from "vitest";
import { none, some } from "../../option.js";
import type { Attribute } from "../../parser/ast.js";
import { toDocComment } from "./doc-comment.js";

describe("toDocComment", () => {
  it("converts doc attributes to doc comment", () => {
    const attributes: Attribute[] = [
      {
        kind: "Attribute",
        name: {
          kind: "Identifier",
          text: "doc",
          tokenId: 0,
        },
        arguments: none(),
      },

      {
        kind: "Attribute",
        name: {
          kind: "Identifier",
          text: "foo",
          tokenId: 1,
        },
        arguments: some([
          {
            path: none(),
            literal: some({
              kind: "StringLiteral",
              tokenId: 1,
              value: "Hello, world!",
            }),
          },
        ]),
      },
      {
        kind: "Attribute",
        name: {
          kind: "Identifier",
          text: "doc",
          tokenId: 1,
        },
        arguments: some([
          { path: none(), literal: none() },
          {
            path: none(),
            literal: some({
              kind: "StringLiteral",
              tokenId: 1,
              value: "Hello, world!",
            }),
          },
          {
            path: some({
              absolute: true,
              segments: ["std", "print"],
            }),
            literal: none(),
          },
          {
            path: some({
              absolute: false,
              segments: ["std", "print"],
            }),
            literal: none(),
          },
          {
            path: some({
              absolute: false,
              segments: ["std", "print"],
            }),
            literal: some({
              kind: "StringLiteral",
              tokenId: 1,
              value: "Exclude",
            }),
          },
          {
            path: some({
              absolute: true,
              segments: ["std", "print"],
            }),
            literal: some({
              kind: "StringLiteral",
              tokenId: 1,
              value: "Exclude",
            }),
          },
          {
            path: some({
              absolute: true,
              segments: ["std", "print"],
            }),
            literal: some({
              kind: "StringLiteral",
              tokenId: 1,
              value: "Exclude",
            }),
          },
        ]),
      },
    ];
    const comment = toDocComment(attributes);
    expect(comment).toEqual(
      some({
        kind: "DocComment",
        text: "Hello, world!",
      }),
    );
  });
});

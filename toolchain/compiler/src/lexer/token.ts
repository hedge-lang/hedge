import { assertNever } from "../assert.js";
import type { Option } from "../option.js";

export type IntSuffix =
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "isize"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "usize";
export type FloatSuffix = "f32" | "f64";

/** A half-open source range, measured in UTF-16 code units, 0-based. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** A keyword token; `text` is the keyword itself. */
export interface KeywordToken {
  readonly kind: "keyword";
  readonly span: Span;
  readonly text: string;
}

export interface IntToken {
  readonly kind: "int";
  readonly span: Span;
  readonly text: string;
  readonly radix: 2 | 8 | 10 | 16;
  readonly suffix: Option<IntSuffix>;
}

export interface FloatToken {
  readonly kind: "float";
  readonly span: Span;
  readonly text: string;
  readonly suffix: Option<FloatSuffix>;
}

/** The `::` path separator. */
export interface PathSepToken {
  readonly kind: "path_sep";
  readonly span: Span;
}

/** The lexical category of a {@link Token}. */
export type Token =
  // Non-symbol tokens: identifiers, keywords, literals, and structural markers.
  | { readonly kind: "ident"; readonly span: Span; readonly text: string }
  | KeywordToken
  | IntToken
  | FloatToken
  | { readonly kind: "char"; readonly span: Span; readonly text: string }
  | { readonly kind: "string"; readonly span: Span; readonly text: string }
  | { readonly kind: "lifetime"; readonly span: Span; readonly text: string }
  // A malformed token; `text` is the raw offending source span, paired with
  // a Diagnostic describing what went wrong.
  | { readonly kind: "error"; readonly span: Span; readonly text: string }
  // Zero-width sentinel marking the end of the token stream.
  | { readonly kind: "eof"; readonly span: Span }
  // Delimiters
  | { readonly kind: "lparen"; readonly span: Span } // "("
  | { readonly kind: "rparen"; readonly span: Span } // ")"
  | { readonly kind: "lbrace"; readonly span: Span } // "{"
  | { readonly kind: "rbrace"; readonly span: Span } // "}"
  | { readonly kind: "lbracket"; readonly span: Span } // "["
  | { readonly kind: "rbracket"; readonly span: Span } // "]"
  // Single-char punctuation
  | { readonly kind: "comma"; readonly span: Span } // ","
  | { readonly kind: "semi"; readonly span: Span } // ";"
  | { readonly kind: "colon"; readonly span: Span } // ":"
  | { readonly kind: "dot"; readonly span: Span } // "."
  | { readonly kind: "hash"; readonly span: Span } // "#"
  | { readonly kind: "at"; readonly span: Span } // "@"
  | { readonly kind: "question"; readonly span: Span } // "?"
  // Single-char operators
  | { readonly kind: "plus"; readonly span: Span } // "+"
  | { readonly kind: "minus"; readonly span: Span } // "-"
  | { readonly kind: "star"; readonly span: Span } // "*"
  | { readonly kind: "slash"; readonly span: Span } // "/"
  | { readonly kind: "percent"; readonly span: Span } // "%"
  | { readonly kind: "amp"; readonly span: Span } // "&"
  | { readonly kind: "pipe"; readonly span: Span } // "|"
  | { readonly kind: "caret"; readonly span: Span } // "^"
  | { readonly kind: "bang"; readonly span: Span } // "!"
  | { readonly kind: "lt"; readonly span: Span } // "<"
  | { readonly kind: "gt"; readonly span: Span } // ">"
  | { readonly kind: "eq"; readonly span: Span } // "="
  // Multi-char operators
  | { readonly kind: "eq_eq"; readonly span: Span } // "=="
  | { readonly kind: "bang_eq"; readonly span: Span } // "!="
  | { readonly kind: "lt_eq"; readonly span: Span } // "<="
  | { readonly kind: "gt_eq"; readonly span: Span } // ">="
  | { readonly kind: "amp_amp"; readonly span: Span } // "&&"
  | { readonly kind: "pipe_pipe"; readonly span: Span } // "||"
  | { readonly kind: "lt_lt"; readonly span: Span } // "<<"
  | { readonly kind: "gt_gt"; readonly span: Span } // ">>"
  | { readonly kind: "lt_lt_eq"; readonly span: Span } // "<<="
  | { readonly kind: "gt_gt_eq"; readonly span: Span } // ">>="
  | { readonly kind: "plus_eq"; readonly span: Span } // "+="
  | { readonly kind: "minus_eq"; readonly span: Span } // "-="
  | { readonly kind: "star_eq"; readonly span: Span } // "*="
  | { readonly kind: "slash_eq"; readonly span: Span } // "/="
  | { readonly kind: "percent_eq"; readonly span: Span } // "%="
  | { readonly kind: "amp_eq"; readonly span: Span } // "&="
  | { readonly kind: "pipe_eq"; readonly span: Span } // "|="
  | { readonly kind: "caret_eq"; readonly span: Span } // "^="
  | { readonly kind: "arrow"; readonly span: Span } // "->"
  | { readonly kind: "fat_arrow"; readonly span: Span } // "=>"
  | PathSepToken // "::"
  | { readonly kind: "dot_dot"; readonly span: Span } // ".."
  | { readonly kind: "dot_dot_eq"; readonly span: Span }; // "..="

/**
 * Every token category. Spelled out rather than derived from {@link Token}
 * so it ports directly to a Hedge enum. `tokenKindAt` returns a token's own
 * `kind` as this type, so `tsc` rejects the union drifting from the variants.
 */
export type TokenKind =
  | "ident"
  | "char"
  | "string"
  | "lifetime"
  | "error"
  | "eof"
  | "lparen"
  | "rparen"
  | "lbrace"
  | "rbrace"
  | "lbracket"
  | "rbracket"
  | "comma"
  | "semi"
  | "colon"
  | "dot"
  | "hash"
  | "at"
  | "question"
  | "plus"
  | "minus"
  | "star"
  | "slash"
  | "percent"
  | "amp"
  | "pipe"
  | "caret"
  | "bang"
  | "lt"
  | "gt"
  | "eq"
  | "eq_eq"
  | "bang_eq"
  | "lt_eq"
  | "gt_eq"
  | "amp_amp"
  | "pipe_pipe"
  | "lt_lt"
  | "gt_gt"
  | "lt_lt_eq"
  | "gt_gt_eq"
  | "plus_eq"
  | "minus_eq"
  | "star_eq"
  | "slash_eq"
  | "percent_eq"
  | "amp_eq"
  | "pipe_eq"
  | "caret_eq"
  | "arrow"
  | "fat_arrow"
  | "dot_dot"
  | "dot_dot_eq"
  | "keyword"
  | "int"
  | "float"
  | "path_sep";

function escapeText(text: string): string {
  return text
    .replaceAll("\\", "\\\\")
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t")
    .replaceAll('"', '\\"');
}

// eslint-disable-next-line complexity -- Routing function over the full Token union
export function tokenToString(token: Token): string {
  switch (token.kind) {
    case "ident":
      return `ident(${escapeText(token.text)})`;
    case "keyword":
      return `keyword(${escapeText(token.text)})`;
    case "int":
      return `int(${escapeText(token.text)})`;
    case "string":
      return `string(${escapeText(token.text)})`;
    case "char":
      return `char(${escapeText(token.text)})`;
    case "float":
      return `float(${escapeText(token.text)})`;
    case "lifetime":
      return `lifetime(${escapeText(token.text)})`;
    case "error":
      return `error(${escapeText(token.text)})`;
    case "eof":
      return "end of input";
    case "lparen":
    case "rparen":
    case "lbrace":
    case "rbrace":
    case "lbracket":
    case "rbracket":
    case "comma":
    case "semi":
    case "colon":
    case "dot":
    case "hash":
    case "at":
    case "question":
    case "plus":
    case "minus":
    case "star":
    case "slash":
    case "percent":
    case "amp":
    case "pipe":
    case "caret":
    case "bang":
    case "lt":
    case "gt":
    case "eq":
    case "eq_eq":
    case "bang_eq":
    case "lt_eq":
    case "gt_eq":
    case "amp_amp":
    case "pipe_pipe":
    case "lt_lt":
    case "gt_gt":
    case "lt_lt_eq":
    case "gt_gt_eq":
    case "plus_eq":
    case "minus_eq":
    case "star_eq":
    case "slash_eq":
    case "percent_eq":
    case "amp_eq":
    case "pipe_eq":
    case "caret_eq":
    case "arrow":
    case "fat_arrow":
    case "dot_dot":
    case "dot_dot_eq":
    case "path_sep":
      // Carries no text: the kind name is the whole token.
      return token.kind;
    default:
      return assertNever(token, `Unexpected token: ${JSON.stringify(token)}`);
  }
}

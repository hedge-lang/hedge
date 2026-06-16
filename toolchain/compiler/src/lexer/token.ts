/** A half-open source range, measured in UTF-16 code units, 0-based. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** The lexical category of a {@link Token}. */
export type TokenKind =
  // Non-symbol tokens
  | "ident"
  | "keyword"
  | "int"
  | "string"
  | "lifetime"
  | "eof"
  // Delimiters
  | "lparen"
  | "rparen"
  | "lbrace"
  | "rbrace"
  | "lbracket"
  | "rbracket"
  // Single-char punctuation
  | "comma"
  | "semi"
  | "colon"
  | "dot"
  | "hash"
  | "at"
  | "question"
  // Single-char operators
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
  // Multi-char operators
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
  | "path_sep"
  | "dot_dot"
  | "dot_dot_eq";

/** A single lexical token: its category, its source text, and where it sits. */
export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly span: Span;
}

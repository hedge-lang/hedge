/** A half-open source range, measured in UTF-16 code units, 0-based. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** The lexical category of a {@link Token}. Extended as the lexer grows. */
export type TokenKind =
  | "ident"
  | "keyword"
  | "int"
  | "string"
  | "punct"
  | `doc-${"inner" | "outer"}`
  | "eof";

/** A single lexical token: its category, its source text, and where it sits. */
export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  readonly span: Span;
}

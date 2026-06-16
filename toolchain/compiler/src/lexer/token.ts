/** A half-open source range, measured in UTF-16 code units, 0-based. */
export interface Span {
  readonly start: number;
  readonly end: number;
}

/** The lexical category of a {@link Token}. */
export type Token =
  // Non-symbol tokens
  | { readonly kind: "ident"; readonly span: Span; readonly text: string }
  | { readonly kind: "keyword"; readonly span: Span; readonly text: string }
  | { readonly kind: "int"; readonly span: Span; readonly text: string }
  | { readonly kind: "string"; readonly span: Span; readonly text: string }
  | { readonly kind: "lifetime"; readonly span: Span; readonly text: string }
  | { readonly kind: "eof"; readonly span: Span }
  // Delimiters
  | { readonly kind: "lparen"; readonly span: Span }
  | { readonly kind: "rparen"; readonly span: Span }
  | { readonly kind: "lbrace"; readonly span: Span }
  | { readonly kind: "rbrace"; readonly span: Span }
  | { readonly kind: "lbracket"; readonly span: Span }
  | { readonly kind: "rbracket"; readonly span: Span }
  // Single-char punctuation
  | { readonly kind: "comma"; readonly span: Span }
  | { readonly kind: "semi"; readonly span: Span }
  | { readonly kind: "colon"; readonly span: Span }
  | { readonly kind: "dot"; readonly span: Span }
  | { readonly kind: "hash"; readonly span: Span }
  | { readonly kind: "at"; readonly span: Span }
  | { readonly kind: "question"; readonly span: Span }
  // Single-char operators
  | { readonly kind: "plus"; readonly span: Span }
  | { readonly kind: "minus"; readonly span: Span }
  | { readonly kind: "star"; readonly span: Span }
  | { readonly kind: "slash"; readonly span: Span }
  | { readonly kind: "percent"; readonly span: Span }
  | { readonly kind: "amp"; readonly span: Span }
  | { readonly kind: "pipe"; readonly span: Span }
  | { readonly kind: "caret"; readonly span: Span }
  | { readonly kind: "bang"; readonly span: Span }
  | { readonly kind: "lt"; readonly span: Span }
  | { readonly kind: "gt"; readonly span: Span }
  | { readonly kind: "eq"; readonly span: Span }
  // Multi-char operators
  | { readonly kind: "eq_eq"; readonly span: Span }
  | { readonly kind: "bang_eq"; readonly span: Span }
  | { readonly kind: "lt_eq"; readonly span: Span }
  | { readonly kind: "gt_eq"; readonly span: Span }
  | { readonly kind: "amp_amp"; readonly span: Span }
  | { readonly kind: "pipe_pipe"; readonly span: Span }
  | { readonly kind: "lt_lt"; readonly span: Span }
  | { readonly kind: "gt_gt"; readonly span: Span }
  | { readonly kind: "lt_lt_eq"; readonly span: Span }
  | { readonly kind: "gt_gt_eq"; readonly span: Span }
  | { readonly kind: "plus_eq"; readonly span: Span }
  | { readonly kind: "minus_eq"; readonly span: Span }
  | { readonly kind: "star_eq"; readonly span: Span }
  | { readonly kind: "slash_eq"; readonly span: Span }
  | { readonly kind: "percent_eq"; readonly span: Span }
  | { readonly kind: "amp_eq"; readonly span: Span }
  | { readonly kind: "pipe_eq"; readonly span: Span }
  | { readonly kind: "caret_eq"; readonly span: Span }
  | { readonly kind: "arrow"; readonly span: Span }
  | { readonly kind: "fat_arrow"; readonly span: Span }
  | { readonly kind: "path_sep"; readonly span: Span }
  | { readonly kind: "dot_dot"; readonly span: Span }
  | { readonly kind: "dot_dot_eq"; readonly span: Span };

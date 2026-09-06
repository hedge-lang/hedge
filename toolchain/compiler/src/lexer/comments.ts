import { type Diagnostic, errorDiagnostic } from "../diagnostics/index.js";
import { none, type Option, some } from "../option.js";
import { err, isErr, ok, type Result } from "../result.js";
import { type Token } from "./token.js";
import { isWhitespace } from "./whitespace.js";

/**
 * Parse a comment starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` if the source starts with a comment.
 * @returns `None` if the source does not start with a comment.
 */
// eslint-disable-next-line complexity -- The main loop is more readable as a single function.
export function tokenizeComment(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  const maybeOuter = isOuterDocComment(source, start);
  if (isErr(maybeOuter)) {
    diagnostics.push(maybeOuter.error);
    return none();
  }
  if (maybeOuter.value)
    return tokenizeOuterDocComment(tokens, diagnostics, source, start);

  const maybeInner = isInnerDocComment(source, start);
  if (isErr(maybeInner)) {
    diagnostics.push(maybeInner.error);
    return none();
  }
  if (maybeInner.value)
    return tokenizeInnerDocComment(tokens, diagnostics, source, start);

  const maybeLine = isLineComment(source, start);
  if (isErr(maybeLine)) {
    diagnostics.push(maybeLine.error);
    return none();
  }
  if (maybeLine.value)
    return tokenizeLineComment(tokens, diagnostics, source, start);

  const maybeBlock = isBlockComment(source, start);
  if (isErr(maybeBlock)) {
    diagnostics.push(maybeBlock.error);
    return none();
  }
  if (maybeBlock.value)
    return tokenizeBlockComment(tokens, diagnostics, source, start);

  const maybeBlockOuter = isBlockOuterDocComment(source, start);
  if (isErr(maybeBlockOuter)) {
    diagnostics.push(maybeBlockOuter.error);
    return none();
  }
  if (maybeBlockOuter.value)
    return tokenizeBlockOuterDocComment(tokens, diagnostics, source, start);

  const maybeBlockInner = isBlockInnerDocComment(source, start);
  if (isErr(maybeBlockInner)) {
    diagnostics.push(maybeBlockInner.error);
    return none();
  }
  if (maybeBlockInner.value)
    return tokenizeBlockInnerDocComment(tokens, diagnostics, source, start);

  return none();
}

/**
 * Identify a line comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `Ok(true)` if the source starts with a line comment.
 * @returns `Ok(false)` if the source does not start with a line comment.
 * @returns `Err(Diagnostic)` if the source is out of bounds.
 */
export function isLineComment(
  source: string,
  index: number,
): Result<boolean, Diagnostic> {
  const ch = source.at(index);
  if (ch === undefined) {
    return err(
      errorDiagnostic(
        { kind: "LexReadPastEnd", index, sourceLength: source.length },
        none(),
      ),
    );
  }
  return ok(ch === "/" && source.at(index + 1) === "/");
}

/**
 * Parse a line comment starting at `start` in `source`, appending it to `tokens`.
 *
 * @param _tokens The token list to append to.
 * @param _diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the comment.
 */
export function tokenizeLineComment(
  _tokens: Token[],
  _diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  for (let i = start + 2; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\n" || ch === "\r") {
      return some(i);
    }
  }
  return some(source.length);
}

/**
 * Identify a block comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `Ok(true)` if the source starts with a block comment.
 * @returns `Ok(false)` if the source does not start with a block comment.
 * @returns `Err(Diagnostic)` if the source is out of bounds.
 */
export function isBlockComment(
  source: string,
  index: number,
): Result<boolean, Diagnostic> {
  const ch = source.at(index);
  if (ch === undefined) {
    return err(
      errorDiagnostic(
        { kind: "LexReadPastEnd", index, sourceLength: source.length },
        none(),
      ),
    );
  }
  return ok(
    ch === "/" &&
      source.at(index + 1) === "*" &&
      source.at(index + 2) !== "*" &&
      source.at(index + 2) !== "!",
  );
}

/**
 * Parse a block comment starting at `start` in `source`, appending it to `tokens`.
 *
 * @param _tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the comment.
 */
export function tokenizeBlockComment(
  _tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  const OFFSET_START = 2;
  const OFFSET_END = 2;

  let nesting = 0;
  for (let i = start + OFFSET_START; i < source.length; i++) {
    if (source[i] === "/" && source[i + 1] === "*") {
      nesting += 1;
    }
    if (source[i] === "*" && source[i + 1] === "/") {
      if (nesting === 0) {
        return some(i + OFFSET_END);
      }
      nesting -= 1;
    }
  }
  diagnostics.push(
    errorDiagnostic(
      { kind: "LexUnterminatedBlockComment" },
      some({ start, end: source.length }),
    ),
  );
  return some(source.length);
}

/**
 * Identify a block outer doc comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `Ok(true)` if the source starts with a block outer doc comment (`/**`).
 * @returns `Ok(false)` if the source does not.
 * @returns `Err(Diagnostic)` if the source is out of bounds.
 */
function isBlockOuterDocComment(
  source: string,
  index: number,
): Result<boolean, Diagnostic> {
  const ch = source.at(index);
  if (ch === undefined) {
    return err(
      errorDiagnostic(
        { kind: "LexReadPastEnd", index, sourceLength: source.length },
        none(),
      ),
    );
  }
  return ok(
    ch === "/" && source.at(index + 1) === "*" && source.at(index + 2) === "*",
  );
}

/**
 * Parse a block outer doc comment starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the comment.
 */
function tokenizeBlockOuterDocComment(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  const OFFSET_START = 3;
  const OFFSET_END = 2;

  tokens.push(
    {
      kind: "hash",
      span: { start, end: start },
    },
    {
      kind: "lbracket",
      span: { start, end: start },
    },
    {
      kind: "ident",
      text: "doc",
      span: { start, end: start },
    },
    {
      kind: "lparen",
      span: { start, end: start },
    },
  );

  for (let i = start + OFFSET_START; i < source.length; i++) {
    if (source[i] === "*" && source[i + 1] === "/") {
      const end = i + OFFSET_END;
      let sliceStart = start + OFFSET_START;
      if (source[sliceStart] === " ") {
        sliceStart += 1;
      }

      const normalizedComments = normalizeComment(source.slice(sliceStart, i));
      for (let j = 0; j < normalizedComments.length; j++) {
        if (j !== 0) {
          tokens.push({
            kind: "comma",
            span: { start, end },
          });
        }
        tokens.push({
          kind: "string",
          text: normalizedComments[j] ?? "",
          span: { start, end },
        });
      }

      tokens.push(
        {
          kind: "rparen",
          span: { start: end, end },
        },
        {
          kind: "rbracket",
          span: { start: end, end },
        },
      );
      return some(end);
    }
  }
  diagnostics.push(
    errorDiagnostic(
      { kind: "LexUnterminatedBlockComment" },
      some({ start, end: source.length }),
    ),
  );
  return some(source.length);
}

/**
 * Identify a block inner doc comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `Ok(true)` if the source starts with a block inner doc comment (`/*!`).
 * @returns `Ok(false)` if the source does not.
 * @returns `Err(Diagnostic)` if the source is out of bounds.
 */
function isBlockInnerDocComment(
  source: string,
  index: number,
): Result<boolean, Diagnostic> {
  const ch = source.at(index);
  if (ch === undefined) {
    return err(
      errorDiagnostic(
        { kind: "LexReadPastEnd", index, sourceLength: source.length },
        none(),
      ),
    );
  }
  return ok(
    ch === "/" && source.at(index + 1) === "*" && source.at(index + 2) === "!",
  );
}

/**
 * Parse a block inner doc comment starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the comment.
 */
function tokenizeBlockInnerDocComment(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  const OFFSET_START = 3;
  const OFFSET_END = 2;

  tokens.push(
    {
      kind: "hash",
      span: { start, end: start },
    },
    {
      kind: "bang",
      span: { start, end: start },
    },
    {
      kind: "lbracket",
      span: { start, end: start },
    },
    {
      kind: "ident",
      text: "doc",
      span: { start, end: start },
    },
    {
      kind: "lparen",
      span: { start, end: start },
    },
  );

  for (let i = start + OFFSET_START; i < source.length; i++) {
    if (source[i] === "*" && source[i + 1] === "/") {
      const end = i + OFFSET_END;
      let sliceStart = start + OFFSET_START;
      if (source[sliceStart] === " ") {
        sliceStart += 1;
      }

      const normalizedComments = normalizeComment(source.slice(sliceStart, i));
      for (let j = 0; j < normalizedComments.length; j++) {
        if (j !== 0) {
          tokens.push({
            kind: "comma",
            span: { start, end },
          });
        }
        tokens.push({
          kind: "string",
          text: normalizedComments[j] ?? "",
          span: { start, end },
        });
      }

      tokens.push(
        {
          kind: "rparen",
          span: { start: end, end },
        },
        {
          kind: "rbracket",
          span: { start: end, end },
        },
      );
      return some(end);
    }
  }
  diagnostics.push(
    errorDiagnostic(
      { kind: "LexUnterminatedBlockComment" },
      some({ start, end: source.length }),
    ),
  );
  return some(source.length);
}

/**
 * Identify an outer doc comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `Ok(true)` if the source starts with an outer doc comment (`///`).
 * @returns `Ok(false)` if the source does not.
 * @returns `Err(Diagnostic)` if the source is out of bounds.
 */
function isOuterDocComment(
  source: string,
  index: number,
): Result<boolean, Diagnostic> {
  const ch = source.at(index);
  if (ch === undefined) {
    return err(
      errorDiagnostic(
        { kind: "LexReadPastEnd", index, sourceLength: source.length },
        none(),
      ),
    );
  }
  return ok(
    ch === "/" && source.at(index + 1) === "/" && source.at(index + 2) === "/",
  );
}

/**
 * Shared core of `tokenizeOuterDocComment`/`tokenizeInnerDocComment`: gathers
 * every consecutive `///`/`//!`-marked line (skipping only whitespace between
 * them) into one comma-separated `#[doc("...")]`/`#![doc("...")]` token
 * sequence. `leadingTokens` supplies the marker-specific prefix (outer has no
 * `bang`, inner does); `isMarker` distinguishes `///` from `//!` at each
 * line's start.
 */
// eslint-disable-next-line complexity -- Shared parse loop; deliberately not split further
function tokenizeLineDocComment(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
  leadingTokens: readonly Token[],
  isMarker: (source: string, index: number) => Result<boolean, Diagnostic>,
): Option<number> {
  const OFFSET_START = 3;

  tokens.push(...leadingTokens);

  const lines: string[] = [];
  let end = source.length;
  for (let i = start; i < source.length;) {
    while (i < source.length) {
      const maybeWhitespace = isWhitespace(source, i);
      if (isErr(maybeWhitespace)) {
        diagnostics.push(maybeWhitespace.error);
        break;
      }
      if (!maybeWhitespace.value) {
        break;
      }
      i += 1;
    }

    if (i >= source.length) break;

    const maybeIsMarker = isMarker(source, i);
    if (isErr(maybeIsMarker)) {
      diagnostics.push(maybeIsMarker.error);
      break;
    }
    if (!maybeIsMarker.value) {
      break;
    }

    let j = i + OFFSET_START;
    const lastStart = j;
    while (j < source.length && source[j] !== "\n") {
      j += 1;
    }
    lines.push(source.slice(lastStart, j));
    i = j + 1;
    end = j;
  }

  const text = lines.join("\n");
  const normalizedComments = normalizeComment(text);
  for (let j = 0; j < normalizedComments.length; j++) {
    if (j !== 0) {
      tokens.push({
        kind: "comma",
        span: { start, end },
      });
    }
    tokens.push({
      kind: "string",
      text: normalizedComments[j] ?? "",
      span: { start, end },
    });
  }

  tokens.push(
    {
      kind: "rparen",
      span: { start: end, end },
    },
    {
      kind: "rbracket",
      span: { start: end, end },
    },
  );
  return some(end);
}

/**
 * Parse an outer doc comment starting at `start` in `source`, appending it to `tokens`.
 *
 * Doc comments are lowered into a synthetic `#[doc("...")]` token sequence so
 * the parser assembles them into ordinary `doc` attributes (`///` is sugar for
 * `#[doc = "..."]`); see `parseAttribute` in the parser.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the comment.
 */
function tokenizeOuterDocComment(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  return tokenizeLineDocComment(
    tokens,
    diagnostics,
    source,
    start,
    [
      { kind: "hash", span: { start, end: start } },
      { kind: "lbracket", span: { start, end: start } },
      { kind: "ident", text: "doc", span: { start, end: start } },
      { kind: "lparen", span: { start, end: start } },
    ],
    isOuterDocComment,
  );
}

/**
 * Identify an inner doc comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `Ok(true)` if the source starts with an inner doc comment (`//!`).
 * @returns `Ok(false)` if the source does not.
 * @returns `Err(Diagnostic)` if the source is out of bounds.
 */
function isInnerDocComment(
  source: string,
  index: number,
): Result<boolean, Diagnostic> {
  const ch = source.at(index);
  if (ch === undefined) {
    return err(
      errorDiagnostic(
        { kind: "LexReadPastEnd", index, sourceLength: source.length },
        none(),
      ),
    );
  }
  return ok(
    ch === "/" && source.at(index + 1) === "/" && source.at(index + 2) === "!",
  );
}

/**
 * Parse an inner doc comment starting at `start` in `source`, appending it to `tokens`.
 *
 * Doc comments are lowered into a synthetic `#![doc("...")]` token sequence so
 * the parser assembles them into ordinary inner `doc` attributes (`//!` is sugar for
 * `#![doc = "..."]`); see `parseAttribute` in the parser.
 *
 * @param tokens The token list to append to.
 * @param diagnostics The diagnostic list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns `Some(index)` with the index of the first character after the comment.
 */
function tokenizeInnerDocComment(
  tokens: Token[],
  diagnostics: Diagnostic[],
  source: string,
  start: number,
): Option<number> {
  return tokenizeLineDocComment(
    tokens,
    diagnostics,
    source,
    start,
    [
      { kind: "hash", span: { start, end: start } },
      { kind: "bang", span: { start, end: start } },
      { kind: "lbracket", span: { start, end: start } },
      { kind: "ident", text: "doc", span: { start, end: start } },
      { kind: "lparen", span: { start, end: start } },
    ],
    isInnerDocComment,
  );
}

/**
 * Normalize a comment by removing leading whitespace.
 *
 * @param text The comment text.
 *
 * @returns The normalized comment text.
 */
function normalizeComment(text: string): string[] {
  const lines = text.split("\n");
  let minIndent: number | null = null;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const maybeWhitespace = isWhitespace(line, i);
      if (isErr(maybeWhitespace) || !maybeWhitespace.value) {
        minIndent = Math.min(minIndent ?? i, i);
        break;
      }
    }
  }

  const indent = minIndent ?? 0;
  return lines.map((line) => line.slice(indent));
}

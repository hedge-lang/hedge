import type { Diagnostic } from "./diagnostics/index.js";
import { tokenize } from "./lexer/lexer.js";
import type { Token } from "./lexer/token.js";
import { isSome, type Option } from "./option.js";
import type { Program } from "./parser/ast.js";
import { parse } from "./parser/parser.js";

const PRIMITIVE_ZEROS: readonly (readonly [string, string])[] = [
  ["i8", "0"],
  ["i16", "0"],
  ["i32", "0"],
  ["i64", "0"],
  ["isize", "0"],
  ["u8", "0"],
  ["u16", "0"],
  ["u32", "0"],
  ["u64", "0"],
  ["usize", "0"],
  ["f32", "0.0f32"],
  ["f64", "0.0"],
  ["bool", "false"],
  ["char", "'\\0'"],
];

const PRIMITIVE_IMPLS = PRIMITIVE_ZEROS.map(
  ([name, zero]) => `impl Clone for ${name} {
  fn clone(&self) -> ${name} { *self }
}

impl Default for ${name} {
  fn default() -> ${name} { ${zero} }
}
`,
).join("\n");

/**
 * The always-in-scope standard-library declarations, compiled in front of
 * every program. Pre-modules (ROADMAP Slice 7), this is the only prelude
 * mechanism: the items reach the user program through the normal
 * registration and resolution passes, exactly as if they had been declared
 * at the top of the file. `prelude.test.ts` pins that this source parses
 * and analyzes clean on its own - a break there is what fails CI.
 */
export const PRELUDE_SOURCE = `trait Clone {
  fn clone(&self) -> Self;
}

trait PartialEq {
  fn eq(&self, other: &Self) -> bool;
}

trait Eq: PartialEq {}

enum Ordering { Less, Equal, Greater }

enum Option<T> { Some(T), None }

enum Result<T, E> { Ok(T), Err(E) }

impl<T> Option<T> {
  fn is_some(&self) -> bool {
    match self {
      Option::Some(x) => true,
      Option::None => false,
    }
  }

  fn is_none(&self) -> bool {
    match self {
      Option::Some(x) => false,
      Option::None => true,
    }
  }

  fn unwrap_or(self, default: T) -> T {
    match self {
      Option::Some(x) => x,
      Option::None => default,
    }
  }
}

impl<T, E> Result<T, E> {
  fn is_ok(&self) -> bool {
    match self {
      Result::Ok(x) => true,
      Result::Err(e) => false,
    }
  }

  fn is_err(&self) -> bool {
    match self {
      Result::Ok(x) => false,
      Result::Err(e) => true,
    }
  }

  fn unwrap_or(self, default: T) -> T {
    match self {
      Result::Ok(x) => x,
      Result::Err(e) => default,
    }
  }
}

impl<T: Clone> Clone for Option<T> {
  fn clone(&self) -> Option<T> {
    match self {
      Option::Some(x) => Option::Some(x.clone()),
      Option::None => Option::None,
    }
  }
}

impl<T: PartialEq> PartialEq for Option<T> {
  fn eq(&self, other: &Option<T>) -> bool {
    match self {
      Option::Some(a) => match other {
        Option::Some(b) => a == b,
        Option::None => false,
      },
      Option::None => match other {
        Option::Some(b) => false,
        Option::None => true,
      },
    }
  }
}

impl<T: PartialEq + Eq> Eq for Option<T> {}

impl<T, E> Clone for Result<T, E> where T: Clone, E: Clone {
  fn clone(&self) -> Result<T, E> {
    match self {
      Result::Ok(x) => Result::Ok(x.clone()),
      Result::Err(e) => Result::Err(e.clone()),
    }
  }
}

impl<T, E> PartialEq for Result<T, E> where T: PartialEq, E: PartialEq {
  fn eq(&self, other: &Result<T, E>) -> bool {
    match self {
      Result::Ok(a) => match other {
        Result::Ok(b) => a == b,
        Result::Err(b) => false,
      },
      Result::Err(a) => match other {
        Result::Ok(b) => false,
        Result::Err(b) => a == b,
      },
    }
  }
}

impl<T, E> Eq for Result<T, E> where T: PartialEq + Eq, E: PartialEq + Eq {}

trait PartialOrd: PartialEq {
  fn partial_cmp(&self, other: &Self) -> Ordering;
}

trait Ord: Eq + PartialOrd {
  fn cmp(&self, other: &Self) -> Ordering;
}

trait Default {
  fn default() -> Self;
}

trait Drop {
  fn drop(&mut self);
}

trait Neg {
  type Output;
  fn neg(self) -> Self::Output;
}

trait Not {
  type Output;
  fn not(self) -> Self::Output;
}

trait AddAssign<Rhs = Self> {
  fn add_assign(&mut self, rhs: Rhs);
}

trait SubAssign<Rhs = Self> {
  fn sub_assign(&mut self, rhs: Rhs);
}

trait MulAssign<Rhs = Self> {
  fn mul_assign(&mut self, rhs: Rhs);
}

trait DivAssign<Rhs = Self> {
  fn div_assign(&mut self, rhs: Rhs);
}

trait RemAssign<Rhs = Self> {
  fn rem_assign(&mut self, rhs: Rhs);
}

trait BitAndAssign<Rhs = Self> {
  fn bitand_assign(&mut self, rhs: Rhs);
}

trait BitOrAssign<Rhs = Self> {
  fn bitor_assign(&mut self, rhs: Rhs);
}

trait BitXorAssign<Rhs = Self> {
  fn bitxor_assign(&mut self, rhs: Rhs);
}

trait ShlAssign<Rhs = Self> {
  fn shl_assign(&mut self, rhs: Rhs);
}

trait ShrAssign<Rhs = Self> {
  fn shr_assign(&mut self, rhs: Rhs);
}

trait Add<Rhs = Self> {
  type Output;
  fn add(self, rhs: Rhs) -> Self::Output;
}

trait Sub<Rhs = Self> {
  type Output;
  fn sub(self, rhs: Rhs) -> Self::Output;
}

trait Mul<Rhs = Self> {
  type Output;
  fn mul(self, rhs: Rhs) -> Self::Output;
}

trait Div<Rhs = Self> {
  type Output;
  fn div(self, rhs: Rhs) -> Self::Output;
}

trait Rem<Rhs = Self> {
  type Output;
  fn rem(self, rhs: Rhs) -> Self::Output;
}

trait BitAnd<Rhs = Self> {
  type Output;
  fn bitand(self, rhs: Rhs) -> Self::Output;
}

trait BitOr<Rhs = Self> {
  type Output;
  fn bitor(self, rhs: Rhs) -> Self::Output;
}

trait BitXor<Rhs = Self> {
  type Output;
  fn bitxor(self, rhs: Rhs) -> Self::Output;
}

trait Shl<Rhs = Self> {
  type Output;
  fn shl(self, rhs: Rhs) -> Self::Output;
}

trait Shr<Rhs = Self> {
  type Output;
  fn shr(self, rhs: Rhs) -> Self::Output;
}

${PRIMITIVE_IMPLS}
impl<T> Default for Option<T> {
  fn default() -> Option<T> { Option::None }
}
`;

export interface AssembledProgram {
  readonly program: Option<Program>;
  readonly tokens: readonly Token[];
  readonly lexDiagnostics: readonly Diagnostic[];
  readonly parseDiagnostics: readonly Diagnostic[];
}

/**
 * Prelude token spans are pushed past any real source offset so the combined
 * stream stays a single non-overlapping span space: `parser.ts`'s
 * missing-item-name recovery locates the offending token by `span.start`
 * alone, and a prelude token sharing an offset with a user token would
 * otherwise misdirect it.
 */
const SYNTHETIC_SPAN_BASE = 1_000_000_000;

export function isPreludeToken(
  tokens: readonly Token[],
  tokenId: number,
): boolean {
  const token = tokens[tokenId];
  return token !== undefined && token.span.start >= SYNTHETIC_SPAN_BASE;
}

const PRELUDE_TOKENS: readonly Token[] = tokenize(PRELUDE_SOURCE)
  .tokens.filter((token): boolean => token.kind !== "eof")
  .map((token) => ({
    ...token,
    span: {
      start: token.span.start + SYNTHETIC_SPAN_BASE,
      end: token.span.end + SYNTHETIC_SPAN_BASE,
    },
  }));

/**
 * Length of the leading run of module-level inner attributes (`#![...]`,
 * which is also what a leading `//!` doc comment lexes to). They must stay
 * at token 0 for `parse()` to read them as module attributes, so the
 * prelude splices in after them rather than before.
 */
function leadingInnerAttributePrefix(tokens: readonly Token[]): number {
  let index = 0;
  while (
    tokens[index]?.kind === "hash" &&
    tokens[index + 1]?.kind === "bang" &&
    tokens[index + 2]?.kind === "lbracket"
  ) {
    index += 2;
    let depth = 0;
    do {
      const kind = tokens[index]?.kind;
      if (kind === undefined) return index;
      if (kind === "lbracket") depth += 1;
      else if (kind === "rbracket") depth -= 1;
      index += 1;
    } while (depth > 0);
  }
  return index;
}

/**
 * Parses {@link source} with the std prelude spliced into its token stream,
 * so every `tokenId` is a correct index into the returned `tokens` with no
 * rewriting. The user tokens are parsed on their own first: a parse failure
 * (a truncated program, unrecoverable syntax) returns exactly what it would
 * without a prelude, and only a program that parses cleanly on its own is
 * re-parsed with the prelude spliced in ahead of its first item. The user
 * tokens keep their original spans, so diagnostics, source maps, and
 * fixture offsets are unaffected by the splice.
 */
export function assembleProgram(source: string): AssembledProgram {
  const { tokens: userTokens, diagnostics: lexDiagnostics } = tokenize(source);
  const userOnly = parse(userTokens);
  if (!isSome(userOnly.program)) {
    return {
      program: userOnly.program,
      tokens: userTokens,
      lexDiagnostics,
      parseDiagnostics: userOnly.diagnostics,
    };
  }
  const prefix = leadingInnerAttributePrefix(userTokens);
  const tokens = [
    ...userTokens.slice(0, prefix),
    ...PRELUDE_TOKENS,
    ...userTokens.slice(prefix),
  ];
  const { program, diagnostics: parseDiagnostics } = parse(tokens);
  return { program, tokens, lexDiagnostics, parseDiagnostics };
}

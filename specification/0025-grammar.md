# Grammar

This appendix is the normative grammar for Hedge: the lexical structure, the
operator precedence table, and the syntactic productions. The prose chapters
remain authoritative for semantics; where a construct's meaning matters, they
own it and this appendix only fixes its shape.

## Notation

Productions are written in EBNF:

```
::=        defines a production
|          alternation
( )        grouping
?          zero or one
*          zero or more
+          one or more
"..."      a literal terminal
UPPER/Name a nonterminal
(* ... *)  a comment
```

Terminals written as bare symbols (`+`, `::`, `#[`) are literal source text. A
range of characters is written `'a'..'z'`.

## Lexical grammar

The lexer reads Unicode source text (UTF-8) and produces tokens. Whitespace and
comments separate tokens and are otherwise insignificant; Hedge has no automatic
semicolon insertion.

### Whitespace and comments

```
LineComment  ::= "//" (* any character except newline *)*
BlockComment ::= "/*" ( BlockComment | (* any character *) )* "*/"
DocComment   ::= "///" (* to newline *) | "//!" (* to newline *)
```

Block comments nest. `///` documents the following item and `//!` the enclosing
module; both are otherwise ordinary comments that tooling may consume.

### Identifiers

An identifier is an ECMAScript `IdentifierName`, so every Hedge identifier is a
valid JavaScript identifier and can be exported verbatim.

```
Identifier   ::= RawIdentifier | IdentStart IdentContinue*
IdentStart   ::= UnicodeIDStart | "_" | "$"
IdentContinue::= UnicodeIDContinue | "$" | ZWNJ | ZWJ
RawIdentifier::= "r#" IdentStart IdentContinue*
```

Identifiers are compared by code point; no normalization is applied, matching
JavaScript. A `RawIdentifier` uses a keyword as an ordinary identifier (`r#fn`,
`r#match`). Exporting a name that is a JavaScript reserved word is a compile
error; rename it at the boundary with `as` (see [Modules](0018-modules.md) and
[JavaScript export generation](0021-javascript-export-generation.md)).

### Keywords

Hard keywords are always reserved and may appear as identifiers only through the
`r#` form:

```
as     async  await  break  const  continue  dyn    else   enum
export extern false  fn     for    if        impl   in     let
loop   match  move   pub    return self  Self  static struct super
trait  true   type   unsafe use    where     while
```

Contextual keywords are keywords only in their syntactic slot and are ordinary
identifiers elsewhere (so `socket.write(buf)` and `fn test()` are valid):

```
write  bind  package  unchecked
```

Attribute names (`derive`, `test`, `non_exhaustive`, and any future ones) are
ordinary identifiers; they carry meaning only inside `#[ ... ]`, so they are not
keywords.

The following are reserved but unused, held back for diagnostics and future use.
They are not valid identifiers except through `r#`:

```
mut  mod  box  macro  yield
```

`mut`, `mod`, and `box` mark capabilities Hedge deliberately omits (`write`
instead of `mut`, files-as-modules instead of `mod`, no `Box`); reserving them
lets the compiler report the intended alternative rather than a generic parse
error. New keywords are introduced only at major language versions, and the `r#`
form keeps any such addition from breaking existing code.

### Literals

```
Literal ::= IntLiteral | FloatLiteral | CharLiteral | StringLiteral | BoolLiteral

BoolLiteral ::= "true" | "false"

IntLiteral  ::= ( DecInt | HexInt | OctInt | BinInt ) IntSuffix?
DecInt      ::= Digit ( Digit | "_" )*
HexInt      ::= "0x" HexDigit ( HexDigit | "_" )*
OctInt      ::= "0o" OctDigit ( OctDigit | "_" )*
BinInt      ::= "0b" ( "0" | "1" ) ( "0" | "1" | "_" )*
IntSuffix   ::= "i8" | "i16" | "i32" | "i64" | "u8" | "u16" | "u32" | "u64"
             | "usize" | "isize"

FloatLiteral::= DecInt "." DecInt Exponent? FloatSuffix?
             | DecInt Exponent FloatSuffix?
             | DecInt FloatSuffix
Exponent    ::= ( "e" | "E" ) ( "+" | "-" )? DecInt
FloatSuffix ::= "f32" | "f64"
```

A `.` in a float requires digits on both sides, so `1.0` is a float while `1.`
and `.5` are not; this keeps `5.method()` an unambiguous method call. An
unsuffixed integer literal defaults to `i32` and an unsuffixed float to `f64`
(see [Primitive Types](0010-primitive-types.md)).

```
CharLiteral ::= "'" ( CharChar | EscapeSeq ) "'"
CharChar    ::= (* any character except "'", "\", or newline *)

StringLiteral ::= '"' ( StringChar | EscapeSeq | Interpolation )* '"'
              | RawString
StringChar    ::= (* any character except '"', "\", or "${" *)
Interpolation ::= "${" Expression "}"
RawString     ::= "r" '"' (* any character except '"' *)* '"'
               | "r#" '"' (* any character except '"#' *)* '"#'

EscapeSeq ::= "\" ( "n" | "r" | "t" | "\" | "'" | '"' | "0"
                  | "x" HexDigit HexDigit
                  | "u{" HexDigit+ "}"
                  | "$" )
```

An `${ Expression }` interpolation requires the expression to implement the
format trait (`Display`) and lowers to a JavaScript template literal. A literal
`${` is written `\${`. Raw strings take no escapes and no interpolation.

```
Digit    ::= '0'..'9'
HexDigit ::= '0'..'9' | 'a'..'f' | 'A'..'F'
OctDigit ::= '0'..'7'
```

### Lifetimes and labels

```
Lifetime ::= "'" Identifier   (* not immediately followed by "'" *)
Label    ::= "'" Identifier ":"
```

A leading `'` begins a `CharLiteral` when a closing `'` follows the single
character, and a `Lifetime` or `Label` otherwise.

## Operators and precedence

Operators are listed highest to lowest precedence. The overloaded sigils are
resolved by position: `&` and `*` are reference/dereference as prefix operators
and bit-and/multiply as infix; `|` is a closure or pattern delimiter by position
and bit-or as infix. In expression context `<` is always comparison, so explicit
type arguments to a value use the turbofish `::<...>`.

| Prec | Operators                              | Associativity |
| ---- | -------------------------------------- | ------------- |
| 1    | `.` `()` `[]` `?` (postfix)            | left          |
| 2    | `-` `!` `*` `&` `&write` (prefix)      | right         |
| 3    | `*` `/` `%`                            | left          |
| 4    | `+` `-`                                | left          |
| 5    | `<<` `>>`                              | left          |
| 6    | `&` (bit-and)                          | left          |
| 7    | `^`                                    | left          |
| 8    | `\|` (bit-or)                          | left          |
| 9    | `==` `!=` `<` `>` `<=` `>=`            | none          |
| 10   | `&&`                                   | left          |
| 11   | `\|\|`                                 | left          |
| 12   | `..` `..=`                             | none          |
| 13   | `=` `+=` `-=` `*=` `/=` `%=` `&=` `\|=` `^=` `<<=` `>>=` | right |
| 14   | closure body, `return`, `break`        | —             |

Comparison is non-associative, so `a < b < c` is a syntax error. Assignment is an
expression of type `()`, so `if x = y { }` is a type error rather than a silent
bug. A closure body and a `break`/`return` operand extend as far to the right as
the grammar allows.

## Syntactic grammar

### Items

```
Item        ::= Attribute* Visibility? ItemKind
Attribute   ::= "#[" Path ( "(" AttrArgs? ")" )? "]"
AttrArgs    ::= AttrArg ( "," AttrArg )* ","?
AttrArg     ::= Path | Literal | Path "=" Literal
Visibility  ::= "pub" ( "(" "package" ")" )?

ItemKind    ::= Function | Struct | Enum | Trait | Impl
             | TypeAlias | Const | Static | Use | ExternBlock

Linkage     ::= ( "export" | "extern" ) StringLiteral "unchecked"?

Function    ::= Linkage? "unsafe"? "async"? "const"? "fn" Identifier
                Generics? "(" Params? ")" ( "->" Type )? WhereClause?
                ( Block | ";" )
Params      ::= Receiver ( "," Param )* ","?
             | Param ( "," Param )* ","?
Receiver    ::= "self" | "write" "self" | "&" "self" | "&" "write" "self"
Param       ::= Pattern ":" Type

Struct      ::= "struct" Identifier Generics? WhereClause?
                ( StructBody | TupleBody ";" | ";" )
StructBody  ::= "{" ( Field ( "," Field )* ","? )? "}"
Field       ::= Attribute* "pub"? Identifier ":" Type
TupleBody   ::= "(" ( TupleField ( "," TupleField )* ","? )? ")"
TupleField  ::= "pub"? Type

Enum        ::= "enum" Identifier Generics? WhereClause?
                "{" ( Variant ( "," Variant )* ","? )? "}"
Variant     ::= Attribute* Identifier ( StructBody | TupleBody )?

Trait       ::= "trait" Identifier Generics? ( ":" TraitBounds )?
                WhereClause? "{" TraitItem* "}"
TraitItem   ::= Attribute* ( Function | TypeAlias | Const )

Impl        ::= "impl" Generics? ( TraitRef "for" )? Type WhereClause?
                "{" Item* "}"
TraitRef    ::= Path Generics?

TypeAlias   ::= "type" Identifier Generics? ( "=" Type )? ";"
Const       ::= "const" Identifier ":" Type "=" Expression ";"
Static      ::= "static" Identifier ":" Type "=" Expression ";"

Use         ::= "use" UseTree ";"
UseTree     ::= Path ( "::" "*"
                     | "::" "{" ( UseTree ( "," UseTree )* ","? )? "}" )?
                     ( "as" Identifier )?
ExternBlock ::= "extern" StringLiteral "{" ( Attribute* "unsafe"? Function )* "}"
```

A function with a body is a definition; `extern` declarations and trait methods
without a default end in `;`. `unchecked` is permitted only on an `export`
linkage. The semantic constraints on `export`/`extern` are in
[JavaScript Interactions](0003-javascript-interactions.md).

### Generics

```
Generics     ::= "<" GenericParam ( "," GenericParam )* ","? ">"
GenericParam ::= Lifetime | Identifier ( ":" TraitBounds )?
TraitBounds  ::= TraitBound ( "+" TraitBound )*
TraitBound   ::= Path Generics? | Lifetime
WhereClause  ::= "where" WherePredicate ( "," WherePredicate )* ","?
WherePredicate ::= Type ":" TraitBounds
```

### Types

```
Type ::= "&" Lifetime? "write"? Type
       | "[" Type ";" Expression "]"
       | "[" Type "]"
       | "(" ( Type ( "," Type )* ","? )? ")"
       | "fn" "(" ( Type ( "," Type )* )? ")" ( "->" Type )?
       | "dyn" TraitBound
       | "!"
       | "Self"
       | Path Generics?
```

`( )` is the unit type and `( Type )` a parenthesized type; a tuple type needs at
least one comma. `!` is the never type (see
[Expressions & Control Flow](0008-expressions-and-control-flow.md)).

### Patterns

```
Pattern    ::= OrPattern
OrPattern  ::= PatternNoAlt ( "|" PatternNoAlt )*
PatternNoAlt ::= "_"
             | Literal
             | RangePat
             | BindingPat
             | StructPat
             | TupleStructPat
             | TuplePat
             | SlicePat
             | Path
BindingPat ::= ( "&" "write"? | "write" )? Identifier ( "@" PatternNoAlt )?
RangePat   ::= Literal "..=" Literal
StructPat  ::= Path "{" ( FieldPat ( "," FieldPat )* )? ( ","? ".." )? "}"
FieldPat   ::= Identifier ( ":" Pattern )?
TupleStructPat ::= Path "(" ( Pattern ( "," Pattern )* )? ")"
TuplePat   ::= "(" ( Pattern ( "," Pattern )* ","? )? ")"
SlicePat   ::= "[" ( Pattern | RestPat ) ( "," ( Pattern | RestPat ) )* ","? "]"
RestPat    ::= ( "&" "write"? Identifier | Identifier )? ".."
```

Binding modes, refutability, and exhaustiveness are specified in
[Pattern matching](0016-pattern-matching.md).

### Statements and blocks

```
Block        ::= "{" Statement* Expression? "}"
Statement    ::= ";"
              | Item
              | LetStatement
              | Expression ";"
LetStatement ::= "let" "bind"? "write"? Pattern ( ":" Type )?
                 ( "=" Expression )? ";"
```

A block evaluates to its trailing expression, or to `()` when it ends in a
statement. Binding capabilities are declared `bind` before `write`
(`let bind write x`); see [Mutability](0004-mutability.md).

### Expressions

The expression grammar is layered by the precedence table above. The leaf and
compound forms are:

```
Expression ::= Literal
            | Path GenericArgs?
            | "(" ( Expression ( "," Expression )* ","? )? ")"   (* tuple / group *)
            | "[" ArrayElems? "]"
            | StructExpr
            | Closure
            | Block
            | IfExpr
            | MatchExpr
            | LoopExpr | WhileExpr | ForExpr
            | BreakExpr | ContinueExpr | ReturnExpr
            | UnaryExpr | BinaryExpr | AssignExpr
            | CallExpr | MethodCall | FieldAccess | IndexExpr | TryExpr
            | RangeExpr | "await" -postfix

GenericArgs ::= "::" "<" ( Type ( "," Type )* ","? )? ">"   (* turbofish *)
ArrayElems  ::= Expression ( "," Expression )* ","?
             | Expression ";" Expression                    (* [value; count] *)
StructExpr  ::= Path "{" ( FieldInit ( "," FieldInit )* )? ( ","? ".." Expression )? "}"
FieldInit   ::= Identifier ( ":" Expression )?

UnaryExpr   ::= ( "-" | "!" | "*" | "&" "write"? | "write" ) Expression
BinaryExpr  ::= Expression BinaryOp Expression
AssignExpr  ::= Expression AssignOp Expression
CallExpr    ::= Expression "(" ( Expression ( "," Expression )* ","? )? ")"
MethodCall  ::= Expression "." Identifier GenericArgs? "(" Args? ")"
FieldAccess ::= Expression "." ( Identifier | DecInt )
IndexExpr   ::= Expression "[" Expression "]"
TryExpr     ::= Expression "?"
RangeExpr   ::= Expression? ( ".." | "..=" ) Expression?

IfExpr      ::= "if" Expression Block ( "else" ( IfExpr | Block ) )?
             | "if" "let" Pattern "=" Expression Block ( "else" Block )?
MatchExpr   ::= "match" Expression "{" ( MatchArm ","? )* "}"
MatchArm    ::= Pattern ( "if" Expression )? "=>" Expression

Closure     ::= "move"? "async"? "|" ( ClosureParam ( "," ClosureParam )* ","? )? "|"
                ( Expression | "->" Type Block )
ClosureParam::= Pattern ( ":" Type )?
```

### Loops and labels

```
LoopExpr    ::= Label? "loop" Block
WhileExpr   ::= Label? ( "while" Expression | "while" "let" Pattern "=" Expression ) Block
ForExpr     ::= Label? "for" Pattern "in" Expression Block
BreakExpr   ::= "break" LabelRef? Expression?
ContinueExpr::= "continue" LabelRef?
ReturnExpr  ::= "return" Expression?
LabelRef    ::= "'" Identifier
```

A `break` carries an optional target label and an optional value. The value
becomes the result of the loop it targets: the innermost enclosing loop, or the
loop named by the label. All value-carrying breaks that target one `loop` must
unify to a single type, which is that loop's type; a `loop` with no value-break
yields `()`, and a `loop` with no reachable break is `!`. Only a `loop` may be
the target of a value-carrying break, because `while` and `for` always yield
`()` (they may run zero times); a valueless `break 'l` or `continue 'l` may
target any enclosing loop. See
[Expressions & Control Flow](0008-expressions-and-control-flow.md).

### Paths

```
Path        ::= "::"? PathSegment ( "::" PathSegment )*
PathSegment ::= Identifier | "self" | "super" | "Self"
```

A leading package name resolves to a dependency, and `self` and `super` resolve
to the current and parent modules (see [Modules](0018-modules.md)).

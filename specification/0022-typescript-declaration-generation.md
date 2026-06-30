# TypeScript Declaration Generation

Hedge emits a `.d.ts` describing the exported surface. The declarations reflect
what is true at runtime; they never assert a constraint Hedge cannot enforce. In
particular, exported object fields are plainly mutable, never `readonly`, since
JavaScript owns a value once it crosses out.

Names are emitted as written, with no case conversion.

## Type mapping

| Hedge                                            | TypeScript                                                     |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `bool`                                           | `boolean`                                                      |
| `i8`–`i32`, `u8`–`u32`, `usize`, `isize`         | `number`                                                       |
| `i64`, `u64`                                     | `bigint`                                                       |
| `f32`, `f64`                                     | `number`                                                       |
| `char`, `str`                                    | `string`                                                       |
| `()`                                             | `void`                                                         |
| `(A, B)`                                         | `[A, B]`                                                       |
| `Vec<T>`                                         | `Array<T>`                                                     |
| `Vec<u8>` / `Vec<i32>` / `Vec<f32>` / `Vec<i64>` | `Uint8Array` / `Int32Array` / `Float32Array` / `BigInt64Array` |
| `HashMap<K, V>` (primitive `K`)                  | `Map<K, V>`                                                    |
| `HashSet<T>` (primitive `T`)                     | `Set<T>`                                                       |
| `Option<T>`                                      | `T \| null`                                                    |
| `Result<T, E>`                                   | `T` (throws / rejects `E`)                                     |
| `struct`                                         | `interface` of public fields (mutable)                         |
| `enum`                                           | discriminated union on `tag`                                   |
| `async fn … -> T`                                | `(…) => Promise<T>`                                            |
| generic `fn<T>`                                  | generic signature `<T>` (erased at runtime)                    |

`HashMap`/`HashSet` map to a native `Map`/`Set` only for primitive keys. With a
composite key they use a structural hash map (see
[Generics & Traits](0015-generics-and-traits.md)) and do not surface as a native
`Map`.

## What cannot be declared

References do not cross the boundary, so a signature using `&T` or `&mut T`
across `export "js"`, or a struct that borrows, is a compile error rather than a
declaration. See [Safe/Unsafe Boundaries](0023-safe-unsafe-boundaries.md).

## Structs and enums

A struct becomes an `interface` of its public fields:

```ts
interface Point {
  x: number;
  y: number;
}
```

An enum becomes a discriminated union:

```ts
type Shape =
  | { tag: "Circle"; _0: number }
  | { tag: "Rect"; w: number; h: number };
```

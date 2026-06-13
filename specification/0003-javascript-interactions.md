# JavaScript Interactions

JavaScript is a foreign, untrusted environment, and every interaction with it
crosses an explicitly marked boundary in one of two directions. `export "js"`
exposes a Hedge function to JavaScript: it has a body, and the compiler emits the
entry point, the runtime guards, and the `.d.ts` declaration. `extern "js"`
imports a JavaScript function or value that Hedge calls: it is a declaration with
no body.

```hedge
export "js"
fn greet(name: &str) -> str {
  "Hello, " + name
}

fn internal(name: &str) -> str {
  greet(name)
}
```

generates roughly

```ts
export function greet(name: string): string {
  return `Hello, ${name}`;
}

function internal(name: string): string {
  return greet(name);
}
```

An import has no body and generates a typed `declare`:

```hedge
extern "js" {
  fn now() -> f64;
  fn random() -> f64;
}
```

```ts
declare function now(): number;
declare function random(): number;
```

An import that traffics in non-primitive objects must be marked `unsafe` (see
[Unsafe interop](#unsafe-interop)).

## The untrusted boundary

JavaScript is external and untrusted, and the compiler does not reason about its
aliases, getters and setters, proxies, or prototype chains. None of these are
represented in the Hedge type system, so the boundary is defined by what it
refuses to let across rather than by any model of the foreign side.

### Primitive values only

Only primitive values may cross from JavaScript into Hedge. A non-primitive value
would let JavaScript keep an alias and mutate the value after it had crossed,
invalidating both the type system and the ownership model:

```js
const x = [1, 2, 3];
hedgeProgram.run(x);
x.push("foo"); // breaks the Hedge types and ownership model
```

The restriction is one-directional. A Hedge program may hand an owned object out
to JavaScript, at which point it surrenders ownership and the JavaScript side is
free to do as it likes with the object.

A non-primitive value is dangerous even when it appears inert, because JavaScript
can hide mutation behind ordinary-looking access:

```javascript
// A getter that mutates internal state would break Hedge's assumptions if the
// object were passed directly into Hedge code.
class SharedObject {
  #value = 0;
  get value() {
    return this.#value++;
  }
}
```

### Runtime guards

A `.d.ts` is erased at runtime and untrusted JavaScript can ignore it, so the
primitive-only rule is enforced with real checks rather than types alone. Every
exported entry point guards its inbound arguments and rejects anything that is
not a primitive before Hedge code runs:

```ts
export function greet(name: string): string {
  if (typeof name !== "string") {
    throw new TypeError("greet: name must be a string");
  }
  return `Hello, ${name}`;
}
```

Guards are on by default. A boundary that has been audited, or that is
performance-critical, can opt out per function with `unchecked`:

```hedge
export "js" unchecked
fn greet(name: &str) -> str {
  "Hello, " + name
}
```

No arbitrary object can cross inward today. A future path would deep-copy the
value at the boundary, for example with `structuredClone`, and validate the copy,
so that Hedge never holds a live alias into JavaScript memory.

### References cannot cross

A reference cannot cross the boundary in either direction. JavaScript has no
notion of a reference, and passing one out would surrender the ownership
guarantee the reference depends on. An export that returns a reference is
therefore rejected:

```hedge
// Rejected: a reference cannot cross the boundary.
export "js"
fn get_by_name(name: &str) -> &Person {
  // Assuming person_map is Map<&str, Person>:
  person_map.get(name)
}
```

Were it allowed, it would erase to a plain object on the JavaScript side and the
read-only guarantee would be gone:

```ts
const alice = hedgeProgram.get_by_name("Alice");
alice.name = "Bob"; // no longer read-only
```

## Owned values with cleanup

A value whose type has a `Drop` cannot cross out implicitly, because that would
silently void its cleanup guarantee. It crosses through an explicit conversion
that surrenders ownership and attaches a disposer, so the JavaScript side can
release it with `using`:

```ts
using file = hedge.openLog(); // Hedge's cleanup runs at end of scope
```

See [Drop & RAII](0007-drop-and-raii.md) for how this is generated.

## Unsafe interop

Some JavaScript functionality cannot satisfy Hedge's guarantees at all — DOM and
browser APIs and arbitrary objects among them — and reaching it requires an
`unsafe` declaration, which marks the point where Hedge's guarantees stop and the
author takes responsibility:

```hedge
// Exporting a function that works with DOM objects requires unsafe: it receives
// and returns non-primitive JavaScript values.
export "js"
unsafe fn query_selector(document: Document, selector: str) -> Element {
    document.querySelector(selector)
}
```

```ts
export function query_selector(document: Document, selector: string): Element {
  return document.querySelector(selector);
}
```

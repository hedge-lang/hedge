import { compile, isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

function requireJavascript(source: string): string {
  const result = compile(source);
  expect(isSome(result.code)).toBe(true);
  if (!isSome(result.code) || !isSome(result.code.value.javascript)) {
    return "";
  }
  return result.code.value.javascript.value;
}

describe("drop determinism and RAII spec", (): void => {
  it("generated JS emits Symbol.dispose wiring for owned cleanup paths", (): void => {
    const js = requireJavascript(`
      struct Resource { id: i32 }
      fn main() {
        let x = Resource { id: 1 };
        print(x.id);
      }
    `);
    expect(js).toContain("Symbol.dispose");
  });

  it("drop order for distinct owned bindings is reverse declaration order", (): void => {
    // A struct field typed `i32` is Copy, so a struct with only Copy fields
    // has exactly one real drop point — the struct itself, not its fields.
    // Two separate droppable bindings (not two fields of one struct) is what
    // actually exercises "reverse declaration order": both bindings lower to
    // `using` in source declaration order, and native `using` semantics
    // guarantee disposal at scope end runs in the *reverse* of that order
    // (b before a) — no codegen effort beyond emitting `using` is needed.
    const js = requireJavascript(`
      struct A { id: i32 }
      struct B { id: i32 }
      fn main() {
        let a = A { id: 1 };
        let b = B { id: 2 };
        print(a.id + b.id);
      }
    `);
    const usingA = js.indexOf("using a");
    const usingB = js.indexOf("using b");
    expect(usingA).toBeGreaterThanOrEqual(0);
    expect(usingB).toBeGreaterThan(usingA);
  });

  it.fails(
    "conditional initialization uses drop flags to avoid double-drop",
    (): void => {
      const js = requireJavascript(`
      struct R { id: i32 }
      fn main() {
        let mut cond = true;
        if cond {
          let x = R { id: 1 };
          print(x.id);
        } else {
          print(0);
        }
      }
    `);
      expect(js).toContain("dropFlag");
    },
  );

  it.fails("drop cannot occur while mutable borrow is live", (): void => {
    const result = compile(`
      fn main() {
        let mut x = "a";
        let r = &mut x;
        print(r);
      }
    `);
    expect(
      result.diagnostics.some((d) => d.message.toLowerCase().includes("drop")),
    ).toBe(true);
  });

  it.fails(
    "early drop occurs at last use instead of lexical scope end",
    (): void => {
      const js = requireJavascript(`
      struct R { id: i32 }
      fn main() {
        let x = R { id: 1 };
        print(x.id);
        print("after");
      }
    `);
      expect(js).toMatch(/dispose\(x\)[\s\S]*print\("after"\)/);
    },
  );
});

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
    // A struct field typed `i32` is Copy, so a struct with only Copy
    // fields has exactly one real drop point: the struct itself, not
    // its fields. Two separate droppable bindings (not two fields of
    // one struct) is what actually exercises "reverse declaration
    // order": both bindings lower to `using` in source declaration
    // order, and native `using` semantics guarantee disposal at scope
    // end runs in the *reverse* of that order (b before a), no codegen
    // effort beyond emitting `using` is needed.
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

  it("resolves a binding moved on only one branch by dropping it in the other branch, not with a runtime flag", (): void => {
    // Matches rustc's drop elaboration: the moved/not-moved decision is
    // already known statically here (x is owned on the else path, moved on
    // the then path), so the drop is duplicated directly into the else
    // branch instead of costing a runtime boolean and a scope-exit check.
    const js = requireJavascript(`
      struct R { id: i32 }
      fn main() {
        let mut cond = true;
        let x = R { id: 1 };
        if cond {
          let y = x;
          print(y.id);
        } else {
          print(0);
        }
      }
    `);
    expect(js).not.toMatch(/dropFlag/);
    expect(js).toMatch(/else\s*\{[^}]*print\(0\);\s*x\[Symbol\.dispose\]\(\);/);
  });

  it("resolves a binding moved on only the else branch by dropping it in then, the symmetric case", (): void => {
    const js = requireJavascript(`
      struct R { id: i32 }
      fn main() {
        let mut cond = true;
        let x = R { id: 1 };
        if cond {
          print(0);
        } else {
          let y = x;
          print(y.id);
        }
      }
    `);
    expect(js).not.toMatch(/dropFlag/);
    expect(js).toMatch(
      /if\s*\(cond\)\s*\{[^}]*print\(0\);\s*x\[Symbol\.dispose\]\(\);/,
    );
  });

  it("emits no drop of any kind for a binding moved on every branch", (): void => {
    const js = requireJavascript(`
      struct Boxed { value: i32 }
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          let y = x;
          print(y.value);
        } else {
          let z = x;
          print(z.value);
        }
      }
    `);
    expect(js).not.toMatch(/dropFlag/);
    expect(js).not.toContain("x[Symbol.dispose]");
    expect(js).not.toMatch(/using x\b/);
  });

  it("resolves a value moved partway down an else-if chain to two static drop sites, not a flag", (): void => {
    const js = requireJavascript(`
      struct Boxed { value: i32 }
      fn main() {
        let mut n = 1;
        let x = Boxed { value: 1 };
        if n == 1 {
          print(0);
        } else if n == 2 {
          let y = x;
          print(y.value);
        } else {
          print(2);
        }
      }
    `);
    expect(js).not.toMatch(/dropFlag/);
    const disposeCount = (js.match(/x\[Symbol\.dispose\]\(\);/g) ?? []).length;
    expect(disposeCount).toBe(2);
    expect(js).toMatch(
      /if\s*\(n === 1\)\s*\{[^}]*print\(0\);\s*x\[Symbol\.dispose\]\(\);/,
    );
    expect(js).toMatch(/else\s*\{[^}]*print\(2\);\s*x\[Symbol\.dispose\]\(\);/);
  });

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

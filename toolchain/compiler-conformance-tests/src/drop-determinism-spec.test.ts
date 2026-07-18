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

  it("resolves two independent bindings each conditionally moved in separate if/else pairs without interference", (): void => {
    const js = requireJavascript(`
      struct Boxed { value: i32 }
      fn main() {
        let mut cond1 = true;
        let mut cond2 = true;
        let x = Boxed { value: 1 };
        let w = Boxed { value: 2 };
        if cond1 {
          let y = x;
          print(y.value);
        } else {
          print(0);
        }
        if cond2 {
          print(1);
        } else {
          let z = w;
          print(z.value);
        }
      }
    `);
    expect(js).not.toMatch(/dropFlag/);
    expect(js).toMatch(/else\s*\{[^}]*print\(0\);\s*x\[Symbol\.dispose\]\(\);/);
    expect(js).toMatch(
      /if\s*\(cond2\)\s*\{[^}]*print\(1\);\s*w\[Symbol\.dispose\]\(\);/,
    );
  });

  it("resolves a conditional move inside a nested block within a branch at the enclosing if's merge", (): void => {
    const js = requireJavascript(`
      struct Boxed { value: i32 }
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          {
            let y = x;
            print(y.value);
          }
          let done = true;
          print(0);
        } else {
          print(1);
        }
      }
    `);
    expect(js).not.toMatch(/dropFlag/);
    expect(js).toMatch(/else\s*\{[^}]*print\(1\);\s*x\[Symbol\.dispose\]\(\);/);
  });

  it("synthesizes an else branch to carry the drop when a conditional move has no source else at all", (): void => {
    const js = requireJavascript(`
      struct Boxed { value: i32 }
      fn main() {
        let mut cond = true;
        let x = Boxed { value: 1 };
        if cond {
          let y = x;
          print(y.value);
        }
        print(1);
      }
    `);
    expect(js).not.toMatch(/dropFlag/);
    expect(js).toMatch(/else\s*\{\s*x\[Symbol\.dispose\]\(\);\s*\}/);
  });

  it("places a branch-attributed drop before the return in a function with a declared return type", (): void => {
    // jsimIfStatement's insertBeforeTrailingReturn exists specifically to
    // prevent this drop from landing after `return 1;`, where it would be
    // dead code -- the trailing expression becomes a real `return` only
    // because the function declares a non-unit return type.
    const js = requireJavascript(`
      struct Boxed { value: i32 }
      fn f(cond: bool, x: Boxed) -> i32 {
        if cond {
          let y = x;
          y.value
        } else {
          1
        }
      }
    `);
    expect(js).not.toMatch(/dropFlag/);
    expect(js).toMatch(
      /else\s*\{\s*x\[Symbol\.dispose\]\(\);\s*return 1;\s*\}/,
    );
  });

  it("attributes a drop to a conditionally moved parameter without shadow-rebinding it", (): void => {
    // dropParamShadows only shadows a parameter found in the unconditional
    // `drops` list; a branch-attributed conditional drop must not trigger
    // it, since `x` is still read directly by name in the branch that
    // doesn't move it.
    const js = requireJavascript(`
      struct Boxed { value: i32 }
      fn f(cond: bool, x: Boxed) {
        if cond {
          let y = x;
          print(y.value);
        } else {
          print(0);
        }
      }
    `);
    expect(js).not.toMatch(/dropFlag/);
    expect(js).toContain("function f(cond, x)");
    expect(js).not.toMatch(/using x\$?\d*\s*=\s*x;/);
    expect(js).toMatch(/else\s*\{[^}]*print\(0\);\s*x\[Symbol\.dispose\]\(\);/);
  });

  it("a branch-attributed drop coexists with an unconditional using drop in the same scope without disturbing either", (): void => {
    const js = requireJavascript(`
      struct Boxed { value: i32 }
      fn main() {
        let mut cond = true;
        let a = Boxed { value: 1 };
        let x = Boxed { value: 2 };
        if cond {
          let y = x;
          print(y.value);
        } else {
          print(0);
        }
        print(a.value);
      }
    `);
    expect(js).not.toMatch(/dropFlag/);
    expect(js).toMatch(/using a\s*=/);
    expect(js).toMatch(/else\s*\{[^}]*print\(0\);\s*x\[Symbol\.dispose\]\(\);/);
    // `a`'s drop stays implicit (native `using` semantics), not duplicated
    // as an explicit call the way x's conditional drop is.
    expect(js).not.toContain("a[Symbol.dispose]");
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

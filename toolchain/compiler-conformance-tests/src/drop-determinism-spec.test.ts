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
  it.fails(
    "generated JS emits Symbol.dispose wiring for owned cleanup paths",
    (): void => {
      const js = requireJavascript(`
      struct Resource { id: i32 }
      fn main() {
        let x = Resource { id: 1 };
        print(x.id);
      }
    `);
      expect(js).toContain("Symbol.dispose");
    },
  );

  it.fails(
    "drop order for nested owned values is reverse declaration order",
    (): void => {
      const js = requireJavascript(`
      struct Pair { a: i32, b: i32 }
      fn main() {
        let p = Pair { a: 1, b: 2 };
        print(p.a + p.b);
      }
    `);
      const firstDispose = js.indexOf("dispose");
      const secondDispose = js.lastIndexOf("dispose");
      expect(firstDispose).toBeGreaterThanOrEqual(0);
      expect(secondDispose).toBeGreaterThan(firstDispose);
    },
  );

  it.fails(
    "conditional initialization uses drop flags to avoid double-drop",
    (): void => {
      const js = requireJavascript(`
      struct R { id: i32 }
      fn main() {
        let bind write cond = true;
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
        let write x = "a";
        let r = &write x;
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

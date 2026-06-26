import { compile, isSome } from "@hedge-lang/compiler";
import { describe, expect, it } from "vitest";

function compileDts(source: string): string | null {
  const result = compile(source);
  if (!isSome(result.code)) return null;
  return isSome(result.code.value.typedef)
    ? result.code.value.typedef.value
    : null;
}

describe(".d.ts conformance", (): void => {
  it("emits public declarations for pub fn", (): void => {
    const dts = compileDts(`pub fn add(x: i32, y: i32) -> i32 { x + y }`);
    expect(dts).toContain(
      "export declare function add(x: number, y: number): number;",
    );
  });

  it("marks pub(package) declarations as @internal", (): void => {
    const dts = compileDts(`pub(package) fn helper() {}`);
    expect(dts).toContain("@internal");
    expect(dts).toContain("export declare function helper(): void;");
  });

  it("includes module doc comment in declaration output", (): void => {
    const dts = compileDts(`//! lib module\npub fn lib() {}`);
    expect(dts).toContain("@module");
    expect(dts).toContain("lib module");
  });
});

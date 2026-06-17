#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { stderr, stdout } from "node:process";

import { compile, isSome } from "@hedge-lang/compiler";

import { renderDiagnostics } from "../util/render.js";

export async function build(file: string): Promise<number> {
  const source = await readFile(file, "utf8");
  const result = compile(source);
  if (result.diagnostics.length > 0) {
    stderr.write(`${renderDiagnostics(result.diagnostics)}\n`);
  }
  const codeOption = result.code;
  if (!isSome(codeOption)) {
    return 1;
  }
  const code = codeOption.value;
  const base = file.replace(/\.hed(ge)?$/u, "");
  if (isSome(code.javascript)) {
    await writeFile(`${base}.js`, code.javascript.value, "utf8");
    stdout.write(`Compiled ${file} -> ${base}.js\n`);
  }
  if (isSome(code.typedef)) {
    await writeFile(`${base}.d.ts`, code.typedef.value, "utf8");
  }
  return 0;
}

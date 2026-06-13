#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { stderr, stdout } from "node:process";

import { compile } from "@hedge-lang/compiler";

import { renderDiagnostics } from "../util/render.js";

export async function build(file: string): Promise<number> {
    const source = await readFile(file, "utf8");
    const result = compile(source);
    if (result.diagnostics.length > 0) {
        stderr.write(`${renderDiagnostics(result.diagnostics)}\n`);
    }
    if (result.code === null) {
        return 1;
    }
    const base = file.replace(/\.hed(ge)?$/u, "");
    await writeFile(`${base}.js`, result.code.javascript, "utf8");
    if (result.code.typedef !== "") {
        await writeFile(`${base}.d.ts`, result.code.typedef, "utf8");
    }
    stdout.write(`Compiled ${file} -> ${base}.js\n`);
    return 0;
}

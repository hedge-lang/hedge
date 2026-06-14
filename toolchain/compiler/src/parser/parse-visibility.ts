import type { Token } from "../lexer/token.js";
import {none, some} from "../option.js";
import {type Result, ok, err} from "../result.js";
import type {Visibility} from "./ast.js";
import type {Parsed} from "./parse.js";

export function isVisibility(tokens: readonly Token[], start: number): boolean {
    const token = tokens[start];
    if (!token) {
        return false;
    }
    return token.kind === "keyword" && token.text === "pub";
}

export function parseVisibility(tokens: readonly Token[], start: number): Result<Parsed<Visibility>, Error> {
    if (!isVisibility(tokens, start)) {
        return err(new Error("Expected visibility"));
    }

    const a = tokens[start + 1];
    const b = tokens[start + 2];
    const c = tokens[start + 3];

    if (a && b && c) {
        if (a.kind === "punct" && a.text === "(" && b.kind === "ident" && c.kind === "punct" && c.text === ")") {
            return ok({
                node: {
                    kind: "Visibility",
                    name: "pub",
                    scope: some(b.text),
                },
                next: start + 4,
            })
        }
    }

    return ok({
        node: {
            kind: "Visibility",
            name: "pub",
            scope: none(),
        },
        next: start + 1,
    })
}

import { describe, it, expect } from "vitest";
import {tokenize} from "../lexer/lexer.js";
import {none, some} from "../option.js";
import {ok} from "../result.js";
import { parseVisibility } from "./parse-visibility.js";

describe("parseVisibility", () => {
    it("Visibility ::= \"pub\"", () => {
        const tokens = tokenize("pub foo");
        const visibility = parseVisibility(tokens, 0);
        expect(visibility).toMatchObject(ok({
            node: {
                kind: "Visibility",
                name: "pub",
                scope: none(),
            },
            next: tokens.length - 2,
        }))
    });

    it("Visibility ::= \"pub\" \"(\" \"package\" \")\"", () => {
        const tokens = tokenize("pub(package) foo");
        const visibility = parseVisibility(tokens, 0);
        expect(visibility).toMatchObject(ok({
            node: {
                kind: "Visibility",
                name: "pub",
                scope: some("package"),
            },
            next: tokens.length - 2,
        }))
    });
})

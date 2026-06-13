import type {Token} from "../lexer/token.js";
import type {AST, Program, StringLiteral} from "./ast.js";

export function parse(tokens: Token[]): Program {
    const program: Program = {
        kind: "Program",
        items: [],
    };

    for (const token of tokens) {
        if (token.kind === "eof") {
            break;
        }

        if (token.kind === "string") {
            program.items.push(parseStringLiteral(token));
            continue;
        }
    }

    return program;
}

function parseStringLiteral(token: Token): StringLiteral {
    return {
        kind: "StringLiteral",
        value: token.text,
        token,
    }
}

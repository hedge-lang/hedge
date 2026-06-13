import type {Token} from "../lexer/token.js";

export type AST = StringLiteral;

export interface Program {
    kind: "Program";
    items: AST[];
}

export interface StringLiteral {
    kind: "StringLiteral";
    value: string;
    token: Token,
}

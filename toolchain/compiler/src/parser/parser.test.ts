import {describe, it, expect} from "vitest";
import { parse } from "./parser.js";
import { tokenize } from "../lexer/lexer.js";

describe("parser", (): void => {
    it("parses the tracer bullet", (): void => {
        const tokens = tokenize(`
          fn main() {
            let greeting = "Hello, world!";
            print(greeting);
          }
        `);
        const ast = parse(tokens);

        expect(ast).toMatchObject({
            kind: "Program",
            items: [
                {
                    kind: "Function",
                    name: {
                        kind: "Identifier",
                        text: "main",
                    },
                    generics: [],
                    params: [],
                    returnType: null,
                    whereClause: null,
                    body: {
                        kind: "Block",
                        statements: [
                            {
                                kind: "LetStatement",
                                bind: false,
                                write: false,
                                pattern: {
                                    kind: "BindingPattern",
                                    name: {
                                        kind: "Identifier",
                                        text: "greeting",
                                    },
                                },
                                type: null,
                                initializer: {
                                    kind: "StringLiteral",
                                    value: "Hello, world!",
                                },
                            },
                            {
                                kind: "ExpressionStatement",
                                expression: {
                                    kind: "CallExpression",
                                    callee: {
                                        kind: "PathExpression",
                                        path: {
                                            absolute: false,
                                            segments: ["print"],
                                        },
                                    },
                                    arguments: [
                                        {
                                            kind: "PathExpression",
                                            path: {
                                                absolute: false,
                                                segments: ["greeting"],
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                        trailingExpression: null,
                    },
                },
            ],
        });
    });
});

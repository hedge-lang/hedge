import {scanWhile} from "./scan-while.js";
import type { Token } from "./token.js";

/**
 * Identify a line comment starting at `index` in `source`.
 *
 * @param source The source to scan.
 * @param index The index to start scanning at.
 *
 * @returns `true` if the source starts with a line comment.
 */
export function isLineComment(source: string, index: number): boolean {
    return source[index] === "/" && source[index + 1] === "/";
}

/**
 * Parse a line comment starting at `start` in `source`, appending it to `tokens`.
 *
 * @param tokens The token list to append to.
 * @param source The source to scan.
 * @param start The index to start scanning at.
 *
 * @returns The index of the first character after the comment.
 */
export function parseLineComment(tokens: Token[], source: string, start: number): number {
    return scanWhile(source, start, (ch) => ch !== "\n" && ch !== "\r");
}

/**
 * Result of a successful parse operation.
 *
 * Parsers are implemented as pure functions that consume tokens starting at a
 * given position and return both the parsed AST node and the index of the next
 * unconsumed token.
 */
export interface Parsed<T> {
  readonly node: T;
  readonly next: number;
}

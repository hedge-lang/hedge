/**
 * Thrown by compiled Hedge code on a panic: an integer overflow, a failed
 * assertion, an `unwrap` on `None`, or an out-of-bounds access. Compiled output
 * imports this from the runtime; it is the irreducible JS floor described in
 * ADR 0004.
 */
export class HedgePanic extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "HedgePanic";
  }
}

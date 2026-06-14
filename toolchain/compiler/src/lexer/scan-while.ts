/**
 * Advance from `start` while `pred` holds, returning the first index at which it
 * does not (or the end of the source).
 *
 * @param source The source to scan.
 * @param start The index to start scanning at.
 * @param pred The predicate to scan for.
 *
 * @returns The index of the first character that does not satisfy `pred`.
 */
export function scanWhile(
  source: string,
  start: number,
  pred: (ch: string, index: number, source: string) => boolean,
): number {
  let j = start;
  while (j < source.length) {
    const ch = source[j];
    if (!pred(ch, j, source)) {
      break;
    }
    j += 1;
  }
  return j;
}

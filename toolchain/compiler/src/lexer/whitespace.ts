export function isWhitespace(source: string, index: number): boolean {
  return (
    source[index] === " " ||
    source[index] === "\t" ||
    source[index] === "\n" ||
    source[index] === "\r"
  );
}

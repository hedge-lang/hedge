export function assert(
  condition: boolean,
  message?: string,
): asserts condition {
  if (!condition) {
    throw new Error(message ?? "Assertion failed");
  }
}

export function assertNever(_shouldBeNever: never, message?: string): never {
  throw new Error(message ?? "Expected value to be of type 'never'");
}

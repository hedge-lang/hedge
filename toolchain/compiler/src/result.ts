export type Result<T, E> = { kind: "Ok", value: T } | { kind: "Err", error: E };

export function ok<T>(value: T): Result<T, never> {
  return { kind: "Ok", value };
}

export function err<E>(error: E): Result<never, E> {
  return { kind: "Err", error };
}

export function isOk<T, E>(result: Result<T, E>): result is { kind: "Ok", value: T } {
  return result.kind === "Ok";
}

export function isErr<T, E>(result: Result<T, E>): result is { kind: "Err", error: E } {
  return result.kind === "Err";
}

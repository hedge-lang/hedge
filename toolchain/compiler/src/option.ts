export type Option<T> =
  | {
      readonly kind: "Some";
      readonly value: T;
    }
  | { readonly kind: "None" };

export function some<T>(value: T): Option<T> {
  return { kind: "Some", value };
}

export function none<T>(): Option<T> {
  return { kind: "None" };
}

export const isSome = <T>(
  option: Option<T>,
): option is { kind: "Some"; value: T } => option.kind === "Some";
export const isNone = <T>(option: Option<T>): option is { kind: "None" } =>
  option.kind === "None";

export function mapSome<T, R>(option: Option<T>, fn: (value: T) => R): Option<R> {
  return isSome(option) ? some(fn(option.value)) : none();
}

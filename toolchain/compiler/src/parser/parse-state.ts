/**
 * `self` and `Self` are rejected as a leading path segment in expression
 * position everywhere except inside a trait or impl method body, where `self`
 * is the receiver and `Self` the implementing type. The parser is a
 * single-threaded recursive descent with no context object, so this
 * module-scoped state stands in for that context, the same way the mutable
 * `diagnostics` array is threaded through every parse function.
 *
 * `withMethodBodyItems` marks an impl/trait body; `withFunctionBody` reads that
 * mark once per function and clears it, so a method sees `self` in scope but a
 * free `fn` nested inside its body does not, and a method of an `impl` nested
 * inside a method body sees it again.
 */
let selfKeywordAllowed = false;
let insideMethodBodyItems = false;

export function isSelfKeywordAllowed(): boolean {
  return selfKeywordAllowed;
}

export function withMethodBodyItems<T>(parseItems: () => T): T {
  const previous = insideMethodBodyItems;
  insideMethodBodyItems = true;
  try {
    return parseItems();
  } finally {
    insideMethodBodyItems = previous;
  }
}

export function withFunctionBody<T>(parseBody: () => T): T {
  const isMethod = insideMethodBodyItems;
  const previousAllowed = selfKeywordAllowed;
  const previousInside = insideMethodBodyItems;
  selfKeywordAllowed = isMethod;
  insideMethodBodyItems = false;
  try {
    return parseBody();
  } finally {
    selfKeywordAllowed = previousAllowed;
    insideMethodBodyItems = previousInside;
  }
}

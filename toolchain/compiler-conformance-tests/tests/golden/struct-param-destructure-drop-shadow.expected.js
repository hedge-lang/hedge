#!/usr/bin/env node

function f(paramDestructure) {
  let inner;
  let tag;
  inner = paramDestructure.inner;
  tag = paramDestructure.tag;
  using dropShadow_inner = inner;
  return tag;
}

function main() {
  print(f(({inner: ({v: 5, [Symbol.dispose]() {}}), tag: 9, [Symbol.dispose]() {}})));
}

main();

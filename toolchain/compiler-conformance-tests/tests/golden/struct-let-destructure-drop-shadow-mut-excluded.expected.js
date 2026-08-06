#!/usr/bin/env node

function main() {
  const p = ({a: ({v: 1, [Symbol.dispose]() {}}), b: ({v: 2, [Symbol.dispose]() {}}), [Symbol.dispose]() {}});
  const letDestructure = p;
  let a;
  let b;
  a = letDestructure.a;
  b = letDestructure.b;
  using dropShadow_b = b;
  a = ({v: 99, [Symbol.dispose]() {}});
  print(a.v);
  print(b.v);
}

main();

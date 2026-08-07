#!/usr/bin/env node

function main() {
  const p = ({a: ({v: 1, [Symbol.dispose]() {}}), b: ({v: 2, [Symbol.dispose]() {}}), [Symbol.dispose]() { using _d0 = this.a; using _d1 = this.b; }});
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

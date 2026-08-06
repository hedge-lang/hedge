#!/usr/bin/env node

function consume(x) {
  using x$1 = x;
}

function main() {
  const p = ({a: ({v: 1, [Symbol.dispose]() {}}), b: ({v: 2, [Symbol.dispose]() {}}), [Symbol.dispose]() { using _d0 = this.a; using _d1 = this.b; }});
  const letDestructure = p;
  let a;
  let b;
  a = letDestructure.a;
  b = letDestructure.b;
  using dropShadow_b = b;
  consume(a);
  print(b.v);
}

main();

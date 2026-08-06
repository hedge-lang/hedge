#!/usr/bin/env node

function consume(x) {
  using x$1 = x;
}

function main() {
  const cond = true;
  const p = ({a: ({v: 1, [Symbol.dispose]() {}}), b: ({v: 2, [Symbol.dispose]() {}}), [Symbol.dispose]() { this.a[Symbol.dispose](); this.b[Symbol.dispose](); }});
  const letDestructure = p;
  let a;
  let b;
  a = letDestructure.a;
  b = letDestructure.b;
  using dropShadow_b = b;
  if (cond) { consume(a); } else { using dropShadow_a = a; }
  print(b.v);
}

main();

#!/usr/bin/env node

function main() {
  const o = ({inner: ({v: 5, [Symbol.dispose]() {}}), tag: 9, [Symbol.dispose]() { this.inner[Symbol.dispose](); }});
  const letDestructure = o;
  let inner;
  let tag;
  inner = letDestructure.inner;
  tag = letDestructure.tag;
  using dropShadow_inner = inner;
  print(tag);
}

main();

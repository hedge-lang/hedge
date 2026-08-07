#!/usr/bin/env node

function main() {
  const o = ({inner: ({v: 5, [Symbol.dispose]() {}}), tag: 9, [Symbol.dispose]() { using _d0 = this.inner; }});
  const letDestructure = o;
  let inner;
  let tag;
  inner = letDestructure.inner;
  tag = letDestructure.tag;
  using dropShadow_inner = inner;
  print(tag);
}

main();

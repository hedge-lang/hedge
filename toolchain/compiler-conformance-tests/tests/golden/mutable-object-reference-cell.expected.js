#!/usr/bin/env node

function main() {
  let foo = ({x: 1, [Symbol.dispose]() {}});
  const r = ({ get v() { return foo.x; }, set v(nv) { foo.x = nv; } });
  r.v = ((r.v + 1)|0);
  print(foo.x);
}

main();

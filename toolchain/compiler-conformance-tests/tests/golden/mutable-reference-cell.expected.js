#!/usr/bin/env node

function main() {
  let n = 1;
  const r = ({ get v() { return n; }, set v(nv) { n = nv; } });
  r.v = ((r.v + 1)|0);
  print(n);
}

main();

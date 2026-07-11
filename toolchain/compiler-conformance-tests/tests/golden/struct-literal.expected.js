#!/usr/bin/env node

function main() {
  using p = ({x: 1, y: 2, [Symbol.dispose]() {}});
  print(p.x);
}

main();

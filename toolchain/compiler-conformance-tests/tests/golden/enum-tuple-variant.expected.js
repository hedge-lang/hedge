#!/usr/bin/env node

function main() {
  using m = ({tag: "Move", data: [1, 2], [Symbol.dispose]() {}});
  print("constructed");
}

main();

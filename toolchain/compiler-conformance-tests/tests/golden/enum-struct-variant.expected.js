#!/usr/bin/env node

function main() {
  using m = ({tag: "Write", data: ({text: "hi", [Symbol.dispose]() {}}), [Symbol.dispose]() {}});
  print("constructed");
}

main();

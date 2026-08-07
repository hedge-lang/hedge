#!/usr/bin/env node

function main() {
  using m = ({tag: "Write", data: ({text: "hi", [Symbol.dispose]() {}}), [Symbol.dispose]() { using _d0 = this.data; }});
  print("constructed");
}

main();

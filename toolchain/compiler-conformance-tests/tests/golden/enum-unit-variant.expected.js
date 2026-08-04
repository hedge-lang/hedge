#!/usr/bin/env node

function main() {
  using m = ({tag: "Quit", [Symbol.dispose]() {}});
  print("constructed");
}

main();

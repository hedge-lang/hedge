#!/usr/bin/env node

function describe(m) {
  return (() => {
    const matchScrutinee = m;
    switch (matchScrutinee.tag) {
      case "Quit":
        return 0;
      default:
        return ((-1)|0);
    }
  })();
}

function main() {
  print(describe(({tag: "Quit", [Symbol.dispose]() {}})));
}

main();

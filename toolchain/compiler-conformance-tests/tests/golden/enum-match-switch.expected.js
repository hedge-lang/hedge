#!/usr/bin/env node

function describe(m) {
  return (() => {
    const matchScrutinee = m;
    switch (matchScrutinee.tag) {
      case "Quit": {
        return 0;
      }
      case "Move": {
        const x = matchScrutinee.data[0];
        const y = matchScrutinee.data[1];
        return x;
      }
      default: {
        throw new Error("unreachable");
      }
    }
  })();
}

function main() {
  print(describe(({tag: "Quit", [Symbol.dispose]() {}})));
}

main();

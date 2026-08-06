#!/usr/bin/env node

function describe(d) {
  return (() => {
    const matchScrutinee = d;
    switch (matchScrutinee.tag) {
      case "North": {
        return 0;
      }
      case "South": {
        return 1;
      }
      case "East": {
        return 2;
      }
      case "West": {
        return 3;
      }
      default: {
        throw new Error("unreachable");
      }
    }
  })();
}

function main() {
  print(describe(({tag: "North", [Symbol.dispose]() {}})));
}

main();

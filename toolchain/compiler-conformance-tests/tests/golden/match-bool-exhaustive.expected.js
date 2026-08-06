#!/usr/bin/env node

function describe(flag) {
  return (() => {
    const matchScrutinee = flag;
    if (matchScrutinee === true) {
      return 1;
    }
    if (matchScrutinee === false) {
      return 0;
    }
    throw new Error("unreachable");
  })();
}

function main() {
  print(describe(true));
}

main();

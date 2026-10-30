#!/usr/bin/env node

function identity(x) {
  return x;
}

function main() {
  print(identity(3));
  print(identity(true));
}

main();

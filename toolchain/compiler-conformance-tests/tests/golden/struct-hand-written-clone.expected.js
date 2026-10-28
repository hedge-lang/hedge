#!/usr/bin/env node

function Point$Clone$clone(self) {
  return ({x: self.x, y: self.y, [Symbol.dispose]() {}});
}

function main() {
  using a = ({x: 1, y: 2, [Symbol.dispose]() {}});
  using b = Point$Clone$clone(a);
  print(((b.x + b.y)|0));
}

main();

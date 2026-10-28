#!/usr/bin/env node

const __witness_Draw_Circle = {draw: Circle$Draw$draw};

function Circle$Draw$draw(self) {
  return self.r;
}

function show(d) {
  return d.witness.draw(d.value);
}

function main() {
  using c = ({r: 3, [Symbol.dispose]() {}});
  print(show(({ value: c, witness: __witness_Draw_Circle })));
}

main();

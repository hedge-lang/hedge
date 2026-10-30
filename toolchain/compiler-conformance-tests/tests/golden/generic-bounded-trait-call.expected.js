#!/usr/bin/env node

const __witness_Draw_Circle = {draw: Circle$Draw$draw};

function Circle$Draw$draw(self) {
  return ((self.r * 2)|0);
}

function draw_all(item, _witness_T_Draw) {
  return _witness_T_Draw.draw(item);
}

function main() {
  using c = ({r: 4, [Symbol.dispose]() {}});
  print(draw_all(c, __witness_Draw_Circle));
}

main();

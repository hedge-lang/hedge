#!/usr/bin/env node

function __hedgeDisposeArray(arr) {
  arr[Symbol.dispose] = function () {
    for (const el of arr) {
      if (el != null && typeof el[Symbol.dispose] === "function") {
        el[Symbol.dispose]();
      }
    }
  };
  return arr;
}

function main() {
  using m = ({tag: "Move", data: __hedgeDisposeArray([1, 2]), [Symbol.dispose]() { using _d0 = this.data; }});
  print("constructed");
}

main();

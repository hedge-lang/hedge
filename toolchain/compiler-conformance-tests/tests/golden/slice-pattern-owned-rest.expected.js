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
  const arr = __hedgeDisposeArray(new Int32Array([1, 2, 3]));
  const letDestructure = arr;
  let first;
  let rest;
  first = ((_arr, _i) => _i < 0 || _i >= _arr.length ? (() => { throw new RangeError("index out of bounds"); })() : (_arr[_i]))(letDestructure, 0);
  rest = __hedgeDisposeArray(letDestructure.subarray(1, 3));
  using dropShadow_rest = rest;
  print(first);
  print(((_arr, _i) => _i < 0 || _i >= _arr.length ? (() => { throw new RangeError("index out of bounds"); })() : (_arr[_i]))(rest, 0));
}

main();

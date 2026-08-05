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
  let arr = __hedgeDisposeArray(new Int32Array([1, 2, 3, 4]));
  const letDestructure = arr;
  let first;
  let tail;
  first = ((_arr, _i) => _i < 0 || _i >= _arr.length ? (() => { throw new RangeError("index out of bounds"); })() : (_arr[_i]))(letDestructure, 0);
  const restView = __hedgeDisposeArray(letDestructure.subarray(1, 4));
  tail = ({ get v() { return restView; }, set v(nv) { restView = nv; } });
  ((_arr, _i) => _i < 0 || _i >= _arr.length ? (() => { throw new RangeError("index out of bounds"); })() : (_arr[_i] = 99))(tail.v, 0);
  print(first);
  print(((_arr, _i) => _i < 0 || _i >= _arr.length ? (() => { throw new RangeError("index out of bounds"); })() : (_arr[_i]))(arr, 1));
}

main();

#!/usr/bin/env node

function __hedgeArraySliceView(target, start, len) {
  const extras = {};
  return new Proxy(extras, {
    get(_, prop) {
      if (prop === "length") return len;
      if (prop === Symbol.iterator) {
        return function* () {
          for (let i = 0; i < len; i++) yield target[start + i];
        };
      }
      if (typeof prop === "string" && /^\d+$/.test(prop)) {
        const i = Number(prop);
        return i < len ? target[start + i] : undefined;
      }
      return extras[prop];
    },
    set(_, prop, value) {
      if (typeof prop === "string" && /^\d+$/.test(prop)) {
        const i = Number(prop);
        if (i < len) {
          target[start + i] = value;
          return true;
        }
      }
      extras[prop] = value;
      return true;
    },
  });
}

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
  let restView = __hedgeDisposeArray(typeof letDestructure.subarray === "function" ? letDestructure.subarray(1, 4) : __hedgeArraySliceView(letDestructure, 1, 3));
  tail = ({ get v() { return restView; }, set v(nv) { restView = nv; } });
  ((_arr, _i) => _i < 0 || _i >= _arr.length ? (() => { throw new RangeError("index out of bounds"); })() : (_arr[_i] = 99))(tail.v, 0);
  print(first);
  print(((_arr, _i) => _i < 0 || _i >= _arr.length ? (() => { throw new RangeError("index out of bounds"); })() : (_arr[_i]))(arr, 1));
}

main();

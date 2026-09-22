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
  const arr = __hedgeDisposeArray(new Int32Array([1, 2, 3]));
  const letDestructure = arr;
  let first;
  let rest;
  first = ((_arr, _i) => _i < 0 || _i >= _arr.length ? (() => { throw new RangeError("index out of bounds"); })() : (_arr[_i]))(letDestructure, 0);
  rest = __hedgeDisposeArray(typeof letDestructure.subarray === "function" ? letDestructure.subarray(1, 3) : __hedgeArraySliceView(letDestructure, 1, 2));
  using dropShadow_rest = rest;
  print(first);
  print(((_arr, _i) => _i < 0 || _i >= _arr.length ? (() => { throw new RangeError("index out of bounds"); })() : (_arr[_i]))(rest, 0));
}

main();

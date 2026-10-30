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

function describe(r) {
  using r$1 = r;
  return (() => {
    const matchScrutinee = r$1;
    switch (matchScrutinee.tag) {
      case "Ok": {
        const v = matchScrutinee.data[0];
        return v;
      }
      case "Err": {
        const e = matchScrutinee.data[0];
        return 0;
      }
      default: {
        throw new Error("unreachable");
      }
    }
  })();
}

function main() {
  const ok = ({tag: "Ok", data: __hedgeDisposeArray([5]), [Symbol.dispose]() { using _d0 = this.data; }});
  const err = ({tag: "Err", data: __hedgeDisposeArray(["bad"]), [Symbol.dispose]() { using _d0 = this.data; }});
  print(describe(ok));
  print(describe(err));
}

main();

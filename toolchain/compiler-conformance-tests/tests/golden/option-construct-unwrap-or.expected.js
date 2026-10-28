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

function Option$unwrap_or(self, default$1) {
  return (() => {
    const matchScrutinee = self;
    switch (matchScrutinee.tag) {
      case "Some": {
        const x = matchScrutinee.data[0];
        return x;
      }
      case "None": {
        return default$1;
      }
      default: {
        throw new Error("unreachable");
      }
    }
  })();
}

function main() {
  const some = ({tag: "Some", data: __hedgeDisposeArray([7]), [Symbol.dispose]() { using _d0 = this.data; }});
  const none = ({tag: "None", [Symbol.dispose]() {}});
  print(Option$unwrap_or(some, 0));
  print(Option$unwrap_or(none, 9));
}

main();

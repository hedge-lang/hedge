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

const __witness_Draw_Circle = {$type: "Circle", draw: Circle$Draw$draw};

function Circle$Draw$draw(self) {
  return self.r;
}

function radius(d) {
  return (() => {
    const matchScrutinee = ((dynRecv) => {
      if (dynRecv.witness.$type === "Circle") {
        return ({tag: "Some", data: __hedgeDisposeArray([dynRecv.value]), [Symbol.dispose]() {}});
      } else {
        return ({tag: "None", [Symbol.dispose]() {}});
      }
    })(d);
    switch (matchScrutinee.tag) {
      case "Some": {
        const c = matchScrutinee.data[0];
        return c.r;
      }
      case "None": {
        return ((0 - 1)|0);
      }
      default: {
        throw new Error("unreachable");
      }
    }
  })();
}

function main() {
  using c = ({r: 3, [Symbol.dispose]() {}});
  print(radius(({ value: c, witness: __witness_Draw_Circle })));
}

main();

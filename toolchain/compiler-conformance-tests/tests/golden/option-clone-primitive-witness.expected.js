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

const __witnessPrimitiveEq = {eq: (a, b) => a === b};

const __witness_Clone_i32 = {clone: i32$Clone$clone};

function Option$Clone$clone(self, _witness_T_Clone) {
  return (() => {
    const matchScrutinee = self;
    switch (matchScrutinee.tag) {
      case "Some": {
        const x = matchScrutinee.data[0];
        return ({tag: "Some", data: __hedgeDisposeArray([_witness_T_Clone.clone(x)]), [Symbol.dispose]() { using _d0 = this.data; }});
      }
      case "None": {
        return ({tag: "None", [Symbol.dispose]() {}});
      }
      default: {
        throw new Error("unreachable");
      }
    }
  })();
}

function Option$PartialEq$eq(self, other, _witness_T_PartialEq) {
  return (() => {
    const matchScrutinee = self;
    switch (matchScrutinee.tag) {
      case "Some": {
        const a = matchScrutinee.data[0];
        return (() => {
          const matchScrutinee$1 = other;
          switch (matchScrutinee$1.tag) {
            case "Some": {
              const b = matchScrutinee$1.data[0];
              return _witness_T_PartialEq.eq(a, b);
            }
            case "None": {
              return false;
            }
            default: {
              throw new Error("unreachable");
            }
          }
        })();
      }
      case "None": {
        return (() => {
          const matchScrutinee$2 = other;
          switch (matchScrutinee$2.tag) {
            case "Some": {
              const b$1 = matchScrutinee$2.data[0];
              return false;
            }
            case "None": {
              return true;
            }
            default: {
              throw new Error("unreachable");
            }
          }
        })();
      }
      default: {
        throw new Error("unreachable");
      }
    }
  })();
}

function i32$Clone$clone(self) {
  return self;
}

function main() {
  using a = ({tag: "Some", data: __hedgeDisposeArray([7]), [Symbol.dispose]() { using _d0 = this.data; }});
  using b = Option$Clone$clone(a, __witness_Clone_i32);
  print(Option$PartialEq$eq(b, a, __witnessPrimitiveEq));
}

main();

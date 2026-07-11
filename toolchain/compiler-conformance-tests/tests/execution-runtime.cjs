globalThis.print = (...args) => {
  process.stdout.write(args.join(""));
};

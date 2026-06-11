# Modules

## Modules are files

A module is a file, and a directory of files is a module tree nested the way the
directories are. There are no `mod` blocks and no separate module declarations;
the file system is the module structure, matching the ES modules that Hedge
compiles to.

## Packages

A package is the unit of distribution and the boundary for coherence: the orphan
rule (see [Generics & Traits](0015-generics-and-traits.md)) lets a package
implement a trait for a type when it defines the trait or the type. A package
maps to an npm package on output.

## Visibility

Items are private to their module by default. Three levels:

* *(default)*: visible only within the defining module.
* `pub(package)`: visible to other modules in the same package.
* `pub`: visible to any module that can reach this one, including other
  packages.

Module visibility is separate from the JavaScript boundary. `pub` controls what
other Hedge code can see; `export "js"` (see
[JavaScript Interactions](0003-javascript-interactions.md)) controls what crosses
out to JavaScript. A `pub` item is not automatically a JavaScript export.

## Using items from other modules

`use` brings items into scope. Paths use `::` and resolve along the module tree:
a leading package name resolves to a dependency, and `super` and `self` refer to
the parent and current modules.

```hedge
use http::client::{get, post};   // from the `http` package
use http::client::get as fetch;  // renamed with `as`
use super::config::Settings;     // from the parent module
use self::util::*;               // glob import from a child module
```

An import may be renamed with `as`, which resolves a name clash or gives a
clearer local name. `pub use` re-exports an item as part of the current module's
surface:

```hedge
pub use client::Request;
```

## Generated code

Each module compiles to one ES module. `use` becomes `import`, `pub use` becomes
a re-export, and items visible across modules become `export`s in the emitted
JavaScript. Module privacy is enforced at compile time; the published `.d.ts`
surfaces only the package's intended API, not its internal cross-module exports.
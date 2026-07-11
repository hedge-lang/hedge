import { type Option } from "../option.js";

export interface SourceMapMapping {
  readonly generatedStart: number;
  readonly generatedEnd: number;
  readonly sourceStart: number;
  readonly sourceEnd: number;
}

interface SourceMap {
  readonly version: 3;
  readonly mappings: readonly SourceMapMapping[];
}

export interface Code {
  javascript: Option<string>;
  typedef: Option<string>;
  sourceMap: SourceMap;
}

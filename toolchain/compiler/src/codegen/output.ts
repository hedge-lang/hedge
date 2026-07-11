import { type Option } from "../option.js";

/**
 * Represents a mapping between a range in a generated source and a range in
 * the original source.
 *
 * This interface is used to describe sections of a source map, mapping portions
 * of the generated file back to their corresponding locations in the original
 * file. It includes the start and end positions for both the generated and
 * original source ranges.
 */
export interface SourceMapMapping {
  /**
   * The zero-based starting position of the range in the generated source.
   */
  readonly generatedStart: number;

  /**
   * The zero-based ending position of the range in the generated source.
   */
  readonly generatedEnd: number;

  /**
   * The zero-based starting position of the range in the original source.
   */
  readonly sourceStart: number;

  /**
   * The zero-based ending position of the range in the original source.
   */
  readonly sourceEnd: number;
}

/**
 * Represents a source map, which is used to map transformed or compiled code
 * back to its original source code.
 */
interface SourceMap {
  /**
   * The version of the source map.
   *
   * See: https://tc39.es/ecma426/#sec-intro
   */
  readonly version: 3;

  /**
   * Represents an immutable array of source map mappings.
   *
   * Each element in the `mappings` array contains information about the mapping
   * between the original source and the generated source in a source map.
   *
   * This property is read-only, ensuring the mappings cannot be altered after
   * their initial definition.
   */
  readonly mappings: readonly SourceMapMapping[];
}

/**
 * Represents structured code with optional JavaScript content, type
 * definitions, and an associated source map.
 */
export interface Code {
  /**
   * Optional JavaScript code content.
   */
  javascript: Option<string>;

  /**
   * Optional type definitions related to the code.
   */
  typedef: Option<string>;

  /**
   * The source map corresponding to the code.
   */
  sourceMap: SourceMap;
}

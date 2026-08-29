// Root-runtime export of the canonical downstream identity. The definition
// lives under resources/shared so independently compiled bundled extensions
// consume the same constants without escaping their TypeScript rootDir.
export * from "./resources/shared/distribution.js";

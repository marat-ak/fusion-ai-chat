/**
  Copyright (c) 2015, 2026, Oracle and/or its affiliates.
  Licensed under The Universal Permissive License (UPL), Version 1.0
  as shown at https://oss.oracle.com/licenses/upl/

*/
// Named .cjs on purpose: ojet-tooling (18 and 19: lib/mainJsInjector.js) treats an existing `test-config/jest.config.js` as a VDOM
// app's Jest config and, on every dev `ojet build`, scans `src/jet-composites` (not this MVVM+TS
// app's `src/ts/jet-composites`) to rewrite its moduleNameMapper — the build crashes with ENOENT.
module.exports = {
    rootDir: process.cwd(),
    preset: "@oracle/oraclejet-jest-preset",
    moduleNameMapper: {
        "^markdown-it$": "<rootDir>/src/ts/jet-composites/xxx-gnimsys-ai/libs/markdown-it.min.js",
        "^dompurify$": "<rootDir>/src/ts/jet-composites/xxx-gnimsys-ai/libs/purify.min.js"
    },
    roots: ["<rootDir>/src/ts"],
    testMatch: ["**/__tests__/**/*.test.ts"]
}

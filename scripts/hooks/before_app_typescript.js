/**
  Copyright (c) 2015, 2026, Oracle and/or its affiliates.
  Licensed under The Universal Permissive License (UPL), Version 1.0
  as shown at https://oss.oracle.com/licenses/upl/

*/
'use strict';

module.exports = function (configObj) {
  return new Promise((resolve) => {
    console.log("Running before_app_typescript hook.");
    // ojet replaces tsconfig.json include/exclude with its own Jest-style globs (`*.[jt]s?(x)`),
    // which TypeScript cannot match; exclude test folders with a TS-compatible glob.
    const { tsconfigJson } = configObj.typescript;
    tsconfigJson.exclude = tsconfigJson.exclude || [];
    tsconfigJson.exclude.push("**/__tests__/**");
    resolve(configObj);
  });
};

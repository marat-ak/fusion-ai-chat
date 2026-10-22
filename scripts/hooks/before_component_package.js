/**
  Copyright (c) 2015, 2026, Oracle and/or its affiliates.
  Licensed under The Universal Permissive License (UPL), Version 1.0
  as shown at https://oss.oracle.com/licenses/upl/

*/
'use strict';

const fs = require('fs');
const path = require('path');

// ojet build stages the non-TypeScript files of src/**/__tests__ (the *.sse fixtures) into web/.
// They are not part of the component: drop them from the staged component before ojet archives it.
function removeTestDirs(dir) {
  const removed = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    if (entry.name === '__tests__') {
      fs.rmSync(full, { recursive: true });
      removed.push(full);
    } else {
      removed.push(...removeTestDirs(full));
    }
  }
  return removed;
}

module.exports = function (configObj) {
  return new Promise((resolve, reject) => {
    console.log('Running before_component_package hook.');
    try {
      removeTestDirs(configObj.pathToComponent).forEach((dir) => console.log(`[Hook] not packaged: ${dir}`));
      resolve(configObj);
    } catch (error) {
      reject(error);
    }
  });
};

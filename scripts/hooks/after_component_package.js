/**
  Copyright (c) 2015, 2026, Oracle and/or its affiliates.
  Licensed under The Universal Permissive License (UPL), Version 1.0
  as shown at https://oss.oracle.com/licenses/upl/

*/
'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');

// `ojet package pack` writes the Component Exchange form: one zip per member component plus a pack
// zip that holds only the pack's component.json. VB Studio import and the CDN copy need the whole
// pack in one archive, so once the pack itself is archived, its staged folder (component.json,
// chat/, libs/, min/, types/) is zipped to dist/<pack>.zip. The versioned zips stay next to it.
module.exports = function (configObj) {
  return new Promise((resolve, reject) => {
    console.log('Running after_component_package hook.');
    if (configObj.type !== 'pack') {
      resolve(configObj);
      return;
    }
    const packDir = configObj.pathToComponent;
    if (!fs.existsSync(path.join(packDir, 'min'))) {
      reject(new Error(`${packDir} has no min/: the staged pack is not a release build (run npm run build:release first)`));
      return;
    }
    const target = path.join('dist', `${configObj.name}.zip`);
    const output = fs.createWriteStream(target);
    const archive = archiver('zip');
    output.on('close', () => {
      console.log(`[Hook] Pack '${configObj.name}' archived as a single zip: ${target}`);
      resolve(configObj);
    });
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(packDir, false);
    archive.finalize();
  });
};

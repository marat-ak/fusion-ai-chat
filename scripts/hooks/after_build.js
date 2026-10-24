/**
  Copyright (c) 2015, 2026, Oracle and/or its affiliates.
  Licensed under The Universal Permissive License (UPL), Version 1.0
  as shown at https://oss.oracle.com/licenses/upl/

*/

'use strict';

const debugHost = require('./debug-host');

module.exports = function (configObj) {
  console.log("Running after_build hook.");
  return Promise.resolve()
    .then(() => (debugHost.flavourOf(configObj) === debugHost.FLAVOUR ? debugHost.finish(configObj) : undefined))
    .then(() => configObj);
};

/**
  Copyright (c) 2015, 2026, Oracle and/or its affiliates.
  Licensed under The Universal Permissive License (UPL), Version 1.0
  as shown at https://oss.oracle.com/licenses/upl/

*/

'use strict';

module.exports = function (configObj) {
  return new Promise((resolve, reject) => {
    console.log('Running before_serve hook.');

    try {
      const express = require("express");
      const app = express();

      // CORS headers
      app.use((req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,SOAPAction');
        res.setHeader('Access-Control-Allow-Credentials', 'true');

        // Handle preflight requests
        if (req.method === 'OPTIONS') {
          res.status(200).end();
          return;
        }

        next();
      });

      // e2e host page only (MOCK_POD=1): the page's same-origin pod calls go to the local mock pod.
      // In the real dev loop the page is on the pod and this server serves only the bundle.
      if (process.env.MOCK_POD === '1') {
        const { createProxyMiddleware } = require('http-proxy-middleware');
        configObj.preMiddleware = [
          createProxyMiddleware({
            target: 'http://localhost:8787',
            pathFilter: ['/api', '/fscmRestApi', '/hcmRestApi'],
            changeOrigin: false,
            ws: false,
          }),
        ];
        console.log('[Hook] MOCK_POD=1: proxying /api, /fscmRestApi, /hcmRestApi to http://localhost:8787');
      }

      // Pass the Express instance (with CORS) to the JET tooling
      configObj.express = app;

      // The server runs inside the dev.sh container: ojet's default bind 127.0.0.1 is unreachable
      // through Docker's published port, so the VB page could not load the bundle from the host.
      // ojet serve has no host flag; connectOpts is the object serveWeb passes to the server.
      configObj.connectOpts.hostname = '0.0.0.0';

      console.log('Running before_serve hook end.');
      resolve(configObj);
    } catch (error) {
      console.error('[Hook] Error in before_serve hook:', error);
      reject(error);
    }
  });
};

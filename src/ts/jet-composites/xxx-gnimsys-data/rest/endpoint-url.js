/**
 * Endpoint URL rewrite shared by DashboardRestHelper and the VB stream provider (vb-stream-fetch.js).
 *
 * Used as VB's `body` request transformation: `configuration.url` is the endpoint's URL; an absolute request URL
 * replaces it, a relative one is appended to it. Moved verbatim out of DashboardRestHelper (behaviour unchanged, see
 * __tests__/dashboardRestHelper.characterisation.test.ts).
 */
define([], function () {
    'use strict';

    function rewriteEndpointUrl(configuration, requestUrl) {
        const url = new URL(configuration.url);
        const endpointUrl = new URL(configuration.endpointDefinition.url);

        if ((requestUrl.startsWith('http://') || requestUrl.startsWith('https://')) /*&& url.host !== endpointUrl.host*/) {
            // Absolute URL - replace entirely
            configuration.url = requestUrl;
        } else {
            // Relative URL - append to base
            const cleanUrl = requestUrl.replace(/^\//, '');
            configuration.url = configuration.url.replace(/\/$/, '') + '/' + cleanUrl;
        }
        return configuration;
    }

    return { rewriteEndpointUrl };
});

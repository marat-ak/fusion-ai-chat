/**
 * Dashboard REST Helper - Wrapper for Oracle RestHelper
 *
 * Features:
 * - Multi-endpoint support (FA, BOSS, BIP, etc.)
 * - Instance-based design following Oracle RestHelper pattern
 * - Template variable processing in URLs
 * - Standard HTTP methods (GET, POST, PUT, PATCH, DELETE)
 *
 * Usage:
 * const restHelper = new DashboardRestHelper(oracleRestHelper, {
 *     FA: 'site_FA:Base/custom',
 *     BOSS: 'site_BOSS:Base/custom'
 * });
 *
 * const endpoint = restHelper.createEndpoint({
 *     target: 'FA',
 *     url: '/employees/{{employeeId}}'
 * });
 *
 * endpoint.fetch({ employeeId: '123' }).then(data => { ... });
 */
define([
    './dashboard-logger'
], function (DashboardLogger) {
    'use strict';

    /**
     * Internal Endpoint class
     * Represents a configured REST endpoint with HTTP methods
     */
    class Endpoint {
        constructor(restHelper, endpointName, config) {
            this.restHelper = restHelper;
            this.endpointName = endpointName;
            this.config = config;
            this.logger = DashboardLogger.getLogger('rest-endpoint');

            this.logger.debug('Endpoint created', {
                endpointName: this.endpointName,
                url: this.config.url
            });
        }

        /**
         * GET request
         */
        fetch(options = {}) {
            return this.executeRequest('GET', options);
        }

        /**
         * POST request
         */
        create(data, options = {}) {
            return this.executeRequest('POST', { ...options, data });
        }

        /**
         * PUT request
         */
        update(data, options = {}) {
            return this.executeRequest('PUT', { ...options, data });
        }

        /**
         * PATCH request
         */
        patch(data, options = {}) {
            return this.executeRequest('PATCH', { ...options, data });
        }

        /**
         * DELETE request
         */
        delete(options = {}) {
            return this.executeRequest('DELETE', options);
        }

        /**
         * Execute REST request using Oracle RestHelper
         */
        executeRequest(method, options = {}) {
            if (!this.restHelper) {
                return Promise.reject(new Error('Oracle RestHelper is required for REST endpoints'));
            }

            if (!this.config.url) {
                return Promise.reject(new Error('REST endpoint requires url property'));
            }

            // Process URL with template variables
            const processedUrl = this.processTemplate(this.config.url, options);

            // Build request configuration
            const requestConfig = {
                method: method,
                headers: {
                    // 'Content-Type': 'application/json',
                    ...(this.config.headers || {})
                }
            };

            // Handle different HTTP methods
            if (['POST', 'PUT', 'PATCH'].includes(method)) {
                if (options.rawBody !== undefined) {
                    // Use raw body (for SOAP XML, etc.)
                    requestConfig.body = options.rawBody;
                } else if (options.data) {
                    // Use JSON-stringified data (standard REST)
                    requestConfig.body = JSON.stringify(options.data);
                    requestConfig.headers['Content-Type'] = requestConfig.headers['Content-Type'] || 'application/json';
                }
            }

            // Add query parameters for GET and DELETE
            if (['GET', 'DELETE'].includes(method) && options) {
                const params = new URLSearchParams();
                Object.entries(options).forEach(([key, value]) => {
                    if (value !== undefined && value !== null && key !== 'data') {
                        if (['offset', 'limit', 'q', 'fields', 'totalResults', 'orderBy'].includes(key) === true) {
                            params.append(key, value.toString());
                        }
                        if (key === 'fetchSize') {
                            params.append('limit', value.toString());
                        }
                        if (key === 'startIndex') {
                            params.append('offset', value.toString());
                        }
                    }
                });

                if (params.toString()) {
                    const separator = processedUrl.includes('?') ? '&' : '?';
                    requestConfig.url = processedUrl + separator + params.toString();
                } else {
                    requestConfig.url = processedUrl;
                }
            } else {
                requestConfig.url = processedUrl;
            }

            this.logger.debug('Executing REST request', {
                method: method,
                url: requestConfig.url,
                hasBody: !!requestConfig.body
            });

            // Execute using Oracle RestHelper
            const endpoint = this.restHelper.get(this.endpointName);
            const configuredEndpoint = endpoint.initConfiguration(requestConfig);

            // Apply URL transformation
            configuredEndpoint.requestTransformationFunctions({
                body: (configuration) => {
                    const url = new URL(configuration.url);
                    const endpointUrl = new URL(configuration.endpointDefinition.url);

                    if ((requestConfig.url.startsWith('http://') || requestConfig.url.startsWith('https://')) /*&& url.host !== endpointUrl.host*/) {
                        // Absolute URL - replace entirely
                        configuration.url = requestConfig.url;
                    } else {
                        // Relative URL - append to base
                        const cleanUrl = requestConfig.url.replace(/^\//, '');
                        configuration.url = configuration.url.replace(/\/$/, '') + '/' + cleanUrl;
                    }
                    return configuration;
                }
            });
            /*
            configuredEndpoint.hookHandler({
                handlePreFetchHook: (rest) => {
                    debugger;
                },
                handleRequestHook: (request) => {
                    debugger;
                },
                handleResponseHook: (response) => {
                    debugger;
                },
                handlePostFetchHook: (result) => {
                    debugger;
                },
                handlePostFetchErrorHook: (result) => {
                    debugger;
                    if (!result.error)
                        result.error = {
                            status: result.response.status,
                            statusText: result.response.statusText || result.body
                        };
                    return result;
                }
            });*/
            // Execute and return promise
            return configuredEndpoint.fetch()
                .then(response => {
                    this.logger.debug('REST request completed', {
                        method: method,
                        responseType: typeof response
                    });

                    // Check if response is an Oracle error
                    // Oracle RestHelper.fetch() doesn't throw on HTTP errors - it returns error as response
                    if (response && typeof response === 'object') {
                        // Check Oracle REST API error format: { status: 400, title: "...", detail: "..." }
                        if ((response.response && response.response.status && typeof response.response.status === 'number' && response.response.status >= 400) ||
                            response.body && typeof response.body === 'object' && response.body['o:errorCode']) {
                            // Oracle error response - convert to rejected promise
                            const errorMessage = response.detail || response.title ||
                            response.response.statusText || `HTTP ${response.response.status} Error`;
                            const error = new Error(errorMessage);
                            error.response = response.response || null;
                            error.body = response.body || null;
                            error.status = response.response.status;
                            this.logger.error('REST request returned error response', {
                                method: method,
                                url: requestConfig.url,
                                status: response.response.status,
                                error: errorMessage
                            });

                            return Promise.reject(error);
                        }
                    }

                    return response;
                })
                .catch(error => {
                    // Ensure errors are properly logged and re-thrown
                    this.logger.error('REST request error', {
                        method: method,
                        url: requestConfig.url,
                        error: error.message || error
                    });
                    throw error;
                });
        }

        /**
         * Process template variables in strings
         */
        processTemplate(template, context) {
            if (typeof template !== 'string') return template;

            return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
                const value = this.getNestedProperty(context, key.trim());
                return value !== undefined ? value : match;
            });
        }

        /**
         * Get nested property from object using dot notation
         */
        getNestedProperty(obj, path) {
            return path.split('.').reduce((curr, prop) => curr && curr[prop], obj);
        }
    }

    /**
     * Dashboard REST Helper
     * Wrapper for Oracle RestHelper with multi-endpoint support
     */
    class DashboardRestHelper {
        constructor(restHelper, endpoints = {}) {
            this.restHelper = restHelper;
            this.endpoints = endpoints; // { FA: 'endpoint-name', BOSS: 'endpoint-name' }
            this.logger = DashboardLogger.getLogger('rest-helper');

            this.logger.info('DashboardRestHelper initialized', {
                hasRestHelper: !!this.restHelper,
                endpoints: Object.keys(this.endpoints)
            });
        }

        /**
         * Create endpoint instance
         * @param {Object} config - Endpoint configuration
         * @param {string} config.target - Target endpoint key (FA, BOSS, etc.)
         * @param {string} config.url - URL path (can include template variables)
         * @param {Object} config.headers - Optional additional headers
         * @returns {Endpoint} Configured endpoint instance
         */
        createEndpoint(config) {
            if (!config || !config.target) {
                throw new Error('Endpoint config must include target property');
            }

            if (!config.url) {
                throw new Error('Endpoint config must include url property');
            }

            const endpointName = this.endpoints[config.target];
            if (!endpointName) {
                throw new Error(`Unknown endpoint target: ${config.target}. Available targets: ${Object.keys(this.endpoints).join(', ')}`);
            }

            this.logger.debug('Creating endpoint', {
                target: config.target,
                endpointName: endpointName,
                url: config.url
            });

            return new Endpoint(this.restHelper, endpointName, config);
        }

        /**
         * Get metadata about available endpoints
         */
        getMetadata() {
            return {
                hasRestHelper: !!this.restHelper,
                endpoints: Object.keys(this.endpoints),
                endpointMapping: this.endpoints
            };
        }
    }

    return DashboardRestHelper;
});

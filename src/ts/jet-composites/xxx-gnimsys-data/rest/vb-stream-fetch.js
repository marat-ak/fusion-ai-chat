/**
 * VB stream provider: an unconsumed, streaming native Response for one request through a VB RestHelper endpoint.
 *
 * VB's Rest.fetch() always reads the body before it resolves (rest.js), but it hands the native Response to the hook
 * handler's handleResponseHook first and then reads WHATEVER that hook returned. The provider keeps the native Response
 * and returns a body-less stand-in for VB to read, so the request still goes through VB's own pipeline (endpoint URL,
 * transforms, headers, service-worker auth plugins and their 401 retry) and the caller gets the body as it arrives.
 *
 *   const streamFetch = createVbStreamFetch(RestHelper);
 *   streamFetch('ext:fuai/root', { url: '/api/fusion-ai/...', method: 'POST', headers, body, signal }) -> Promise<Response>
 *
 * The kept Response is resolved for every HTTP status (the caller reads error bodies and maps statuses; a 401 arrives
 * intact). `url` is resolved against the endpoint exactly as DashboardRestHelper does (endpoint-url.js). `signal` goes
 * into VB's request init; an abort also cancels the kept body unless a reader already holds it (the reader cancels).
 */
define(['./endpoint-url'], function (EndpointUrl) {
    'use strict';

    // Statuses whose Response must have a null body.
    const NULL_BODY_STATUSES = [204, 205, 304];

    function abortError() {
        return new DOMException('The operation was aborted.', 'AbortError');
    }

    function cancelUnread(response) {
        if (response.body && !response.body.locked) {
            response.body.cancel().catch(() => undefined);
        }
    }

    /** The body-less copy of a response that VB reads instead of the native one. */
    function standIn(response) {
        // A status outside 200..599 (an opaque response) cannot be copied: VB reads the native response itself.
        if (response.status < 200 || response.status > 599) {
            return response;
        }
        const body = NULL_BODY_STATUSES.includes(response.status) ? null : '';
        return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }

    /** Whether the helper's request chains have what the provider uses (VB's hookHandler and responseBodyFormat). */
    function supportsVbStreamFetch(restHelper, endpointId) {
        if (!restHelper || typeof restHelper.get !== 'function') {
            return false;
        }
        const rest = restHelper.get(endpointId);
        return !!rest &&
            ['initConfiguration', 'requestTransformationFunctions', 'hookHandler', 'responseBodyFormat', 'fetch']
                .every((m) => typeof rest[m] === 'function');
    }

    function createVbStreamFetch(restHelper) {
        return function streamFetch(endpointId, request) {
            const { url, method, headers, body, signal } = request;
            if (signal && signal.aborted) {
                return Promise.reject(abortError());
            }
            let kept = null;
            const hooks = {
                handlePreFetchHook() { return undefined; },
                handleRequestHook(req) { return req; },
                handleResponseHook(response) {
                    kept = response;
                    return standIn(response);
                },
                handlePostFetchHook() { return undefined; },
                handlePostFetchErrorHook() { return undefined; },
            };
            const init = { method, headers: { ...headers }, url };
            if (body !== undefined) {
                init.body = body;
            }
            if (signal !== undefined) {
                init.signal = signal;
            }
            return restHelper.get(endpointId)
                .initConfiguration(init)
                .requestTransformationFunctions({ body: (configuration) => EndpointUrl.rewriteEndpointUrl(configuration, url) })
                .hookHandler(hooks)
                .responseBodyFormat('text')
                .fetch()
                .then(() => {
                    if (kept === null) {
                        throw new Error(`VB rest helper did not hand the response to handleResponseHook (endpoint ${endpointId})`);
                    }
                    const response = kept;
                    if (signal) {
                        if (signal.aborted) {
                            cancelUnread(response);
                            throw abortError();
                        }
                        signal.addEventListener('abort', () => cancelUnread(response), { once: true });
                    }
                    return response;
                });
        };
    }

    return { createVbStreamFetch, supportsVbStreamFetch };
});

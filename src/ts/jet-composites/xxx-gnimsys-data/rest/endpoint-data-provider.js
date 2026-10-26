/**
 * Endpoint data provider: a JET RESTDataProvider served by the pack's Endpoint layer (dashboard-rest-helper), for
 * selects whose options come from a Fusion REST datasource (gnimsys-ui block v1 rev 2 §2.3; agent-app contract §6
 * "JET DataProvider adapter"). Declarative: the datasource shape says what to call, the provider pages and filters
 * on the server.
 *
 *   createEndpointDataProvider({
 *     createEndpoint: (url) => endpoint,   // the caller's Endpoint factory (target, headers, path checks are its own)
 *     url: "/fscmRestApi/resources/11.13.18.05/subinventories?q=Description LIKE '{{query}}%'&fields=SubinventoryCode,Description",
 *     valueField: "SubinventoryCode", labelField: "Description",
 *     pageSize: 25, searchTemplate: { minChars: 1, debounceMs: 250 }, dataTransform: { type: "map", expression: "items" }
 *   })
 *
 * fetchFirst / fetchByOffset: the dropdown's text goes into the url's `{{query}}` placeholder — quoted for a Fusion `q`
 * clause (a single quote doubles) — and the Endpoint appends `q`, `limit` (the configured page size; a component asking
 * for more iterates the pages), `offset` and `totalResults` as query parameters (URLSearchParams-encoded). Typed text shorter than
 * `minChars` answers an empty page without a request; a request waits `debounceMs` and is dropped (empty page) when
 * newer text arrives meanwhile. A url without `{{query}}` is paged the same way with no server search.
 * fetchByKeys: `q=<valueField> IN ('k1','k2')` (quotes doubled in the keys) on the same url with its WHOLE `q`
 * parameter removed and `limit` = the number of keys. The placeholder lives in the url's `q` parameter: that parameter
 * is taken off the url and passed as the `q` option (so the Endpoint encodes it); a `{{query}}` anywhere else in the
 * url is substituted in place (URL-encoded).
 * Response: the rows are the body when it is an array, else `body.items`, else the array at `dataTransform.expression`
 * (type `map`, a dotted path); `hasMore` = `body.hasMore` when it is a boolean, else "a full page came back";
 * `totalSize` = `body.totalResults` when it is a number. The `lodash` transform type is never evaluated here.
 */
define(['ojs/ojrestdataprovider'], function (ojrestdataprovider) {
    'use strict';
    // ojs/ojrestdataprovider is an ES-style AMD module: its class is the named export.
    const RESTDataProvider = ojrestdataprovider.RESTDataProvider;

    const QUERY = '{{query}}';
    const DEFAULTS = { pageSize: 25, minChars: 1, debounceMs: 250 };

    /** A single quote doubles inside a Fusion `q` string literal. */
    function quoteForQ(text) {
        return String(text).replace(/'/g, "''");
    }

    /** The url split into its path and its query parameters (raw `key=value` pairs, as written). */
    function splitUrl(url) {
        const i = url.indexOf('?');
        if (i < 0) return { path: url, params: [] };
        return { path: url.slice(0, i), params: url.slice(i + 1).split('&').filter((p) => p !== '') };
    }

    function joinUrl(path, params) {
        return params.length === 0 ? path : path + '?' + params.join('&');
    }

    /** The raw value of a `key=value` pair, decoded when it decodes (an unencoded `%` in a hand-written url stays). */
    function paramValue(pair) {
        const raw = pair.slice(pair.indexOf('=') + 1);
        try {
            return decodeURIComponent(raw);
        } catch (e) {
            return raw;
        }
    }

    const isQ = (pair) => pair === 'q' || pair.startsWith('q=');

    /**
     * The three url forms of a datasource url: `page` = the url without its placeholder-carrying `q` (kept as the
     * `qTemplate` option), `keys` = the url without any `q` at all, plus the `q` template (null without a placeholder).
     */
    function urlForms(url) {
        const { path, params } = splitUrl(url);
        const qPair = params.find((p) => isQ(p) && p.includes(QUERY));
        const qTemplate = qPair === undefined ? null : paramValue(qPair);
        return {
            page: joinUrl(path, params.filter((p) => p !== qPair)),
            keys: joinUrl(path, params.filter((p) => !isQ(p))).split(QUERY).join(''),
            qTemplate,
            // a url whose `q` has no placeholder keeps that `q` on the page url (no server search)
        };
    }

    /** A dotted path (`a.b.0`) into a JSON value; undefined when a step is missing. */
    function atPath(root, path) {
        let cur = root;
        for (const step of path.split('.')) {
            if (step === '') return undefined;
            if (Array.isArray(cur)) cur = /^\d+$/.test(step) ? cur[Number(step)] : undefined;
            else if (cur !== null && typeof cur === 'object') cur = cur[step];
            else return undefined;
        }
        return cur;
    }

    /** The rows of a datasource answer (see the module comment); throws when there is no row array. */
    function rowsOf(body, dataTransform) {
        if (dataTransform !== undefined && dataTransform !== null) {
            if (dataTransform.type !== 'map') throw new Error('dataTransform "' + dataTransform.type + '" is not evaluated by the endpoint data provider (map only)');
            const rows = atPath(body, String(dataTransform.expression));
            if (!Array.isArray(rows)) throw new Error('no array at ' + dataTransform.expression);
            return rows;
        }
        if (Array.isArray(body)) return body;
        if (body !== null && typeof body === 'object' && Array.isArray(body.items)) return body.items;
        throw new Error('datasource answer is neither an array nor { items: [...] }');
    }

    /** A RESTDataProvider page from an Endpoint result. */
    function pageOf(result, dataTransform, limit) {
        const body = result && typeof result === 'object' ? result.body : undefined;
        const data = rowsOf(body, dataTransform);
        const envelope = body !== null && typeof body === 'object' && !Array.isArray(body) ? body : {};
        const page = { data, hasMore: typeof envelope.hasMore === 'boolean' ? envelope.hasMore : data.length >= limit };
        if (typeof envelope.totalResults === 'number') page.totalSize = envelope.totalResults;
        return page;
    }

    /** The text of a JET filter criterion: a TextFilter's `text`, else ''. */
    function textOf(filterCriterion) {
        return filterCriterion && typeof filterCriterion.text === 'string' ? filterCriterion.text : '';
    }

    function createEndpointDataProvider(options) {
        const { createEndpoint, url, valueField, labelField, dataTransform } = options;
        if (typeof createEndpoint !== 'function') throw new Error('createEndpointDataProvider needs createEndpoint(url)');
        if (typeof url !== 'string' || url === '') throw new Error('createEndpointDataProvider needs a url');
        if (typeof valueField !== 'string' || valueField === '') throw new Error('createEndpointDataProvider needs valueField');
        if (typeof labelField !== 'string' || labelField === '') throw new Error('createEndpointDataProvider needs labelField');
        const pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0 ? options.pageSize : DEFAULTS.pageSize;
        const search = options.searchTemplate || {};
        const minChars = Number.isInteger(search.minChars) && search.minChars >= 0 ? search.minChars : DEFAULTS.minChars;
        const debounceMs = Number.isInteger(search.debounceMs) && search.debounceMs >= 0 ? search.debounceMs : DEFAULTS.debounceMs;
        const forms = urlForms(url);
        let seq = 0; // the newest text fetch; older ones still waiting out the debounce are dropped

        async function fetchPage({ fetchParameters }) {
            const text = textOf(fetchParameters.filterCriterion);
            // The server page is the configured size whatever the component asks for: a larger request is served page by
            // page (the component iterates until it has enough rows or the server has no more).
            const size = pageSize;
            const offset = Number.isInteger(fetchParameters.offset) && fetchParameters.offset > 0 ? fetchParameters.offset : 0;
            if (text !== '' && text.length < minChars) return { data: [], hasMore: false };
            if (text !== '' && debounceMs > 0) {
                const mine = ++seq;
                await new Promise((resolve) => setTimeout(resolve, debounceMs));
                if (mine !== seq) return { data: [], hasMore: false };
            }
            const quoted = quoteForQ(text);
            const query = {};
            if (forms.qTemplate !== null) query.q = forms.qTemplate.split(QUERY).join(quoted);
            query.limit = size;
            query.offset = offset;
            if (fetchParameters.includeFilteredRowCount === 'enabled') query.totalResults = true;
            const pageUrl = forms.page.split(QUERY).join(encodeURIComponent(quoted));
            const result = await createEndpoint(pageUrl).fetch(query);
            return pageOf(result, dataTransform, size);
        }

        async function fetchByKeys({ fetchParameters }) {
            const keys = Array.from(fetchParameters.keys || []);
            if (keys.length === 0) return { data: [], hasMore: false };
            const clause = valueField + ' IN (' + keys.map((k) => "'" + quoteForQ(k) + "'").join(',') + ')';
            const result = await createEndpoint(forms.keys).fetch({ q: clause, limit: keys.length });
            return pageOf(result, dataTransform, keys.length);
        }

        return new RESTDataProvider({
            keyAttributes: valueField,
            textFilterAttributes: [labelField],
            capabilities: {
                fetchByKeys: { implementation: 'lookup' },
                fetchByOffset: { implementation: 'randomAccess' },
                filter: { textFilter: true },
            },
            restHelper: { fetchFirst: fetchPage, fetchByOffset: fetchPage, fetchByKeys },
        });
    }

    return { createEndpointDataProvider, urlForms, rowsOf, pageOf, quoteForQ, DEFAULTS };
});

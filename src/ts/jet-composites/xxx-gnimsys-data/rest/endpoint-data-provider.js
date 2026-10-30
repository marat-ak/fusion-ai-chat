/**
 * Endpoint data provider: a JET RESTDataProvider served by the pack's Endpoint layer (dashboard-rest-helper), for
 * selects whose options come from a Fusion REST or a Business Objects (BOSS) datasource (gnimsys-ui block v1 rev 2
 * §2.3; agent-app contract §6 "JET DataProvider adapter"). Declarative: the datasource shape says what to call and which
 * attribute is searched; the provider writes every filter itself and pages and searches on the server.
 *
 *   createEndpointDataProvider({
 *     createEndpoint: (url, headers) => endpoint, // the caller's Endpoint factory (target and path checks are its own)
 *     dialect: "fa",                              // the url's query language: "fa" (Fusion REST) or "boss" (Business Objects)
 *     url: "/fscmRestApi/resources/11.13.18.05/subinventories?q=OrganizationCode='M1'&fields=SubinventoryCode,Description",
 *     headers: {},                                // the datasource's own request headers (optional)
 *     valueField: "SubinventoryCode", labelField: "Description", searchField: "Description",
 *     pageSize: 25, searchTemplate: { minChars: 1, debounceMs: 250 }, dataTransform: { type: "map", expression: "items" }
 *   })
 *
 * The url carries FIXED filters only, in the dialect's filter parameter (`q` / `$filter`): the provider takes that
 * parameter off the url (decoded when it decodes) and writes the whole filter of every request:
 * - fetchFirst / fetchByOffset without typed text: the fixed filter alone (none = no filter): the paged list.
 * - with typed text: `(<fixed filter>) and <search clause>` (the clause alone without a fixed filter), on the searched
 *   attribute = `searchField`, else `labelField`, a case-insensitive "contains":
 *     fa:   UPPER(<attribute>) LIKE '%<TEXT>%'   (TEXT = the typed text upper-cased; a single quote doubles)
 *     boss: <attribute> ~LIKE '%<text>%'          (a single quote doubles; ~LIKE is case-insensitive)
 *   Text shorter than `minChars` answers an empty page without a request; a request waits `debounceMs` and is dropped
 *   (empty page) when newer text arrives meanwhile. `limit` = the configured page size (a component asking for more
 *   iterates the pages), `offset` = the asked position.
 * - fetchByKeys: the keys clause alone (the fixed filter dropped, so valueField must identify a row by itself), `limit` =
 *   the number of keys: fa `q=<valueField> IN ('k1','k2')`; boss `$filter=(<valueField> = 'k1' or <valueField> = 'k2')`
 *   (a number key unquoted).
 * Encoding: fa sends `q`, `limit`, `offset` (and `totalResults` when the row count is asked for) through the Endpoint's
 * query object, which appends them URLSearchParams-encoded (`%` -> `%25`); boss writes `$filter` (encodeURIComponent),
 * `$limit` and `$offset` on the url itself (the Endpoint knows only the Fusion REST names; no row count is asked for).
 * Headers: the fa filters are Fusion REST expression syntax (UPPER, LIKE, IN, and), which needs REST-Framework-Version 2
 * or later: the provider sends `REST-Framework-Version: 4` with the datasource's headers unless they set it themselves; a
 * value of theirs below 2 is refused (the provider throws: the field shows it), never overridden.
 * Response (both dialects): the rows are the body when it is an array, else `body.items`, else the array at
 * `dataTransform.expression` (type `map`, a dotted path); `hasMore` = `body.hasMore` when it is a boolean, else "a full
 * page came back"; `totalSize` = `body.totalResults` when it is a number. The `lodash` transform type is never evaluated.
 */
define(['ojs/ojrestdataprovider'], function (ojrestdataprovider) {
    'use strict';
    // ojs/ojrestdataprovider is an ES-style AMD module: its class is the named export.
    const RESTDataProvider = ojrestdataprovider.RESTDataProvider;

    const DEFAULTS = { pageSize: 25, minChars: 1, debounceMs: 250 };
    /** The filter parameter of each dialect (see the module comment). */
    const FILTER_PARAM = { fa: 'q', boss: '$filter' };
    /** The Fusion REST framework version the fa filters are written for (expression syntax needs 2 or later). */
    const FRAMEWORK_HEADER = 'REST-Framework-Version';
    const FA_FRAMEWORK_VERSION = '4';

    /** A single quote doubles inside a Fusion `q` or a BOSS `$filter` string literal. */
    function quoteForQ(text) {
        return String(text).replace(/'/g, "''");
    }

    /** A key as a BOSS `$filter` literal: a number as is, anything else a quoted string. */
    function bossLiteral(key) {
        return typeof key === 'number' ? String(key) : "'" + quoteForQ(key) + "'";
    }

    /** The url with raw `key=value` pairs appended. */
    function withParams(url, pairs) {
        return url + (url.includes('?') ? '&' : '?') + pairs.join('&');
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

    /** The dialect's filter parameter name; throws for anything but `fa` / `boss`. */
    function filterParam(dialect) {
        if (!Object.prototype.hasOwnProperty.call(FILTER_PARAM, dialect)) throw new Error('createEndpointDataProvider needs dialect "fa" or "boss"');
        return FILTER_PARAM[dialect];
    }

    /**
     * A datasource url in its dialect: `url` = the url without its filter parameter (`q` / `$filter`), `fixedFilter` =
     * that parameter's value, decoded (null without one). Two filter parameters are refused (which one would be meant).
     */
    function urlForms(url, dialect) {
        const name = filterParam(dialect);
        const isFilter = (pair) => pair === name || pair.startsWith(name + '=');
        const { path, params } = splitUrl(url);
        const filters = params.filter(isFilter);
        if (filters.length > 1) throw new Error('the datasource url has ' + filters.length + ' ' + name + ' parameters (one fixed filter at most)');
        const value = filters.length === 1 ? paramValue(filters[0]) : '';
        return { url: joinUrl(path, params.filter((p) => !isFilter(p))), fixedFilter: value === '' ? null : value };
    }

    /** The search clause on `attribute` for typed `text` (see the module comment). */
    function searchClause(dialect, attribute, text) {
        return dialect === 'fa'
            ? 'UPPER(' + attribute + ") LIKE '%" + quoteForQ(text.toUpperCase()) + "%'"
            : attribute + " ~LIKE '%" + quoteForQ(text) + "%'";
    }

    /** The fixed filter and the search clause together: `(<fixed>) and <clause>`, either alone, or null for neither. */
    function combine(fixedFilter, clause) {
        if (clause === null) return fixedFilter;
        return fixedFilter === null ? clause : '(' + fixedFilter + ') and ' + clause;
    }

    /**
     * The request headers of a dialect: the datasource's own, plus `REST-Framework-Version: 4` for fa unless they set it;
     * a version of theirs below 2 cannot carry the fa filters and is refused (thrown), never overridden.
     */
    function requestHeaders(dialect, headers) {
        const own = { ...(headers || {}) };
        if (dialect !== 'fa') return own;
        const name = Object.keys(own).find((k) => k.toLowerCase() === FRAMEWORK_HEADER.toLowerCase());
        if (name === undefined) return { ...own, [FRAMEWORK_HEADER]: FA_FRAMEWORK_VERSION };
        const version = Number(own[name]);
        if (!(Number.isInteger(version) && version >= 2)) {
            throw new Error('the datasource header ' + name + ': ' + own[name] + ' cannot carry the search filter (Fusion REST expression syntax needs version 2 or later)');
        }
        return own;
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
        const { createEndpoint, dialect, url, valueField, labelField, searchField, dataTransform } = options;
        if (typeof createEndpoint !== 'function') throw new Error('createEndpointDataProvider needs createEndpoint(url, headers)');
        filterParam(dialect);
        if (typeof url !== 'string' || url === '') throw new Error('createEndpointDataProvider needs a url');
        if (typeof valueField !== 'string' || valueField === '') throw new Error('createEndpointDataProvider needs valueField');
        if (typeof labelField !== 'string' || labelField === '') throw new Error('createEndpointDataProvider needs labelField');
        if (searchField !== undefined && (typeof searchField !== 'string' || searchField === '')) throw new Error('createEndpointDataProvider: searchField must be a non-empty string');
        const searched = searchField !== undefined ? searchField : labelField;
        const headers = requestHeaders(dialect, options.headers);
        const pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0 ? options.pageSize : DEFAULTS.pageSize;
        const search = options.searchTemplate || {};
        const minChars = Number.isInteger(search.minChars) && search.minChars >= 0 ? search.minChars : DEFAULTS.minChars;
        const debounceMs = Number.isInteger(search.debounceMs) && search.debounceMs >= 0 ? search.debounceMs : DEFAULTS.debounceMs;
        const forms = urlForms(url, dialect);
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
            const filter = combine(forms.fixedFilter, text === '' ? null : searchClause(dialect, searched, text));
            if (dialect === 'boss') {
                const pairs = filter === null ? [] : ['$filter=' + encodeURIComponent(filter)];
                const result = await createEndpoint(withParams(forms.url, [...pairs, '$limit=' + size, '$offset=' + offset]), headers).fetch();
                return pageOf(result, dataTransform, size);
            }
            const query = {};
            if (filter !== null) query.q = filter;
            query.limit = size;
            query.offset = offset;
            if (fetchParameters.includeFilteredRowCount === 'enabled') query.totalResults = true;
            const result = await createEndpoint(forms.url, headers).fetch(query);
            return pageOf(result, dataTransform, size);
        }

        async function fetchByKeys({ fetchParameters }) {
            const keys = Array.from(fetchParameters.keys || []);
            if (keys.length === 0) return { data: [], hasMore: false };
            if (dialect === 'boss') {
                const anyOf = '(' + keys.map((k) => valueField + ' = ' + bossLiteral(k)).join(' or ') + ')';
                const result = await createEndpoint(withParams(forms.url, ['$filter=' + encodeURIComponent(anyOf), '$limit=' + keys.length]), headers).fetch();
                return pageOf(result, dataTransform, keys.length);
            }
            const clause = valueField + ' IN (' + keys.map((k) => "'" + quoteForQ(k) + "'").join(',') + ')';
            const result = await createEndpoint(forms.url, headers).fetch({ q: clause, limit: keys.length });
            return pageOf(result, dataTransform, keys.length);
        }

        return new RESTDataProvider({
            keyAttributes: valueField,
            textFilterAttributes: [searched],
            capabilities: {
                fetchByKeys: { implementation: 'lookup' },
                fetchByOffset: { implementation: 'randomAccess' },
                filter: { textFilter: true },
            },
            restHelper: { fetchFirst: fetchPage, fetchByOffset: fetchPage, fetchByKeys },
        });
    }

    return { createEndpointDataProvider, urlForms, searchClause, requestHeaders, rowsOf, pageOf, quoteForQ, DEFAULTS, FA_FRAMEWORK_VERSION };
});

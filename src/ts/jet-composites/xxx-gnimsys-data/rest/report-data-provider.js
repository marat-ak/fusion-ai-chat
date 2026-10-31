/**
 * Report data provider: a JET RESTDataProvider whose fetches run a BI Publisher report (the dashboard's `BIPReport`
 * datasource, explicit form) through the pack's Endpoint layer, for selects whose options are a report's rows
 * (gnimsys-ui block v1 rev 5 §2.3). Declarative: the datasource says which report, which fixed parameters, which
 * parameter takes the typed text and how a row is read; the provider writes the SOAP call itself.
 *
 *   createReportDataProvider({
 *     createEndpoint: (url, headers) => endpoint,        // the caller's Endpoint factory (target and path checks are its own)
 *     reportName: "/Custom/Gnimsys/LOV/SUPPLIER_SITES.xdo",
 *     recordsetSelector: "DATA_DS", recordSelector: "G_1",
 *     columns: [{ name: "VENDOR_SITE_ID", type: 2 }, { name: "VENDOR_NAME" }, { name: "SITE_LABEL" }],
 *     parameters: [{ name: "P_BU_NAME", value: "US1 Business Unit" }], // fixed values (an array = a multi-value parameter)
 *     searchParam: "P_SEARCH",                           // optional: the parameter that takes the typed text
 *     valueField: "VENDOR_SITE_ID", labelField: "SITE_LABEL", searchField: undefined,
 *     pageSize: 25, searchTemplate: { minChars: 1, debounceMs: 250 },
 *     onError: (message) => {},                          // optional: a failed run's message, null once a run succeeds
 *   })
 *
 * The call: `POST /xmlpserver/services/ExternalReportWSSService` (SOAP 1.2, `Content-Type: application/soap+xml;
 * charset=utf-8`, no SOAPAction: the operation is the body element), body
 *   <soap:Envelope><soap:Body><pub:runReport><pub:reportRequest>
 *     <pub:attributeFormat>xml</pub:attributeFormat>
 *     <pub:parameterNameValues><pub:item><pub:name>P</pub:name><pub:values><pub:item>v</pub:item>…</pub:values></pub:item>…
 *     </pub:parameterNameValues>                         (left out when there is no parameter)
 *     <pub:reportAbsolutePath>…</pub:reportAbsolutePath><pub:sizeOfDataChunkDownload>-1</pub:sizeOfDataChunkDownload>
 *   </pub:reportRequest></pub:runReport></soap:Body></soap:Envelope>
 * The answer's `reportBytes` (base64, UTF-8) is the report's data XML: the rows are the `recordSelector` elements inside
 * the first `recordsetSelector` element; a row's field = its direct child element named after the column (a name that is
 * not an XML name is matched in BIP's `_xHHHH_` form); an absent element (BIP leaves NULL values out) = null; type 2 =
 * a number (an empty element null; any other non-number text is an error), anything else the element's text. A row
 * without a `valueField` value is an error (a select cannot key it). A SOAP fault (any HTTP status) is the error text.
 *
 * Search: with `searchParam`, every distinct typed text is one report run with `searchParam` = the text as typed (''
 * without text: the report decides what an empty search lists); the report does the matching. Text shorter than
 * `minChars` answers an empty page without a run; a run waits `debounceMs` and is dropped (empty page) when newer text
 * arrives meanwhile. Without `searchParam` the report runs once and the typed text filters its rows here: a
 * case-insensitive "contains" on `searchField`, else `labelField` (minChars / debounceMs do not apply: no request).
 * A run's rows are paged here (`pageSize` per page); the last 8 runs are kept, a failed one is not.
 * fetchByKeys answers from every row a run has returned so far; keys not seen yet run the unsearched report ('' search)
 * once and are looked up there (keys still not found are not in the answer).
 * Errors: with `onError`, a failed run is reported there and answers an empty page; without it, the fetch rejects.
 */
define(['ojs/ojrestdataprovider'], function (ojrestdataprovider) {
    'use strict';
    // ojs/ojrestdataprovider is an ES-style AMD module: its class is the named export.
    const RESTDataProvider = ojrestdataprovider.RESTDataProvider;

    const DEFAULTS = { pageSize: 25, minChars: 1, debounceMs: 250 };
    /** The BI Publisher report service every report datasource is run through (a pod path of the FA endpoint). */
    const BIP_SERVICE_PATH = '/xmlpserver/services/ExternalReportWSSService';
    const SOAP_HEADERS = { 'Content-Type': 'application/soap+xml; charset=utf-8' };
    const SOAP12 = 'http://www.w3.org/2003/05/soap-envelope';
    const PUB = 'http://xmlns.oracle.com/oxp/service/PublicReportService';
    /** Runs kept per provider (search texts); the oldest is dropped first. */
    const KEPT_RUNS = 8;

    function escapeXml(text) {
        return String(text).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
    }

    /** The runReport envelope of a report and its parameters (`[{ name, values: string[] }]`). */
    function runReportEnvelope(reportName, parameters) {
        const items = parameters.map((p) => '<pub:item><pub:name>' + escapeXml(p.name) + '</pub:name><pub:values>' +
            p.values.map((v) => '<pub:item>' + escapeXml(v) + '</pub:item>').join('') + '</pub:values></pub:item>').join('');
        return '<soap:Envelope xmlns:soap="' + SOAP12 + '" xmlns:pub="' + PUB + '"><soap:Header/><soap:Body>' +
            '<pub:runReport><pub:reportRequest><pub:attributeFormat>xml</pub:attributeFormat>' +
            (items === '' ? '' : '<pub:parameterNameValues>' + items + '</pub:parameterNameValues>') +
            '<pub:reportAbsolutePath>' + escapeXml(reportName) + '</pub:reportAbsolutePath>' +
            '<pub:sizeOfDataChunkDownload>-1</pub:sizeOfDataChunkDownload></pub:reportRequest></pub:runReport></soap:Body></soap:Envelope>';
    }

    /** A column name as BIP writes it as an element name: characters outside [A-Za-z0-9_.-] as `_xHHHH_`. */
    function elementName(column) {
        return column.replace(/[^A-Za-z0-9_.-]/g, (c) => '_x' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0') + '_');
    }

    function parseXml(text, what) {
        const doc = new DOMParser().parseFromString(text, 'application/xml');
        if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(what + ' is not well-formed XML');
        return doc;
    }

    /** The text of the first element named `localName` (any namespace) under `root`, or null. */
    function firstText(root, localName) {
        const el = root.getElementsByTagNameNS('*', localName)[0];
        return el === undefined ? null : el.textContent;
    }

    /** A SOAP fault's text (SOAP 1.2 Reason/Text, else SOAP 1.1 faultstring), or null when `text` holds no fault. */
    function faultText(text) {
        if (typeof text !== 'string' || !/Fault\b/.test(text)) return null;
        let doc;
        try {
            doc = parseXml(text, 'the fault');
        } catch (e) {
            return null;
        }
        const fault = doc.getElementsByTagNameNS('*', 'Fault')[0];
        if (fault === undefined) return null;
        const text12 = firstText(fault, 'Text');
        const reason = text12 !== null ? text12 : firstText(fault, 'faultstring');
        return reason === null ? 'SOAP fault' : reason.trim();
    }

    /** base64 -> the UTF-8 text it encodes. */
    function decodeBase64Utf8(b64) {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
    }

    /** The report's data XML out of a runReport answer; a fault, or an answer without reportBytes, throws. */
    function reportXmlOf(soapText) {
        if (typeof soapText !== 'string' || soapText === '') throw new Error('the report service answered no XML');
        const fault = faultText(soapText);
        if (fault !== null) throw new Error(fault);
        const bytes = firstText(parseXml(soapText, 'the report service answer'), 'reportBytes');
        if (bytes === null) throw new Error('the report service answer has no reportBytes');
        return decodeBase64Utf8(bytes.trim());
    }

    /** A column's value in a row element (see the module comment). */
    function cellOf(row, column, rowIndex) {
        const name = elementName(column.name);
        let el;
        for (const child of Array.from(row.children)) if (child.localName === name) { el = child; break; }
        if (el === undefined) return null;
        const text = el.textContent;
        if (column.type !== 2) return text;
        if (text.trim() === '') return null;
        const n = Number(text);
        if (!Number.isFinite(n)) throw new Error('row ' + (rowIndex + 1) + ': column ' + column.name + ' is a number (type 2) but holds ' + JSON.stringify(text));
        return n;
    }

    /** The rows of a report's data XML (see the module comment). */
    function reportRows(reportXml, shape) {
        const doc = parseXml(reportXml, 'the report output');
        const set = doc.getElementsByTagName(shape.recordsetSelector)[0];
        if (set === undefined) throw new Error('the report output has no ' + shape.recordsetSelector + ' element (recordsetSelector)');
        return Array.from(set.getElementsByTagName(shape.recordSelector)).map((row, i) => {
            const out = {};
            for (const column of shape.columns) out[column.name] = cellOf(row, column, i);
            if (shape.valueField !== undefined && (out[shape.valueField] === null || out[shape.valueField] === '')) {
                throw new Error('row ' + (i + 1) + ' has no ' + shape.valueField + ' (valueField): a select option needs a key');
            }
            return out;
        });
    }

    /** A rejected Endpoint call as one line: the SOAP fault of its body, else its HTTP status, else its message. */
    function failureText(e) {
        const fault = e !== null && typeof e === 'object' ? faultText(e.body) : null;
        if (fault !== null) return fault;
        if (e !== null && typeof e === 'object' && typeof e.status === 'number') return 'HTTP ' + e.status;
        return e instanceof Error ? e.message : String(e);
    }

    /** The text of a JET filter criterion: a TextFilter's `text`, else ''. */
    function textOf(filterCriterion) {
        return filterCriterion && typeof filterCriterion.text === 'string' ? filterCriterion.text : '';
    }

    const asValues = (value) => (Array.isArray(value) ? value : [value]).map((v) => String(v));

    function createReportDataProvider(options) {
        const { createEndpoint, reportName, recordsetSelector, recordSelector, columns, searchParam, valueField, labelField, searchField, onError } = options;
        if (typeof createEndpoint !== 'function') throw new Error('createReportDataProvider needs createEndpoint(url, headers)');
        if (typeof reportName !== 'string' || reportName === '') throw new Error('createReportDataProvider needs reportName');
        if (typeof recordsetSelector !== 'string' || recordsetSelector === '') throw new Error('createReportDataProvider needs recordsetSelector');
        if (typeof recordSelector !== 'string' || recordSelector === '') throw new Error('createReportDataProvider needs recordSelector');
        if (!Array.isArray(columns) || columns.length === 0) throw new Error('createReportDataProvider needs columns');
        if (typeof valueField !== 'string' || valueField === '') throw new Error('createReportDataProvider needs valueField');
        if (typeof labelField !== 'string' || labelField === '') throw new Error('createReportDataProvider needs labelField');
        if (searchParam !== undefined && (typeof searchParam !== 'string' || searchParam === '')) throw new Error('createReportDataProvider: searchParam must be a non-empty string');
        const names = columns.map((c) => c.name);
        for (const [what, name] of [['valueField', valueField], ['labelField', labelField], ['searchField', searchField]]) {
            if (name !== undefined && !names.includes(name)) throw new Error('createReportDataProvider: ' + what + ' ' + name + ' is not one of the columns');
        }
        const fixed = (options.parameters || []).map((p) => ({ name: p.name, values: asValues(p.value) }));
        if (searchParam !== undefined && fixed.some((p) => p.name === searchParam)) throw new Error('createReportDataProvider: searchParam ' + searchParam + ' is also a fixed parameter');
        const searched = searchField !== undefined ? searchField : labelField;
        const pageSize = Number.isInteger(options.pageSize) && options.pageSize > 0 ? options.pageSize : DEFAULTS.pageSize;
        const search = options.searchTemplate || {};
        const minChars = Number.isInteger(search.minChars) && search.minChars >= 0 ? search.minChars : DEFAULTS.minChars;
        const debounceMs = Number.isInteger(search.debounceMs) && search.debounceMs >= 0 ? search.debounceMs : DEFAULTS.debounceMs;
        const shape = { recordsetSelector, recordSelector, columns, valueField };

        const runs = new Map(); // search text ('' = unsearched) -> Promise<rows>
        const seen = new Map(); // key -> row, every row a run returned
        let seq = 0; // the newest typed text; older ones still waiting out the debounce are dropped

        async function execute(text) {
            const parameters = searchParam === undefined ? fixed : [...fixed, { name: searchParam, values: [text] }];
            let answer;
            try {
                answer = await createEndpoint(BIP_SERVICE_PATH, { ...SOAP_HEADERS }).create(undefined, { rawBody: runReportEnvelope(reportName, parameters) });
            } catch (e) {
                throw new Error('report ' + reportName + ' failed: ' + failureText(e));
            }
            try {
                const rows = reportRows(reportXmlOf(answer && typeof answer === 'object' ? answer.body : undefined), shape);
                for (const row of rows) seen.set(row[valueField], row);
                return rows;
            } catch (e) {
                throw new Error('report ' + reportName + ' failed: ' + (e instanceof Error ? e.message : String(e)));
            }
        }

        /** The rows of one search text: a kept run, else a new one (a failed run is not kept). */
        function run(text) {
            const kept = runs.get(text);
            if (kept !== undefined) return kept;
            const p = execute(text).catch((e) => { runs.delete(text); throw e; });
            runs.set(text, p);
            if (runs.size > KEPT_RUNS) runs.delete(runs.keys().next().value);
            return p;
        }

        /** Runs `work`; with onError a failure is reported and answers `empty`, a success clears the reported error. */
        async function reported(work, empty) {
            try {
                const out = await work();
                if (onError) onError(null);
                return out;
            } catch (e) {
                if (!onError) throw e;
                onError(e instanceof Error ? e.message : String(e));
                return empty;
            }
        }

        async function rowsForText(text, offset) {
            if (searchParam === undefined) {
                const all = await run('');
                if (text === '') return all;
                const lower = text.toLowerCase();
                return all.filter((r) => r[searched] !== null && r[searched] !== undefined && String(r[searched]).toLowerCase().includes(lower));
            }
            if (text !== '' && text.length < minChars) return null;
            if (text !== '' && offset === 0 && debounceMs > 0 && !runs.has(text)) {
                const mine = ++seq;
                await new Promise((resolve) => setTimeout(resolve, debounceMs));
                if (mine !== seq) return null;
            }
            return run(text);
        }

        async function fetchPage({ fetchParameters }) {
            const text = textOf(fetchParameters.filterCriterion);
            const offset = Number.isInteger(fetchParameters.offset) && fetchParameters.offset > 0 ? fetchParameters.offset : 0;
            const none = { data: [], hasMore: false };
            return reported(async () => {
                const rows = await rowsForText(text, offset);
                if (rows === null) return none;
                const data = rows.slice(offset, offset + pageSize);
                return { data, hasMore: offset + data.length < rows.length, totalSize: rows.length };
            }, none);
        }

        async function fetchByKeys({ fetchParameters }) {
            const keys = Array.from(fetchParameters.keys || []);
            const none = { data: [], hasMore: false };
            return reported(async () => {
                if (keys.some((k) => !seen.has(k))) await run('');
                return { data: keys.filter((k) => seen.has(k)).map((k) => seen.get(k)), hasMore: false };
            }, none);
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

    return { createReportDataProvider, runReportEnvelope, reportXmlOf, reportRows, faultText, elementName, BIP_SERVICE_PATH, SOAP_HEADERS, DEFAULTS };
});

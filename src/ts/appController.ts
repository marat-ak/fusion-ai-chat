/**
 * @license
 * Copyright (c) 2014, 2025, Oracle and/or its affiliates.
 * Licensed under The Universal Permissive License (UPL), Version 1.0
 * as shown at https://oss.oracle.com/licenses/upl/
 * @ignore
 */
import * as ko from "knockout";
import * as ResponsiveUtils from "ojs/ojresponsiveutils";
import * as ResponsiveKnockoutUtils from "ojs/ojresponsiveknockoututils";
import Context = require("ojs/ojcontext");
import "xxx-gnimsys-ai/chat/loader";
import { MOCK_ENDPOINTS, MockRestHelper } from "./dev/mock-rest-helper";
import type { MockRequestInit, MockRest, MockTransforms } from "./dev/mock-rest-helper";

/** VB's basic request chain only (no hookHandler / responseBodyFormat): a rest helper the chat cannot stream through. */
function withoutHooks(rest: MockRest) {
  const chain = {
    initConfiguration: (init: MockRequestInit) => { rest.initConfiguration(init); return chain; },
    requestTransformationFunctions: (fns: MockTransforms) => { rest.requestTransformationFunctions(fns); return chain; },
    fetch: () => rest.fetch(),
  };
  return chain;
}

/** SSE answers handed over as one chunk (dev mode only: read whole on purpose), so their last frame and their end
 * arrive in the same tick. */
async function sseInOneChunk(request: Request): Promise<Response> {
  const res = await fetch(request);
  if (!(res.headers.get("content-type") ?? "").startsWith("text/event-stream")) return res;
  const whole = await res.text();
  return new Response(whole, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// Dev host page config: every call goes through the mock rest helper to the mock pod (tests/mock-pod).
const defaultMockConfig = {
  mode: "chat",
  agent: { workflowCode: "MOCK_WF" },
  auth: { kind: "fusionShell" },
  protocol: { checkVersion: "2607100", hcmRestBase: "/hcmRestApi/rest/latest/en/11.13.18.05:9" },
  ui: { starterQuestions: "fromWorkflow" },
  files: { enabled: true },
};

class RootViewModel {
  smScreen: ko.Observable<boolean>|undefined;
  appName: ko.Observable<string>;
  userLogin: ko.Observable<string>;
  footerLinks: Array<object>;
  chatConfig: object | string;
  chatConversationId: string | undefined;
  chatUser: { userName?: string; roles?: string[] };
  chatRestHelper: { get(endpointId: string): unknown } | undefined;
  chatEndpoints: Record<string, string>;

  constructor() {
    // media queries for responsive layouts
    let smQuery: string | null = ResponsiveUtils.getFrameworkQuery("sm-only");
    if (smQuery) {
      this.smScreen = ResponsiveKnockoutUtils.createMediaQueryObservable(smQuery);
    }

    // header

    // application Name used in Branding Area
    this.appName = ko.observable("App Name");

    // user Info used in Global Navigation area
    this.userLogin = ko.observable("john.hancock@oracle.com");

    // footer
    this.footerLinks = [
      {name: 'About Oracle', linkId: 'aboutOracle', linkTarget:'http://www.oracle.com/us/corporate/index.html#menu-about'},
      { name: "Contact Us", id: "contactUs", linkTarget: "http://www.oracle.com/us/corporate/contact/index.html" },
      { name: "Legal Notices", id: "legalNotices", linkTarget: "http://www.oracle.com/us/legal/index.html" },
      { name: "Terms Of Use", id: "termsOfUse", linkTarget: "http://www.oracle.com/us/legal/terms/index.html" },
      { name: "Your Privacy Rights", id: "yourPrivacyRights", linkTarget: "http://www.oracle.com/us/legal/privacy/index.html" },
    ];

    this.chatConfig = window.__CHAT_CONFIG__ ?? defaultMockConfig;
    // Unset unless a test starts the chat in a host-chosen conversation.
    this.chatConversationId = window.__CHAT_CONVERSATION_ID__;

    // Stands in for VB's $application.user; a test may replace it (e.g. with roles for the trace panel).
    this.chatUser = window.__CHAT_USER__ ?? { userName: "test.user@example.com", roles: [] };

    // Stand-in for VB's RestHelper and the page's endpoint map: every mock service connection points at this page's
    // origin, whose dev server proxies the pod paths to the mock pod (MOCK_POD=1, scripts/hooks/before_serve.js).
    // The chat streams through it with the data pack's VB stream provider (VB's hookHandler semantics), as on a pod.
    // A test may replace the endpoint map, withhold the rest helper ("none"), offer only VB's basic chain without
    // hookHandler / responseBodyFormat ("no-stream": the chat cannot stream), have the first streamed call fail at once
    // without an HTTP answer, as a network failure does ("stream-fails-once"), or hand each SSE answer over as one chunk
    // ("stream-one-chunk").
    const origin = window.location.origin;
    const mode = window.__CHAT_REST_HELPER_MODE__;
    const mock = new MockRestHelper({
      serviceConnections: Object.fromEntries(Object.values(MOCK_ENDPOINTS).map((id) => [id, origin])),
      ...(mode === "stream-one-chunk" && { fetchImpl: sseInOneChunk }),
    });
    let failNext = mode === "stream-fails-once";
    // A streamed call is one whose chain got a hook handler (the VB stream provider sets one).
    const failingOnceWhenStreamed = (rest: MockRest): MockRest => {
      const setHooks = rest.hookHandler.bind(rest);
      const fetchOnce = rest.fetch.bind(rest);
      let streamed = false;
      rest.hookHandler = (handler) => { streamed = true; return setHooks(handler); };
      rest.fetch = () => {
        if (!streamed || !failNext) return fetchOnce();
        failNext = false;
        return Promise.reject(new TypeError("Failed to fetch"));
      };
      return rest;
    };
    this.chatRestHelper = mode === "none" ? undefined
      : mode === "no-stream" ? { get: (id: string) => withoutHooks(mock.get(id)) }
        : mode === "stream-fails-once" ? { get: (id: string) => failingOnceWhenStreamed(mock.get(id)) }
          : mock;
    this.chatEndpoints = window.__CHAT_ENDPOINTS__ ?? { ...MOCK_ENDPOINTS };

    // release the application bootstrap busy state
    Context.getPageContext().getBusyContext().applicationBootstrapComplete();        
  }
}

export default new RootViewModel();
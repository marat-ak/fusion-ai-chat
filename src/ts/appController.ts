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

// Dev host page config: the mock pod (tests/mock-pod) answers for pod "mockpod".
const defaultMockConfig = {
  agent: { workflowCode: "MOCK_WF", pod: "mockpod" },
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
  chatRestHelper: MockRestHelper;
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
    // A test may replace the endpoint map.
    const origin = window.location.origin;
    this.chatRestHelper = new MockRestHelper({
      serviceConnections: Object.fromEntries(Object.values(MOCK_ENDPOINTS).map((id) => [id, origin])),
    });
    this.chatEndpoints = window.__CHAT_ENDPOINTS__ ?? { ...MOCK_ENDPOINTS };

    // release the application bootstrap busy state
    Context.getPageContext().getBusyContext().applicationBootstrapComplete();        
  }
}

export default new RootViewModel();
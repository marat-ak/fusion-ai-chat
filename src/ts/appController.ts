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

    // release the application bootstrap busy state
    Context.getPageContext().getBusyContext().applicationBootstrapComplete();        
  }
}

export default new RootViewModel();
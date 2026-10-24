// Entry of the debug-host build flavour (`npm run build:debug-host`): the hook scripts/hooks/debug-host.js points the
// shell's main.js at this module instead of ./root, so the dev mock rest helper is not in that build at all.
import * as ko from "knockout";
import { whenDocumentReady } from "ojs/ojbootstrap";
import Context = require("ojs/ojcontext");
import "ojs/ojknockout";
import { DebugHostViewModel } from "./hostController";

whenDocumentReady().then(() => {
  const vm = new DebugHostViewModel({ origin: window.location.origin, search: window.location.search });
  ko.applyBindings(vm, document.getElementById("globalBody"));
  // release the application bootstrap busy state (main.js sets oj_whenReady)
  Context.getPageContext().getBusyContext().applicationBootstrapComplete();
  vm.start();
});

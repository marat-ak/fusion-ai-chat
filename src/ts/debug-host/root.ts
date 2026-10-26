// Entry of the debug-host build flavour (`npm run build:debug-host`): the hook scripts/hooks/debug-host.js points the
// shell's main.js at this module instead of ./root, so the dev mock rest helper is not in that build at all.
import * as ko from "knockout";
import { whenDocumentReady } from "ojs/ojbootstrap";
import Context = require("ojs/ojcontext");
import "ojs/ojknockout";
import { DebugHostViewModel } from "./hostController";
import { mountInspector } from "./inspector/Inspector";

whenDocumentReady().then(() => {
  const vm = new DebugHostViewModel({ origin: window.location.origin, search: window.location.search });
  ko.applyBindings(vm, document.getElementById("globalBody"));
  // release the application bootstrap busy state (main.js sets oj_whenReady)
  Context.getPageContext().getBusyContext().applicationBootstrapComplete();
  // The agent UI's panel messages (export, reset, breakpoints).
  window.addEventListener("message", vm.onWindowMessage);
  vm.start().then(() => {
    const o = vm.outcome();
    const source = vm.definitionSource();
    // The Run pane sits outside Knockout's bindings (data-oj-binding-provider="none"): Preact renders it.
    const el = document.getElementById("dbg-run");
    if (o !== null && o.kind === "run" && source !== null && el !== null) {
      const setActive = mountInspector(el, {
        store: vm.runStore, source, workflowCode: o.binding.workflowCode, version: o.binding.version, onExport: () => { vm.exportNow(); },
      }, vm.tab() === "run");
      // After the pane's hidden attribute has changed: the graph measures the pane when it is created.
      vm.tab.subscribe((t) => window.requestAnimationFrame(() => setActive(t === "run")));
    }
  });
});

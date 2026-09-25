import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
test("Workforce forms and role boundary", async () => {
  const dom = new JSDOM('<div id="root"></div>', {
    url: "http://localhost:4173",
  });
  for (const k of [
    "window",
    "document",
    "HTMLElement",
    "HTMLDialogElement",
    "Node",
    "Event",
    "MouseEvent",
    "localStorage",
    "sessionStorage",
    "MutationObserver",
  ])
    Object.defineProperty(globalThis, k, {
      value: dom.window[k],
      configurable: true,
      writable: true,
    });
  Object.defineProperty(globalThis, "navigator", {
    value: dom.window.navigator,
    configurable: true,
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  window.confirm = () => true;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await mkdir("test-results", { recursive: true });
  await build({
    entryPoints: ["src/ui/workforce.jsx"],
    outfile: "test-results/workforce-ui.mjs",
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    jsx: "automatic",
    loader: { ".css": "empty" },
    define: { "import.meta.env": "{}" },
  });
  const React = await import("react"),
    { render, screen, cleanup } = await import("@testing-library/react"),
    user = (await import("@testing-library/user-event")).default.setup({
      document: dom.window.document,
    });
  const C = await import("../test-results/workforce-ui.mjs");

  const { MemoryRouter } = await import("react-router-dom");
  const calls = [];
  const state = {
    hr_enabled: true,
    team_records: [],
    team_audit: [],
    hr_access: [],
    members: [],
  };
  const props = {
    state,
    isAdmin: true,
    canWrite: true,
    onSubmit: async (type, payload) => calls.push({ type, payload }),
  };
  const mount = (path, extra = {}) =>
    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: [path] },
        React.createElement(C.Workforce, { ...props, ...extra }),
      ),
    );
  mount("/employees");
  await user.click(screen.getByRole("button", { name: "New employee" }));
  await user.type(screen.getByLabelText("Clock code"), "001");
  await user.type(screen.getByLabelText("Full name"), "Sample Employee");
  await user.clear(screen.getByLabelText("Hourly rate $"));
  await user.type(screen.getByLabelText("Hourly rate $"), "18.25");
  await user.click(screen.getByRole("button", { name: "Save" }));
  assert.equal(calls[0].payload.data.rate_cents, 1825);
  assert.equal(calls[0].payload.data.code, "001");
  cleanup();
  mount("/employees", {
    state: { ...state, hr_enabled: false },
    isAdmin: false,
    canWrite: false,
  });
  assert.ok(screen.getByText("Workforce access required"));
  assert.equal(screen.queryByRole("button", { name: "New employee" }), null);
  cleanup();
  mount("/sales");
  await user.click(screen.getByRole("button", { name: "New sales close" }));
  await user.type(screen.getByLabelText("Source / POS"), "Square");
  await user.type(screen.getByLabelText("Unique close reference"), "close-01");
  await user.clear(screen.getByLabelText("Gross sales $"));
  await user.type(screen.getByLabelText("Gross sales $"), "10.25");
  await user.click(screen.getByRole("button", { name: "Save" }));
  assert.equal(calls[1].payload.data.gross_cents, 1025);
  assert.equal(calls[1].payload.data.status, "Draft");
  cleanup();
  mount("/attendance");
  await user.click(screen.getByRole("button", { name: "Import CSV" }));
  assert.ok(screen.getByText(/Start and end require ISO/));
  assert.ok(screen.getByRole("button", { name: "Confirm import" }).disabled);
  cleanup();
  dom.window.close();
});

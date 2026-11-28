import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App.jsx";
import { Result } from "./pages/Explorer.jsx";
import { setJsonView } from "./components/JsonPane.jsx";
import { conn, fakeApi, REAL_OK, REAL_REFUSED } from "./test-helpers.js";

beforeEach(() => { setJsonView("form"); try { sessionStorage.clear(); } catch { /* none */ } window.location.hash = ""; try { localStorage.clear(); } catch { /* none */ } delete document.documentElement.dataset.present; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); try { sessionStorage.clear(); } catch { /* none */ } });
const go = (h) => { window.location.hash = h; window.dispatchEvent(new HashChangeEvent("hashchange")); };

test("skip link, nav and modal: Mock is the default, the modal says what is simulated, and the old banner is gone", async () => {
  fakeApi();
  render(<App />);
  expect(screen.getByText("Skip to content")).toHaveAttribute("href", "#main");
  const modal = await screen.findByTestId("mode-modal");
  expect(modal).toHaveAttribute("data-mode", "mock");
  expect(modal).toHaveTextContent("MOCK");
  expect(modal).toHaveTextContent(/not a recording/);
  expect(modal).toHaveTextContent(/Nothing leaves this machine/);
  expect(screen.queryByTestId("banner")).toBeNull();
  expect(document.querySelector("main > .banner, [data-testid=banner] .banner")).toBeNull();
  await waitFor(() => expect(screen.getByTestId("writes-notice")).toHaveTextContent(/Writes are off/));
  await userEvent.setup().click(screen.getByTestId("mode-modal-ok"));
  expect(screen.queryByTestId("mode-modal")).toBeNull();
  expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
  for (const label of ["Explorer", "Connections", "Audit", "Diagram"]) expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
});

test("the Explorer page: search box, filters, and the operation list render", async () => {
  fakeApi();
  render(<App />);
  const search = await screen.findByTestId("search");
  expect(search).toBeInTheDocument();
  expect(screen.getByTestId("tag-filter")).toBeInTheDocument();
  expect(screen.getByTestId("method-filter")).toBeInTheDocument();
  // Idle view: all operations, grouped into service categories (swagger-tag style).
  await waitFor(() => expect(screen.getByTestId("match-count")).toHaveTextContent(/All 447 operations/));
  const groups = screen.getAllByTestId("op-group");
  expect(groups.length).toBe(2); // ApplicationService, UserService
  expect(screen.getAllByTestId("op-card").length).toBe(4);
  expect(screen.getAllByTestId("method-GET").length).toBe(2);
  // A search switches to the flat match list.
  const user = userEvent.setup();
  await user.type(search, "pi");
  await waitFor(() => expect(screen.getByTestId("match-count")).toHaveTextContent(/4 of 447 operations match/));
  expect(screen.queryByTestId("op-group")).toBeNull();
});

test("typing 'pi' in the search hits /api/spec with q=pi (the server does the substring match)", async () => {
  const state = fakeApi();
  const user = userEvent.setup();
  render(<App />);
  const search = await screen.findByTestId("search");
  await user.type(search, "pi");
  await waitFor(() => expect(state.calls.some((c) => c.url === "/api/spec?q=pi")).toBe(true));
});

test("open an operation, press Call, and the real-time result shows status, ms, path and body", async () => {
  const state = fakeApi();
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getAllByTestId("op-card").length).toBe(4));
  // The runner lives inside the card now: expand the GET users card, then run it.
  await user.click(screen.getAllByTestId("op-card").find((c) => c.textContent.includes("GET") && c.textContent.includes("users")).querySelector("[data-testid=op-open]"));
  const detail = await screen.findByTestId("op-runner");
  expect(detail.closest("[data-testid=op-card]")).toHaveTextContent("/api/{ObjectMeta.Tenant}/v1/users");
  expect(screen.getByTestId("param-ObjectMeta.Tenant")).toHaveValue(conn().tenant); // prefilled from the connection
  await user.click(screen.getByTestId("call"));
  await screen.findByTestId("result");
  await waitFor(() => expect(screen.getByTestId("result-status")).toHaveTextContent("200"));
  expect(screen.getByTestId("result-ms")).toHaveTextContent("15 ms");
  expect(screen.getByTestId("result-path")).toHaveTextContent("/api/11111111-2222-4333-8444-555555555555/v1/users");
  // The body is a JsonPane: Form by default (a label and a value per field), the exact JSON text under the JSON button.
  const box = screen.getByTestId("result-body-box");
  expect(within(box).getByRole("button", { name: "Form" })).toHaveAttribute("aria-pressed", "true");
  expect(within(box).getByRole("button", { name: "JSON" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByTestId("result-body")).toHaveTextContent("users-sample-1");
  await user.click(within(box).getByRole("button", { name: "JSON" }));
  expect(screen.getByTestId("result-body").tagName).toBe("PRE");
  expect(screen.getByTestId("result-body")).toHaveTextContent('"Name": "users-sample-1"');
  expect(state.calls.some((c) => c.url === "/api/connections/c1/call" && c.body.opId === "op-1")).toBe(true);
});

test("the result body marks this lab's important keys (Kind, State) in both views, and the pane has no scroll cap", () => {
  const body = { Users: [{ ObjectMeta: { Kind: "User", Name: "u1" }, Spec: { State: "pending", Scopes: ["mcp"], Notes: "x" } }] };
  const { container } = render(<Result result={{ status: 200, ms: 3, path: "/api/t/v1/users", sessionId: "s1", body }} />);
  const hotRows = () => [...container.querySelectorAll('.jform__row[data-hot="true"]')].map((r) => r.textContent);
  expect(hotRows().some((t) => /(^|\.)Kind/.test(t))).toBe(true);
  expect(hotRows().some((t) => /(^|\.)State/.test(t))).toBe(true);
  expect(hotRows().some((t) => /(^|\.)Notes/.test(t))).toBe(false);
  setJsonView("raw");
  cleanup();
  const raw = render(<Result result={{ status: 200, ms: 3, path: "/api/t/v1/users", sessionId: "s1", body }} />).container;
  const hotText = [...raw.querySelectorAll(".jtok--hot")].map((n) => n.textContent);
  expect(hotText).toContain('"Kind"');
  expect(hotText).toContain('"State"');
  expect(hotText).not.toContain('"Notes"');
});

test("a refused call (401 from the console) is shown as an error in the result pane", async () => {
  fakeApi({ handlers: { "POST /api/connections/:id/call": (_b, _s, json) => json(401, { error: "login_required", message: "the console refused the credential (HTTP 401): check the API key and secret" }) } });
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getAllByTestId("op-card").length).toBe(4));
  await user.click(screen.getAllByTestId("op-card").find((c) => c.textContent.includes("GET") && c.textContent.includes("users")).querySelector("[data-testid=op-open]"));
  await user.click(await screen.findByTestId("call"));
  await waitFor(() => expect(screen.getByTestId("result-error")).toHaveTextContent(/login_required/));
  expect(screen.getByTestId("result-error")).toHaveTextContent(/check the API key and secret/);
});

test("a destructive operation warns that writes must be enabled", async () => {
  fakeApi();
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getAllByTestId("op-card").length).toBe(4));
  const del = screen.getAllByTestId("op-card").find((c) => c.textContent.includes("DELETE"));
  await user.click(del.querySelector("[data-testid=op-open]"));
  await screen.findByTestId("op-runner");
  expect(screen.getByTestId("op-runner")).toHaveTextContent(/runs only when writes are enabled/);
});

test("Connections: the mock demo button creates a loopback connection and the test shows the credential check", async () => {
  const state = fakeApi({ conns: [] });
  const user = userEvent.setup();
  render(<App />);
  go("#/connections");
  await user.click(await screen.findByText("Add mock console connection"));
  await waitFor(() => expect(state.calls.some((c) => c.url === "/api/connections" && c.method === "POST")).toBe(true));
  expect(await screen.findByTestId("health-card")).toHaveTextContent(/Credential accepted/);
});

test("Connections: writes are off by default and the switch is shown per connection", async () => {
  fakeApi({ conns: [conn()] });
  render(<App />);
  go("#/connections");
  const card = await screen.findByTestId("conn-card");
  expect(card).toHaveTextContent(/off: GET calls only/);
  expect(card.querySelector('input[type="checkbox"]').checked).toBe(false);
});

test("Real refused: the toggle is disabled with the server's reason and the page stays in Mock", async () => {
  fakeApi({ real: REAL_REFUSED });
  render(<App />);
  await waitFor(() => expect(screen.getByTestId("mode-select").querySelector('option[value="real"]').disabled).toBe(true));
  expect(screen.getByTestId("mode")).toHaveTextContent("Mode: mock");
});

test("Real allowed: pressing the toggle switches mode, the modal follows with REAL, and nothing about the mode is stored", async () => {
  fakeApi({ conns: [conn()] });
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getByTestId("mode-select").querySelector('option[value="real"]').disabled).toBe(false));
  await user.click(await screen.findByTestId("mode-modal-ok")); // the MOCK modal, dismissed
  await user.selectOptions(screen.getByTestId("mode-select"), "real");
  expect(screen.getByTestId("mode")).toHaveTextContent("Mode: real");
  const modal = await screen.findByTestId("mode-modal");
  expect(modal).toHaveAttribute("data-mode", "real");
  expect(modal).toHaveTextContent("REAL");
  expect(modal).toHaveTextContent(/Owner-run/);
  expect(modal).toHaveTextContent(/Writes stay off until you enable them per connection/);
  expect(localStorage.getItem("pae.mode")).toBeNull();
});

test("a server that starts in Real: the modal says MOCK until /api/info answers, then REAL, which is not blocked by the earlier MOCK", async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  fakeApi({ handlers: { "GET /api/info": (_b, _s, json) => held.then(() => json(200, { mode: "real", source: "real", modes: ["mock", "real"], real: REAL_OK })) } });
  render(<App />);
  expect(await screen.findByTestId("mode-modal")).toHaveAttribute("data-mode", "mock");
  release();
  await waitFor(() => expect(screen.getByTestId("mode-modal")).toHaveAttribute("data-mode", "real"));
  expect(screen.getByTestId("mode-modal")).toHaveTextContent("REAL");
  expect(screen.getByTestId("mode")).toHaveTextContent("Mode: real");
});

test("Audit: entries render as text rows", async () => {
  fakeApi({ audit: [{ at: "2026-11-12T01:00:00Z", op: "connection-test", outcome: "refused", status: 401 }, { at: "2026-11-12T00:59:00Z", op: "UserService_ListUsers", outcome: "ok", status: 200, ms: 12 }] });
  render(<App />);
  go("#/audit");
  await screen.findByTestId("audit-table");
  const rows = screen.getAllByTestId("audit-row");
  expect(rows.length).toBe(2);
  expect(rows[0]).toHaveTextContent("connection-test");
  expect(rows[1]).toHaveTextContent("UserService_ListUsers");
});

test("Reset from the header calls the server and says what was kept", async () => {
  const state = fakeApi({ conns: [conn()] });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("writes-notice");
  await user.click(screen.getByTestId("mode-modal-ok"));
  await user.click(screen.getByTestId("reset"));
  await waitFor(() => expect(state.calls.some((c) => c.url === "/api/reset")).toBe(true));
  await waitFor(() => expect(screen.getByTestId("live")).toHaveTextContent(/Saved connections kept/));
});

test("the Help button opens the in-app Privilege configuration guide", async () => {
  fakeApi();
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByTestId("help-link"));
  const steps = await screen.findByText("Part 1 — in the Privilege console");
  expect(steps).toBeInTheDocument();
  expect(screen.getByText("Part 2 — in this app")).toBeInTheDocument();
  expect(screen.getByTestId("help-link")).toHaveAttribute("href", "#/help");
  expect(screen.getByText(/Settings → For Developers/)).toBeInTheDocument();
});

test("hostile text from the server never becomes markup", async () => {
  fakeApi({ audit: [{ at: "<img src=x onerror=alert(1)>", op: "<script>bad()</script>", outcome: "ok", status: 200 }] });
  render(<App />);
  go("#/audit");
  await screen.findByTestId("audit-table");
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector("script")).toBeNull();
});

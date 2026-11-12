import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "./App.jsx";
import { conn, fakeApi, REAL_REFUSED } from "./test-helpers.js";

beforeEach(() => { window.location.hash = ""; try { localStorage.clear(); } catch { /* none */ } delete document.documentElement.dataset.present; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const go = (h) => { window.location.hash = h; window.dispatchEvent(new HashChangeEvent("hashchange")); };

test("skip link, nav and banner: Mock is the default, the banner says what is simulated", async () => {
  fakeApi();
  render(<App />);
  expect(screen.getByText("Skip to content")).toHaveAttribute("href", "#main");
  const banner = await screen.findByTestId("banner");
  await waitFor(() => expect(within(banner).getByText(/^MOCK mode, simulated/)).toBeInTheDocument());
  expect(banner).toHaveTextContent(/not a recording/);
  expect(banner).toHaveTextContent(/Nothing leaves this machine/);
  expect(banner).toHaveTextContent(/Writes are off/);
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
  // The idle list is grouped by service; find the GET users card anywhere in the groups.
  await user.click(screen.getAllByTestId("op-card").find((c) => c.textContent.includes("GET") && c.textContent.includes("users")).querySelector("button"));
  const detail = await screen.findByTestId("op-detail");
  expect(detail).toHaveTextContent("/api/{ObjectMeta.Tenant}/v1/users");
  expect(screen.getByTestId("param-ObjectMeta.Tenant")).toHaveValue(conn().tenant); // prefilled from the connection
  await user.click(screen.getByTestId("call"));
  await screen.findByTestId("result");
  await waitFor(() => expect(screen.getByTestId("result-status")).toHaveTextContent("200"));
  expect(screen.getByTestId("result-ms")).toHaveTextContent("15 ms");
  expect(screen.getByTestId("result-path")).toHaveTextContent("/api/11111111-2222-4333-8444-555555555555/v1/users");
  expect(screen.getByTestId("result-body")).toHaveTextContent("users-sample-1");
  expect(state.calls.some((c) => c.url === "/api/connections/c1/call" && c.body.opId === "op-1")).toBe(true);
});

test("a refused call (401 from the console) is shown as an error in the result pane", async () => {
  fakeApi({ handlers: { "POST /api/connections/:id/call": (_b, _s, json) => json(401, { error: "login_required", message: "the console refused the credential (HTTP 401): check the API key and secret" }) } });
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getAllByTestId("op-card").length).toBe(4));
  await user.click(screen.getAllByTestId("op-card").find((c) => c.textContent.includes("GET") && c.textContent.includes("users")).querySelector("button"));
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
  await user.click(del.querySelector("button"));
  await screen.findByTestId("op-detail");
  expect(screen.getByTestId("op-detail")).toHaveTextContent(/runs only when writes are enabled/);
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

test("Real allowed: pressing the toggle switches mode, the banner follows, and nothing about the mode is stored", async () => {
  fakeApi({ conns: [conn()] });
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(screen.getByTestId("mode-select").querySelector('option[value="real"]').disabled).toBe(false));
  await user.selectOptions(screen.getByTestId("mode-select"), "real");
  expect(screen.getByTestId("mode")).toHaveTextContent("Mode: real");
  const banner = screen.getByTestId("banner");
  await waitFor(() => expect(within(banner).getByText(/^REAL mode, owner-run/)).toBeInTheDocument());
  expect(localStorage.getItem("pae.mode")).toBeNull();
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
  await screen.findByTestId("banner");
  await user.click(screen.getByTestId("reset"));
  await waitFor(() => expect(state.calls.some((c) => c.url === "/api/reset")).toBe(true));
  await waitFor(() => expect(screen.getByTestId("live")).toHaveTextContent(/Saved connections kept/));
});

test("hostile text from the server never becomes markup", async () => {
  fakeApi({ audit: [{ at: "<img src=x onerror=alert(1)>", op: "<script>bad()</script>", outcome: "ok", status: 200 }] });
  render(<App />);
  go("#/audit");
  await screen.findByTestId("audit-table");
  expect(document.querySelector("img")).toBeNull();
  expect(document.querySelector("script")).toBeNull();
});

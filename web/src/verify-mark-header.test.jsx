import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import App from "./App.jsx";
import { fakeApi } from "./test-helpers.js";

// The header shows this lab's own Verified / In progress mark, read from GET /api/shelf. Through the lab-proxy that call reaches the shelf, whose
// payload lists every demo with its mark; opened on its own port the lab has no such route (or answers only { shelfUrl }), so there is no mark.
beforeEach(() => { window.location.hash = ""; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
// fakeApi answers 404 for /api/shelf; layer a shelf answer (or none) over it.
function withShelf(payload) {
  fakeApi();
  const base = globalThis.fetch;
  globalThis.fetch = vi.fn((url, init) => (url === "/api/shelf" && payload ? Promise.resolve(new Response(JSON.stringify(payload))) : base(url, init)));
  return () => globalThis.fetch.mock.calls.some(([u]) => u === "/api/shelf");
}

test("shows this lab's own mark inside the top menu, and no other lab's", async () => {
  const asked = withShelf({ shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("in-progress", "In progress") }, { id: "privilege-api-explorer", verification: mark("verified", "Verified", { note: "Every call run on the mock" }) }] });
  render(<App />);
  const bar = within(await screen.findByTestId("top-menu"));
  expect(await bar.findByText("Verified")).toBeInTheDocument();
  expect(asked()).toBe(true);
  expect(bar.queryByText("In progress")).toBeNull();
  expect(document.querySelectorAll(".verify")).toHaveLength(1);
  expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("Every call run on the mock"));
});

test("shows nothing without a mark, when /api/shelf has only { shelfUrl }, or when it is unreachable", async () => {
  for (const payload of [{ shelfUrl: "http://shelf.example" }, { shelfUrl: "http://shelf.example", demos: [{ id: "privilege-api-explorer", verification: null }] }, { shelfUrl: "http://shelf.example", demos: [{ id: "privilege-api-explorer", verification: { status: "none", label: "" } }] }, null]) {
    const asked = withShelf(payload);
    const { unmount } = render(<App />);
    await screen.findByTestId("top-menu");
    await vi.waitFor(() => expect(asked()).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector(".verify")).toBeNull();
    unmount();
  }
});

test("App.jsx renders exactly one <VerifyMark id> for this lab's shelf id (removing it fails the tests above)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, "App.jsx"), "utf8");
  expect(src.match(/<VerifyMark\b/g)).toHaveLength(1);
  expect(src).toContain('<VerifyMark id="privilege-api-explorer" />');
  const entry = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "docs", "shelf-entry.json"), "utf8"));
  expect(entry.demos.map((d) => d.id)).toContain("privilege-api-explorer");
  expect(fs.readFileSync(path.join(here, "main.jsx"), "utf8")).toContain('import "./components/VerifyMark.css";');
});

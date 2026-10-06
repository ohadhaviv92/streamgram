import { readFileSync } from "fs";
import { resolve } from "path";
import { runInNewContext } from "vm";

// Exercise the shipped browser module without adding a DOM/test framework dependency.
function fixture() {
  const warning = { hidden: true, innerHTML: "" };
  const results = { textContent: "", innerHTML: "" };
  const retry = { disabled: false, onclick: () => Promise.resolve() };
  const root = {
    isConnected: true,
    querySelector: (selector: string) => selector === "#check-configuration" ? retry : results,
  };
  const location = { hash: "#settings" };
  const pending: Array<{ resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
  const api = jest.fn(() => new Promise((resolve, reject) => pending.push({ resolve, reject })));
  const source = readFileSync(resolve(__dirname, "../../..", "public/js/checks.js"), "utf8")
    .replace(/^import .*;$/gm, "")
    .replace(/export function/g, "function");
  const context = {
    api, location, t: (text: string) => text, language: "en",
    esc: (text: unknown) => String(text), button: () => "", bindChecks: undefined,
  };
  runInNewContext(source, context);
  const bindChecks = context.bindChecks as unknown as (root: unknown, options?: { saved?: boolean; warning?: unknown }) => {
    check: (options?: { saved: boolean }) => Promise<void>; invalidate: () => void;
  };
  const checks = bindChecks(root, { warning });
  const response = (message: string) => ({
    checkedAt: new Date().toISOString(),
    telegram: { status: "unverified", message },
    tmdb: { status: "passed", message },
    streamingHttps: { status: "failed", message },
  });
  return { root, results, retry, location, pending, checks, api, response, warning };
}

describe("Browser configuration checks", () => {
  it("runs on mount and shows save feedback, statuses, and retry", async () => {
    const f = fixture();
    expect(f.api).toHaveBeenCalledWith("/setup/checks", { method: "POST" });
    expect(f.results.textContent).toBe("Checking…");
    f.pending[0].resolve(f.response("Original"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.retry.disabled).toBe(false);
    const check = f.checks.check({ saved: true });
    f.pending[1].resolve(f.response("Saved result"));
    await check;
    expect(f.results.innerHTML).toMatch(/Settings saved/);
    expect(f.results.innerHTML).toMatch(/Unverified/);
    expect(f.results.innerHTML).toMatch(/Failed/);
    expect(f.retry.disabled).toBe(false);
  });
  it("shows only problematic connections in the overview warning and clears it on recovery", async () => {
    const f = fixture();
    f.pending[0].resolve(f.response("Connection problem"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.warning.hidden).toBe(false);
    expect(f.warning.innerHTML).toContain("Telegram API (Unverified)");
    expect(f.warning.innerHTML).toContain("Streaming HTTPS (Failed)");
    expect(f.warning.innerHTML).not.toContain("TMDB API");
    expect(f.warning.innerHTML).toContain('href="#settings"');
    const check = f.checks.check();
    const healthy = { status: "passed", message: "Working" };
    f.pending[1].resolve({ checkedAt: new Date().toISOString(), telegram: healthy, tmdb: healthy, streamingHttps: healthy });
    await check;
    expect(f.warning.hidden).toBe(true);
    expect(f.warning.innerHTML).toBe("");
  });
  it("ignores an older response after a newer save", async () => {
    const f = fixture();
    f.checks.invalidate();
    const check = f.checks.check({ saved: true });
    f.pending[1].resolve(f.response("New settings"));
    await check;
    f.pending[0].resolve(f.response("Old settings"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.results.innerHTML).toContain("New settings");
    expect(f.results.innerHTML).not.toContain("Old settings");
  });
  it.each(["detach", "navigate"])("ignores results after %s", async (action) => {
    const f = fixture();
    if (action === "detach") f.root.isConnected = false;
    else f.location.hash = "#accounts";
    f.pending[0].resolve(f.response("Stale"));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(f.results.innerHTML).toBe("");
    expect(f.warning.hidden).toBe(true);
  });
  it("distinguishes check failure from save failure and allows retry", async () => {
    const f = fixture();
    const check = f.checks.check({ saved: true });
    f.pending[1].reject(new Error("503"));
    await check;
    expect(f.results.textContent).toBe("Settings saved, but checks could not finish. Try again.");
    expect(f.warning.hidden).toBe(false);
    expect(f.warning.innerHTML).toContain("Connections could not be verified");
    expect(f.retry.disabled).toBe(false);
    const retry = f.retry.onclick();
    f.pending[2].resolve(f.response("Recovered"));
    await retry;
    expect(f.results.innerHTML).toContain("Settings saved");
    expect(f.results.innerHTML).toContain("Recovered");
  });
});

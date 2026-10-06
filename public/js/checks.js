import { t, language } from "./i18n.js";
import { api, esc, button } from "./shared.js";

export function checksCard() {
  return `<section class="card" data-configuration-checks><div class="split"><h2>${t("Configuration checks")}</h2>${button("Check again", "check-configuration")}</div><div data-check-results role="status" aria-live="polite">${t("Checking…")}</div></section>`;
}

export function bindChecks(root, { saved = false, warning = null } = {}) {
  const results = root.querySelector("[data-check-results]");
  const retry = root.querySelector("#check-configuration");
  const route = location.hash;
  let revision = 0;
  let wasSaved = saved;
  const current = (id) => revision === id && root.isConnected && location.hash === route;
  function invalidate() {
    revision++;
    retry.disabled = true;
    results.textContent = t("Checking…");
  }
  async function check({ saved = wasSaved } = {}) {
    wasSaved = saved;
    const id = ++revision;
    retry.disabled = true;
    results.textContent = t("Checking…");
    try {
      const data = await api("/setup/checks", { method: "POST" });
      if (!current(id)) return;
      const labels = { telegram: "Telegram API", tmdb: "TMDB API", streamingHttps: "Streaming HTTPS" };
      const statuses = { passed: "Passed", failed: "Failed", unverified: "Unverified" };
      if (warning) {
        const issues = Object.entries(labels).filter(([key]) => data[key].status !== "passed");
        warning.hidden = issues.length === 0;
        warning.innerHTML = issues.length
          ? `<strong>${t("Connections need attention")}</strong><ul>${issues.map(([key, label]) => `<li><strong>${t(label)} (${t(statuses[data[key].status])})</strong>: ${esc(t(data[key].message))}</li>`).join("")}</ul><a href="#settings">${t("Open Settings")}</a>`
          : "";
      }
      results.innerHTML = `${saved ? `<p>${t("Settings saved")}</p>` : ""}` +
        Object.entries(labels).map(([key, label]) => {
          const result = data[key];
          const kind = result.status === "passed" ? "" : result.status === "failed" ? "warn" : "neutral";
          return `<div class="row"><div><strong>${t(label)}</strong><p class="hint">${esc(t(result.message))}</p></div><span class="badge ${kind}">${t(statuses[result.status])}</span></div>`;
        }).join("") + `<p class="hint">${t("Last checked")}: ${esc(new Date(data.checkedAt).toLocaleString(language))}</p>`;
    } catch {
      if (!current(id)) return;
      results.textContent = t(saved ? "Settings saved, but checks could not finish. Try again." : "Checks could not finish. Try again.");
      if (warning) {
        warning.hidden = false;
        warning.innerHTML = `<strong>${t("Connections could not be verified")}</strong><p>${t("Checks could not finish. Try again.")}</p><a href="#settings">${t("Open Settings")}</a>`;
      }
    } finally {
      if (current(id)) retry.disabled = false;
    }
  }
  retry.onclick = () => check();
  void check();
  return { check, invalidate };
}

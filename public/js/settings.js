import { t } from "./i18n.js";
import {
  $,
  api,
  button,
  confirmAction,
  esc,
  languageOptions,
  run,
  toast,
} from "./shared.js";
import {
  TELEGRAM_API_TUTORIAL_ID,
  TMDB_ACCESS_TOKEN_TUTORIAL_ID,
  tutorialHref,
} from "./tutorials.js";
export function credentialFields(data, { showTutorialLink = false } = {}) {
  const contextualLink = (id) =>
    showTutorialLink
      ? ` <span aria-hidden="true">·</span> <a href="${tutorialHref(id)}">${t("View tutorial")}</a>`
      : "";
  return `<div class="field"><label for="public-url">${t("Public URL")}</label><input id="public-url" type="url" value="${esc(data.publicUrl || location.origin)}" required placeholder="https://stream.example.com" dir="ltr"></div><div class="credential-group"><div class="grid"><div class="field"><label for="api-id">${t("Telegram API ID")}</label><input id="api-id" type="text" inputmode="numeric" pattern="[0-9]+" autocomplete="off" ${data.apiIdConfigured ? "" : "required"} placeholder="${esc(data.apiIdConfigured ? data.apiIdPreview || "****" : "")}" aria-describedby="telegram-secret-help telegram-api-help" dir="ltr"></div><div class="field"><label for="api-hash">${t("Telegram API hash")}</label><input id="api-hash" type="password" autocomplete="new-password" ${data.apiHashConfigured ? "" : "required"} placeholder="${esc(data.apiHashConfigured ? data.apiHashPreview || "****" : "")}" aria-describedby="telegram-secret-help telegram-api-help" dir="ltr"></div></div><p class="hint" id="telegram-secret-help">${t("Leave blank to keep the saved secret")}</p><p class="hint" id="telegram-api-help"><a href="https://my.telegram.org" target="_blank" rel="noreferrer">${t("Get your API ID and hash from Telegram")}</a>${contextualLink(TELEGRAM_API_TUTORIAL_ID)}</p></div><div class="field"><label for="tmdb-token">${t("TMDB bearer token")}</label><input id="tmdb-token" type="password" autocomplete="new-password" ${data.tmdbConfigured ? "" : "required"} placeholder="${esc(data.tmdbConfigured ? data.tmdbTokenPreview || "****" : "")}" aria-describedby="tmdb-secret-help tmdb-api-help" dir="ltr"><p class="hint" id="tmdb-secret-help">${t("Leave blank to keep the saved secret")}</p><p class="hint" id="tmdb-api-help"><a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">${t("Get your API Read Access Token from TMDB")}</a>${contextualLink(TMDB_ACCESS_TOKEN_TUTORIAL_ID)}</p></div><div class="field"><label for="default-language">${t("Default search language")}</label><select id="default-language">${languageOptions(data.preferredLanguage)}</select></div>`;
}
export function credentialValues() {
  return {
    publicUrl: $("#public-url").value.replace(/\/$/, ""),
    apiId: $("#api-id").value.trim(),
    apiHash: $("#api-hash").value,
    tmdbBearerToken: $("#tmdb-token").value,
    preferredLanguage: $("#default-language").value,
  };
}
export function protectionFields(data, firstRun = false) {
  return `<label class="check"><input id="protection" type="checkbox" ${firstRun || data.adminProtection ? "checked" : ""}>${t("Protect management with a password")}</label><p class="hint">${t("When protection is disabled, anyone who can reach this instance can manage it.")}</p><div class="field" style="margin-top:20px"><label for="admin-password">${t(firstRun ? "Admin password" : "New admin password")}</label><input id="admin-password" type="password" autocomplete="new-password" minlength="8" maxlength="1024" ${firstRun ? "required" : ""} placeholder="${data.adminPasswordConfigured ? t("Leave blank to keep the saved secret") : ""}"><p class="hint">${t("Use at least 8 characters.")}</p></div>`;
}
export function bindProtection(hasPassword = false) {
  const change = () => {
    $("#admin-password").required = $("#protection").checked && !hasPassword;
  };
  $("#protection").onchange = change;
  change();
}
export function renderSettings(data) {
  $("#main").innerHTML =
    `<div class="page-head"><h1>${t("Settings")}</h1></div><section class="card"><div class="card-header"><h2>${t("Instance credentials")}</h2></div><form id="credentials" class="form-width">${credentialFields(data, { showTutorialLink: true })}<button class="primary" style="margin-top:24px">${t("Save changes")}</button></form></section><section class="card"><h2>${t("Admin protection")}</h2><form id="protection-form" class="form-width" style="margin-top:20px">${protectionFields(data)}<button class="primary">${t("Save changes")}</button></form></section><section class="card"><h2>${t("Backup & restore")}</h2><p>${t("Backups contain private Telegram sessions. Store them securely.")}</p><div class="actions"><a class="btn" href="/setup/config/export" download>${t("Download backup")}</a></div><form id="restore-form" class="form-width" style="margin-top:24px"><label for="backup-file">${t("Choose backup")}</label><input id="backup-file" type="file" accept="application/json,.json" required><button class="danger" style="margin-top:16px">${t("Restore backup")}</button></form></section><section class="card"><div class="split"><h2>${t("Cache")}</h2>${button("Clear cache", "clear-cache")}</div></section>`;
  bindProtection(data.adminPasswordConfigured);
  $("#credentials").onsubmit = (e) => {
    e.preventDefault();
    run($("#credentials button"), async () => {
      await api("/setup/config", { method: "POST", body: credentialValues() });
      Object.assign(data, await api("/setup/admin-status"));
      for (const [selector, preview] of [
        ["#api-id", data.apiIdPreview],
        ["#api-hash", data.apiHashPreview],
        ["#tmdb-token", data.tmdbTokenPreview],
      ]) {
        const input = $(selector);
        input.value = "";
        input.required = false;
        input.placeholder = preview || "****";
      }
      toast("Changes saved");
    });
  };
  $("#protection-form").onsubmit = (e) => {
    e.preventDefault();
    run($("#protection-form button"), async () => {
      await api("/setup/config", {
        method: "POST",
        body: {
          adminProtection: $("#protection").checked,
          adminPassword: $("#admin-password").value,
        },
      });
      data.adminPasswordConfigured =
        data.adminPasswordConfigured ||
        Boolean($("#admin-password").value.trim());
      $("#admin-password").value = "";
      bindProtection(data.adminPasswordConfigured);
      toast("Changes saved");
    });
  };
  $("#restore-form").onsubmit = async (e) => {
    e.preventDefault();
    const file = $("#backup-file").files[0];
    if (!file) return;
    if (
      !(await confirmAction(
        "Restore this backup?",
        "This replaces accounts and preferences. Your current admin protection is kept. Invitations and browser sessions will be invalidated.",
        "Restore backup",
      ))
    )
      return;
    run($("#restore-form button"), async () => {
      await api("/setup/config/import", {
        method: "POST",
        body: JSON.parse(await file.text()),
      });
      location.assign("/");
    });
  };
  $("#clear-cache").onclick = () =>
    run($("#clear-cache"), async () => {
      await api("/cache/clear", { method: "DELETE" });
      toast("Cache cleared");
    });
}

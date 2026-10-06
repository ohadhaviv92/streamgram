import { t, applyLanguage } from "./i18n.js";
import { $, api, button, errorMessage, shell } from "./shared.js";
import { personal } from "./personal.js";
import { admin } from "./admin.js";
import { setup, invitation } from "./setup.js";
applyLanguage();
async function start() {
  const params = new URLSearchParams(location.search);
  // Route before fetching bootstrap/admin data, even with an existing admin cookie.
  if (params.has("token") || params.get("action") === "settings") {
    if (!params.get("token")) throw new Error("Missing personal account link");
    return personal(params.get("token"));
  }
  if (params.has("invite")) return invitation(params.get("invite"));
  const status = await api("/setup/status");
  return status.managementInitialized ? admin() : setup();
}
start().catch((error) => {
  shell();
  $("#main").innerHTML =
    `<section class="card"><h1>${t("Unable to open this page")}</h1><div id="page-error" style="margin-top:24px"></div>${button("Retry", "retry")}</section>`;
  errorMessage(error, $("#page-error"));
  $("#retry").onclick = () => location.reload();
});

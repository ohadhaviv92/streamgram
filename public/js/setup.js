import { checksCard, bindChecks } from "./checks.js";
import { t } from "./i18n.js";
import {
  $,
  api,
  button,
  copy,
  installCard,
  pageHead,
  run,
  shell,
} from "./shared.js";
import {
  credentialFields,
  credentialValues,
  protectionFields,
  bindProtection,
} from "./settings.js";
import { connect } from "./auth.js";
export async function setup() {
  shell();
  let config = await api("/setup/bootstrap");
  let initialized = false;
  let protection = { adminProtection: true, adminPassword: "" };
  function frame(step, body) {
    $("#main").innerHTML =
      pageHead(
        "Welcome to StreamGram",
        "A few steps to your own streaming dashboard.",
      ) +
      `<ol class="steps">${["Protection", "Credentials", "Telegram", "Install"].map((s, i) => `<li ${i === step ? 'aria-current="step"' : ""}>${t(s)}</li>`).join("")}</ol><section class="card">${body}</section>`;
  }
  function secure() {
    frame(
      0,
      `<h2>${t("Secure your dashboard")}</h2><form id="security" style="margin-top:24px">${protectionFields(config, true)}<button class="primary">${t("Continue")}</button></form>`,
    );
    $("#protection").checked = protection.adminProtection;
    $("#admin-password").value = protection.adminPassword;
    bindProtection(config.adminPasswordConfigured);
    $("#security").onsubmit = (e) => {
      e.preventDefault();
      protection = {
        adminProtection: $("#protection").checked,
        adminPassword: $("#admin-password").value,
      };
      run($("#security button"), async () => {
        await api(initialized ? "/setup/config" : "/setup/initialize", {
          method: "POST",
          body: protection,
        });
        initialized = true;
        protection.adminPassword = "";
        config = await api("/setup/admin-status");
        credentials();
      });
    };
  }
  function credentials() {
    frame(
      1,
      `<h2>${t("Set up your instance")}</h2><p>${t("Existing environment settings are prefilled. Blank secret fields keep saved values.")}</p><form id="instance">${credentialFields(config)}<div class="actions" style="margin-top:24px">${button("Back", "back")}<button class="primary">${t("Save & continue")}</button></div></form>`,
    );
    $("#back").onclick = secure;
    $("#instance").onsubmit = (e) => {
      e.preventDefault();
      run($("#instance .primary"), async () => {
        await api("/setup/config", {
          method: "POST",
          body: credentialValues(),
        });
        telegram(true);
      });
    };
  }
  function telegram(saved = false) {
    frame(
      2,
      `<h2>${t("Connect Telegram")}</h2><p>${t("Connect Telegram to start streaming in Stremio.")}</p><div class="actions">${button("Connect Telegram", "connect", "primary")}<a class="btn ghost" href="/">${t("Go to dashboard")}</a></div>`,
    );
    $("#main").insertAdjacentHTML("beforeend", checksCard());
    bindChecks($("[data-configuration-checks]"), { saved });
    $("#connect").onclick = () =>
      connect({}, async (token) => {
        const account = await api("/settings", { token });
        frame(
          3,
          installCard(account.manifestUrl) +
            `<a class="btn" href="/?action=settings&token=${encodeURIComponent(token)}">${t("Open personal page")}</a>`,
        );
        $("#copy-manifest").onclick = () =>
          copy(account.manifestUrl, "Manifest copy to clipboard");
      });
  }
  secure();
}
export async function invitation(secret) {
  shell();
  try {
    await api(`/invitations/${encodeURIComponent(secret)}`);
  } catch (error) {
    const description = error.message.includes("expired")
      ? "This invitation has expired. Ask your admin for a new link."
      : error.message.includes("revoked")
        ? "This invitation was revoked. Ask your admin for a new link."
        : error.message.includes("used")
          ? "This invitation was already used. Open your personal configure link instead."
          : "This invitation could not be found. Check the link with your admin.";
    $("#main").innerHTML =
      `<section class="card empty"><h1>${t("Invitation unavailable")}</h1><p>${t(description)}</p></section>`;
    return;
  }
  $("#main").innerHTML =
    `<section class="card login"><div class="eyebrow">StreamGram</div><h1>${t("You’re invited")}</h1><p>${t("Connect your Telegram account to get your own private Stremio installation.")}</p>${button("Connect Telegram", "connect", "primary")}<p class="help-line">${t("Single use · Valid for 7 days")}</p></section>`;
  $("#connect").onclick = () =>
    connect({ invite: secret }, async (token) =>
      location.assign(`/?action=settings&token=${encodeURIComponent(token)}`),
    );
}

import { checksCard, bindChecks } from "./checks.js";
import { t, language } from "./i18n.js";
import {
  $,
  api,
  badge,
  button,
  confirmAction,
  copy,
  dialog,
  esc,
  icon,
  pageHead,
  run,
  shell,
} from "./shared.js";
import { connect } from "./auth.js";
import { renderSettings } from "./settings.js";
import { renderTutorials } from "./tutorials.js";
export async function admin() {
  const session = await api("/admin/session");
  if (!session.authenticated) {
    login();
    return;
  }
  // A unique browser session also binds authentication on unprotected instances.
  await api("/admin/session", { method: "POST" });
  const render = async () => {
    const [route, ...routeParts] = location.hash.slice(1).split("/");
    const tab =
      {
        overview: "Overview",
        accounts: "Accounts",
        invitations: "Invitations",
        settings: "Settings",
        tutorials: "Tutorials",
      }[route] || "Overview";
    shell("admin", tab);
    $("#main").innerHTML = `<p role="status">${t("Loading…")}</p>`;
    try {
      const config = await api("/setup/admin-status");
      if (tab === "Tutorials") {
        return renderTutorials(routeParts.join("/"));
      }
      if (tab === "Settings") {
        renderSettings(config);
        return;
      }
      if (tab === "Invitations") {
        await invitations();
        return;
      }
      const accounts = await api("/admin/accounts");
      if (tab === "Accounts")
        $("#main").innerHTML =
          pageHead(
            "Accounts",
            "Private links provide access to each account. Share them only with their owner.",
            button("Add account", "add-account", "primary", "plus"),
          ) + `<section class="card" id="account-list"></section>`;
      else {
        const invites = await api("/admin/invitations");
        const credentialsComplete = Boolean(
          config.publicUrl &&
            config.apiIdConfigured &&
            config.apiHashConfigured &&
            config.tmdbConfigured,
        );
        $("#main").innerHTML =
          pageHead(
            "Overview",
            "Manage your Telegram accounts and Stremio connections in one place.",
            button("Add account", "add-account", "primary", "plus"),
          ) +
          `<div class="notice" id="connection-warning" role="status" aria-live="polite" hidden></div>` +
          (!config.adminProtection
            ? `<div class="notice">${t("When protection is disabled, anyone who can reach this instance can manage it.")}</div>`
            : "") +
          (!config.setupComplete
            ? credentialsComplete && accounts.length === 0
              ? `<div class="notice"><strong>${t("Connect a Telegram account")}</strong><br>${t("Your API credentials are set. Add a Telegram account to start streaming in Stremio.")}</div>`
              : `<div class="notice"><strong>${t("Configuration incomplete")}</strong><br>${t("Finish instance credentials in Settings to enable streaming.")}</div>`
            : "") +
          `<div class="stats"><section class="card stat"><div class="stat-label">${icon("Accounts")}${t("Telegram accounts")}</div><div class="value">${accounts.length}</div><p class="hint">${t("Connected")}</p></section><section class="card stat"><div class="stat-label">${icon("Invitations")}${t("Active invitations")}</div><div class="value">${invites.filter((i) => i.status === "active").length}</div><p class="hint">${t("Single use · Valid for 7 days")}</p></section><section class="card stat"><div class="stat-label">${icon("shield")}${t("Admin protection")}</div><div class="value">${t(config.adminProtection ? "Enabled" : "Disabled")}</div><p class="hint">${t("Session expires after 8 hours.")}</p></section></div><section class="card"><div class="card-header"><h2>${t("Telegram accounts")}</h2><a class="btn ghost" href="#accounts">${t("View all")}${icon("arrow")}</a></div><div id="account-list"></div></section><section class="card"><div class="card-header"><div><h2>${t("Invitations")}</h2><p>${t("Invite someone to connect their own Telegram account.")}</p></div></div>${button("Create invitation", "create-invitation", "", "plus")}</section>`;
        $("#main").insertAdjacentHTML("beforeend", checksCard());
        bindChecks($("[data-configuration-checks]"), { warning: $("#connection-warning") });
        $("#create-invitation").onclick = createInvitation;
      }
      renderAccounts(
        tab === "Overview" ? accounts.slice(0, 4) : accounts,
        config,
        render,
      );
      $("#add-account").onclick = () =>
        connect({}, async () => {
          await render();
        });
      if ($("#empty-add")) $("#empty-add").onclick = $("#add-account").onclick;
    } catch (error) {
      if (error.status === 401) login();
      else {
        const { errorMessage } = await import("./shared.js");
        errorMessage(error);
      }
    }
  };
  window.onhashchange = async () => {
    const tutorialFocused = await render();
    if (!tutorialFocused) $("#main").focus();
  };
  await render();
}
function login() {
  window.onhashchange = null;
  shell();
  $("#main").innerHTML =
    `<section class="card login"><div class="eyebrow">${t("Management")}</div><h1>${t("Welcome back")}</h1><p>${t("Sign in to manage your StreamGram instance.")}</p><form id="login-form"><div class="field"><label for="login-password">${t("Admin password")}</label><input id="login-password" type="password" autocomplete="current-password" required maxlength="1024"></div><button class="primary">${t("Sign in")}</button></form></section>`;
  $("#login-form").onsubmit = (e) => {
    e.preventDefault();
    run($("#login-form button"), async () => {
      await api("/admin/login", {
        method: "POST",
        body: { password: $("#login-password").value },
      });
      await admin();
    });
  };
}
function renderAccounts(accounts, config, refresh) {
  if (!accounts.length) {
    $("#account-list").innerHTML =
      `<div class="empty">${icon("Accounts")}<h2>${t("No accounts yet")}</h2><p>${t("Connect Telegram to start streaming in Stremio.")}</p>${button("Add account", "empty-add", "primary", "plus")}</div>`;
    return;
  }
  $("#account-list").innerHTML = accounts
    .map(
      (a, i) =>
        `<div class="row account-row"><div class="identity"><div class="avatar" aria-hidden="true">${esc((a.name || t("Account")).slice(0, 1).toUpperCase())}</div><div><h3><a class="account-link" href="/?action=settings&token=${encodeURIComponent(a.token)}" aria-label="${t("Open personal page")}: ${esc(a.name || t("Account"))}">${esc(a.name || t("Account"))}${icon("arrow")}</a></h3><p dir="ltr">•••• ${esc(a.phoneLast4)}</p>${a.createdAt !== null ? `<p class="hint">${t("Created")} ${new Date(a.createdAt).toLocaleDateString(language)}</p>` : ""}</div></div><div class="actions">${badge(a.blocked ? "Blocked" : a.connected ? "Connected" : "Reconnect needed", a.blocked || !a.connected ? "warn" : "")}<button class="${a.blocked ? "" : "danger"}" data-block="${i}">${t(a.blocked ? "Unblock" : "Block")}</button><button class="ghost" data-copy="${i}">${icon("copy")}<span class="sr-only">${t("Copy manifest")}</span></button><button class="danger" data-delete="${i}">${t("Delete")}</button></div></div>`,
    )
    .join("");
  document
    .querySelectorAll("[data-copy]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          copy(
            `${(config.publicUrl || location.origin).replace(/\/$/, "")}/${accounts[Number(b.dataset.copy)].token}/manifest.json`,
            "Manifest copy to clipboard",
          )),
    );
  document.querySelectorAll("[data-block]").forEach((b) => {
    b.onclick = () => run(b, async () => {
      const account = accounts[Number(b.dataset.block)];
      await api(`/admin/accounts/${encodeURIComponent(account.token)}/block`, {
        method: "PUT", body: { blocked: !account.blocked },
      });
      await refresh();
    });
  });
  document.querySelectorAll("[data-delete]").forEach(
    (b) =>
      (b.onclick = async () => {
        if (
          !(await confirmAction(
            "Delete this account?",
            "Its private links will stop working. This does not delete your Telegram account.",
          ))
        )
          return;
        run(b, async () => {
          await api(
            `/admin/accounts/${accounts[Number(b.dataset.delete)].token}`,
            { method: "DELETE" },
          );
          await refresh();
        });
      }),
  );
}
function nameDialog(title, value, trigger, save) {
  const d = dialog(title,
    `<form id="name-form"><div class="field"><label for="record-name">${t("Display name (optional)")}</label><input id="record-name" maxlength="80" value="${esc(value)}" autocomplete="off"></div><button class="primary">${t("Create invitation")}</button></form>`, trigger);
  $("#name-form", d).onsubmit = (event) => {
    event.preventDefault();
    run($("#name-form button", d), async () => {
      await save($("#record-name", d).value.trim(), () => d.close());
      d.close();
    }, $(".dialog-body", d));
  };
}
async function createInvitation() {
  nameDialog("Create invitation", "", $("#create-invitation"), async (name, close) => {
    const invite = await api("/admin/invitations", { method: "POST", body: { name } });
    close();
    const url = new URL("/", location.origin);
    url.searchParams.set("invite", invite.secret);
    if (language !== "en") url.searchParams.set("lng", language);
    const d = dialog(
      "Invitation ready",
      `<p>${t("Copy this link now. It is shown only once.")}</p><label for="invite-url">${t("Copy link")}</label><input id="invite-url" dir="ltr" readonly value="${esc(url.href)}"><p class="hint">${t("Single use · Valid for 7 days")}</p><div class="actions" style="margin-top:20px">${button("Copy link", "copy-invite", "primary", "copy")}${navigator.share ? button("Share link", "share-invite") : ""}</div>`,
      $("#create-invitation"),
    );
    $("#copy-invite", d).onclick = () => copy(url.href);
    if ($("#share-invite", d))
      $("#share-invite", d).onclick = () =>
        run(
          $("#share-invite", d),
          () => navigator.share({ title: "StreamGram", url: url.href }),
          $(".dialog-body", d),
        );
    if (location.hash === "#invitations")
      d.addEventListener("close", () => run(null, invitations));
  });
}
async function invitations() {
  const list = (await api("/admin/invitations")).filter(
    (invite) => invite.status !== "revoked",
  );
  $("#main").innerHTML =
    pageHead(
      "Invitations",
      "Invite someone to connect their own Telegram account.",
      button("Create invitation", "create-invitation", "primary", "plus"),
    ) +
    `<section class="card">${
      list.length
        ? list
            .slice()
            .reverse()
            .map(
              (i, index) =>
                `<div class="row"><div><h3>${esc(i.name || `${t("Invitations")} ${list.length - index}`)}</h3><p class="hint">${t("Created")} ${new Date(i.createdAt).toLocaleDateString(language)} · ${t("Expires")} ${new Date(i.expiresAt).toLocaleDateString(language)}</p></div><div class="actions">${badge(i.status, i.status === "active" ? "" : "neutral")}${i.status === "active" ? `<button class="danger" data-revoke="${esc(i.id)}">${t("Revoke")}</button>` : i.status === "used" ? `<button class="danger" data-delete-invite="${esc(i.id)}">${t("Delete")}</button>` : ""}</div></div>`,
            )
            .join("")
        : `<div class="empty">${icon("Invitations")}<h2>${t("No invitations yet")}</h2><p>${t("Create a private link to invite your first user.")}</p></div>`
    }</section><p class="help-line">${t("Single use · Valid for 7 days")}</p>`;
  $("#create-invitation").onclick = createInvitation;
  document.querySelectorAll("[data-delete-invite]").forEach((b) => {
    b.onclick = () => run(b, async () => {
      await api(`/admin/invitations/${encodeURIComponent(b.dataset.deleteInvite)}/record`, {
        method: "DELETE",
      });
      await invitations();
    });
  });
  document.querySelectorAll("[data-revoke]").forEach(
    (b) =>
      (b.onclick = () =>
        run(b, async () => {
          await api(`/admin/invitations/${b.dataset.revoke}`, {
            method: "DELETE",
          });
          await invitations();
        })),
  );
}

import { t, language } from "./i18n.js";
export const $ = (selector, root = document) => root.querySelector(selector);
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const paths = {
  Overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  Accounts:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M17 4a4 4 0 0 1 0 7 M22 21v-2a4 4 0 0 0-3-3.8",
  Invitations: "M4 5h16v14H4z M4 6l8 7 8-7",
  Settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  Tutorials:
    "M2 3h6a4 4 0 0 1 4 4v14a4 4 0 0 0-4-4H2z M22 3h-6a4 4 0 0 0-4 4v14a4 4 0 0 1 4-4h6z",
  plus: "M12 5v14 M5 12h14",
  arrow: "M7 17L17 7 M7 7h10v10",
  chevron: "M6 9l6 6 6-6",
  copy: "M8 8h12v13H8z M16 8V3H3v13h5",
  shield: "M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6",
  play: "M8 4l13 8-13 8z",
  close: "M6 6l12 12 M6 18L18 6",
  telegram: "M3 11l18-8-5 18-5-7-8-3z M11 14L21 3",
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.telegram}"/></svg>`;
export const button = (label, id, style = "", glyph = "") =>
  `<button type="button" id="${id}" class="${style}">${glyph ? icon(glyph) : ""}${t(label)}</button>`;
export const badge = (label, kind = "") =>
  `<span class="badge ${kind}">${t(label)}</span>`;
export function languageOptions(selected, inherit = false) {
  return (
    `${inherit ? `<option value="">${t("Use instance default")}</option>` : ""}` +
    Object.entries({ en: "English", he: "Hebrew", ru: "Russian", ar: "Arabic" })
      .map(
        ([value, label]) =>
          `<option value="${value}" ${selected === value ? "selected" : ""}>${t(label)}</option>`,
      )
      .join("")
  );
}
export function shell(mode = "", tab = "") {
  const brand = `<a class="brand" href="/"><img class="brandmark" src="/logo-icon-only.png" alt="" width="48" height="48"><span>StreamGram<small>${t("Private instance")}</small></span></a>`;
  const nav = ["Overview", "Accounts", "Invitations", "Settings", "Tutorials"]
    .map(
      (label) =>
        `<a href="#${label.toLowerCase()}" ${tab === label ? 'aria-current="page"' : ""}>${icon(label)}${t(label)}</a>`,
    )
    .join("");
  $("#app").innerHTML =
    `<div class="${mode === "admin" ? "shell" : "standalone"}">${mode === "admin" ? `<aside>${brand}<nav aria-label="${t("Management")}">${nav}</nav><div class="aside-footer">StreamGram<br>${t("Your Telegram. Your Stream.")}</div></aside>` : ""}<div><header>${mode === "admin" ? `<span class="crumb">StreamGram / ${t(tab)}</span>` : brand}<div class="toolbar"><label class="sr-only" for="ui-language">${t("Interface language")}</label><select id="ui-language"><option value="en" ${language === "en" ? "selected" : ""}>English</option><option value="he" ${language === "he" ? "selected" : ""}>עברית</option></select>${mode === "admin" ? button("Sign out", "signout", "ghost") : ""}</div></header><main id="main" tabindex="-1"></main></div></div>`;
  $("#ui-language").onchange = (e) => {
    localStorage.setItem("streamgram-ui-language", e.target.value);
    location.reload();
  };
  if ($("#signout"))
    $("#signout").onclick = () =>
      run($("#signout"), async () => {
        await api("/admin/logout", { method: "POST" });
        location.assign("/");
      });
}
export async function api(
  path,
  { method = "GET", body, token, invite, ...options } = {},
) {
  const response = await fetch(path, {
    ...options,
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(invite ? { "X-Invitation-Token": invite } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.success === false && !data.passwordRequired)) {
    const error = new Error(
      Array.isArray(data.message)
        ? data.message.join(" · ")
        : data.message || `Request failed (${response.status})`,
    );
    error.status = response.status;
    throw error;
  }
  return data;
}
let toastTimer;
export function toast(message) {
  $("#toast").textContent = t(message);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").textContent = "";
  }, 5000);
}
export function errorMessage(error, root = $("#main")) {
  let box = $(".error", root);
  if (!box) {
    box = document.createElement("div");
    box.className = "notice error";
    box.setAttribute("role", "alert");
    root.prepend(box);
  }
  box.textContent = t(error.message || String(error));
}
export async function run(control, work, root) {
  const old = control?.innerHTML;
  if (control) {
    control.disabled = true;
    control.setAttribute("aria-busy", "true");
    control.textContent = t("Loading…");
  }
  try {
    return await work();
  } catch (error) {
    errorMessage(error, root);
  } finally {
    if (control) {
      control.disabled = false;
      control.removeAttribute("aria-busy");
      control.innerHTML = old;
    }
  }
}
export async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast("Copied to clipboard");
  } catch {
    const d = dialog(
      "Copy link",
      `<label for="copy-fallback">${t("Copy link")}</label><input id="copy-fallback" readonly value="${esc(value)}">`,
    );
    $("#copy-fallback", d).select();
  }
}
let dialogSequence = 0;
export function dialog(title, html, previous = document.activeElement) {
  const titleId = `dialog-title-${++dialogSequence}`;
  const d = document.createElement("dialog");
  d.setAttribute("aria-labelledby", titleId);
  d.innerHTML = `<button class="ghost close" aria-label="${t("Close")}">${icon("close")}</button><h2 id="${titleId}">${t(title)}</h2><div class="dialog-body">${html}</div>`;
  document.body.append(d);
  $(".close", d).onclick = () => d.close();
  d.addEventListener(
    "close",
    () => {
      d.remove();
      if (previous?.isConnected) previous.focus();
    },
    { once: true },
  );
  d.showModal();
  return d;
}
export async function confirmAction(title, text, action = "Delete") {
  return new Promise((resolve) => {
    const d = dialog(
      title,
      `<p>${t(text)}</p><div class="actions">${button("Cancel", "cancel")}${button(action, "confirm", "danger")}</div>`,
    );
    let result = false;
    $("#cancel", d).onclick = () => d.close();
    $("#confirm", d).onclick = () => {
      result = true;
      d.close();
    };
    d.addEventListener("close", () => resolve(result), { once: true });
  });
}
export function pageHead(title, description, action = "") {
  return `<div class="page-head"><div><h1>${t(title)}</h1><p>${t(description)}</p></div>${action}</div>`;
}
export function installCard(manifest) {
  return `<section class="card install"><div class="eyebrow">${t("Ready to install")}</div><h2>${t("Ready when you are.")}</h2><p>${t("Connect your Telegram library to Stremio. Catalogs are optional.")}</p><a class="btn primary" href="${esc(manifest.replace(/^https?:\/\//, "stremio://"))}">${icon("play")}${t("Install in Stremio")}</a><label for="manifest-url">${t("Manifest URL")}</label><div class="copy-field"><input id="manifest-url" readonly value="${esc(manifest)}">${button("Copy manifest", "copy-manifest", "", "copy")}</div><p class="hint">${t("Keep this link private. It grants access to your account.")}</p></section>`;
}

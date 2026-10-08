import { t } from "./i18n.js";
import {
  $,
  api,
  badge,
  button,
  confirmAction,
  copy,
  esc,
  installCard,
  languageOptions,
  run,
  shell,
  toast,
} from "./shared.js";
import { connect } from "./auth.js";
export async function personal(token) {
  shell("personal");
  $("#main").innerHTML = `<p role="status">${t("Loading…")}</p>`;
  const data = await api("/settings", { token });
  $("#main").innerHTML =
    `<div class="page-head"><div><div class="eyebrow">${t("Personal account")}</div><h1>${esc(data.canEditName ? data.name || t("Account") : t("Account"))}</h1></div>${badge(data.telegramConnected ? "Connected" : "Reconnect needed", data.telegramConnected ? "" : "warn")}</div>${installCard(data.manifestUrl)}<section class="card"><h2>${t("Account preferences")}</h2><form id="preferences" style="margin-top:24px"><div class="grid">${data.canEditName ? `<div class="field"><label for="name">${t("Display name")}</label><input id="name" maxlength="80" value="${esc(data.name)}" autocomplete="nickname"></div>` : ""}<div class="field"><label for="personal-language">${t("Search language")}</label><select id="personal-language">${languageOptions(data.personalLanguage || "", true)}</select><p class="hint">${t("English is always searched. Selecting another language adds searches in that language.")}</p></div></div><button class="primary">${t("Save changes")}</button></form></section><section class="card"><details id="catalogs"><summary>${t("Channel and folder catalogs (optional)")}</summary><p>${t("Browse selected folders and channels inside Stremio. You can install without selecting any.")}</p>${button("Load folders and channels", "load-sources")}<p id="sources-status" role="status" class="hint"></p><div id="source-lists" class="grid"></div>${button("Save catalogs", "save-sources", "primary")}</details></section><section class="card"><h2>${t("Account controls")}</h2><p>${t("Reconnect using the same Telegram account. Your private link and preferences stay the same.")}</p><div class="actions">${button("Reconnect Telegram", "reconnect")}${button("Delete account", "delete-account", "danger")}</div></section>`;
  $("#copy-manifest").onclick = () =>
    copy(data.manifestUrl, "Manifest copy to clipboard");
  $("#preferences").onsubmit = (e) => {
    e.preventDefault();
    run($("#preferences button"), async () => {
      if (data.canEditName) {
        await api("/name", {
          method: "PUT", token, body: { name: $("#name").value },
        });
        $("h1").textContent = $("#name").value || t("Account");
      }
      await api("/settings", {
        method: "PUT",
        token,
        body: { language: $("#personal-language").value || null },
      });
      toast("Changes saved");
    });
  };
  $("#reconnect").onclick = () => connect({ token }, () => personal(token));
  $("#delete-account").onclick = async () => {
    if (
      !(await confirmAction(
        "Delete this account?",
        "Its private links will stop working. This does not delete your Telegram account.",
      ))
    )
      return;
    run($("#delete-account"), async () => {
      await api(`/auth/logout/${encodeURIComponent(token)}`, {
        method: "DELETE",
        token,
      });
      $("#main").innerHTML =
        `<section class="card empty"><h1>${t("Account deleted")}</h1><p>${t("Your connection has been removed.")}</p></section>`;
    });
  };
  const states = {
    folders: { loaded: false, items: [], selected: new Set() },
    channels: { loaded: false, items: [], selected: new Set() },
  };
  $("#save-sources").disabled = true;
  function renderList(type) {
    const state = states[type],
      root = $(`#${type}-list`),
      query =
        type === "channels" ? $("#channel-search").value.toLowerCase() : "";
    const items = state.items.filter(
      (i) =>
        !query ||
        `${i.title} ${i.username || ""}`.toLowerCase().includes(query),
    );
    root.replaceChildren();
    if (!items.length) {
      root.textContent = t("No items found");
      return;
    }
    items.forEach((item) => {
      const label = document.createElement("label");
      label.className = "check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state.selected.has(String(item.id));
      input.onchange = () =>
        input.checked
          ? state.selected.add(String(item.id))
          : state.selected.delete(String(item.id));
      const text = document.createElement("span");
      text.textContent = item.title || String(item.id);
      label.append(input, text);
      root.append(label);
    });
  }
  $("#load-sources").onclick = () =>
    run($("#load-sources"), async () => {
      if (!$("#folders-list"))
        $("#source-lists").innerHTML =
          `<section><h3 class="section-label">${t("Folders")}</h3><div id="folders-list" class="sources"></div></section><section><h3 class="section-label">${t("Channels")}</h3><label class="sr-only" for="channel-search">${t("Search channels")}</label><input id="channel-search" type="search" placeholder="${t("Search channels")}"><div id="channels-list" class="sources"></div></section>`;
      const results = await Promise.allSettled(
        ["folders", "channels"].map((type) => api(`/${type}`, { token })),
      );
      results.forEach((result, i) => {
        const type = i ? "channels" : "folders",
          state = states[type];
        if (result.status === "fulfilled") {
          state.items = result.value[type];
          if (!state.loaded) {
            state.selected = new Set(
              state.items.filter((v) => v.isSelected).map((v) => String(v.id)),
            );
            state.loaded = true;
          }
          renderList(type);
        } else if (!state.loaded)
          $(`#${type}-list`).textContent = t(
            "Could not load this list. Try again.",
          );
      });
      $("#channel-search").oninput = () => renderList("channels");
      $("#save-sources").disabled = !Object.values(states).some(
        (s) => s.loaded,
      );
      $("#sources-status").textContent = t(
        results.every((r) => r.status === "fulfilled")
          ? "Sources loaded"
          : "Could not load this list. Try again.",
      );
    });
  $("#save-sources").onclick = () =>
    run($("#save-sources"), async () => {
      const results = await Promise.allSettled(
        Object.entries(states)
          .filter(([, state]) => state.loaded)
          .map(([type, state]) =>
            api(`/${type}`, {
              method: "POST",
              token,
              body:
                type === "folders"
                  ? { folderIds: [...state.selected].map(Number) }
                  : { channelIds: [...state.selected] },
            }),
          ),
      );
      const failure = results.find((r) => r.status === "rejected");
      if (failure) throw failure.reason;
      toast("Catalogs saved");
    });
}

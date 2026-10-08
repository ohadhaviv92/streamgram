import { t } from "./i18n.js";
import { $, api, button, dialog, errorMessage, run } from "./shared.js";
export function connect(context, onConnected) {
  const d = dialog(
    context.token ? "Reconnect Telegram" : "Connect Telegram",
    `<div class="segmented"><button id="qr-mode" aria-pressed="true">${t("QR code")}</button><button id="phone-mode" aria-pressed="false">${t("Phone code")}</button></div><div id="auth-content"></div>`,
  );
  let expiryTimer,
    timer,
    qrToken,
    attemptId,
    phone,
    generation = 0;
  const clear = () => {
    clearTimeout(timer);
    clearTimeout(expiryTimer);
    generation++;
  };
  d.addEventListener("close", clear);
  const complete = async (data) => {
    if (d.open) d.close();
    // A successful response must deliver the private link even if the dialog closed during verification.
    await onConnected(data.user.token);
  };
  function qr() {
    clear();
    $("#qr-mode", d).setAttribute("aria-pressed", "true");
    $("#phone-mode", d).setAttribute("aria-pressed", "false");
    $("#auth-content", d).innerHTML =
      `<p>${t("Open Telegram → Settings → Devices → Add Device → Scan QR code.")}</p><div id="qr-output"></div>${button("Generate QR code", "generate", "primary")}<p id="qr-status" role="status"></p><form id="qr-password" hidden><div class="field"><label for="q-password">${t("Telegram password")}</label><input id="q-password" type="password" autocomplete="current-password" required></div><button class="primary">${t("Continue")}</button></form>`;
    const regenerate = $("#generate", d);
    regenerate.textContent = t("Regenerate QR code");
    regenerate.hidden = true;
    const statusLine = $("#qr-status", d);
    const expire = () => {
      clearTimeout(timer);
      clearTimeout(expiryTimer);
      statusLine.textContent = t("QR code expired. Generate a new one.");
      statusLine.className = "qr-expired";
      $("#qr-output", d).replaceChildren();
      $("#qr-password", d).hidden = true;
      regenerate.textContent = t("Regenerate QR code");
      regenerate.hidden = false;
    };
    async function generate() {
      clear();
      const epoch = generation;
      regenerate.hidden = true;
      statusLine.className = "";
      statusLine.textContent = t("Loading…");
      $("#qr-output", d).replaceChildren();
      $("#qr-password", d).hidden = true;
      try {
        const data = await api("/auth/qr/generate", { method: "POST", ...context });
        if (!d.open || epoch !== generation) return;
        qrToken = data.qrToken;
        const img = document.createElement("img");
        img.className = "qr";
        img.alt = t("QR code");
        img.src = data.qrCodeImage;
        $("#qr-output", d).replaceChildren(img);
        statusLine.textContent = t("Waiting to scan...");
        expiryTimer = setTimeout(() => {
          if (d.open && epoch === generation) expire();
        }, data.expiresIn * 1000);
        async function poll() {
          if (!d.open || epoch !== generation) return;
          try {
            const status = await api(`/auth/qr/status/${qrToken}`, context);
            if (status.user) {
              await complete(status);
              return;
            }
            if (!d.open || epoch !== generation || !regenerate.hidden) return;
            if (status.passwordRequired) {
              clearTimeout(expiryTimer);
              $("#qr-output", d).replaceChildren();
              $("#qr-password", d).hidden = false;
              $("#q-password", d).focus();
              statusLine.textContent = t("Telegram password");
              return;
            }
            timer = setTimeout(poll, 2000);
          } catch (error) {
            if (!d.open || epoch !== generation || !regenerate.hidden) return;
            if (error.message === "Authentication expired. Start again.") expire();
            else {
              errorMessage(error, $(".dialog-body", d));
              timer = setTimeout(poll, 2000);
            }
          }
        }
        timer = setTimeout(poll, 2000);
      } catch (error) {
        if (!d.open || epoch !== generation) return;
        statusLine.textContent = "";
        errorMessage(error, $(".dialog-body", d));
        regenerate.textContent = t("Retry");
        regenerate.hidden = false;
      }
    }
    regenerate.onclick = generate;
    $("#qr-password", d).onsubmit = (e) => {
      e.preventDefault();
      run(
        $("#qr-password button", d),
        async () => {
          const data = await api(`/auth/qr/status/${qrToken}`, {
            method: "POST",
            body: { password: $("#q-password", d).value },
            ...context,
          });
          if (data.user) await complete(data);
        },
        $(".dialog-body", d),
      );
    };
    void generate();
  }
  function phoneMode() {
    clear();
    $("#qr-mode", d).setAttribute("aria-pressed", "false");
    $("#phone-mode", d).setAttribute("aria-pressed", "true");
    $("#auth-content", d).innerHTML =
      `<form id="send-code"><div class="field"><label for="phone">${t("Phone number (with country code)")}</label><input id="phone" type="tel" dir="ltr" placeholder="${t("+Country code and phone number")}" autocomplete="tel" aria-describedby="phone-help" required><p id="phone-help" class="hint">${t("Use your country code, such as +1, +44 or +91. Spaces, dashes and parentheses are accepted.")}</p></div><button class="primary">${t("Send code")}</button></form><form id="verify-code" hidden><p id="phone-auth-status" role="status"></p><div id="code-field" class="field"><label for="code">${t("Verification code")}</label><input id="code" dir="ltr" inputmode="numeric" autocomplete="one-time-code" required pattern="[0-9]{5}" maxlength="5"></div><div id="password-field" class="field" hidden><label for="password">${t("Telegram password")}</label><input id="password" type="password" autocomplete="current-password" aria-describedby="phone-auth-status"></div><button class="primary">${t("Verify & connect")}</button></form>`;
    $("#send-code", d).onsubmit = (e) => {
      e.preventDefault();
      run(
        $("#send-code button", d),
        async () => {
          const epoch = generation;
          phone = $("#phone", d).value.trim();
          const data = await api("/auth/send-code", {
            method: "POST",
            body: { phone },
            ...context,
          });
          if (!d.open || epoch !== generation) return;
          attemptId = data.attemptId;
          $("#send-code", d).hidden = true;
          $("#verify-code", d).hidden = false;
          $("#phone-auth-status", d).textContent = t(data.message);
          $("#code", d).focus();
        },
        $(".dialog-body", d),
      );
    };
    $("#verify-code", d).onsubmit = (e) => {
      e.preventDefault();
      run(
        $("#verify-code button", d),
        async () => {
          const epoch = generation;
          const data = await api("/auth/verify-code", {
            method: "POST",
            body: {
              phone,
              attemptId,
              code: $("#code", d).value,
              password: $("#password", d).value || undefined,
            },
            ...context,
          });
          if (data.passwordRequired) {
            if (!d.open || epoch !== generation) return;
            $("#code-field", d).hidden = true;
            $("#code", d).required = false;
            $("#password-field", d).hidden = false;
            $("#phone-auth-status", d).textContent = t(data.message);
            $("#password", d).required = true;
            $("#password", d).focus();
          } else await complete(data);
        },
        $(".dialog-body", d),
      );
    };
  }
  $("#qr-mode", d).onclick = qr;
  $("#phone-mode", d).onclick = phoneMode;
  qr();
}

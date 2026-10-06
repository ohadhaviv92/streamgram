import { t } from "./i18n.js";
import { $, esc, icon, pageHead } from "./shared.js";

export const TELEGRAM_API_TUTORIAL_ID = "telegram-api";
export const TMDB_ACCESS_TOKEN_TUTORIAL_ID = "tmdb-access-token";

export function tutorialHref(id) {
  return `#tutorials/${encodeURIComponent(id)}`;
}

const tutorials = [
  {
    id: TELEGRAM_API_TUTORIAL_ID,
    question: "How do I create a Telegram API ID and API hash?",
    content: () => `
      <p>${t("Watch this guide to create the credentials StreamGram needs from Telegram.")}</p>
      <div class="tutorial-video">
        <iframe
          src="https://www.youtube-nocookie.com/embed/8naENmP3rg4"
          title="${esc(t("How do I create a Telegram API ID and API hash?"))}"
          loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        ></iframe>
      </div>
      <section class="tutorial-instructions" aria-labelledby="telegram-api-steps">
        <h3 id="telegram-api-steps">${t("Quick steps")}</h3>
        <ol>
          <li>${t("Sign in to my.telegram.org using your Telegram account.")}</li>
          <li>${t("Open API development tools and create an app if Telegram asks for one.")}</li>
          <li>${t("Copy both values into the Instance credentials section in StreamGram Settings.")}</li>
          <li>${t("Save your settings.")}</li>
        </ol>
      </section>
      <p class="tutorial-links">
        <a href="https://my.telegram.org" target="_blank" rel="noreferrer">${t("Open Telegram API portal")}</a>
        <a href="https://www.youtube.com/watch?v=8naENmP3rg4" target="_blank" rel="noreferrer">${t("Watch on YouTube")}</a>
      </p>
      <p class="tutorial-note"><strong>${t("Keep your API hash private.")}</strong> ${t("Only enter it in your own StreamGram instance.")}</p>
    `,
  },
  {
    id: TMDB_ACCESS_TOKEN_TUTORIAL_ID,
    question: "How do I create a TMDB API Read Access Token?",
    content: () => `
      <p>${t("Watch this guide to get the TMDB API Read Access Token StreamGram needs.")}</p>
      <div class="tutorial-video">
        <iframe
          src="https://www.youtube-nocookie.com/embed/Gf45f5cW6c4"
          title="${esc(t("How do I create a TMDB API Read Access Token?"))}"
          loading="lazy"
          referrerpolicy="strict-origin-when-cross-origin"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowfullscreen
        ></iframe>
      </div>
      <section class="tutorial-instructions" aria-labelledby="tmdb-access-token-steps">
        <h3 id="tmdb-access-token-steps">${t("Quick steps")}</h3>
        <ol>
          <li>${t("Sign in to your TMDB account.")}</li>
          <li>${t("Open Settings → API.")}</li>
          <li>${t("Create or copy the API Read Access Token (v4).")}</li>
          <li>${t("Paste the token into the TMDB bearer token field in StreamGram Settings.")}</li>
        </ol>
      </section>
      <p class="tutorial-links">
        <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer">${t("Open TMDB API settings")}</a>
        <a href="https://www.youtube.com/watch?v=Gf45f5cW6c4" target="_blank" rel="noreferrer">${t("Watch on YouTube")}</a>
      </p>
      <p class="tutorial-note"><strong>${t("Keep your TMDB token private.")}</strong> ${t("Only enter it in your own StreamGram instance.")}</p>
    `,
  },
];

export function renderTutorials(selectedId = "") {
  $("#main").innerHTML =
    pageHead(
      "Tutorials",
      "Step-by-step help for setting up and using StreamGram.",
    ) +
    `<div class="tutorial-list">${tutorials
      .map(
        (tutorial) => `
          <details class="tutorial" id="tutorial-${tutorial.id}" data-tutorial="${tutorial.id}">
            <summary>
              <span>${t(tutorial.question)}</span>
              <span class="tutorial-chevron">${icon("chevron")}</span>
            </summary>
            <div class="tutorial-body">${tutorial.content()}</div>
          </details>`,
      )
      .join("")}</div>`;

  document.querySelectorAll(".tutorial").forEach((tutorial) => {
    tutorial.addEventListener("toggle", () => {
      const href = tutorialHref(tutorial.dataset.tutorial);
      if (tutorial.open) history.replaceState(null, "", href);
      else if (location.hash === href)
        history.replaceState(null, "", "#tutorials");
    });
  });

  const selected = tutorials.find((tutorial) => tutorial.id === selectedId);
  if (!selected) return false;
  const tutorial = $(`#tutorial-${selected.id}`);
  tutorial.open = true;
  requestAnimationFrame(() => {
    tutorial.scrollIntoView({ block: "start" });
    $("summary", tutorial).focus();
  });
  return true;
}

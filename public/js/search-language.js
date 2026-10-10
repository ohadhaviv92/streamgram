import { t } from "./i18n.js";
import { $, esc } from "./shared.js";

const titles = {
  en: "Night of the Living Dead",
  he: "ליל המתים החיים",
  ru: "Ночь живых мертвецов",
  ar: "ليلة الموتى الأحياء",
};

export function bindSearchLanguageExample(fieldId, instanceLanguage = "en") {
  const select = $(`#${fieldId}`);
  const example = $(`#${fieldId}-example`);
  select.onchange = () => {
    const selected = select.value || instanceLanguage;
    const language = Object.hasOwn(titles, selected) ? selected : "en";
    const explanation = language === "en"
      ? "Example: searching in English finds this title:"
      : "Example: searching in the selected language includes both titles:";
    const localized = language === "en" ? "" : ` / <bdi>${esc(titles[language])}</bdi>`;
    example.innerHTML = `${esc(t(explanation))} <bdi>${titles.en}</bdi>${localized} (1968).`;
    example.hidden = false;
  };
}

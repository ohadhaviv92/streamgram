export default () => ({
  telegram: {
    apiId: parseInt(process.env.TELEGRAM_API_ID || "0", 10),
    apiHash: process.env.TELEGRAM_API_HASH || "",
  },
  server: {
    host: "0.0.0.0",
    port: parseInt(process.env.PORT || "3000", 10),
    streamHost: process.env.PUBLIC_URL || process.env.STREAM_HOST || "",
    nodeEnv: process.env.NODE_ENV || "production",
  },
  tmdb: {
    bearerToken: process.env.TMDB_BEARER_TOKEN || "",
    baseUrl: "https://api.themoviedb.org/3",
  },
  wikidata: {
    baseUrl: "https://query.wikidata.org",
    sparqlEndpoint: "/sparql",
  },
  cache: {
    defaultTtl: 3600,
    searchTtl: 1800,
    messageTtl: 7200,
    folderTtl: 60,
    channelVideosTtl: 60,
  },
  language: {
    defaultLanguage: "en",
    preferredLanguage: process.env.PREFERRED_LANGUAGE || "he",
    languages: {
      en: {
        name: "english",
        tmdbCode: "en",
        seasonTerms: { long: ["season"], short: ["s"] },
        episodeTerms: { long: ["episode"], short: ["e"] },
        subtitleIndicators: ["hebsub"],
        dubbedIndicators: ["hebdub"],
        subtitleLabel: "Built-in Subtitles",
        dubbedLabel: "Dubbed",
        howToTagLabel: "How to Tag",
        noLocalizedTitleMessage: "No localized title available",
      },
      he: {
        name: "hebrew",
        tmdbCode: "he",
        seasonTerms: { long: ["עונה"], short: ["ע"] },
        episodeTerms: { long: ["פרק"], short: ["פ"] },
        subtitleIndicators: ["ת.מ", "תרגום מובנה"],
        dubbedIndicators: ["מדובב"],
        subtitleLabel: "תרגום מובנה",
        dubbedLabel: "מדובב",
        howToTagLabel: "איך לתייג",
        noLocalizedTitleMessage: "אין כותרת בעברית",
      },
      ru: {
        name: "russian",
        tmdbCode: "ru",
        seasonTerms: { long: ["сезон"], short: ["с"] },
        episodeTerms: { long: ["серия", "эпизод"], short: ["э"] },
        subtitleIndicators: ["русские субтитры", "субтитры"],
        dubbedIndicators: ["дубляж", "озвучка"],
        subtitleLabel: "Встроенные субтитры",
        dubbedLabel: "Дубляж",
        howToTagLabel: "Как отметить",
        noLocalizedTitleMessage: "Нет локализованного названия",
      },
      ar: {
        name: "arabic",
        tmdbCode: "ar",
        seasonTerms: { long: ["الموسم"], short: ["م"] },
        episodeTerms: { long: ["الحلقة"], short: ["ح"] },
        subtitleIndicators: ["ترجمة", "ترجمة مدمجة"],
        dubbedIndicators: ["مدبلج"],
        subtitleLabel: "ترجمة مدمجة",
        dubbedLabel: "مدبلج",
        howToTagLabel: "كيفية الوسم",
        noLocalizedTitleMessage: "لا يوجد عنوان محلي",
      },
    },
  },
  searchResults: {
    movie: {
      totalResults: 10,
    },
    series: {
      totalResults: 20,
    },
  },
  search: {
    globalSearchLimit: 150,
  },
  streaming: {
    maxRequestSize: 1024 * 1024, // 1MB
  },
});

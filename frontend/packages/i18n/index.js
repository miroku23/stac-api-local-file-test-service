import en from "./messages/en.json" with { type: "json" };
import ko from "./messages/ko.json" with { type: "json" };
import primevueEn from "./primevue/en.json" with { type: "json" };
import primevueKo from "./primevue/ko.json" with { type: "json" };

export const messages = { en, ko };
export const primevueLocales = { en: primevueEn, ko: primevueKo };
export const defaultLocale = "en";
export const supportedLocales = ["en", "ko"];

export function resolveLocale(locale = globalThis.navigator?.language || "") {
  const normalized = String(locale).toLowerCase();
  return normalized.startsWith("ko") ? "ko" : defaultLocale;
}

export function getMessages(locale) {
  return messages[locale] || messages[defaultLocale];
}

export function getPrimevueLocale(locale) {
  return primevueLocales[locale] || primevueLocales[defaultLocale];
}

export function parseProperties(source) {
  return String(source || "")
    .split(/\r?\n/)
    .reduce((properties, line) => {
      const text = line.trim();
      if (!text || text.startsWith("#") || text.startsWith("!")) return properties;

      const separatorIndex = text.search(/[:=]/);
      if (separatorIndex < 0) {
        properties[text] = "";
        return properties;
      }

      const key = text.slice(0, separatorIndex).trim();
      const value = text.slice(separatorIndex + 1).trim();
      if (key) properties[key] = value;
      return properties;
    }, {});
}

export function formatMessage(value, options = {}) {
  const text = String(value ?? "");
  switch (options.case) {
    case "upper":
      return text.toLocaleUpperCase(options.locale);
    case "lower":
      return text.toLocaleLowerCase(options.locale);
    case "capitalize":
      return text ? `${text[0].toLocaleUpperCase(options.locale)}${text.slice(1)}` : text;
    default:
      return text;
  }
}

export function getMessage(codes, code, options) {
  return formatMessage(codes?.[code] ?? code, options);
}

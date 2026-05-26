import ko from "./ko";
import en from "./en";

export const messages = { ko, en };

export const languageOptions = [
  { label: "한국어", value: "ko" },
  { label: "English", value: "en" }
];

export function resolveBrowserLanguage(locale = globalThis.navigator?.language || "") {
  return String(locale).toLowerCase().startsWith("ko") ? "ko" : "en";
}

export function getMessages(language) {
  return messages[language] || messages.en;
}

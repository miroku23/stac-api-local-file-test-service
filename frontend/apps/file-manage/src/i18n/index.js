import ko from "./ko";
import en from "./en";
import enProperties from "@repo/i18n/messages/en.properties?raw";
import koProperties from "@repo/i18n/messages/ko.properties?raw";
import { getMessage, parseProperties } from "@repo/i18n";

export { getMessage };

export const messages = { ko, en };
export const messageCodes = {
  ko: parseProperties(koProperties),
  en: parseProperties(enProperties)
};

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

export function getMessageCodes(language) {
  return messageCodes[language] || messageCodes.en;
}

export function getMessageCode(language, code, options) {
  return getMessage(getMessageCodes(language), code, options);
}

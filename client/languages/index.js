import { mandarinLanguage } from './mandarin.js';
import { macedonianLanguage } from './macedonian.js';

const REGISTRY = {
  [mandarinLanguage.id]: mandarinLanguage,
  [macedonianLanguage.id]: macedonianLanguage
};

export const DEFAULT_LANGUAGE_ID = mandarinLanguage.id;

export const LANGUAGE_OPTIONS = Object.values(REGISTRY).map((language) => ({
  id: language.id,
  label: language.label
}));

export function getLanguageConfig(languageId) {
  if (languageId && REGISTRY[languageId]) {
    return REGISTRY[languageId];
  }
  return REGISTRY[DEFAULT_LANGUAGE_ID];
}

export function listLanguages() {
  return Object.values(REGISTRY);
}


const { resolveGlossesLocally } = require('../services/glossary');

const DEFAULT_LANGUAGE_ID = 'zh';

const LANGUAGE_SPECS = {
  zh: {
    id: 'zh',
    label: 'Mandarin Chinese',
    romanizationLabel: 'Pinyin',
    card: {
      sentenceLengthLimit: 30,
      romanizationNote: 'Provide the target word in standard Hanyu Pinyin with tone marks.',
      scriptDescriptor: 'Chinese characters'
    },
    reading: {
      descriptor: 'Mandarin reading passages'
    },
    gloss: {
      romanizationDescriptor: 'pinyin with tone marks'
    },
    resolveGlossesLocally
  },
  mk: {
    id: 'mk',
    label: 'Macedonian',
    romanizationLabel: 'Latin transliteration',
    card: {
      sentenceLengthLimit: 160,
      romanizationNote:
        'Provide the target word transliterated into the Latin alphabet using standard Macedonian conventions.',
      scriptDescriptor: 'Macedonian Cyrillic'
    },
    reading: {
      descriptor: 'Macedonian reading passages'
    },
    gloss: {
      romanizationDescriptor: 'Latin transliteration'
    },
    resolveGlossesLocally: null
  }
};

function getLanguageSpec(languageId) {
  if (languageId && LANGUAGE_SPECS[languageId]) {
    return LANGUAGE_SPECS[languageId];
  }
  return LANGUAGE_SPECS[DEFAULT_LANGUAGE_ID];
}

module.exports = {
  DEFAULT_LANGUAGE_ID,
  LANGUAGE_SPECS,
  getLanguageSpec
};

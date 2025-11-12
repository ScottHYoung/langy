import { initializeCalibration } from './calibration.js';

export async function fetchFrequencyCorpus(language) {
  const corpusConfig = language?.corpus || {};
  const path = corpusConfig.path || 'corpus/subtlex_word_frequency.txt';
  const format = corpusConfig.format || 'tsv';
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  if (format === 'mk-json') {
    const payload = await response.json();
    const results = Array.isArray(payload?.results) ? payload.results : [];
    return results
      .map((entry) => {
        const lemma = entry?.lemma || entry?.word || '';
        const frequency = Number.parseInt(entry?.total_frequency ?? entry?.frequency ?? 0, 10);
        if (!lemma || !Number.isFinite(frequency) || frequency <= 0) return null;
        return {
          word: lemma,
          frequency,
          forms: Array.isArray(entry?.forms) ? entry.forms : []
        };
      })
      .filter(Boolean);
  }
  const raw = await response.text();
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return null;
      const parts = trimmed.split(/\s+/);
      const word = parts[0];
      const freqStr = parts[1];
      if (!word || !freqStr) return null;
      const frequency = Number.parseInt(freqStr, 10);
      if (!Number.isFinite(frequency) || frequency <= 0) return null;
      return { word, frequency };
    })
    .filter(Boolean)
    .slice(0, 120000);
}

export function initializeLexicon(state, entries) {
  if (!entries?.length) return;
  state.lexicon = entries;
  state.frequencyMap = {};
  state.frequencyProbabilityMap = {};
  let totalFrequency = 0;
  state.lexicon.forEach(({ word, frequency }) => {
    const safeFrequency = Number.isFinite(frequency) && frequency > 0 ? frequency : 0;
    state.frequencyMap[word] = safeFrequency;
    totalFrequency += safeFrequency;
  });
  state.lexiconIndexByWord = {};
  state.lexicon.forEach((entry, index) => {
    if (entry?.word) {
      state.lexiconIndexByWord[entry.word] = index;
    }
  });
  state.totalCorpusFrequency = Math.max(totalFrequency, 1);
  Object.entries(state.frequencyMap).forEach(([word, frequency]) => {
    state.frequencyProbabilityMap[word] = frequency / state.totalCorpusFrequency;
  });
  initializeCalibration(state);
}

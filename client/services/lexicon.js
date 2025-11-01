import { initializeCalibration } from './calibration.js';

export async function fetchFrequencyCorpus() {
  const response = await fetch('corpus/subtlex_word_frequency.txt');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const raw = await response.text();
  return raw
    .split(/\r?\n/)
    .map((line) => {
      const [word, freqStr] = line.trim().split(/\s+/);
      if (!word || !freqStr) return null;
      const frequency = Number.parseInt(freqStr, 10);
      if (!Number.isFinite(frequency) || frequency <= 0) return null;
      return { word, frequency };
    })
    .filter(Boolean)
    .slice(0, 100000);
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
  state.totalCorpusFrequency = Math.max(totalFrequency, 1);
  Object.entries(state.frequencyMap).forEach(([word, frequency]) => {
    state.frequencyProbabilityMap[word] = frequency / state.totalCorpusFrequency;
  });
  initializeCalibration(state);
}

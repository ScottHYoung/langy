import { createInitialState } from './state/sessionState.js';
import { seedCards, focusMetaMap } from './data/seedCards.js';
import {
  formatPercent,
  formatDelta,
  formatTokens,
  formatStd,
  clampProbability
} from './utils/formatters.js';
import { highlightFocus as highlightFocusText } from './utils/text.js';
import { fetchFrequencyCorpus, initializeLexicon } from './services/lexicon.js';
import { generateCard } from './services/api.js';
import { consumeCalibrationIndex, handleCalibrationResponse } from './services/calibration.js';
import {
  wordProbability as computeWordProbability,
  applyLevelUpdate
} from './services/levelEstimator.js';

export function createLangyApp() {
  return {
    data() {
      return createInitialState();
    },
    mounted() {
      this.loadLexicon();
    },
    computed: {
      currentCard() {
        return this.activeCard;
      },
      responseButtons() {
        return [
          {
            type: 'sentence',
            label: 'Fully understood.',
            classes:
              'h-14 rounded-2xl border border-emerald-400/60 bg-emerald-50 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100 hover:border-emerald-500'
          },
          {
            type: 'focus',
            label: 'Focus word understood.',
            classes:
              'h-14 rounded-2xl border border-sky-400/60 bg-sky-50 text-sm font-medium text-sky-700 transition hover:bg-sky-100 hover:border-sky-500'
          },
          {
            type: 'unknown',
            label: 'I do not know the focus word.',
            classes:
              'h-14 rounded-2xl border border-rose-400/60 bg-rose-50 text-sm font-medium text-rose-700 transition hover:bg-rose-100 hover:border-rose-500'
          }
        ];
      },
      levelTokensMean() {
        return Math.exp(this.logExposureMean);
      },
      levelStdLog() {
        return Math.sqrt(Math.max(this.logExposureVar, 0));
      },
      calibrationStatusLabel() {
        if (this.calibrationActive) {
          const remaining = Math.max(this.calibrationSamplesTarget - this.calibrationResponses.length, 0);
          return `Calibrating (${remaining} left)`;
        }
        return 'Ready';
      },
      calibrationBadgeClasses() {
        return this.calibrationActive
          ? 'bg-amber-100 text-amber-700 border border-amber-200'
          : 'bg-emerald-100 text-emerald-700 border border-emerald-200';
      },
      levelPreviewRows() {
        if (!this.lexicon.length) return [];
        const bands = [
          { label: 'Top 5%', rank: 0.05 },
          { label: 'Top 25%', rank: 0.25 },
          { label: 'Median', rank: 0.5 },
          { label: 'Lower 25%', rank: 0.75 }
        ];
        const lastIndex = this.lexicon.length - 1;
        return bands
          .map((band) => {
            const idx = Math.min(lastIndex, Math.round(band.rank * lastIndex));
            const entry = this.lexicon[idx];
            if (!entry) return null;
            return {
              label: band.label,
              word: entry.word,
              probability: this.wordProbability(entry.word)
            };
          })
          .filter(Boolean);
      }
    },
    methods: {
      formatPercent,
      formatDelta,
      formatTokens,
      formatStd,
      async loadLexicon() {
        try {
          const entries = await fetchFrequencyCorpus();
          if (entries.length) {
            initializeLexicon(this, entries);
            await this.loadNextCard({});
            return;
          }
        } catch (error) {
          console.warn('Unable to load sampled corpus; falling back to focus list.', error);
        }
        if (!this.lexicon.length) {
          const fallbackEntries = Array.from(
            new Set(seedCards.map((card) => card.focus.hanzi))
          ).map((word) => ({
            word,
            frequency: 1
          }));
          initializeLexicon(this, fallbackEntries);
          await this.loadNextCard({});
        }
      },
      async loadNextCard({ advance = false, resetIndex = false, targetIndex = null } = {}) {
        if (!this.lexicon.length || this.isLoadingCard) return;
        const maxIndex = this.lexicon.length - 1;
        if (this.calibrationActive) {
          const calibrationIndex = consumeCalibrationIndex(this);
          if (calibrationIndex != null) {
            this.currentIndex = calibrationIndex;
          } else {
            this.currentIndex = this.findIndexClosestToProbability(0.5);
          }
        } else if (targetIndex != null) {
          const clamped = Math.max(0, Math.min(maxIndex, targetIndex));
          this.currentIndex = clamped;
        } else if (resetIndex) {
          this.currentIndex = 0;
        } else if (advance) {
          this.currentIndex = Math.min(maxIndex, this.currentIndex + 1);
        } else if (this.currentIndex > maxIndex) {
          this.currentIndex = maxIndex;
        }
        const entry = this.lexicon[this.currentIndex];
        if (!entry) return;
        await this.fetchCardForWord(entry.word);
      },
      async fetchCardForWord(word) {
        if (!word) return;
        this.isLoadingCard = true;
        this.errorMessage = '';
        try {
          const completion = await generateCard(word);
          const meta = focusMetaMap[word] || {};
          this.activeCard = {
            sentence: {
              text: completion.sentence,
              focus: word
            },
            sentenceTranslation: completion.sentence_translation,
            wordTranslation: completion.word_translation,
            focus: {
              hanzi: word,
              pinyin: completion.word_pinyin || meta.pinyin || '',
              literal: meta.literal || '',
              definition: completion.definition || meta.definition || '',
              usage: completion.usage_hint || ''
            }
          };
        } catch (error) {
          this.errorMessage = error.message || 'Unable to load sentence.';
          this.activeCard = null;
        } finally {
          this.isLoadingCard = false;
          this.isFlipped = false;
        }
      },
      async recordResponse(type) {
        if (this.isLoadingCard || !this.currentCard) return;
        if (!this.responseOptions.includes(type)) return;
        const currentWord = this.currentCard?.focus?.hanzi;
        const freqProbability = currentWord ? this.frequencyProbabilityMap[currentWord] ?? 0 : 0;
        const isKnown = type === 'sentence' || type === 'focus';

        if (this.calibrationActive) {
          if (currentWord && freqProbability > 0) {
            const result = handleCalibrationResponse(this, {
              word: currentWord,
              freqProbability,
              outcome: isKnown
            });
            if (result && result.fit) {
              this.recordCalibrationSummary(result.fit, result.priorMean);
            }
          }
          if (this.calibrationActive) {
            await this.loadNextCard({});
          } else {
            const nextIndex = this.selectNextIndex();
            await this.loadNextCard({ targetIndex: nextIndex });
          }
          return;
        }

        if (currentWord && freqProbability > 0) {
          this.totalResponses += 1;
          const update = applyLevelUpdate(this, currentWord, freqProbability, isKnown);
          this.recordLevelUpdate({
            word: currentWord,
            correct: isKnown,
            probability: update.priorProbability,
            priorMean: update.priorMean,
            priorVar: update.priorVar,
            posteriorMean: update.posteriorMean,
            posteriorVar: update.posteriorVar
          });
        }
        const nextIndex = this.selectNextIndex();
        await this.loadNextCard({ targetIndex: nextIndex });
      },
      async advanceCard() {
        if (!this.lexicon.length) return;
        if (this.calibrationActive) {
          await this.loadNextCard({});
        } else {
          const nextIndex = this.selectNextIndex();
          await this.loadNextCard({ targetIndex: nextIndex });
        }
      },
      highlightFocus(sentence) {
        return highlightFocusText(sentence);
      },
      revealCard() {
        if (this.isFlipped || this.isLoadingCard || !this.currentCard) return;
        this.errorMessage = '';
        this.isFlipped = true;
      },
      wordProbability(word) {
        return computeWordProbability(this, word);
      },
      selectNextIndex() {
        if (!this.lexicon.length) return this.currentIndex || 0;
        if (this.calibrationActive) {
          return this.findIndexClosestToProbability(0.5);
        }
        const target = this.targetSuccessRate;
        const center = this.findIndexClosestToProbability(target);
        const windowSize = Math.max(20, this.targetWindowSize);
        const maxIndex = this.lexicon.length - 1;
        const halfWindow = Math.floor(windowSize / 2);
        let start = Math.max(0, center - halfWindow);
        let end = Math.min(maxIndex, start + windowSize - 1);
        start = Math.max(0, end - windowSize + 1);
        const candidates = [];
        for (let idx = start; idx <= end; idx++) {
          const entry = this.lexicon[idx];
          if (!entry) continue;
          const probability = this.wordProbability(entry.word);
          candidates.push({
            idx,
            score: Math.abs(probability - target)
          });
        }
        if (!candidates.length) {
          return center;
        }
        candidates.sort((a, b) => a.score - b.score);
        const topSlice = candidates.slice(0, Math.min(5, candidates.length));
        const pick = topSlice[Math.floor(Math.random() * topSlice.length)] ?? topSlice[0];
        return pick?.idx ?? center;
      },
      findIndexClosestToProbability(target) {
        if (!this.lexicon.length) return 0;
        let low = 0;
        let high = this.lexicon.length - 1;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const entry = this.lexicon[mid];
          const probability = entry ? this.wordProbability(entry.word) : 0;
          if (probability > target) {
            low = mid + 1;
          } else {
            high = mid - 1;
          }
        }
        const candidates = [low, high];
        let bestIndex = 0;
        let bestScore = Infinity;
        for (const candidate of candidates) {
          const idx = Math.max(0, Math.min(this.lexicon.length - 1, candidate));
          const entry = this.lexicon[idx];
          if (!entry) continue;
          const probability = this.wordProbability(entry.word);
          const score = Math.abs(probability - target);
          if (score < bestScore) {
            bestScore = score;
            bestIndex = idx;
          }
        }
        return bestIndex;
      },
      recordLevelUpdate({ word, correct, probability, priorMean, posteriorMean, posteriorVar }) {
        const entry = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          word,
          correct,
          probability: clampProbability(probability),
          deltaMean: posteriorMean - priorMean,
          stdAfter: Math.sqrt(Math.max(posteriorVar, 0)),
          timestampLabel: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        this.recentLevelUpdates.unshift(entry);
        if (this.recentLevelUpdates.length > this.maxRecentLevelUpdates) {
          this.recentLevelUpdates.length = this.maxRecentLevelUpdates;
        }
      },
      recordCalibrationSummary(fit, priorMean) {
        const entry = {
          id: `calibration-${Date.now()}`,
          word: 'Calibration',
          correct: true,
          probability: 1,
          deltaMean: fit.mean - (priorMean ?? fit.mean),
          stdAfter: Math.sqrt(Math.max(fit.variance, 0)),
          timestampLabel: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        this.recentLevelUpdates.unshift(entry);
        if (this.recentLevelUpdates.length > this.maxRecentLevelUpdates) {
          this.recentLevelUpdates.length = this.maxRecentLevelUpdates;
        }
      }
    }
  };
}

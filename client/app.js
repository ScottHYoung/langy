import { createInitialState, READING_TOPIC_LIBRARY } from './state/sessionState.js';
import { seedCards, focusMetaMap } from './data/seedCards.js';
import {
  formatPercent,
  formatDelta,
  formatTokens,
  formatStd,
  clampProbability
} from './utils/formatters.js';
import { highlightFocus as highlightFocusText } from './utils/text.js';
import { segmentChineseText } from './utils/segmentation.js';
import { fetchFrequencyCorpus, initializeLexicon } from './services/lexicon.js';
import { generateCard, requestReadGlosses, requestReadingPassage } from './services/api.js';
import { requestSentenceAudio } from './services/audio.js';
import { initializeCalibration, consumeCalibrationIndex, handleCalibrationResponse } from './services/calibration.js';
import {
  wordProbability as computeWordProbability,
  applyLevelUpdate
} from './services/levelEstimator.js';
import {
  ensureLevelProfile,
  getLevelProfile,
  markProfileCalibrated,
  isLevelProfileCalibrated,
  setLevelProfileStats,
  clearProfileCalibration,
  createProfileTemplate,
  DEFAULT_LOG_EXPOSURE,
  DEFAULT_LOG_VARIANCE
} from './utils/profile.js';

export function createLangyApp() {
  return {
    data() {
      return createInitialState();
    },
    beforeUnmount() {
      this.disposeAudioResources();
      if (this._glossRequestTimer) {
        window.clearTimeout(this._glossRequestTimer);
        this._glossRequestTimer = null;
      }
      if (this._glossRequestQueue) {
        this._glossRequestQueue.clear();
      }
    },
    mounted() {
      this.restorePreferences();
    },
    computed: {
      currentCard() {
        return this.activeCard;
      },
      isListeningCard() {
        return this.currentCardMode === 'listening';
      },
      readingProfile() {
        return getLevelProfile(this, 'reading');
      },
      listeningProfile() {
        return getLevelProfile(this, 'listening');
      },
      isReadingCalibrated() {
        return isLevelProfileCalibrated(this, 'reading');
      },
      isListeningCalibrated() {
        return isLevelProfileCalibrated(this, 'listening');
      },
      showListeningPrompt() {
        return (
          this.appMode === 'listen' ||
          this.isListeningCard ||
          (this.calibrationActive && this.activeCalibrationMode === 'listening')
        );
      },
      currentModeTitle() {
        const titles = {
          read: 'Reading',
          listen: 'Listening',
          study: 'Study'
        };
        return titles[this.appMode] || '';
      },
      modeEntries() {
        const readingReady = this.isReadingCalibrated;
        const listeningReady = this.isListeningCalibrated;
        const studyReady = this.isStudyCalibrated;
        return [
          {
            id: 'read',
            label: 'Read',
            ready: readingReady,
            description: 'Transcript-first probes to check recognition and expand your comfort zone.',
            calibrationCopy: readingReady
              ? 'Jump straight in with tailored sentences.'
              : 'We’ll run a quick reading calibration before you start.'
          },
          {
            id: 'listen',
            label: 'Listen',
            ready: listeningReady && readingReady,
            description: 'Audio-first cards to tune your ear and reinforce sound-to-meaning links.',
            calibrationCopy: listeningReady
              ? 'Audio drills are ready to go.'
              : readingReady
              ? 'We’ll calibrate listening before you begin.'
              : 'Reading calibration runs first, then listening.'
          },
          {
            id: 'study',
            label: 'Study',
            ready: studyReady,
            description: 'Blends reading and listening with adaptive spacing for long-term retention.',
            calibrationCopy: studyReady
              ? 'You’re synced—continue where you left off.'
              : this.studyMode === 'listening'
              ? 'Reading calibrates first, then listening to unlock mixed drills.'
              : 'We’ll calibrate reading, then optional listening when you add audio.'
          }
        ];
      },
      studyModeLabel() {
        return this.studyMode === 'listening' ? 'Listening + Reading' : 'Reading Only';
      },
      studyModeToggleLabel() {
        return this.studyMode === 'listening' ? 'Switch to Reading Only' : 'Switch to Listening + Reading';
      },
      isStudyReady() {
        if (!this.isAuthenticated || this.calibrationActive || this.appMode !== 'study') {
          return false;
        }
        if (!this.isReadingCalibrated) return false;
        if (this.studyMode === 'listening' && !this.isListeningCalibrated) {
          return false;
        }
        return true;
      },
      isStudyCalibrated() {
        if (!this.isReadingCalibrated) return false;
        if (this.studyMode === 'listening' && !this.isListeningCalibrated) {
          return false;
        }
        return true;
      },
      isModeReady() {
        if (!this.appMode) return false;
        if (this.calibrationActive) return false;
        if (this.appMode === 'read') {
          return this.isReadingCalibrated;
        }
        if (this.appMode === 'listen') {
          return this.isListeningCalibrated && this.isReadingCalibrated;
        }
        return this.isStudyReady;
      },
      calibrationRequiredForCurrentMode() {
        if (!this.appMode) return false;
        if (!this.isAuthenticated) return false;
        if (this.calibrationActive) return true;
        const required = this.requiredCalibrationModesForMode(this.appMode);
        return required.length > 0;
      },
      nextCalibrationModeLabel() {
        if (this.calibrationActive && this.activeCalibrationMode) {
          return this.activeCalibrationMode;
        }
        const required = this.requiredCalibrationModesForMode(this.appMode);
        if (required.length) return required[0];
        return this.primaryCalibrationMode;
      },
      nextCalibrationModeTitle() {
        const labels = {
          reading: 'Reading',
          listening: 'Listening'
        };
        return labels[this.nextCalibrationModeLabel] || 'Reading';
      },
      primaryCalibrationMode() {
        if (this.calibrationActive && this.activeCalibrationMode) {
          return this.activeCalibrationMode;
        }
        if (this.appMode === 'listen') return 'listening';
        if (this.appMode === 'read') return 'reading';
        if (this.appMode === 'study' && this.studyMode === 'listening') {
          return this.isListeningCalibrated ? 'listening' : 'reading';
        }
        return 'reading';
      },
      primaryCalibrationTitle() {
        const labels = {
          reading: 'Reading',
          listening: 'Listening'
        };
        return labels[this.primaryCalibrationMode] || 'Reading';
      },
      responseButtons() {
        return [
          {
            type: 'easy',
            label: 'Easy',
            classes:
              'h-14 rounded-2xl border border-emerald-400/70 bg-emerald-50 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 hover:border-emerald-500'
          },
          {
            type: 'hard',
            label: 'Hard',
            classes:
              'h-14 rounded-2xl border border-amber-400/70 bg-amber-50 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 hover:border-amber-500'
          },
          {
            type: 'incorrect',
            label: 'Incorrect',
            classes:
              'h-14 rounded-2xl border border-rose-400/70 bg-rose-50 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 hover:border-rose-500'
          }
        ];
      },
      studyCardStatusLabel() {
        if (this.appMode !== 'study' || this.calibrationActive) return '';
        if (!this.currentStudyCard) return '';
        if (this.currentStudyCard.label) return this.currentStudyCard.label;
        if (this.currentStudyCard.source === 'review') return 'Review';
        if (this.currentStudyCard.source === 'new') return 'New Word';
        return '';
      },
      studyCardStatusDetail() {
        if (this.appMode !== 'study' || this.calibrationActive) return '';
        if (!this.currentStudyCard) return '';
        return this.currentStudyCard.detail || '';
      },
      studyCardStatusClasses() {
        if (this.appMode !== 'study' || this.calibrationActive) return '';
        const tone = this.currentStudyCard?.tone;
        if (tone === 'review-due') {
          return 'border-rose-200 bg-rose-50 text-rose-700';
        }
        if (tone === 'review-upcoming') {
          return 'border-amber-200 bg-amber-50 text-amber-700';
        }
        return 'border-sky-200 bg-sky-50 text-sky-700';
      },
      studyReviewQueue() {
        if (this.appMode !== 'study') return [];
        this.ensureStudyStructures();
        const now = Date.now();
        const entries = [];
        ['reading', 'listening'].forEach((mode) => {
          const base = this.studyKnowledgeBase?.[mode];
          if (!base) return;
          Object.keys(base).forEach((word) => {
            if (!word) return;
            const entry = base[word];
            if (!entry) return;
            const dueAt =
              typeof entry.dueAt === 'number' && Number.isFinite(entry.dueAt) ? entry.dueAt : now;
            const intervalMinutes =
              typeof entry.intervalMinutes === 'number' && Number.isFinite(entry.intervalMinutes)
                ? entry.intervalMinutes
                : 0;
            entries.push({
              key: `${mode}:${word}`,
              word,
              mode,
              dueAt,
              intervalMinutes
            });
          });
        });
        entries.sort((a, b) => (a.dueAt ?? now) - (b.dueAt ?? now));
        const limit = 8;
        return entries.slice(0, limit).map((item) => {
          const minutesUntil = Math.round(((item.dueAt ?? now) - now) / 60000);
          const overdue = minutesUntil <= 0;
          const absMinutes = Math.abs(minutesUntil);
          let statusLabel = '';
          if (overdue) {
            statusLabel = absMinutes ? `${absMinutes}m overdue` : 'Due now';
          } else if (absMinutes < 60) {
            statusLabel = `Due in ${Math.max(1, absMinutes)}m`;
          } else if (absMinutes < 1440) {
            statusLabel = `Due in ${Math.round(absMinutes / 60)}h`;
          } else {
            statusLabel = `Due in ${Math.round(absMinutes / 1440)}d`;
          }
          let intervalLabel = '—';
          if (item.intervalMinutes >= 1440) {
            intervalLabel = `${Math.round(item.intervalMinutes / 1440)}d`;
          } else if (item.intervalMinutes >= 60) {
            intervalLabel = `${Math.round(item.intervalMinutes / 60)}h`;
          } else {
            intervalLabel = `${Math.max(1, Math.round(item.intervalMinutes || 0))}m`;
          }
          return {
            ...item,
            statusLabel,
            intervalLabel,
            overdue,
            toneClass: item.mode === 'listening' ? 'text-sky-600' : 'text-emerald-600',
            modeLabel: item.mode === 'listening' ? 'Listening' : 'Reading'
          };
        });
      },
      studyReviewQueueSummary() {
        if (this.appMode !== 'study') return 'Queue unavailable';
        const queue = this.studyReviewQueue;
        if (!queue.length) {
          return 'Queue empty';
        }
        const dueCount = queue.filter((item) => item.overdue).length;
        if (dueCount > 0) {
          return `${dueCount} due now`;
        }
        return `${queue.length} upcoming`;
      },
      levelTokensMean() {
        return Math.exp(this.logExposureMean);
      },
      levelStdLog() {
        return Math.sqrt(Math.max(this.logExposureVar, 0));
      },
      calibrationStatusLabel() {
        if (this.calibrationActive) {
          const step = (this.calibrationStepCount ?? 0) + 1;
          const std = this.calibrationPosteriorStdLog10;
          if (Number.isFinite(std) && std > 0) {
            const factor = Math.pow(10, std).toFixed(2);
            return `Calibrating (±${factor}×, step ${step})`;
          }
          return `Calibrating (step ${step})`;
        }
        return 'Ready';
      },
      calibrationBadgeClasses() {
        return this.calibrationActive
          ? 'bg-amber-100 text-amber-700 border border-amber-200'
          : 'bg-emerald-100 text-emerald-700 border border-emerald-200';
      },
      calibrationProgress() {
        if (!this.lexicon.length) return null;
        const total = this.lexicon.length;
        const clampIndex = (value, fallback) => {
          if (!Number.isFinite(value)) return fallback;
          return Math.max(0, Math.min(total - 1, Math.round(value)));
        };
        const totalRange = Math.max(total - 1, 1);
        const medianIndex = clampIndex(this.calibrationMedianIndex, 0);
        let lowerIndex = clampIndex(this.calibrationCredibleLowerIndex, 0);
        let upperIndex = clampIndex(this.calibrationCredibleUpperIndex, total - 1);
        if (lowerIndex > upperIndex) {
          const swap = lowerIndex;
          lowerIndex = upperIndex;
          upperIndex = swap;
        }
        const toPercent = (index) => (index / totalRange) * 100;
        const stdLog10 = this.calibrationPosteriorStdLog10;
        const lowerPercent = toPercent(lowerIndex);
        const upperPercent = toPercent(upperIndex);
        const intervalPercent = Math.min(Math.max(upperPercent - lowerPercent, 0), 100);
        const intervalWidthPercent = Math.min(intervalPercent, Math.max(100 - lowerPercent, 0));
        return {
          active: this.calibrationActive,
          total,
          medianIndex,
          lowerIndex,
          upperIndex,
          medianWord: this.lexicon[medianIndex]?.word ?? null,
          lowerWord: this.lexicon[lowerIndex]?.word ?? null,
          upperWord: this.lexicon[upperIndex]?.word ?? null,
          medianPercent: toPercent(medianIndex),
          lowerPercent,
          upperPercent,
          intervalPercent,
          intervalWidthPercent,
          stdLog10,
          spreadFactor: Number.isFinite(stdLog10) ? Math.pow(10, stdLog10) : null,
          stepCount: this.calibrationStepCount ?? 0,
          maxSteps: this.calibrationMaxSteps ?? this.calibrationSamplesTarget ?? 12,
          stepPercent: Math.min(
            100,
            ((this.calibrationStepCount ?? 0) /
              Math.max(1, this.calibrationMaxSteps ?? this.calibrationSamplesTarget ?? 12)) * 100
          )
        };
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
      },
      lexiconWordSet() {
        const set = new Set();
        if (Array.isArray(this.lexicon)) {
          this.lexicon.forEach((entry) => {
            if (entry?.word) {
              set.add(entry.word);
            }
          });
        }
        if (typeof window !== 'undefined' && window.__LANGY_LEXICON_META__) {
          Object.keys(window.__LANGY_LEXICON_META__).forEach((word) => {
            if (word) {
              set.add(word);
            }
          });
        }
        return set;
      },
      readingSegmentsAvailable() {
        return Array.isArray(this.readingSegments) && this.readingSegments.length > 0;
      },
      readingParagraphs() {
        if (!this.readingSegmentsAvailable) return [];
        const paragraphs = [];
        let current = [];
        let paragraphIndex = 0;
        this.readingSegments.forEach((segment) => {
          if (segment.isNewline) {
            if (current.length) {
              paragraphs.push({
                id: `paragraph-${paragraphIndex}`,
                index: paragraphIndex,
                segments: current
              });
              paragraphIndex += 1;
              current = [];
            }
            return;
          }
          current.push(segment);
        });
        if (current.length) {
          paragraphs.push({
            id: `paragraph-${paragraphIndex}`,
            index: paragraphIndex,
            segments: current
          });
        }
        return paragraphs;
      },
      readingPassageAvailable() {
        return Boolean(this.readingGeneration?.passageText);
      },
      readingDifficultyTargetPercent() {
        return Math.round((this.readingGeneration?.difficultyTarget || 0.92) * 100);
      },
      readingDebugSteps() {
        return Array.isArray(this.readingGeneration?.debugSteps)
          ? this.readingGeneration.debugSteps
          : [];
      }
    },
    methods: {
      selectMode(mode) {
        if (!mode) return;
        this.setAppMode(mode);
      },
      segmentReadText(text, options = {}) {
        const dictionary = this.lexiconWordSet;
        const result = segmentChineseText(text, {
          dictionary,
          frequencyMap: this.frequencyMap || {},
          maxWordLength:
            typeof options.maxWordLength === 'number' ? options.maxWordLength : undefined,
          preferJieba: options.preferJieba
        });
        return result;
      },
      async generateReadingPassage(options = {}) {
        if (this.readingGeneration.isGenerating) {
          return;
        }
        this.readingProcessing = true;
        this.readingErrorMessage = '';
        this.resetReadingAnalysis();
        try {
          if (!this.lexiconLoaded) {
            await this.loadLexicon();
          }
          const lifetimeTokens = Math.exp(this.logExposureMean ?? DEFAULT_LOG_EXPOSURE);
          const providedTopic =
            typeof options.topic === 'string'
              ? options.topic
              : this.readingGeneration?.topic || '';
          const topicInput = typeof providedTopic === 'string' && providedTopic.trim()
            ? providedTopic.trim()
            : '';
          const topic = topicInput || this.pickRandomReadingTopic();
          const difficultyTarget =
            typeof options.difficulty === 'number'
              ? options.difficulty
              : this.readingGeneration.difficultyTarget;
          const paragraphCount =
            typeof options.paragraphCount === 'number'
              ? options.paragraphCount
              : this.readingGeneration.paragraphCount;

          Object.assign(this.readingGeneration, {
            topic: topicInput,
            difficultyTarget,
            paragraphCount,
            lifetimeTokensEstimate: lifetimeTokens,
            isGenerating: true,
            attempts: 0,
            passageText: '',
            passageStats: null,
            difficultyHistory: [],
            debugSteps: [],
            lastUsedTopic: topic
          });

          await this.runReadingPassageAttempt({
            topic,
            difficultyTarget,
            paragraphCount,
            lifetimeTokens,
            easeAdjustment: 0,
            attempt: 1,
            previousPassage: null
          });
        } catch (error) {
          this.readingErrorMessage = error?.message || 'Unable to generate passage.';
        } finally {
          this.readingProcessing = false;
          this.readingGeneration.isGenerating = false;
        }
      },
      async runReadingPassageAttempt({
        topic,
        difficultyTarget,
        paragraphCount,
        lifetimeTokens,
        easeAdjustment,
        attempt,
        previousPassage
      }) {
        const maxAttempts = this.readingGeneration.maxAttempts || 3;
        if (attempt > maxAttempts) {
          this.recordReadingDebugStep({
            label: 'Attempts exhausted',
            details: 'Reached maximum retries without meeting difficulty target.',
            intent: 'abort'
          });
          return;
        }

        const debugTopic = this.readingGeneration.lastUsedTopic || topic || 'general';
        this.recordReadingDebugStep({
          label: `Generating attempt ${attempt}`,
          details: `Topic="${debugTopic}", target=${Math.round(
            difficultyTarget * 100
          )}%, adjustment=${easeAdjustment.toFixed(2)}`,
          intent: 'request'
        });

        let result;
        try {
          result = await requestReadingPassage({
            topic,
            lifetimeTokens,
            difficultyTarget,
            paragraphCount,
            easeAdjustment,
            previousPassage
          });
        } catch (error) {
          this.recordReadingDebugStep({
            label: 'Generation failed',
            details: error?.message || 'API error',
            intent: 'error'
          });
          throw error;
        }

        this.recordReadingDebugStep({
          label: 'Draft received',
          details: `Paragraphs=${result.paragraphs.length}, adjusted target=${Math.round(
            (result.adjustedDifficulty || difficultyTarget) * 100
          )}%`,
          intent: 'response'
        });

        const evaluation = this.evaluateReadingPassage(result.text);
        Object.assign(this.readingGeneration, {
          passageText: result.text,
          passageStats: evaluation,
          attempts: attempt
        });

        this.readingGeneration.difficultyHistory = [
          ...(this.readingGeneration.difficultyHistory || []),
          {
            attempt,
            avgProbability: evaluation.avgProbability,
            target: difficultyTarget
          }
        ];

        const tolerance = 0.03;
        if (Math.abs(evaluation.avgProbability - difficultyTarget) <= tolerance) {
          this.recordReadingDebugStep({
            label: 'Difficulty matched',
            details: `Avg ${Math.round(evaluation.avgProbability * 100)}% vs target ${Math.round(
              difficultyTarget * 100
            )}%`,
            intent: 'success'
          });
          return;
        }

        const needEasier = evaluation.avgProbability < difficultyTarget - tolerance;
        const adjustment = needEasier ? easeAdjustment + 1 : easeAdjustment - 1;
        const nextAttempt = attempt + 1;
        this.recordReadingDebugStep({
          label: needEasier ? 'Too challenging' : 'Too easy',
          details: `Avg ${Math.round(evaluation.avgProbability * 100)}%`,
          intent: 'retry'
        });
        await this.runReadingPassageAttempt({
          topic,
          difficultyTarget,
          paragraphCount,
          lifetimeTokens,
          easeAdjustment: adjustment,
          attempt: nextAttempt,
          previousPassage: result.text
        });
      },
      evaluateReadingPassage(text) {
        if (typeof text !== 'string' || !text.trim()) {
          return {
            avgProbability: 0,
            wordCount: 0,
            flaggedCount: 0,
            hardest: []
          };
        }
        const { segments, sentences } = this.segmentReadText(text);
        const prepared = this.prepareReadingSegments({
          segments,
          sentences
        });
        this.readingSegments = prepared.segments;
        this.readingSentenceContexts = sentences;
        this.readingGlossesByKey = prepared.glossEntries;
        this.readingAnalyzedText = text;
        this.readingLastAnalyzedAt = Date.now();

        const wordSegments = prepared.segments.filter((segment) => segment.isWord);
        const totalProbability = wordSegments.reduce(
          (sum, segment) => sum + (segment.probability || 0),
          0
        );
        const avgProbability = wordSegments.length
          ? totalProbability / wordSegments.length
          : 0;
        const hardest = [...wordSegments]
          .sort((a, b) => (a.probability || 0) - (b.probability || 0))
          .slice(0, 8)
          .map((segment) => ({
            word: segment.text,
            probability: segment.probability || 0,
            sentenceIndex: segment.sentenceIndex
          }));

        return {
          avgProbability,
          wordCount: wordSegments.length,
          flaggedCount: 0,
          hardest
        };
      },
      recordReadingDebugStep(entry) {
        const record = {
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          ...entry
        };
        const steps = Array.isArray(this.readingGeneration.debugSteps)
          ? [...this.readingGeneration.debugSteps, record]
          : [record];
        this.readingGeneration.debugSteps = steps.slice(-20);
      },
      pickRandomReadingTopic() {
        if (!Array.isArray(READING_TOPIC_LIBRARY) || !READING_TOPIC_LIBRARY.length) {
          return '城市生活随记';
        }
        const index = Math.floor(Math.random() * READING_TOPIC_LIBRARY.length);
        return READING_TOPIC_LIBRARY[index];
      },
      prepareReadingSegments({ segments = [], sentences = [] } = {}) {
        if (!Array.isArray(segments) || !segments.length) {
          return {
            segments: [],
            glossEntries: {}
          };
        }
        const enriched = [];
        const glossEntries = {};
        segments.forEach((segment, index) => {
          const entry = {
            id: `segment-${index}`,
            text: segment.text || '',
            type: segment.type || 'other',
            sentenceIndex:
              typeof segment.sentenceIndex === 'number' ? segment.sentenceIndex : 0,
            isWord: segment.type === 'word',
            isSpace: segment.type === 'space',
            isNewline: segment.type === 'newline',
            isPunctuation: segment.type === 'punct',
            probability: null,
            glossKey: null
          };
          if (entry.isWord) {
            const probability = this.wordProbability(entry.text, { mode: 'reading' });
            entry.probability =
              typeof probability === 'number' && Number.isFinite(probability) ? probability : 0;
            const glossKey = `${entry.text}@${entry.sentenceIndex}`;
            entry.glossKey = glossKey;
            const previous = this.readingGlossesByKey?.[glossKey];
            glossEntries[glossKey] = previous
              ? { ...previous }
              : {
                  key: glossKey,
                  word: entry.text,
                  sentenceIndex: entry.sentenceIndex,
                  status: 'idle',
                  pinyin: '',
                  gloss: '',
                  note: ''
                };
          }
          enriched.push(entry);
        });
        return {
          segments: enriched,
          glossEntries
        };
      },
      readingGlossForSegment(segment) {
        if (!segment || !segment.glossKey) return null;
        return this.readingGlossesByKey?.[segment.glossKey] || null;
      },
      readingSentenceTextForIndex(index) {
        if (!Array.isArray(this.readingSentenceContexts)) return '';
        const match = this.readingSentenceContexts.find(
          (sentence) => typeof sentence?.index === 'number' && sentence.index === index
        );
        if (match && typeof match.text === 'string' && match.text.trim()) {
          return match.text.trim();
        }
        return '';
      },
      handleReadingWordHover(segment) {
        this.ensureGlossForSegment(segment);
      },
      ensureGlossForSegment(segment) {
        if (!segment || !segment.isWord || !segment.glossKey) {
          return;
        }
        const entry = this.readingGlossForSegment(segment);
        if (entry && (entry.status === 'ready' || entry.status === 'loading')) {
          return;
        }
        const sentenceText =
          this.readingSentenceTextForIndex(segment.sentenceIndex) || segment.text || '';
        const target = {
          key: segment.glossKey,
          word: segment.text,
          sentence: sentenceText,
          sentenceIndex: segment.sentenceIndex
        };
        const current = this.readingGlossesByKey?.[segment.glossKey] || {};
        const updated = {
          ...this.readingGlossesByKey,
          [segment.glossKey]: {
            word: segment.text,
            pinyin: current.pinyin || '',
            gloss: current.gloss || '',
            note: current.note || '',
            status: 'loading'
          }
        };
        this.readingGlossesByKey = updated;
        this.enqueueGlossTargets([target]);
      },
      enqueueGlossTargets(targets = []) {
        if (!Array.isArray(targets) || !targets.length) return;
        if (!this._glossRequestQueue) {
          this._glossRequestQueue = new Map();
        }
        targets.forEach((target) => {
          if (!target || !target.key) return;
          this._glossRequestQueue.set(target.key, target);
        });
        if (this._glossRequestTimer) {
          return;
        }
        this._glossRequestTimer = window.setTimeout(() => {
          this._glossRequestTimer = null;
          const queuedTargets = this._glossRequestQueue
            ? Array.from(this._glossRequestQueue.values())
            : [];
          if (this._glossRequestQueue) {
            this._glossRequestQueue.clear();
          }
          if (queuedTargets.length) {
            this.fetchGlossesForTargets(queuedTargets, this.readingAnalyzedText || '');
          }
        }, 80);
      },
      resetReadingAnalysis() {
        this.readingAnalyzedText = '';
        this.readingSegments = [];
        this.readingSentenceContexts = [];
        this.readingGlossesByKey = {};
        this.readingProcessing = false;
        this.readingGlossLoading = false;
        this.readingErrorMessage = '';
        this.readingLastAnalyzedAt = null;
        if (this._glossRequestTimer) {
          window.clearTimeout(this._glossRequestTimer);
          this._glossRequestTimer = null;
        }
        if (this._glossRequestQueue) {
          this._glossRequestQueue.clear();
        }
      },
      async fetchGlossesForTargets(targets = [], sourceText = '') {
        if (!Array.isArray(targets) || !targets.length) return;
        const text = typeof sourceText === 'string' ? sourceText : '';
        const seen = new Set();
        const pending = targets
          .map((target) => {
            if (!target || !target.key) return null;
            if (seen.has(target.key)) return null;
            seen.add(target.key);
            const entry = this.readingGlossesByKey?.[target.key];
            if (entry && entry.status === 'ready') {
              return null;
            }
            return target;
          })
          .filter(Boolean);
        if (!pending.length) return;
        this.readingGlossLoading = true;
        try {
          const glosses = await requestReadGlosses({
            text,
            targets: pending
          });
          const responses = Array.isArray(glosses) ? glosses : [];
          const merged = { ...this.readingGlossesByKey };
          const respondedKeys = new Set();
          responses.forEach((entry) => {
            if (!entry || !entry.key) return;
            respondedKeys.add(entry.key);
            merged[entry.key] = {
              word: entry.word,
              pinyin: entry.pinyin,
              gloss: entry.gloss,
              note: entry.note,
              status: entry.gloss ? 'ready' : 'error'
            };
          });
          pending.forEach((target) => {
            if (respondedKeys.has(target.key)) return;
            const current = merged[target.key] || {};
            merged[target.key] = {
              word: target.word,
              pinyin: current.pinyin || '',
              gloss: current.gloss || '',
              note: current.note || '',
              status: 'error'
            };
          });
          this.readingGlossesByKey = merged;
        } catch (error) {
          this.readingErrorMessage = error?.message || 'Unable to fetch glosses.';
          const merged = { ...this.readingGlossesByKey };
          pending.forEach((target) => {
            const current = merged[target.key] || {};
            merged[target.key] = {
              word: target.word,
              pinyin: current.pinyin || '',
              gloss: current.gloss || '',
              note: current.note || '',
              status: 'error'
            };
          });
          this.readingGlossesByKey = merged;
        } finally {
          this.readingGlossLoading = false;
        }
      },
      async returnToModeMenu() {
        if (!this.appMode) return;
        if (this.calibrationActive) {
          this.calibrationActive = false;
        }
        this.pendingCalibrationModes = [];
        this.activeCalibrationMode = null;
        this.calibrationQueue = [];
        this.calibrationResponses = [];
        this.calibrationHistory = [];
        this.calibrationProbeCounts = {};
        this.stopAudioPlayback({ clearUrl: true });
        this.activeCard = null;
        this.currentCardMode = 'reading';
        this.activeLevelMode = 'reading';
        this.appMode = null;
        this.isFlipped = false;
        this.currentIndex = 0;
        this.resetStudyCardContext();
        this.calibrationStatusMessage = '';
        this.resetReadingAnalysis();
        this.persistUserProfile();
      },
      refreshCalibrationCompleteness() {
        const readingReady = isLevelProfileCalibrated(this, 'reading');
        const listeningReady = isLevelProfileCalibrated(this, 'listening');
        const needsListening = this.studyMode === 'listening';
        this.calibrationComplete = readingReady && (!needsListening || listeningReady);
        this.syncCalibrationStatusMessage();
      },
      requiredCalibrationModesForMode(mode) {
        if (!mode) return [];
        if (mode === 'read') {
          return this.isReadingCalibrated ? [] : ['reading'];
        }
        if (mode === 'listen') {
          const required = [];
          if (!this.isReadingCalibrated) {
            required.push('reading');
          }
          if (!this.isListeningCalibrated) {
            required.push('listening');
          }
          return required;
        }
        if (mode === 'study') {
          const required = [];
          if (!this.isReadingCalibrated) {
            required.push('reading');
          }
          if (this.studyMode === 'listening' && !this.isListeningCalibrated) {
            required.push('listening');
          }
          return required;
        }
        return [];
      },
      calibrationStatusForMode(mode) {
        if (!mode) return '';
        return this.calibrationStatusByMode?.[mode] || '';
      },
      getCalibrationSeedForMode(mode) {
        if (!mode) {
          return {
            seedMean: this.logExposureMean ?? DEFAULT_LOG_EXPOSURE,
            seedVar: this.logExposureVar ?? DEFAULT_LOG_VARIANCE
          };
        }
        const profile = getLevelProfile(this, mode);
        let seedMean = profile?.logExposureMean ?? DEFAULT_LOG_EXPOSURE;
        let seedVar = profile?.logExposureVar ?? DEFAULT_LOG_VARIANCE;
        if (!profile?.calibrated) {
          const counterpart = mode === 'reading' ? 'listening' : 'reading';
          const counterpartProfile = getLevelProfile(this, counterpart);
          if (counterpartProfile?.calibrated) {
            seedMean = counterpartProfile.logExposureMean;
            seedVar = counterpartProfile.logExposureVar;
          }
        }
        return { seedMean, seedVar };
      },
      async beginCalibrationSequence(modes = [], options = {}) {
        const targets = Array.isArray(modes) ? modes.filter(Boolean) : [];
        const activeMode = this.calibrationActive ? this.activeCalibrationMode : null;
        const queue = activeMode ? targets.filter((mode) => mode !== activeMode) : [...targets];
        this.pendingCalibrationModes = queue;
        if (activeMode) {
          return;
        }
        if (!queue.length) {
          this.activeCalibrationMode = null;
          this.calibrationActive = false;
          await this.handleCalibrationReadyState();
          return;
        }
        await this.beginNextPendingCalibration(options);
      },
      async beginNextPendingCalibration(options = {}) {
        if (!Array.isArray(this.pendingCalibrationModes) || !this.pendingCalibrationModes.length) {
          this.activeCalibrationMode = null;
          this.calibrationActive = false;
          await this.handleCalibrationReadyState();
          return;
        }
        if (this.calibrationActive) {
          return;
        }
        const nextMode = this.pendingCalibrationModes.shift();
        const { seedMean, seedVar } = this.getCalibrationSeedForMode(nextMode);
        await this.startCalibrationFlow({
          resetPosterior: Boolean(options.resetPosterior),
          mode: nextMode,
          seedMean,
          seedVar
        });
      },
      async handleCalibrationReadyState() {
        this.refreshCalibrationCompleteness();
        if (!this.isAuthenticated || this.calibrationActive || !this.appMode) {
          return;
        }
        if (!this.lexiconLoaded) {
          await this.loadLexicon();
        }
        if (!this.lexicon.length) return;
        if (this.appMode === 'study') {
          await this.maybeInitStudy();
          return;
        }
        if (this.appMode === 'read') {
          this.activeLevelMode = 'reading';
          return;
        }
        if (this.appMode === 'listen') {
          this.activeLevelMode = 'listening';
        }
        await this.loadNextCard({ resetIndex: true });
      },
      syncCalibrationStatusMessage() {
        if (this.calibrationActive) {
          this.calibrationStatusMessage = '';
          return;
        }
        const mode = this.primaryCalibrationMode;
        this.calibrationStatusMessage = this.calibrationStatusForMode(mode);
      },
      async finalizeCalibrationMode({ mode = null, fit = null, skip = false } = {}) {
        const fallbackMode = this.activeCalibrationMode || this.activeLevelMode || 'reading';
        const targetMode = mode || fallbackMode;
        if (!targetMode) return;
        const profile = ensureLevelProfile(this, targetMode);
        if (fit) {
          setLevelProfileStats(this, targetMode, {
            mean: fit.mean,
            variance: fit.variance
          });
        } else if (!skip) {
          setLevelProfileStats(this, targetMode, {
            mean: this.logExposureMean ?? profile.logExposureMean,
            variance: this.logExposureVar ?? profile.logExposureVar
          });
        }
        const resolvedProfile = getLevelProfile(this, targetMode);
        const tokensEstimate = Math.exp(resolvedProfile.logExposureMean ?? DEFAULT_LOG_EXPOSURE);
        const message = skip
          ? 'Calibration marked complete.'
          : `Calibration complete. Estimated lifetime tokens ≈ ${this.formatTokens(tokensEstimate)}.`;
        markProfileCalibrated(this, targetMode, message);
        if (!this.calibrationStatusByMode) {
          this.calibrationStatusByMode = {};
        }
        this.calibrationStatusByMode[targetMode] = message;
        this.calibrationStatusMessage = message;
        this.calibrationActive = false;
        this.activeCalibrationMode = null;
        this.calibrationResponses = [];
        this.calibrationHistory = [];
        this.calibrationProbeCounts = {};
        this.calibrationQueue = [];
        this.calibrationStepCount = 0;
        this.refreshCalibrationCompleteness();
        this.persistUserProfile();
        await this.beginNextPendingCalibration();
      },
      async submitLogin() {
        if (this.isAuthenticated) return;
        const { username, password } = this.loginForm;
        if (!username || !password) {
          this.loginForm.error = 'Enter username and password to continue.';
          return;
        }
        this.loginForm.error = '';
        this.userProfile = {
          username,
          apiKey: ''
        };
        this.loadUserProfile(username);
        this.refreshCalibrationCompleteness();
        this.isAuthenticated = true;
        this.calibrationActive = false;
        this.activeCalibrationMode = null;
        this.pendingCalibrationModes = [];
        this.activeCard = null;
        this.isFlipped = false;
        this.currentIndex = 0;
        this.currentCardMode = 'reading';
        this.activeLevelMode = 'reading';
        this.calibrationStatusMessage = '';
        this.appMode = null;
        this.stopAudioPlayback({ clearUrl: true });
        this.persistUserProfile();
      },
      logout() {
        if (this.userProfile?.username) {
          this.persistUserProfile();
        }
        this.disposeAudioResources();
        this.isAuthenticated = false;
        this.calibrationComplete = false;
        this.calibrationActive = false;
        this.lexiconLoaded = false;
        this.lexicon = [];
        this.frequencyMap = {};
        this.resetReadingAnalysis();
        this.frequencyProbabilityMap = {};
        this.activeCard = null;
        this.currentIndex = 0;
        this.resetStudyCardContext();
        this.appMode = null;
        this.studyMode = 'reading';
        this.currentCardMode = 'reading';
        this.activeLevelMode = 'reading';
        this.activeCalibrationMode = null;
        this.loginForm = {
          username: 'test-user',
          password: 'langy-demo',
          apiKey: '',
          error: ''
        };
        this.userProfile = {
          username: '',
          apiKey: ''
        };
        this.isFlipped = false;
        this.totalResponses = 0;
        this.calibrationResponses = [];
        this.calibrationQueue = [];
        this.calibrationHistory = [];
        this.calibrationProbeCounts = {};
        this.calibrationLogGrid = [];
        this.calibrationLogPosterior = [];
        this.calibrationPosterior = [];
        this.calibrationStepCount = 0;
        this.calibrationStatusMessage = '';
        this.calibrationProfiles = {
          reading: createProfileTemplate(),
          listening: createProfileTemplate()
        };
        this.calibrationStatusByMode = {
          reading: '',
          listening: ''
        };
        this.logExposureMean = DEFAULT_LOG_EXPOSURE;
        this.logExposureVar = DEFAULT_LOG_VARIANCE;
        this.studyKnowledgeBase = {
          reading: {},
          listening: {}
        };
        this.studyMixStats = {
          reading: { newServed: 0, reviewServed: 0 },
          listening: { newServed: 0, reviewServed: 0 }
        };
        this.studyNewPerformance = {
          reading: { trials: 0, correct: 0 },
          listening: { trials: 0, correct: 0 }
        };
        this.studyDynamicSuccessRates = {
          reading: this.targetSuccessRate,
          listening: this.targetSuccessRate
        };
        this.pendingCalibrationModes = [];
        try {
          window.localStorage.removeItem('langy-study-mode');
        } catch (error) {
          // ignore storage errors
        }
      },
      async completeCalibration() {
        await this.finalizeCalibrationMode({ skip: true });
      },
      async restartCalibration() {
        const mode = this.activeCalibrationMode || this.primaryCalibrationMode || 'reading';
        await this.startCalibrationFlow({ resetPosterior: false, mode });
      },
      async startCalibrationFlow({
        resetPosterior = false,
        mode = null,
        seedMean,
        seedVar
      } = {}) {
        if (!this.lexiconLoaded) {
          await this.loadLexicon();
        }
        if (!this.lexicon.length) return;

        const targetMode = mode || this.activeCalibrationMode || this.activeLevelMode || 'reading';
        const seeds = this.getCalibrationSeedForMode(targetMode);
        const effectiveMean =
          resetPosterior && typeof DEFAULT_LOG_EXPOSURE === 'number'
            ? DEFAULT_LOG_EXPOSURE
            : typeof seedMean === 'number' && Number.isFinite(seedMean)
              ? seedMean
              : seeds.seedMean;
        const effectiveVar =
          resetPosterior && typeof DEFAULT_LOG_VARIANCE === 'number'
            ? DEFAULT_LOG_VARIANCE
            : typeof seedVar === 'number' && Number.isFinite(seedVar)
              ? seedVar
              : seeds.seedVar;

        this.activeCalibrationMode = targetMode;
        this.activeLevelMode = targetMode;
        clearProfileCalibration(this, targetMode);
        if (this.calibrationStatusByMode) {
          this.calibrationStatusByMode[targetMode] = '';
        }
        setLevelProfileStats(this, targetMode, {
          mean: effectiveMean,
          variance: effectiveVar
        });
        initializeCalibration(this, {
          mode: targetMode,
          seedMean: effectiveMean,
          seedVar: effectiveVar
        });
        this.calibrationActive = true;
        this.calibrationStepCount = 0;
        this.calibrationStatusMessage = '';
        this.calibrationResponses = [];
        this.calibrationHistory = [];
        this.calibrationProbeCounts = {};
        this.resetStudyCardContext();
        this.activeCard = null;
        this.isFlipped = false;
        this.refreshCalibrationCompleteness();
        this.persistUserProfile();
        await this.loadNextCard({ resetIndex: true });
      },
      async continueCalibration() {
        if (!this.calibrationActive) {
          const mode = this.activeCalibrationMode || this.activeLevelMode || 'reading';
          await this.startCalibrationFlow({ resetPosterior: false, mode });
          return;
        }
        if (!this.lexiconLoaded) {
          await this.loadLexicon();
        }
        await this.loadNextCard({});
      },
      loadUserProfile(username) {
        if (!username) return;
        try {
          const raw = window.localStorage.getItem(`langy-profile:${username}`);
          if (!raw) return;
          const data = JSON.parse(raw);
          this.ensureStudyStructures();
          if (typeof data.studyMode === 'string') {
            this.studyMode = data.studyMode;
            this.persistStudyMode();
          }
          this.calibrationActive = false;
          this.activeCalibrationMode = null;
          const profiles = data.calibrationProfiles && typeof data.calibrationProfiles === 'object'
            ? data.calibrationProfiles
            : null;
          if (profiles) {
            ['reading', 'listening'].forEach((mode) => {
              const stored = profiles[mode];
              if (!stored || typeof stored !== 'object') return;
              const profile = ensureLevelProfile(this, mode);
              if (typeof stored.logExposureMean === 'number' && Number.isFinite(stored.logExposureMean)) {
                profile.logExposureMean = stored.logExposureMean;
              }
              if (typeof stored.logExposureVar === 'number' && Number.isFinite(stored.logExposureVar)) {
                profile.logExposureVar = stored.logExposureVar;
              }
              profile.calibrated = Boolean(stored.calibrated);
              profile.calibrationStatusMessage =
                typeof stored.calibrationStatusMessage === 'string'
                  ? stored.calibrationStatusMessage
                  : profile.calibrationStatusMessage || '';
              profile.lastCalibratedAt =
                typeof stored.lastCalibratedAt === 'number' ? stored.lastCalibratedAt : profile.lastCalibratedAt;
            });
          } else {
            const readingProfile = ensureLevelProfile(this, 'reading');
            if (typeof data.logExposureMean === 'number' && Number.isFinite(data.logExposureMean)) {
              readingProfile.logExposureMean = data.logExposureMean;
            }
            if (typeof data.logExposureVar === 'number' && Number.isFinite(data.logExposureVar)) {
              readingProfile.logExposureVar = data.logExposureVar;
            }
            readingProfile.calibrated = Boolean(data.calibrationComplete);
            if (typeof data.calibrationStatusMessage === 'string') {
              readingProfile.calibrationStatusMessage = data.calibrationStatusMessage;
            }
          }
          if (data.calibrationStatusByMode && typeof data.calibrationStatusByMode === 'object') {
            this.calibrationStatusByMode = {
              reading: data.calibrationStatusByMode.reading || '',
              listening: data.calibrationStatusByMode.listening || ''
            };
          } else {
            this.calibrationStatusByMode = {
              reading: getLevelProfile(this, 'reading').calibrationStatusMessage || '',
              listening: getLevelProfile(this, 'listening').calibrationStatusMessage || ''
            };
          }
          if (typeof data.activeLevelMode === 'string' && (data.activeLevelMode === 'reading' || data.activeLevelMode === 'listening')) {
            this.activeLevelMode = data.activeLevelMode;
          } else {
            this.activeLevelMode = 'reading';
          }
          if (typeof data.listeningCardChance === 'number' && Number.isFinite(data.listeningCardChance)) {
            this.listeningCardChance = Math.min(Math.max(data.listeningCardChance, 0), 1);
          }
          if (data.studyState && typeof data.studyState === 'object') {
            const knowledgeSource = data.studyState.knowledgeBase || {};
            const hydrateKnowledge = (mode) => {
              const source = knowledgeSource[mode];
              const target = {};
              if (source && typeof source === 'object') {
                Object.keys(source).forEach((word) => {
                  if (!word) return;
                  const entry = source[word];
                  if (!entry || typeof entry !== 'object') return;
                  target[word] = {
                    word,
                    dueAt: typeof entry.dueAt === 'number' ? entry.dueAt : null,
                    intervalMinutes:
                      typeof entry.intervalMinutes === 'number'
                        ? entry.intervalMinutes
                        : this.studyReviewIncorrectIntervalMinutes,
                    easeFactor:
                      typeof entry.easeFactor === 'number'
                        ? entry.easeFactor
                        : this.studyReviewEaseDefault,
                    lastSeenAt: typeof entry.lastSeenAt === 'number' ? entry.lastSeenAt : null,
                    streak: typeof entry.streak === 'number' ? entry.streak : 0,
                    lastRating: typeof entry.lastRating === 'string' ? entry.lastRating : 'incorrect'
                  };
                });
              }
              this.studyKnowledgeBase[mode] = target;
            };
            hydrateKnowledge('reading');
            hydrateKnowledge('listening');
            if (data.studyState.mixStats && typeof data.studyState.mixStats === 'object') {
              this.studyMixStats = {
                reading: {
                  newServed: Number(data.studyState.mixStats.reading?.newServed) || 0,
                  reviewServed: Number(data.studyState.mixStats.reading?.reviewServed) || 0
                },
                listening: {
                  newServed: Number(data.studyState.mixStats.listening?.newServed) || 0,
                  reviewServed: Number(data.studyState.mixStats.listening?.reviewServed) || 0
                }
              };
            }
            if (data.studyState.newPerformance && typeof data.studyState.newPerformance === 'object') {
              this.studyNewPerformance = {
                reading: {
                  trials: Number(data.studyState.newPerformance.reading?.trials) || 0,
                  correct: Number(data.studyState.newPerformance.reading?.correct) || 0
                },
                listening: {
                  trials: Number(data.studyState.newPerformance.listening?.trials) || 0,
                  correct: Number(data.studyState.newPerformance.listening?.correct) || 0
                }
              };
            }
            if (data.studyState.dynamicSuccessRates && typeof data.studyState.dynamicSuccessRates === 'object') {
              this.studyDynamicSuccessRates = {
                reading: Number.isFinite(data.studyState.dynamicSuccessRates.reading)
                  ? data.studyState.dynamicSuccessRates.reading
                  : this.targetSuccessRate,
                listening: Number.isFinite(data.studyState.dynamicSuccessRates.listening)
                  ? data.studyState.dynamicSuccessRates.listening
                  : this.targetSuccessRate
              };
            }
          }
          const activeProfile = getLevelProfile(this, this.activeLevelMode);
          this.logExposureMean = activeProfile.logExposureMean ?? DEFAULT_LOG_EXPOSURE;
          this.logExposureVar = activeProfile.logExposureVar ?? DEFAULT_LOG_VARIANCE;
          this.refreshCalibrationCompleteness();
        } catch (error) {
          console.warn('Unable to load stored profile:', error);
        }
      },
      persistUserProfile() {
        const username = this.userProfile?.username;
        if (!username) return;
        this.ensureStudyStructures();
        const serializeProfile = (mode) => {
          const profile = ensureLevelProfile(this, mode);
          return {
            logExposureMean: profile?.logExposureMean ?? DEFAULT_LOG_EXPOSURE,
            logExposureVar: profile?.logExposureVar ?? DEFAULT_LOG_VARIANCE,
            calibrated: Boolean(profile?.calibrated),
            calibrationStatusMessage: profile?.calibrationStatusMessage || '',
            lastCalibratedAt: profile?.lastCalibratedAt ?? null
          };
        };
        const serializeKnowledgeBase = (mode) => {
          const snapshot = {};
          const base = this.getStudyKnowledgeBase(mode);
          Object.keys(base).forEach((word) => {
            if (!word) return;
            const entry = base[word];
            if (!entry) return;
            snapshot[word] = {
              dueAt: entry.dueAt ?? null,
              intervalMinutes: entry.intervalMinutes ?? 0,
              easeFactor: entry.easeFactor ?? this.studyReviewEaseDefault,
              lastSeenAt: entry.lastSeenAt ?? null,
              streak: entry.streak ?? 0,
              lastRating: entry.lastRating || 'incorrect'
            };
          });
          return snapshot;
        };
        const payload = {
          studyMode: this.studyMode,
          calibrationComplete: this.calibrationComplete,
          logExposureMean: this.logExposureMean,
          logExposureVar: this.logExposureVar,
          appMode: this.appMode,
          activeLevelMode: this.activeLevelMode,
          calibrationProfiles: {
            reading: serializeProfile('reading'),
            listening: serializeProfile('listening')
          },
          calibrationStatusByMode: {
            reading: this.calibrationStatusByMode?.reading || '',
            listening: this.calibrationStatusByMode?.listening || ''
          },
          listeningCardChance: this.listeningCardChance,
          studyState: {
            knowledgeBase: {
              reading: serializeKnowledgeBase('reading'),
              listening: serializeKnowledgeBase('listening')
            },
            mixStats: this.studyMixStats,
            newPerformance: this.studyNewPerformance,
            dynamicSuccessRates: this.studyDynamicSuccessRates
          },
          updatedAt: Date.now()
        };
        try {
          window.localStorage.setItem(`langy-profile:${username}`, JSON.stringify(payload));
        } catch (error) {
          console.warn('Unable to persist profile:', error);
        }
      },
      async setAppMode(mode) {
        if (mode == null) {
          await this.returnToModeMenu();
          return;
        }
        if (!['read', 'listen', 'study'].includes(mode)) return;
        const modeChanged = this.appMode !== mode;
        if (modeChanged) {
          this.stopAudioPlayback({ clearUrl: true });
          this.appMode = mode;
          this.activeCard = null;
          this.isFlipped = false;
          this.currentIndex = 0;
          this.resetStudyCardContext();
          if (mode === 'read') {
            this.currentCardMode = 'reading';
            this.activeLevelMode = 'reading';
          } else if (mode === 'listen') {
            this.currentCardMode = 'listening';
            this.activeLevelMode = 'listening';
          }
        }
        const required = this.requiredCalibrationModesForMode(mode);
        if (required.length) {
          await this.beginCalibrationSequence(required);
        } else {
          await this.handleCalibrationReadyState();
        }
        this.persistUserProfile();
      },
      async maybeInitStudy() {
        if (!this.isStudyReady) return;
        if (!this.lexiconLoaded) {
          await this.loadLexicon();
        }
        if (!this.lexicon.length) return;
        if (!this.activeCard) {
          await this.loadNextCard({ resetIndex: true });
        }
      },
      formatPercent,
      formatDelta,
      formatTokens,
      formatStd,
      async loadLexicon() {
        if (this.lexiconLoaded) {
          return;
        }
        try {
          const entries = await fetchFrequencyCorpus();
          if (entries.length) {
            initializeLexicon(this, entries);
            this.rebuildLexiconIndex();
            this.lexiconLoaded = true;
            this.calibrationActive = false;
            this.activeCalibrationMode = null;
            this.refreshCalibrationCompleteness();
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
          this.rebuildLexiconIndex();
          this.lexiconLoaded = true;
          this.calibrationActive = false;
          this.activeCalibrationMode = null;
          this.refreshCalibrationCompleteness();
        }
      },
      rebuildLexiconIndex() {
        this.lexiconIndexByWord = {};
        if (!Array.isArray(this.lexicon)) return;
        this.lexicon.forEach((entry, index) => {
          if (entry?.word) {
            this.lexiconIndexByWord[entry.word] = index;
          }
        });
      },
      async loadNextCard({ advance = false, resetIndex = false, targetIndex = null } = {}) {
        if (!this.lexicon.length || this.isLoadingCard) return;
        const maxIndex = this.lexicon.length - 1;
        let selectedWord = null;
        const usingStudyScheduler =
          this.appMode === 'study' && !this.calibrationActive && this.isStudyReady && targetIndex == null;
        if (this.calibrationActive) {
          const calibrationIndex = consumeCalibrationIndex(this);
          if (calibrationIndex != null) {
            this.currentIndex = calibrationIndex;
          } else {
            const fallbackLog = Number.isFinite(this.calibrationPosteriorMedian)
              ? this.calibrationPosteriorMedian
              : this.logExposureMean;
            this.currentIndex = this.findIndexClosestToProbability(0.5, {
              logExposure: fallbackLog
            });
          }
          this.resetStudyCardContext();
        } else if (usingStudyScheduler) {
          const studyTarget = this.selectStudyTarget();
          if (!studyTarget) {
            this.errorMessage = 'No study targets available yet.';
            this.resetStudyCardContext();
            this.prepareAudioForNewCard();
            return;
          }
          this.currentStudyCard = studyTarget;
          this.pendingCardModeOverride = studyTarget.mode;
          if (Number.isFinite(studyTarget.lexiconIndex)) {
            this.currentIndex = studyTarget.lexiconIndex;
          } else if (studyTarget.word && this.lexiconIndexByWord[studyTarget.word] != null) {
            this.currentIndex = this.lexiconIndexByWord[studyTarget.word];
          }
          selectedWord = studyTarget.word;
        } else if (targetIndex != null) {
          const clamped = Math.max(0, Math.min(maxIndex, targetIndex));
          this.currentIndex = clamped;
          this.resetStudyCardContext();
        } else if (resetIndex) {
          this.currentIndex = 0;
          this.resetStudyCardContext();
        } else if (advance) {
          this.currentIndex = Math.min(maxIndex, this.currentIndex + 1);
          this.resetStudyCardContext();
        } else if (this.currentIndex > maxIndex) {
          this.currentIndex = maxIndex;
          this.resetStudyCardContext();
        } else if (this.appMode !== 'study') {
          this.resetStudyCardContext();
        }
        const entry = selectedWord ? { word: selectedWord } : this.lexicon[this.currentIndex];
        if (!entry || !entry.word) return;
        if (this.appMode !== 'study') {
          this.pendingCardModeOverride = null;
        }
        this.prepareAudioForNewCard();
        await this.fetchCardForWord(entry.word);
      },
      resetStudyCardContext() {
        this.currentStudyCard = null;
        this.pendingCardModeOverride = null;
      },
      async fetchCardForWord(word) {
        if (!word) return;
        this.prepareAudioForNewCard();
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
          this.assignCardMode();
          if (this.isListeningCard) {
            this.ensureAudioReady({ autoplay: true }).catch((error) => {
              this.audioErrorMessage = error?.message || 'Unable to load audio.';
            });
          }
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
        this.stopAudioPlayback({ clearUrl: false });
        const currentWord = this.currentCard?.focus?.hanzi;
        const freqProbability = currentWord ? this.frequencyProbabilityMap[currentWord] ?? 0 : 0;
        const rating = type;
        const isKnown = rating === 'easy' || rating === 'hard';

        if (this.calibrationActive) {
          if (currentWord && freqProbability > 0) {
            const result = handleCalibrationResponse(this, {
              word: currentWord,
              freqProbability,
              outcome: isKnown
            });
            if (result && result.fit) {
              this.recordCalibrationSummary(result.fit, result.priorMean);
              await this.finalizeCalibrationMode({ fit: result.fit });
              return;
            }
          }
          if (this.calibrationActive) {
            await this.loadNextCard({});
          }
          return;
        }

        const modeForUpdate = this.isListeningCard ? 'listening' : 'reading';
        this.activeLevelMode = modeForUpdate;
        if (!this.calibrationActive && this.appMode === 'study' && currentWord) {
          this.recordStudyOutcome({
            word: currentWord,
            mode: modeForUpdate,
            rating,
            source: this.currentStudyCard?.source
          });
        }
        if (currentWord && freqProbability > 0) {
          this.totalResponses += 1;
          const update = applyLevelUpdate(this, currentWord, freqProbability, isKnown, {
            mode: modeForUpdate
          });
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
        if (this.appMode === 'study') {
          await this.loadNextCard({});
        } else {
          const nextIndex = this.selectNextIndex({ mode: modeForUpdate });
          await this.loadNextCard({ targetIndex: nextIndex });
        }
        if (!this.calibrationActive) {
          this.persistUserProfile();
        }
      },
      async advanceCard() {
        if (!this.lexicon.length) return;
        if (this.calibrationActive) {
          await this.loadNextCard({});
        } else if (this.appMode === 'study') {
          await this.loadNextCard({});
        } else {
          this.stopAudioPlayback({ clearUrl: false });
          const nextMode = this.isListeningCard ? 'listening' : 'reading';
          const nextIndex = this.selectNextIndex({ mode: nextMode });
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
      wordProbability(word, options = {}) {
        return computeWordProbability(this, word, options);
      },
      async requestAudioPlayback() {
        await this.ensureAudioReady({ autoplay: true, force: false });
      },
      playAudioFromUrl(url) {
        if (!url) return;
        this.stopAudioPlayback({ clearUrl: false });
        try {
          const audio = new Audio(url);
          audio.addEventListener('ended', () => {
            this.stopAudioPlayback({ clearUrl: false });
          });
          audio.addEventListener('error', () => {
            this.audioErrorMessage = 'Audio playback failed.';
          });
          this._currentAudioElement = audio;
          this.currentAudioUrl = url;
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch((error) => {
              this.audioErrorMessage = error?.message || 'Unable to play audio.';
            });
          }
        } catch (error) {
          this.audioErrorMessage = error?.message || 'Unable to play audio.';
        }
      },
      stopAudioPlayback({ clearUrl = true } = {}) {
        if (this._currentAudioElement) {
          try {
            this._currentAudioElement.pause();
            this._currentAudioElement.currentTime = 0;
          } catch (error) {
            // ignore pause errors
          }
        }
        this._currentAudioElement = null;
        if (clearUrl) {
          this.currentAudioUrl = '';
        }
      },
      prepareAudioForNewCard() {
        this.stopAudioPlayback({ clearUrl: true });
        this.isLoadingAudio = false;
        this.audioErrorMessage = '';
        this.currentCardMode = 'reading';
      },
      disposeAudioResources() {
        this.stopAudioPlayback({ clearUrl: true });
        Object.values(this.audioBySentence).forEach((entry) => {
          if (entry?.url) {
            URL.revokeObjectURL(entry.url);
          }
        });
        this.audioBySentence = {};
        this.currentAudioUrl = '';
      },
      async ensureAudioReady({ autoplay = false, force = false } = {}) {
        if (this.isLoadingCard) return;
        if (this.isLoadingAudio) return;
        const sentenceText = this.currentCard?.sentence?.text;
        if (!sentenceText) return;
        this.audioErrorMessage = '';
        const cached = this.audioBySentence[sentenceText];
        if (cached?.url && !force) {
          this.currentAudioUrl = cached.url;
          if (autoplay) {
            this.playAudioFromUrl(cached.url);
          }
          return;
        }
        try {
          this.isLoadingAudio = true;
          const result = await requestSentenceAudio({ text: sentenceText });
          if (cached?.url && cached.url !== result.url) {
            URL.revokeObjectURL(cached.url);
          }
          this.audioBySentence[sentenceText] = {
            url: result.url,
            voice: result.voice,
            format: result.format,
            timestamp: Date.now()
          };
          this.currentAudioUrl = result.url;
          if (autoplay) {
            this.playAudioFromUrl(result.url);
          }
        } catch (error) {
          this.audioErrorMessage = error?.message || 'Unable to load audio.';
        } finally {
          this.isLoadingAudio = false;
        }
      },
      assignCardMode() {
        if (this.pendingCardModeOverride) {
          this.currentCardMode = this.pendingCardModeOverride;
          this.activeLevelMode = this.pendingCardModeOverride;
          this.pendingCardModeOverride = null;
          return;
        }
        if (!this.currentCard) {
          this.currentCardMode = 'reading';
          this.activeLevelMode = 'reading';
          return;
        }
        if (!this.appMode) {
          this.currentCardMode = 'reading';
          this.activeLevelMode = 'reading';
          return;
        }
        if (this.calibrationActive && this.activeCalibrationMode === 'listening') {
          this.currentCardMode = 'listening';
          this.activeLevelMode = 'listening';
          return;
        }
        if (this.appMode === 'listen') {
          this.currentCardMode = 'listening';
          this.activeLevelMode = 'listening';
          return;
        }
        if (this.appMode !== 'study' || this.studyMode !== 'listening') {
          this.currentCardMode = 'reading';
          this.activeLevelMode = 'reading';
          return;
        }
        const chance = Math.min(Math.max(this.listeningCardChance ?? 0.5, 0), 1);
        this.currentCardMode = Math.random() < chance ? 'listening' : 'reading';
        this.activeLevelMode = this.currentCardMode;
      },
      async toggleStudyMode() {
        if (this.appMode !== 'study') return;
        this.studyMode = this.studyMode === 'listening' ? 'reading' : 'listening';
        this.persistStudyMode();
        this.refreshCalibrationCompleteness();
        const requires = this.requiredCalibrationModesForMode('study');
        if (this.appMode === 'study' && requires.length) {
          await this.beginCalibrationSequence(requires);
        } else {
          this.assignCardMode();
          if (this.isListeningCard) {
            this.ensureAudioReady({ autoplay: true }).catch((error) => {
              this.audioErrorMessage = error?.message || 'Unable to load audio.';
            });
          }
        }
        this.persistUserProfile();
      },
      restorePreferences() {
        try {
          const stored = window.localStorage.getItem('langy-study-mode');
          if (stored === 'listening' || stored === 'reading') {
            this.studyMode = stored;
          }
        } catch (error) {
          // ignore storage errors
        }
      },
      persistStudyMode() {
        try {
          window.localStorage.setItem('langy-study-mode', this.studyMode);
        } catch (error) {
          // ignore storage errors
        }
      },
      selectNextIndex(options = {}) {
        if (!this.lexicon.length) return this.currentIndex || 0;
        if (this.calibrationActive) {
          const focusLog = Number.isFinite(this.calibrationPosteriorMedian)
            ? this.calibrationPosteriorMedian
            : this.logExposureMean;
          return this.findIndexClosestToProbability(0.5, { logExposure: focusLog });
        }
        const mode = options.mode || this.activeLevelMode || 'reading';
        const baseTarget = this.getStudyTargetSuccessRate(mode);
        const spread = Math.max(0, this.studyNewWordSpread ?? 0);
        const jitter = spread ? (Math.random() - 0.5) * spread : 0;
        const target = clampProbability(
          baseTarget + jitter,
          this.studyMinSuccessRate ?? 0.35,
          this.studyMaxSuccessRate ?? 0.75
        );
        const center = this.findIndexClosestToProbability(target, { ...options, mode });
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
          const probability = this.wordProbability(entry.word, { ...options, mode });
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
      findIndexClosestToProbability(target, options = {}) {
        if (!this.lexicon.length) return 0;
        let low = 0;
        let high = this.lexicon.length - 1;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const entry = this.lexicon[mid];
          const probability = entry ? this.wordProbability(entry.word, options) : 0;
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
          const probability = this.wordProbability(entry.word, options);
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
      ensureStudyStructures() {
        if (!this.studyKnowledgeBase || typeof this.studyKnowledgeBase !== 'object') {
          this.studyKnowledgeBase = { reading: {}, listening: {} };
        }
        if (!this.studyMixStats || typeof this.studyMixStats !== 'object') {
          this.studyMixStats = { reading: { newServed: 0, reviewServed: 0 }, listening: { newServed: 0, reviewServed: 0 } };
        }
        if (!this.studyNewPerformance || typeof this.studyNewPerformance !== 'object') {
          this.studyNewPerformance = { reading: { trials: 0, correct: 0 }, listening: { trials: 0, correct: 0 } };
        }
        if (!this.studyDynamicSuccessRates || typeof this.studyDynamicSuccessRates !== 'object') {
          this.studyDynamicSuccessRates = { reading: this.targetSuccessRate, listening: this.targetSuccessRate };
        }
        ['reading', 'listening'].forEach((mode) => {
          if (!this.studyKnowledgeBase[mode] || typeof this.studyKnowledgeBase[mode] !== 'object') {
            this.studyKnowledgeBase[mode] = {};
          }
          if (!this.studyMixStats[mode]) {
            this.studyMixStats[mode] = { newServed: 0, reviewServed: 0 };
          }
          if (!this.studyNewPerformance[mode]) {
            this.studyNewPerformance[mode] = { trials: 0, correct: 0 };
          }
          if (typeof this.studyDynamicSuccessRates[mode] !== 'number' || !Number.isFinite(this.studyDynamicSuccessRates[mode])) {
            this.studyDynamicSuccessRates[mode] = this.targetSuccessRate;
          }
        });
      },
      getStudyKnowledgeBase(mode) {
        this.ensureStudyStructures();
        return this.studyKnowledgeBase[mode] || {};
      },
      isWordInKnowledge(mode, word) {
        if (!word) return false;
        const base = this.getStudyKnowledgeBase(mode);
        return Boolean(base[word]);
      },
      peekReviewCandidate(mode) {
        const base = this.getStudyKnowledgeBase(mode);
        const entries = Object.values(base);
        if (!entries.length) return null;
        let best = null;
        entries.forEach((entry) => {
          if (!entry?.word) return;
          if (!best || (entry.dueAt ?? Infinity) < (best.dueAt ?? Infinity)) {
            best = entry;
          }
        });
        if (!best) return null;
        const now = Date.now();
        return {
          entry: best,
          isDue: (best.dueAt ?? 0) <= now,
          dueAt: best.dueAt ?? now
        };
      },
      pickNewWordCandidate(mode) {
        if (!this.lexicon.length) return null;
        const attempts = Math.min(this.lexicon.length, 80);
        const visited = new Set();
        for (let i = 0; i < attempts; i += 1) {
          const idx = this.selectNextIndex({ mode });
          if (visited.has(idx)) continue;
          visited.add(idx);
          const entry = this.lexicon[idx];
          if (!entry?.word) continue;
          if (this.isWordInKnowledge(mode, entry.word)) continue;
          return {
            word: entry.word,
            lexiconIndex: idx
          };
        }
        return null;
      },
      registerStudyMix(mode, source) {
        this.ensureStudyStructures();
        const stats = this.studyMixStats[mode];
        if (!stats) return;
        if (source === 'new') {
          stats.newServed += 1;
        } else {
          stats.reviewServed += 1;
        }
      },
      updateNewPerformance(mode, rating) {
        this.ensureStudyStructures();
        const stats = this.studyNewPerformance[mode];
        if (!stats) return;
        const weight = rating === 'easy' ? 1 : rating === 'hard' ? 0.5 : 0;
        stats.trials += 1;
        stats.correct += weight;
        const observed = stats.correct / Math.max(stats.trials, 1);
        const base = this.targetSuccessRate ?? 0.5;
        const sensitivity = this.studyCalibrationSensitivity ?? 0.6;
        const minTarget = this.studyMinSuccessRate ?? 0.35;
        const maxTarget = this.studyMaxSuccessRate ?? 0.75;
        const adjusted = Math.min(
          maxTarget,
          Math.max(minTarget, base - (observed - base) * sensitivity)
        );
        this.studyDynamicSuccessRates[mode] = adjusted;
      },
      getStudyTargetSuccessRate(mode) {
        this.ensureStudyStructures();
        const value = this.studyDynamicSuccessRates?.[mode];
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }
        return this.targetSuccessRate ?? 0.5;
      },
      applyStudyScheduling({ mode, word, rating }) {
        if (!word || !mode) return;
        this.ensureStudyStructures();
        const base = this.getStudyKnowledgeBase(mode);
        const now = Date.now();
        const easeDefault = this.studyReviewEaseDefault ?? 2.4;
        const incorrectInterval = this.studyReviewIncorrectIntervalMinutes ?? 1;
        const hardInterval = this.studyReviewHardIntervalMinutes ?? 4;
        const baseInterval = this.studyReviewBaseIntervalMinutes ?? 10;
        const easeMin = this.studyReviewEaseMin ?? 1.2;
        const easeMax = this.studyReviewEaseMax ?? 3.5;
        const growth = this.studyReviewIntervalGrowth ?? 1.6;
        const maxInterval = this.studyReviewMaxIntervalMinutes ?? 10080;
        const entry = base[word] || {
          word,
          mode,
          intervalMinutes: 0,
          easeFactor: easeDefault,
          streak: 0
        };
        if (typeof entry.easeFactor !== 'number' || !Number.isFinite(entry.easeFactor)) {
          entry.easeFactor = easeDefault;
        }
        if (typeof entry.intervalMinutes !== 'number' || !Number.isFinite(entry.intervalMinutes)) {
          entry.intervalMinutes = 0;
        }
        if (rating === 'incorrect') {
          entry.streak = 0;
          entry.intervalMinutes = incorrectInterval;
          entry.easeFactor = Math.max(easeMin, entry.easeFactor - 0.3);
        } else if (rating === 'hard') {
          entry.streak = Math.max(1, entry.streak + 1);
          entry.intervalMinutes =
            entry.intervalMinutes > 0
              ? Math.max(hardInterval, entry.intervalMinutes * 0.7)
              : hardInterval;
          entry.easeFactor = Math.max(easeMin, entry.easeFactor - 0.05);
        } else {
          entry.streak = Math.max(1, entry.streak + 1);
          if (entry.intervalMinutes <= 0) {
            entry.intervalMinutes = baseInterval;
          } else {
            entry.intervalMinutes = Math.max(
              baseInterval,
              entry.intervalMinutes * entry.easeFactor * growth
            );
          }
          entry.easeFactor = Math.min(easeMax, entry.easeFactor + 0.1);
        }
        entry.intervalMinutes = Math.min(entry.intervalMinutes, maxInterval);
        entry.lastRating = rating;
        entry.lastSeenAt = now;
        entry.dueAt = now + entry.intervalMinutes * 60 * 1000;
        base[word] = entry;
      },
      recordStudyOutcome({ word, mode, rating, source }) {
        if (!word || !mode) return;
        const normalizedSource = source === 'review' ? 'review' : 'new';
        this.registerStudyMix(mode, normalizedSource);
        if (normalizedSource === 'new') {
          this.updateNewPerformance(mode, rating);
        }
        this.applyStudyScheduling({ mode, word, rating });
      },
      studyModePriority() {
        if (this.studyMode !== 'listening' || !this.isListeningCalibrated) {
          return ['reading'];
        }
        const chance = Math.min(Math.max(this.listeningCardChance ?? 0.5, 0), 1);
        const primary = Math.random() < chance ? 'listening' : 'reading';
        const secondary = primary === 'listening' ? 'reading' : 'listening';
        return [primary, secondary];
      },
      buildStudyCardMeta({ source, mode, entry = null, word, lexiconIndex = null }) {
        const now = Date.now();
        let detail = mode === 'listening' ? 'Listening focus' : 'Reading focus';
        let tone = source === 'review' ? 'review-upcoming' : 'new';
        let dueAt = entry?.dueAt ?? null;
        if (source === 'review') {
          const due = entry?.dueAt ?? now;
          dueAt = due;
          if (due <= now) {
            const overdueMinutes = Math.max(0, Math.round((now - due) / 60000));
            detail = overdueMinutes > 0 ? `${overdueMinutes}m overdue` : 'Due now';
            tone = 'review-due';
          } else {
            const etaMinutes = Math.max(1, Math.round((due - now) / 60000));
            detail = `Due in ${etaMinutes}m`;
            tone = 'review-upcoming';
          }
        }
        return {
          word,
          source,
          mode,
          label: source === 'review' ? 'Review' : 'New Word',
          detail,
          tone,
          dueAt,
          lexiconIndex,
          knowledgeEntry: entry || null
        };
      },
      selectStudyTargetForMode(mode) {
        const reviewCandidate = this.peekReviewCandidate(mode);
        const newCandidate = this.pickNewWordCandidate(mode);
        if (!reviewCandidate && !newCandidate) {
          return null;
        }
        const useReview = this.shouldServeReview({
          mode,
          reviewCandidate,
          newCandidate
        });
        if (useReview && reviewCandidate) {
          const word = reviewCandidate.entry?.word;
          if (!word) return null;
          const lexIndex =
            this.lexiconIndexByWord?.[word] != null ? this.lexiconIndexByWord[word] : null;
          return this.buildStudyCardMeta({
            source: 'review',
            mode,
            entry: reviewCandidate.entry,
            word,
            lexiconIndex: lexIndex
          });
        }
        if (newCandidate) {
          return this.buildStudyCardMeta({
            source: 'new',
            mode,
            entry: null,
            word: newCandidate.word,
            lexiconIndex: newCandidate.lexiconIndex
          });
        }
        if (reviewCandidate) {
          const word = reviewCandidate.entry?.word;
          if (!word) return null;
          const lexIndex =
            this.lexiconIndexByWord?.[word] != null ? this.lexiconIndexByWord[word] : null;
          return this.buildStudyCardMeta({
            source: 'review',
            mode,
            entry: reviewCandidate.entry,
            word,
            lexiconIndex: lexIndex
          });
        }
        return null;
      },
      shouldServeReview({ mode, reviewCandidate, newCandidate }) {
        if (!reviewCandidate) return false;
        if (!newCandidate) return true;
        const stats = this.studyMixStats?.[mode] || { newServed: 0, reviewServed: 0 };
        const total = stats.newServed + stats.reviewServed;
        const targetRatio = this.studyNewWordRatio ?? 0.4;
        const currentRatio = total ? stats.newServed / total : 0;
        const overdueGraceMs = (this.studyReviewOverdueGraceMinutes ?? 10) * 60 * 1000;
        const now = Date.now();
        const overdue =
          reviewCandidate.dueAt != null && now - reviewCandidate.dueAt > overdueGraceMs;
        if (reviewCandidate.isDue && (currentRatio >= targetRatio || overdue)) {
          return true;
        }
        if (!reviewCandidate.isDue) {
          return currentRatio > targetRatio;
        }
        return currentRatio >= targetRatio;
      },
      selectStudyTarget() {
        if (!this.lexicon.length || !this.isStudyReady) {
          return null;
        }
        const priorities = this.studyModePriority();
        for (const mode of priorities) {
          const target = this.selectStudyTargetForMode(mode);
          if (target) {
            return target;
          }
        }
        return null;
      },
      recordCalibrationSummary(fit, priorMean) {
        const calibratedStd =
          typeof fit.stdLog10 === 'number' && Number.isFinite(fit.stdLog10)
            ? fit.stdLog10
            : Math.sqrt(Math.max(fit.variance, 0));
        const entry = {
          id: `calibration-${Date.now()}`,
          word: 'Calibration ✓',
          correct: true,
          probability: clampProbability(0.5),
          deltaMean: fit.mean - (priorMean ?? fit.mean),
          stdAfter: calibratedStd,
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

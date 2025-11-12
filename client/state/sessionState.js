import {
  DEFAULT_LOG_EXPOSURE,
  DEFAULT_LOG_VARIANCE,
  createProfileTemplate
} from '../utils/profile.js';
import {
  DEFAULT_LANGUAGE_ID,
  LANGUAGE_OPTIONS,
  getLanguageConfig
} from '../languages/index.js';

const MIN_LOG_EXPOSURE = Math.log(10);
const MAX_LOG_EXPOSURE = Math.log(1e11);

export const READING_TOPIC_LIBRARY =
  getLanguageConfig(DEFAULT_LANGUAGE_ID).readingTopics || [];

function createLanguageState(languageId = DEFAULT_LANGUAGE_ID) {
  return {
    isFlipped: false,
    currentIndex: 0,
    lexicon: [],
    frequencyMap: {},
    frequencyProbabilityMap: {},
    activeCard: null,
    debugMode: true,
    isLoadingCard: false,
    errorMessage: '',
    isLoadingAudio: false,
    audioErrorMessage: '',
    audioBySentence: {},
    currentAudioUrl: '',
    studyMode: 'reading',
    listeningCardChance: 0.5,
    currentCardMode: 'reading',
    activeLevelMode: 'reading',
    activeCalibrationMode: null,
    appMode: null,
    calibrationComplete: false,
    lexiconLoaded: false,
    readingSegments: [],
    readingSentenceContexts: [],
    readingGlossesByKey: {},
    readingProcessing: false,
    readingGlossLoading: false,
    readingErrorMessage: '',
    readingLastAnalyzedAt: null,
    readingAnalyzedText: '',
    readingGeneration: {
      topic: '',
      difficultyTarget: 0.92,
      paragraphCount: 3,
      lifetimeTokensEstimate: 0,
      isGenerating: false,
      attempts: 0,
      maxAttempts: 3,
      passageText: '',
      passageStats: null,
      difficultyHistory: [],
      debugSteps: [],
      lastUsedTopic: ''
    },
    calibrationProfiles: {
      reading: createProfileTemplate(),
      listening: createProfileTemplate()
    },
    calibrationStatusByMode: {
      reading: '',
      listening: ''
    },
    logExposureMean: DEFAULT_LOG_EXPOSURE,
    logExposureVar: DEFAULT_LOG_VARIANCE,
    minLogExposure: MIN_LOG_EXPOSURE,
    maxLogExposure: MAX_LOG_EXPOSURE,
    exposuresForMastery: 8,
    totalCorpusFrequency: 1,
    recentLevelUpdates: [],
    maxRecentLevelUpdates: 12,
    totalResponses: 0,
    debugCalibrationInput: '',
    debugCalibrationError: '',
    calibrationActive: false,
    calibrationResponses: [],
    calibrationQueue: [],
    calibrationSamplesTarget: 12,
    calibrationBuckets: [0.05, 0.15, 0.35, 0.55, 0.75],
    calibrationGridSize: 241,
    calibrationLogGrid: [],
    calibrationLogPosterior: [],
    calibrationPosterior: [],
    calibrationPosteriorMean: DEFAULT_LOG_EXPOSURE,
    calibrationPosteriorVar: DEFAULT_LOG_VARIANCE,
    calibrationPosteriorMedian: DEFAULT_LOG_EXPOSURE,
    calibrationPosteriorStdLog10: Number.POSITIVE_INFINITY,
    calibrationMedianIndex: 0,
    calibrationCredibleLowerIndex: 0,
    calibrationCredibleUpperIndex: 0,
    calibrationLastIndex: null,
    calibrationProbeCounts: {},
    calibrationStatusMessage: '',
    calibrationStdThreshold: 0.12,
    calibrationMaxSteps: 12,
    calibrationStepCount: 0,
    calibrationMinFrequencyProbability: 0,
    calibrationHistory: [],
    pendingCalibrationModes: [],
    lexiconIndexByWord: {},
    studyKnowledgeBase: {
      reading: {},
      listening: {}
    },
    studyMixStats: {
      reading: { newServed: 0, reviewServed: 0 },
      listening: { newServed: 0, reviewServed: 0 }
    },
    studyNewPerformance: {
      reading: { trials: 0, correct: 0 },
      listening: { trials: 0, correct: 0 }
    },
    studyDynamicSuccessRates: {
      reading: 0.5,
      listening: 0.5
    },
    studyNewWordRatio: 0.4,
    studyNewWordSpread: 0.12,
    studyCalibrationSensitivity: 0.6,
    studyMinSuccessRate: 0.35,
    studyMaxSuccessRate: 0.75,
    studyReviewBaseIntervalMinutes: 10,
    studyReviewHardIntervalMinutes: 4,
    studyReviewIncorrectIntervalMinutes: 1,
    studyReviewIntervalGrowth: 1.6,
    studyReviewEaseDefault: 2.4,
    studyReviewEaseMin: 1.2,
    studyReviewEaseMax: 3.5,
    studyReviewMaxIntervalMinutes: 60 * 24 * 60,
    studyReviewOverdueGraceMinutes: 10,
    currentStudyCard: null,
    pendingCardModeOverride: null,
    targetSuccessRate: 0.5,
    targetWindowSize: 100,
    responseOptions: ['easy', 'hard', 'incorrect']
  };
}

export const LANGUAGE_STATE_KEYS = Object.keys(createLanguageState());

export function createInitialState(options = {}) {
  const languageId = options.languageId || DEFAULT_LANGUAGE_ID;
  const languageState = createLanguageState(languageId);
  return {
    activeLanguage: languageId,
    languageChoices: LANGUAGE_OPTIONS,
    languageStateCache: {},
    isAuthenticated: false,
    loginForm: {
      username: 'test-user',
      password: 'langy-demo',
      apiKey: '',
      error: ''
    },
    userProfile: {
      username: '',
      apiKey: ''
    },
    ...languageState
  };
}

export { createLanguageState };

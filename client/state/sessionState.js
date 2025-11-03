import {
  DEFAULT_LOG_EXPOSURE,
  DEFAULT_LOG_VARIANCE,
  createProfileTemplate
} from '../utils/profile.js';

const MIN_LOG_EXPOSURE = Math.log(10);
const MAX_LOG_EXPOSURE = Math.log(1e11);

export function createInitialState() {
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
    isAuthenticated: false,
    calibrationComplete: false,
    lexiconLoaded: false,
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
    targetSuccessRate: 0.5,
    targetWindowSize: 100,
    responseOptions: ['sentence', 'focus', 'unknown']
  };
}

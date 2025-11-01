const DEFAULT_LOG_EXPOSURE = Math.log(5000);
const MIN_LOG_EXPOSURE = Math.log(10);
const MAX_LOG_EXPOSURE = Math.log(1e8);

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
    logExposureMean: DEFAULT_LOG_EXPOSURE,
    logExposureVar: 16,
    minLogExposure: MIN_LOG_EXPOSURE,
    maxLogExposure: MAX_LOG_EXPOSURE,
    exposuresForMastery: 8,
    totalCorpusFrequency: 1,
    recentLevelUpdates: [],
    maxRecentLevelUpdates: 12,
    totalResponses: 0,
    calibrationActive: true,
    calibrationResponses: [],
    calibrationQueue: [],
    calibrationSamplesTarget: 20,
    calibrationBuckets: [0.05, 0.15, 0.35, 0.55, 0.75],
    targetSuccessRate: 0.8,
    targetWindowSize: 100,
    responseOptions: ['sentence', 'focus', 'unknown']
  };
}

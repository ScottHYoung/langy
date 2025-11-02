import { masteryProbability } from './levelEstimator.js';

const LOG_EPS = 1e-12;
const DEFAULT_LOWER_QUANTILE = 0.16;
const DEFAULT_UPPER_QUANTILE = 0.84;

export function initializeCalibration(state) {
  state.calibrationActive = true;
  state.calibrationResponses = [];
  state.calibrationStepCount = 0;
  state.calibrationHistory = [];
  state.calibrationQueue = [];
  state.calibrationLastIndex = null;
  state.calibrationProbeCounts = {};
  ensurePosteriorInitialized(state);
}

export function consumeCalibrationIndex(state) {
  if (!state.lexicon.length) return null;
  if (!Array.isArray(state.calibrationPosterior) || !state.calibrationPosterior.length) {
    ensurePosteriorInitialized(state);
  }
  const probeCounts = state.calibrationProbeCounts || {};
  const targetLogExposure =
    typeof state.calibrationPosteriorMedian === 'number'
      ? state.calibrationPosteriorMedian
      : state.logExposureMean;
  let candidate = indexForLogExposure(state, targetLogExposure);

  let attempts = 0;
  while (attempts < 3) {
    const lastSame = state.calibrationLastIndex != null && candidate === state.calibrationLastIndex;
    const seenCount = probeCounts[candidate] ?? 0;
    if (!lastSame && seenCount === 0) {
      break;
    }
    const nudged = nudgeIndex(state, candidate, targetLogExposure, probeCounts);
    if (nudged === candidate) {
      break;
    }
    candidate = nudged;
    attempts += 1;
    const newSeen = probeCounts[candidate] ?? 0;
    if (newSeen === 0) {
      break;
    }
  }

  state.calibrationLastIndex = candidate;
  probeCounts[candidate] = (probeCounts[candidate] ?? 0) + 1;
  state.calibrationProbeCounts = probeCounts;
  return candidate;
}

export function handleCalibrationResponse(state, { word, freqProbability, outcome }) {
  state.totalResponses += 1;
  state.calibrationStepCount += 1;
  const observed = outcome ? 1 : 0;
  state.calibrationResponses.push({
    word,
    freqProbability,
    outcome: observed
  });

  if (freqProbability > 0) {
    applyLikelihood(state, freqProbability, observed);
  }

  const historyEntry = buildHistoryEntry(state, { word, observed, freqProbability });
  state.calibrationHistory.push(historyEntry);
  if (state.calibrationHistory.length > 40) {
    state.calibrationHistory.shift();
  }

  if (!state.calibrationActive) {
    return null;
  }

  if (shouldStopCalibration(state)) {
    const priorMean = state.logExposureMean;
    finalizeCalibration(state);
    return {
      fit: {
        mean: state.logExposureMean,
        variance: state.logExposureVar,
        median: state.calibrationPosteriorMedian,
        stdLog10: state.calibrationPosteriorStdLog10
      },
      priorMean
    };
  }

  return null;
}

function ensurePosteriorInitialized(state) {
  const gridSize = Math.max(31, Math.floor(state.calibrationGridSize) || 241);
  const minLog = state.minLogExposure;
  const maxLog = state.maxLogExposure;
  const step = gridSize <= 1 ? 0 : (maxLog - minLog) / (gridSize - 1);
  const grid = new Array(gridSize);
  const logPosterior = new Array(gridSize);
  const priorMean = state.logExposureMean;
  const priorVar = Math.max(state.logExposureVar, 1);

  for (let i = 0; i < gridSize; i += 1) {
    const value = minLog + step * i;
    grid[i] = value;
    const diff = value - priorMean;
    logPosterior[i] = -0.5 * (diff * diff) / priorVar;
  }

  state.calibrationLogGrid = grid;
  state.calibrationLogPosterior = logPosterior;
  normalizePosterior(state);
}

function applyLikelihood(state, freqProbability, outcome) {
  const logPosterior = state.calibrationLogPosterior;
  const grid = state.calibrationLogGrid;
  if (!Array.isArray(logPosterior) || !Array.isArray(grid) || !logPosterior.length) {
    return;
  }

  const exposuresForMastery = state.exposuresForMastery;
  for (let i = 0; i < grid.length; i += 1) {
    const logExposure = grid[i];
    const probability = masteryProbability(logExposure, exposuresForMastery, freqProbability);
    const likelihood = outcome ? probability : 1 - probability;
    logPosterior[i] += Math.log(Math.max(likelihood, LOG_EPS));
  }
  normalizePosterior(state);
}

function normalizePosterior(state) {
  const logPosterior = state.calibrationLogPosterior;
  if (!Array.isArray(logPosterior) || !logPosterior.length) {
    state.calibrationPosterior = [];
    return;
  }
  const logSum = logSumExp(logPosterior);
  const posterior = new Array(logPosterior.length);
  for (let i = 0; i < logPosterior.length; i += 1) {
    posterior[i] = Math.exp(logPosterior[i] - logSum);
    logPosterior[i] -= logSum;
  }
  state.calibrationPosterior = posterior;
  updatePosteriorStats(state);
}

function updatePosteriorStats(state) {
  const grid = state.calibrationLogGrid;
  const posterior = state.calibrationPosterior;
  if (!Array.isArray(grid) || !Array.isArray(posterior) || !posterior.length) {
    return;
  }

  let mean = 0;
  let meanLog10 = 0;
  for (let i = 0; i < grid.length; i += 1) {
    const weight = posterior[i];
    mean += weight * grid[i];
    meanLog10 += weight * (grid[i] / Math.log(10));
  }

  let variance = 0;
  let varianceLog10 = 0;
  for (let i = 0; i < grid.length; i += 1) {
    const weight = posterior[i];
    const diff = grid[i] - mean;
    variance += weight * diff * diff;
    const diffLog10 = grid[i] / Math.log(10) - meanLog10;
    varianceLog10 += weight * diffLog10 * diffLog10;
  }

  const median = posteriorQuantile(grid, posterior, 0.5);
  const lower = posteriorQuantile(grid, posterior, DEFAULT_LOWER_QUANTILE);
  const upper = posteriorQuantile(grid, posterior, DEFAULT_UPPER_QUANTILE);

  state.calibrationPosteriorMean = mean;
  state.calibrationPosteriorVar = Math.min(36, Math.max(1e-4, variance));
  state.calibrationPosteriorMedian = median;
  state.calibrationPosteriorStdLog10 = Math.sqrt(Math.max(varianceLog10, 0));
  state.calibrationMedianIndex = indexForLogExposure(state, median);
  state.calibrationCredibleLowerIndex = indexForLogExposure(state, lower);
  state.calibrationCredibleUpperIndex = indexForLogExposure(state, upper);

  state.logExposureMean = state.calibrationPosteriorMean;
  state.logExposureVar = state.calibrationPosteriorVar;
}

function shouldStopCalibration(state) {
  const stdThreshold =
    typeof state.calibrationStdThreshold === 'number' && state.calibrationStdThreshold > 0
      ? state.calibrationStdThreshold
      : 0.12;
  const maxSteps =
    typeof state.calibrationMaxSteps === 'number' && state.calibrationMaxSteps > 0
      ? state.calibrationMaxSteps
      : 12;

  const stdLog10 = state.calibrationPosteriorStdLog10;
  const narrowEnough = Number.isFinite(stdLog10) && stdLog10 <= stdThreshold;
  if (narrowEnough) return true;
  return state.calibrationStepCount >= maxSteps;
}

function finalizeCalibration(state) {
  state.calibrationActive = false;
  state.calibrationQueue = [];
  state.calibrationLastIndex = null;
  state.calibrationProbeCounts = {};
  state.calibrationResponses = [];
}

function indexForLogExposure(state, logExposure) {
  const lexicon = state.lexicon;
  if (!Array.isArray(lexicon) || !lexicon.length) {
    return 0;
  }
  const targetProbability = 0.5;
  const maxIndex = lexicon.length - 1;
  const minFreq = Math.max(0, state.calibrationMinFrequencyProbability || 0);
  let low = 0;
  let high = maxIndex;
  let bestIndex = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const entry = lexicon[mid];
    if (!entry) break;
    const freqProbability = state.frequencyProbabilityMap[entry.word] ?? 0;
    if (freqProbability <= 0) {
      high = mid - 1;
      continue;
    }
    const probability = masteryProbability(logExposure, state.exposuresForMastery, freqProbability);
    const score = Math.abs(probability - targetProbability);
    if (score < bestScore && freqProbability >= minFreq) {
      bestScore = score;
      bestIndex = mid;
    }
    if (probability > targetProbability) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (!Number.isFinite(bestScore)) {
    bestIndex = Math.min(Math.max(Math.floor(lexicon.length / 2), 0), maxIndex);
  }
  return Math.max(0, Math.min(maxIndex, bestIndex));
}

function nudgeIndex(state, index, referenceLogExposure, probeCounts = null) {
  const maxIndex = state.lexicon.length - 1;
  const candidates = [];
  if (index > 0) candidates.push(index - 1);
  if (index < maxIndex) candidates.push(index + 1);
  if (!candidates.length) return index;

  const counts = probeCounts || null;
  const currentCount = counts ? counts[index] ?? 0 : 0;

  const adjustScore = (score, candidateCount) => {
    if (!counts) return score;
    if (candidateCount === 0) return score - 1e-3;
    if (candidateCount <= currentCount) return score;
    return score + 0.05 * (candidateCount - currentCount);
  };

  const baseScore = scoreForIndex(state, index, referenceLogExposure);
  let bestIndex = index;
  let bestScore = adjustScore(baseScore, currentCount);
  let fallbackIndex = null;
  let fallbackScore = Number.POSITIVE_INFINITY;
  const minFreq = Math.max(0, state.calibrationMinFrequencyProbability || 0);
  const maxOffset = Math.min(maxIndex, Math.max(25, Math.ceil(state.lexicon.length * 0.01)));

  const considerCandidate = (candidate) => {
    if (candidate < 0 || candidate > maxIndex) return;
    const entry = state.lexicon[candidate];
    if (!entry) return;
    const freqProbability = state.frequencyProbabilityMap[entry.word] ?? 0;
    if (freqProbability <= 0) return;
    const score = scoreForIndex(state, candidate, referenceLogExposure);
    const candidateCount = counts ? counts[candidate] ?? 0 : 0;
    const adjustedScore = adjustScore(score, candidateCount);
    if (freqProbability >= minFreq) {
      if (
        adjustedScore < bestScore - 1e-6 ||
        (candidate !== index && Math.abs(adjustedScore - bestScore) <= 1e-6)
      ) {
        bestScore = adjustedScore;
        bestIndex = candidate;
      }
    }
    if (fallbackIndex == null || adjustedScore < fallbackScore) {
      fallbackIndex = candidate;
      fallbackScore = adjustedScore;
    }
  };

  // First check immediate neighbours
  candidates.forEach(considerCandidate);

  if (bestIndex !== index) return bestIndex;

  for (let offset = 2; offset <= maxOffset; offset += 1) {
    considerCandidate(index - offset);
    if (bestIndex !== index) break;
    considerCandidate(index + offset);
    if (bestIndex !== index) break;
  }

  if (bestIndex !== index) {
    return bestIndex;
  }

  if (fallbackIndex != null) {
    return fallbackIndex;
  }

  return index;
}

function scoreForIndex(state, index, logExposure) {
  const entry = state.lexicon[index];
  if (!entry) return Number.POSITIVE_INFINITY;
  const freqProbability = state.frequencyProbabilityMap[entry.word] ?? 0;
  if (freqProbability <= 0) return Number.POSITIVE_INFINITY;
  const probability = masteryProbability(logExposure, state.exposuresForMastery, freqProbability);
  return Math.abs(probability - 0.5);
}

function posteriorQuantile(grid, posterior, quantile) {
  if (!posterior.length) return grid.length ? grid[0] : 0;
  const target = Math.min(1, Math.max(0, quantile));
  let cumulative = 0;
  for (let i = 0; i < posterior.length; i += 1) {
    cumulative += posterior[i];
    if (cumulative >= target) {
      return grid[i];
    }
  }
  return grid[posterior.length - 1];
}

function logSumExp(values) {
  if (!values.length) return -Infinity;
  let maxValue = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] > maxValue) {
      maxValue = values[i];
    }
  }
  if (!Number.isFinite(maxValue)) return maxValue;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += Math.exp(values[i] - maxValue);
  }
  return maxValue + Math.log(sum);
}

function buildHistoryEntry(state, { word, observed, freqProbability }) {
  return {
    id: `cal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    step: state.calibrationStepCount,
    word,
    outcome: observed,
    freqProbability,
    medianIndex: state.calibrationMedianIndex,
    lowerIndex: state.calibrationCredibleLowerIndex,
    upperIndex: state.calibrationCredibleUpperIndex,
    posteriorMean: state.calibrationPosteriorMean,
    posteriorMedian: state.calibrationPosteriorMedian,
    posteriorStdLog10: state.calibrationPosteriorStdLog10
  };
}

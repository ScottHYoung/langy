import { evaluateExposureLikelihood } from './levelEstimator.js';

export function initializeCalibration(state) {
  state.calibrationActive = true;
  state.calibrationResponses = [];
  state.calibrationQueue = buildCalibrationQueue(state);
}

export function consumeCalibrationIndex(state) {
  while (state.calibrationQueue.length) {
    const idx = state.calibrationQueue.shift();
    if (Number.isInteger(idx)) {
      return Math.max(0, Math.min(state.lexicon.length - 1, idx));
    }
  }
  return null;
}

export function handleCalibrationResponse(state, { word, freqProbability, outcome }) {
  state.totalResponses += 1;
  state.calibrationResponses.push({
    word,
    freqProbability,
    outcome: outcome ? 1 : 0
  });

  const samplesReached = state.calibrationResponses.length >= state.calibrationSamplesTarget;
  const queueExhausted = state.calibrationQueue.length === 0;

  if (!samplesReached && !queueExhausted) {
    return null;
  }

  const priorMean = state.logExposureMean;
  const fit = fitExposureFromCalibration(state);
  if (fit) {
    state.logExposureMean = fit.mean;
    state.logExposureVar = fit.variance;
  }
  state.calibrationActive = false;
  state.calibrationQueue = [];
  state.calibrationResponses = [];

  return fit ? { fit, priorMean } : null;
}

function fitExposureFromCalibration(state) {
  const responses = state.calibrationResponses;
  if (!responses.length) return null;
  const minLog = state.minLogExposure;
  const maxLog = state.maxLogExposure;
  const coarseSteps = 400;
  let bestLog = minLog;
  let bestLogLik = -Infinity;
  for (let i = 0; i <= coarseSteps; i += 1) {
    const candidate = minLog + ((maxLog - minLog) * i) / coarseSteps;
    const { logLikelihood } = evaluateExposureLikelihood(state, candidate, responses);
    if (logLikelihood > bestLogLik) {
      bestLogLik = logLikelihood;
      bestLog = candidate;
    }
  }
  const window = (maxLog - minLog) / coarseSteps;
  const lower = Math.max(minLog, bestLog - window);
  const upper = Math.min(maxLog, bestLog + window);
  const refineSteps = 60;
  let refinedBestLog = bestLog;
  let refinedBestLik = bestLogLik;
  for (let i = 0; i <= refineSteps; i += 1) {
    const candidate = lower + ((upper - lower) * i) / refineSteps;
    const { logLikelihood } = evaluateExposureLikelihood(state, candidate, responses);
    if (logLikelihood > refinedBestLik) {
      refinedBestLik = logLikelihood;
      refinedBestLog = candidate;
    }
  }
  const stats = evaluateExposureLikelihood(state, refinedBestLog, responses);
  const variance = stats.hessian < 0 ? Math.min(36, Math.max(0.05, -1 / stats.hessian)) : 16;
  return {
    mean: refinedBestLog,
    variance,
    logLikelihood: refinedBestLik
  };
}

function buildCalibrationQueue(state) {
  if (!state.lexicon.length) {
    return [];
  }
  const maxIndex = state.lexicon.length - 1;
  const queue = [];
  const seen = new Set();
  const buckets =
    Array.isArray(state.calibrationBuckets) && state.calibrationBuckets.length
      ? state.calibrationBuckets
      : [0.05, 0.15, 0.35, 0.55, 0.75];
  const perBucket = Math.max(1, Math.floor(state.calibrationSamplesTarget / buckets.length));

  buckets.forEach((percent) => {
    const center = Math.max(0, Math.min(maxIndex, Math.round(percent * maxIndex)));
    for (let i = 0; i < perBucket; i += 1) {
      const offset = i - Math.floor(perBucket / 2);
      const idx = Math.max(0, Math.min(maxIndex, center + offset));
      if (!seen.has(idx)) {
        seen.add(idx);
        queue.push(idx);
      }
    }
  });

  const maxAttempts = state.calibrationSamplesTarget * 5;
  let attempts = 0;
  while (queue.length < state.calibrationSamplesTarget && attempts < maxAttempts) {
    const randomIdx = Math.floor(Math.random() * Math.max(1, state.lexicon.length));
    attempts += 1;
    if (!seen.has(randomIdx)) {
      seen.add(randomIdx);
      queue.push(randomIdx);
    }
  }

  if (queue.length && queue.length < state.calibrationSamplesTarget) {
    let pointer = 0;
    while (queue.length < state.calibrationSamplesTarget) {
      queue.push(queue[pointer % queue.length]);
      pointer += 1;
    }
  }

  return queue.slice(0, state.calibrationSamplesTarget);
}

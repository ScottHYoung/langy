import { clampProbability } from '../utils/formatters.js';

export function wordProbability(state, word) {
  const freqProbability = state.frequencyProbabilityMap[word] ?? 0;
  if (freqProbability <= 0) return 0;
  return masteryProbability(state.logExposureMean, state.exposuresForMastery, freqProbability);
}

export function masteryProbability(logExposureMean, exposuresForMastery, freqProbability) {
  const exposures = Math.exp(logExposureMean) * freqProbability;
  const ratio = exposures / Math.max(exposuresForMastery, 1e-3);
  const mastery = 1 - Math.exp(-ratio);
  return clampProbability(mastery);
}

export function applyLevelUpdate(state, word, freqProbability, isKnown) {
  const priorMean = state.logExposureMean;
  const priorVar = state.logExposureVar;
  const priorProbability = wordProbability(state, word);
  const { mean, variance } = updateLevelPosterior(state, freqProbability, isKnown ? 1 : 0);
  state.logExposureMean = mean;
  state.logExposureVar = variance;
  return {
    priorMean,
    priorVar,
    priorProbability,
    posteriorMean: mean,
    posteriorVar: variance
  };
}

export function updateLevelPosterior(state, freqProbability, outcome) {
  const minProb = 1e-6;
  const maxProb = 1 - 1e-6;
  const priorMean = state.logExposureMean;
  const priorVar = Math.max(state.logExposureVar, 1e-4);
  const exposures = Math.exp(priorMean) * freqProbability;
  const ratio = exposures / Math.max(state.exposuresForMastery, 1e-3);
  const mastery = clampProbability(1 - Math.exp(-ratio), minProb, maxProb);
  const s = 1 - mastery;
  const a = ratio;
  const pPrime = s * a;
  const pSecond = s * a * (1 - a);
  const outcomeClamped = outcome ? 1 : 0;
  const grad = outcomeClamped * (pPrime / mastery) - (1 - outcomeClamped) * (pPrime / s);
  const hess =
    outcomeClamped * (pSecond / mastery - (pPrime ** 2) / (mastery ** 2)) -
    (1 - outcomeClamped) * (pSecond / s + (pPrime ** 2) / (s ** 2));
  const priorPrecision = 1 / priorVar;
  const posteriorPrecision = Math.max(1e-6, priorPrecision - hess);
  const posteriorVar = 1 / posteriorPrecision;
  const posteriorMean = priorMean + posteriorVar * grad;
  const clampedMean = Math.min(state.maxLogExposure, Math.max(state.minLogExposure, posteriorMean));
  const clampedVar = Math.min(36, Math.max(1e-4, posteriorVar));
  return { mean: clampedMean, variance: clampedVar };
}

export function evaluateExposureLikelihood(state, logExposure, responses) {
  const minProb = 1e-8;
  const maxProb = 1 - 1e-8;
  let logLikelihood = 0;
  let gradient = 0;
  let hessian = 0;
  responses.forEach(({ freqProbability, outcome }) => {
    const ratio =
      Math.exp(logExposure) * freqProbability / Math.max(state.exposuresForMastery, 1e-3);
    const mastery = clampProbability(1 - Math.exp(-ratio), minProb, maxProb);
    const s = 1 - mastery;
    const outcomeClamped = outcome ? 1 : 0;
    logLikelihood += outcomeClamped ? Math.log(mastery) : Math.log(s);
    const pPrime = s * ratio;
    const pSecond = s * ratio * (1 - ratio);
    gradient += outcomeClamped * (pPrime / mastery) - (1 - outcomeClamped) * (pPrime / s);
    hessian +=
      outcomeClamped * (pSecond / mastery - (pPrime ** 2) / (mastery ** 2)) -
      (1 - outcomeClamped) * (pSecond / s + (pPrime ** 2) / (s ** 2));
  });
  return { logLikelihood, gradient, hessian };
}

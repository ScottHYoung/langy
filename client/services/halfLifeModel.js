const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const HALF_LIFE_DEFAULTS = {
  alpha0: 0.1,
  alpha1: 0.25,
  alpha2: 0.05,
  alpha3: 0.1,
  h0: 0.5,
  minHalfLife: 0.1,
  maxHalfLife: 180
};

export function initializeHalfLifeState({ prior = 0, params = {} } = {}) {
  const merged = { ...HALF_LIFE_DEFAULTS, ...params };
  const now = Date.now();
  const halfLife = merged.h0 * (1 + 4 * clamp(prior, 0, 1));
  return {
    halfLife,
    lastSeen: now,
    lastOutcome: null,
    history: [
      {
        timestamp: now,
        probability: 1
      }
    ]
  };
}

export function predictRecall(state, now = Date.now()) {
  if (!state) return { deltaDays: 0, probability: 0 };
  const deltaMs = Math.max(0, now - (state.lastSeen || now));
  const deltaDays = deltaMs / (1000 * 60 * 60 * 24);
  const probability = Math.pow(2, -deltaDays / Math.max(state.halfLife || 0.1, 1e-4));
  return { deltaDays, probability: clamp(probability, 0, 1) };
}

export function applyHalfLifeUpdate(state, outcome, now = Date.now(), params = {}) {
  if (!state) return state;
  const merged = { ...HALF_LIFE_DEFAULTS, ...params };
  const { deltaDays } = predictRecall(state, now);
  const logHalfLife = Math.log(Math.max(state.halfLife || merged.h0, 1e-4));
  const logDelta = Math.log(deltaDays + 1);
  const gain =
    merged.alpha0 +
    merged.alpha1 * outcome +
    merged.alpha2 * logDelta +
    merged.alpha3 * outcome * logDelta;
  const nextHalfLife = Math.exp(logHalfLife + gain);
  const clamped = clamp(nextHalfLife, merged.minHalfLife, merged.maxHalfLife);
  const nextState = {
    ...state,
    halfLife: clamped,
    lastSeen: now,
    lastOutcome: outcome,
    history: [...(state.history || [])]
  };
  const { probability } = predictRecall(nextState, now);
  nextState.history.push({
    timestamp: now,
    probability
  });
  if (nextState.history.length > 200) {
    nextState.history.shift();
  }
  return nextState;
}

export function simulateFutureProbability(state, minutesAhead = 0) {
  if (!state) return 0;
  const future = (state.lastSeen || Date.now()) + minutesAhead * 60 * 1000;
  return predictRecall(state, future).probability;
}

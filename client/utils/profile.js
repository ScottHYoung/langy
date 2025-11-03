const DEFAULT_LOG_EXPOSURE = Math.log(5000);
const DEFAULT_LOG_VARIANCE = 16;

export { DEFAULT_LOG_EXPOSURE, DEFAULT_LOG_VARIANCE };

export function createProfileTemplate(overrides = {}) {
  return {
    logExposureMean: DEFAULT_LOG_EXPOSURE,
    logExposureVar: DEFAULT_LOG_VARIANCE,
    calibrated: false,
    calibrationStatusMessage: '',
    lastCalibratedAt: null,
    ...overrides
  };
}

export function ensureLevelProfile(state, mode) {
  if (!state || typeof state !== 'object' || !mode) {
    return createProfileTemplate();
  }
  if (!state.calibrationProfiles || typeof state.calibrationProfiles !== 'object') {
    state.calibrationProfiles = {};
  }
  if (!state.calibrationProfiles[mode]) {
    state.calibrationProfiles[mode] = createProfileTemplate();
  }
  return state.calibrationProfiles[mode];
}

export function getLevelProfile(state, mode) {
  return ensureLevelProfile(state, mode);
}

export function setLevelProfileStats(state, mode, { mean, variance } = {}) {
  const profile = ensureLevelProfile(state, mode);
  if (!profile) return;
  if (typeof mean === 'number' && Number.isFinite(mean)) {
    profile.logExposureMean = mean;
  }
  if (typeof variance === 'number' && Number.isFinite(variance)) {
    profile.logExposureVar = variance;
  }
}

export function markProfileCalibrated(state, mode, statusMessage = '') {
  const profile = ensureLevelProfile(state, mode);
  if (!profile) return;
  profile.calibrated = true;
  profile.lastCalibratedAt = Date.now();
  if (typeof statusMessage === 'string') {
    profile.calibrationStatusMessage = statusMessage;
  }
}

export function clearProfileCalibration(state, mode) {
  const profile = ensureLevelProfile(state, mode);
  if (!profile) return;
  profile.calibrated = false;
  profile.calibrationStatusMessage = '';
  profile.lastCalibratedAt = null;
}

export function isLevelProfileCalibrated(state, mode) {
  const profile = ensureLevelProfile(state, mode);
  return Boolean(profile?.calibrated);
}

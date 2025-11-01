export function formatPercent(value) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(1)}%`;
}

export function formatDelta(value) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(3)}`;
}

export function formatTokens(value) {
  if (!Number.isFinite(value)) return '—';
  if (value >= 1e7) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e4) return `${(value / 1e3).toFixed(1)}k`;
  return Math.round(value).toLocaleString();
}

export function formatStd(value) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

export function clampProbability(value, min = 1e-6, max = 1 - 1e-6) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// Baseline gaze evaluation instrumentation (Milestone 0).
// Purely observational: records what already happens, changes no behavior.

const STORAGE_KEY = "contextGazeEvaluationSamples";
const MAX_SAMPLES = 300;

const samples = [];
const counts = {
  successfulDwell: 0,
  cancelledDwell: 0,
  accidentalActivation: 0
};

function loadPersisted() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) samples.push(...parsed.slice(-MAX_SAMPLES));
  } catch (e) {
    console.warn("Evaluation history could not be loaded; starting empty.", e);
  }
}
loadPersisted();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(samples.slice(-MAX_SAMPLES)));
  } catch (e) {
    // storage may be full or unavailable; evaluation is best-effort only
  }
}

export function recordEvaluationSample(sample) {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
  counts.successfulDwell++;
  persist();
}

export function recordDwellCancelled() {
  counts.cancelledDwell++;
}

export function recordAccidentalActivation() {
  counts.accidentalActivation++;
}

export function getEvaluationSamples() {
  return samples.slice();
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

export function getEvaluationSummary() {
  const errors = samples.map(s => s.errorPx).filter(v => typeof v === "number").sort((a, b) => a - b);
  const dwellTimes = samples.map(s => s.dwellDuration).filter(v => typeof v === "number");
  const mean = errors.length ? errors.reduce((a, b) => a + b, 0) / errors.length : null;
  const median = errors.length ? percentile(errors, 0.5) : null;
  const p90 = errors.length ? percentile(errors, 0.9) : null;
  const averageDwellTime = dwellTimes.length
    ? dwellTimes.reduce((a, b) => a + b, 0) / dwellTimes.length
    : null;
  return {
    sampleCount: samples.length,
    meanErrorPx: mean,
    medianErrorPx: median,
    p90ErrorPx: p90,
    successfulDwellCount: counts.successfulDwell,
    cancelledDwellCount: counts.cancelledDwell,
    accidentalActivationCount: counts.accidentalActivation,
    averageDwellTime
  };
}

export function clearEvaluationSamples() {
  samples.length = 0;
  counts.successfulDwell = 0;
  counts.cancelledDwell = 0;
  counts.accidentalActivation = 0;
  localStorage.removeItem(STORAGE_KEY);
}

// Console access for manual inspection, per Milestone 0 acceptance criteria.
window.ContextGazeEval = {
  getSamples: getEvaluationSamples,
  getSummary: getEvaluationSummary,
  clear: clearEvaluationSamples
};

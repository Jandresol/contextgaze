// Per-point calibration sample quality validation.
//
// During calibration collection, app.js gathers one full feature object
// (see featureExtraction.js: { vector, iris, head, eyeOpenness, faceBox,
// timestamp }) per video frame where a face was detected while the user is
// asked to hold their gaze on a target. This module decides whether that
// batch of frames is reliable enough to use for fitting the calibration
// model, or whether the point should be retried.
//
// All tuning knobs live in SAMPLE_QUALITY_CONFIG so nothing is scattered as
// magic numbers through app.js. The numeric thresholds below are reasonable
// starting points for the feature scales this app already uses (see
// featureExtraction.js) — they are meant to be tuned by manual testing, not
// derived from a dataset.

export const SAMPLE_QUALITY_CONFIG = {
  // Collection timing (used by app.js instead of hardcoded delays).
  settleMs: 600,   // time to let eyes/head settle onto the new target before collecting
  collectMs: 1800, // actual collection window once settled

  // Hard floors on how much usable data a point needs.
  minUsableFrames: 10,       // raw frames with a detected face, out of the collection window
  minValidLandmarksPct: 0.6, // usableFrames / attemptedFrames — guards against a flickering face lock
  minFilteredFrames: 6,      // frames that must survive per-frame filtering to build a training sample

  // Stability thresholds, expressed as population variance over the
  // collection window. lx/ly/rx/ry are the pupil-in-eye-socket ratios
  // produced by expandFeatures() (indices 1-4 of the feature vector) —
  // already normalized relative to eye-corner landmarks, so they capture
  // gaze direction largely independent of head position/size. That makes
  // them a more direct "is the gaze steady" signal than raw iris pixel
  // coordinates, so we use them for the iris variance metrics below.
  maxIrisVariance: 0.004,          // lx/ly/rx/ry variance ceiling (steady fixation)
  maxHeadPositionVariance: 0.0008, // head.nx/ny variance ceiling (head held still)
  maxFaceWidthVariance: 0.00015,   // head.faceWidth variance ceiling (distance from camera held still)
  maxRollVariance: 0.0015,         // head.roll (radians) variance ceiling (no head tilt drift)

  // Eye-openness thresholds. eyeOpenness.{left,right} is an eyelid-gap /
  // eye-width ratio; values well below typical open-eye range indicate a
  // blink or squint.
  minEyeOpennessMean: 0.12,        // average openness across the window must be at least this
  blinkFrameOpennessThreshold: 0.09, // a single frame below this is treated as "eyes closed"
  maxLowOpennessFrameRatio: 0.35,  // fraction of frames allowed to be blink-like before rejecting

  // Per-frame statistical outlier rejection (applied to lx/ly/rx/ry) when
  // building the filtered/representative sample — same idea as a simple
  // 2-sigma trim.
  outlierStdDevs: 2,

  // Overall acceptance.
  minScore: 0.6
};

function variance(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// 1.0 when value is comfortably under threshold, 0.0 once it reaches or
// exceeds it. Used for "lower is better" metrics like variances.
function scoreBelowIsGood(value, threshold) {
  if (threshold <= 0) return value <= 0 ? 1 : 0;
  return clamp01(1 - value / threshold);
}

// 1.0 once value reaches threshold, scaling down to 0 below it. Used for
// "higher is better" metrics like eye openness or valid-landmark ratio.
function scoreAboveIsGood(value, threshold) {
  if (threshold <= 0) return 1;
  return clamp01(value / threshold);
}

function meanOpenness(sample) {
  return (sample.eyeOpenness.left + sample.eyeOpenness.right) / 2;
}

// Computes the diagnostic metrics described in the plan from the raw
// (unfiltered) collected feature objects for one calibration point.
//
// `attemptedFrames` is the total number of video frames the app tried to
// process during the collection window (including frames where no face was
// detected), used to approximate "percentage of frames with valid
// landmarks". If the caller doesn't track attempts, it defaults to
// rawSamples.length, which degrades gracefully to "100% of captured frames
// were valid" (a slight overestimate, since it can't see dropped frames).
export function computeSampleMetrics(rawSamples, attemptedFrames = rawSamples.length, config = SAMPLE_QUALITY_CONFIG) {
  const usableFrameCount = rawSamples.length;
  const validLandmarksPct = attemptedFrames > 0
    ? usableFrameCount / attemptedFrames
    : (usableFrameCount > 0 ? 1 : 0);

  const lx = rawSamples.map(s => s.vector[1]);
  const ly = rawSamples.map(s => s.vector[2]);
  const rx = rawSamples.map(s => s.vector[3]);
  const ry = rawSamples.map(s => s.vector[4]);
  const nx = rawSamples.map(s => s.head.nx);
  const ny = rawSamples.map(s => s.head.ny);
  const faceWidth = rawSamples.map(s => s.head.faceWidth);
  const roll = rawSamples.map(s => s.head.roll);
  const opennessPerFrame = rawSamples.map(meanOpenness);

  const irisHorizontalVariance = (variance(lx) + variance(rx)) / 2;
  const irisVerticalVariance = (variance(ly) + variance(ry)) / 2;
  const headPositionVariance = (variance(nx) + variance(ny)) / 2;
  const faceWidthVariance = variance(faceWidth);
  const rollVariance = variance(roll);
  const eyeOpennessMean = opennessPerFrame.length
    ? opennessPerFrame.reduce((a, b) => a + b, 0) / opennessPerFrame.length
    : 0;
  const eyeOpennessVariance = variance(opennessPerFrame);
  const lowOpennessFrameRatio = opennessPerFrame.length
    ? opennessPerFrame.filter(v => v < config.blinkFrameOpennessThreshold).length / opennessPerFrame.length
    : 0;

  return {
    usableFrameCount,
    attemptedFrames,
    validLandmarksPct,
    irisHorizontalVariance,
    irisVerticalVariance,
    headPositionVariance,
    faceWidthVariance,
    rollVariance,
    eyeOpennessMean,
    eyeOpennessVariance,
    lowOpennessFrameRatio
  };
}

// Removes frames that look like blinks, then trims statistical outliers on
// the iris-position components — conceptually the same 2-sigma trim the
// previous rejectOutliers() did, generalized to both eyes and kept as full
// feature objects (rather than bare vectors) so callers retain iris/head/
// eyeOpenness context for diagnostics.
export function filterSamples(rawSamples, config = SAMPLE_QUALITY_CONFIG) {
  if (rawSamples.length === 0) return [];

  let samples = rawSamples.filter(s => meanOpenness(s) >= config.blinkFrameOpennessThreshold);
  if (samples.length === 0) samples = rawSamples; // all frames looked like blinks — keep raw rather than discard everything

  for (const idx of [1, 2, 3, 4]) {
    if (samples.length < 4) break;
    const vals = samples.map(s => s.vector[idx]);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const std = Math.sqrt(variance(vals));
    samples = samples.filter(s => Math.abs(s.vector[idx] - mean) <= config.outlierStdDevs * std);
  }
  return samples;
}

// Per-dimension median feature vector across the given samples (not mean —
// medians resist the residual outliers/blink frames that survive filtering).
export function medianVector(samples) {
  if (!samples.length) return null;
  const dims = samples[0].vector.length;
  const out = new Array(dims);
  for (let d = 0; d < dims; d++) {
    const vals = samples.map(s => s.vector[d]).sort((a, b) => a - b);
    const mid = Math.floor(vals.length / 2);
    out[d] = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  }
  return out;
}

function scoreFromMetrics(metrics, config) {
  const components = [
    scoreBelowIsGood(metrics.irisHorizontalVariance, config.maxIrisVariance),
    scoreBelowIsGood(metrics.irisVerticalVariance, config.maxIrisVariance),
    scoreBelowIsGood(metrics.headPositionVariance, config.maxHeadPositionVariance),
    scoreBelowIsGood(metrics.faceWidthVariance, config.maxFaceWidthVariance),
    scoreBelowIsGood(metrics.rollVariance, config.maxRollVariance),
    scoreAboveIsGood(metrics.eyeOpennessMean, config.minEyeOpennessMean),
    scoreAboveIsGood(metrics.validLandmarksPct, config.minValidLandmarksPct)
  ];
  return components.reduce((a, b) => a + b, 0) / components.length;
}

// Main entry point: assesses one calibration point's collected frames and
// decides accept/retry.
//
// rawSamples: array of full feature objects (extractFeatures() output),
//   exactly as collected during the point's collection window.
// attemptedFrames: total frames attempted during the collection window
//   (including ones with no detected face); see computeSampleMetrics().
//
// Returns { accepted, score, reasons, rawSamples, filteredSamples,
//   representativeVector, metrics } as described in the plan.
export function assessCalibrationSample(rawSamples, { attemptedFrames = rawSamples.length, config = SAMPLE_QUALITY_CONFIG } = {}) {
  const metrics = computeSampleMetrics(rawSamples, attemptedFrames, config);
  const filteredSamples = filterSamples(rawSamples, config);
  const representativeVector = medianVector(filteredSamples.length ? filteredSamples : rawSamples);

  const reasons = [];
  if (metrics.usableFrameCount < config.minUsableFrames) {
    reasons.push("Not enough frames captured — hold still and keep your face in view.");
  }
  if (metrics.validLandmarksPct < config.minValidLandmarksPct) {
    reasons.push("Face was lost too often — center your face in the camera.");
  }
  if (metrics.irisHorizontalVariance > config.maxIrisVariance || metrics.irisVerticalVariance > config.maxIrisVariance) {
    reasons.push("Gaze was not steady — try to fix your eyes on the dot.");
  }
  if (metrics.headPositionVariance > config.maxHeadPositionVariance) {
    reasons.push("Too much head movement — try to hold still.");
  }
  if (metrics.faceWidthVariance > config.maxFaceWidthVariance) {
    reasons.push("Distance from the camera changed — try to hold still.");
  }
  if (metrics.rollVariance > config.maxRollVariance) {
    reasons.push("Head tilted during collection — try to hold still.");
  }
  if (metrics.eyeOpennessMean < config.minEyeOpennessMean) {
    reasons.push("Eyes appeared closed — try again with eyes more open.");
  } else if (metrics.lowOpennessFrameRatio > config.maxLowOpennessFrameRatio) {
    reasons.push("Eyes appeared closed for part of the window — try again with eyes more open.");
  }
  if (filteredSamples.length < config.minFilteredFrames) {
    reasons.push("Too few steady frames survived filtering — try again.");
  }

  const score = scoreFromMetrics(metrics, config);
  if (reasons.length === 0 && score < config.minScore) {
    reasons.push("Overall sample quality was too low — try again.");
  }

  return {
    accepted: reasons.length === 0,
    score,
    reasons,
    rawSamples,
    filteredSamples,
    representativeVector,
    metrics
  };
}

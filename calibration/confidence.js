// Live gaze-confidence estimation (Milestone 3).
//
// Scores whether *this frame's* gaze prediction should be trusted enough to
// drive dwell activation. This is a different signal from app.js's
// updateQuality(), which only measures raw face position/size and has no
// notion of calibration or prediction — confidence combines that kind of
// signal with calibration-coverage and stability signals to answer "should
// we act on this specific prediction right now?"
//
// Pure function module: no DOM access, no mutation of its inputs. app.js is
// responsible for gathering the inputs (recent feature history, the fitted
// model, the raw calibration samples, the current prediction) and for
// rendering the result.

// recentFeatureHistory ordering: this module does not care about order (all
// uses below are order-independent variance/mean calculations) — callers
// may append newest-last (oldest first), which is what app.js does.

export const CONFIDENCE_CONFIG = {
  // Boundaries on the final 0-1 score used to pick a level string.
  levelThresholds: { excellent: 0.85, good: 0.65, fair: 0.45 }, // below `fair` => "poor"

  // Below this score, dwell must not be allowed to reach activation
  // (matches the plan's confidence.dwellMinimum default).
  dwellMinimum: 0.45,

  // Relative weights for each component. Components that can't be computed
  // (not enough history / no calibration samples yet) are dropped and the
  // remaining weights are renormalized, rather than injecting a fake
  // "neutral" score.
  weights: {
    faceGeometry: 1.0,
    headMovement: 1.0,
    roll: 0.6,
    eyeOpenness: 1.0,
    featureStability: 1.2,
    localResidual: 1.4,
    neighborDistance: 1.0,
    regionCoverage: 1.2
  },

  // Below this sub-score, a component contributes its reason string.
  reasonThreshold: 0.6,

  // Face centering/size, same rationale as app.js's updateQuality() (face
  // roughly centered, close enough to camera) but recomputed here from
  // faceBox instead of raw landmarks, since confidence.js only sees
  // extractFeatures() output, not the landmark array.
  faceCenterTargetX: 0.5,
  faceCenterTargetY: 0.48,
  faceCenterFalloff: 2.3,
  targetFaceWidth: 0.5, // normalized face-bbox width considered "close enough"

  // Head/roll stability, expressed as population variance over
  // recentFeatureHistory (short live window, not the calibration-collection
  // window sampleQuality.js scores — thresholds are looser accordingly).
  maxHeadPositionVariance: 0.0015,
  maxRollVariance: 0.003,
  minHistoryForVariance: 4, // need at least this many frames to trust a variance estimate

  // Eye openness — same metric/spirit as sampleQuality.js's blink handling,
  // applied per-frame instead of batch.
  minEyeOpennessMean: 0.12,

  // Feature (gaze) stability: variance of the iris-position ratios
  // (vector[1..4] — see featureExtraction.js) across recentFeatureHistory.
  maxIrisVariance: 0.006,

  // Nearest-calibration-sample lookups (feature-space distance uses the
  // same lx/ly/rx/ry indices, for the same reason sampleQuality.js does:
  // they're normalized gaze-direction ratios, roughly head-position
  // independent).
  minCalibrationSamplesForResidual: 3,
  neighborCount: 5,
  maxNeighborFeatureDistance: 0.35, // beyond this, we're extrapolating past calibrated coverage
  maxLocalResidualPx: 220, // avg error of the model near similar calibration samples, beyond this = untrustworthy in this region

  // Screen-region coverage: how far outside the calibrated targets' bounding
  // box (expanded by this fraction of the viewport) the prediction may fall
  // before it's flagged.
  regionMarginFraction: 0.18
};

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// 1.0 when comfortably under threshold, 0.0 at/after it — for "lower is
// better" metrics (variances, distances, residuals).
function scoreBelowIsGood(value, threshold) {
  if (threshold <= 0) return value <= 0 ? 1 : 0;
  return clamp01(1 - value / threshold);
}

// 1.0 once value reaches threshold, scaling down below it — for "higher is
// better" metrics (openness, coverage margin).
function scoreAboveIsGood(value, threshold) {
  if (threshold <= 0) return 1;
  return clamp01(value / threshold);
}

function variance(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
}

function euclidean(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] - b[i]) ** 2;
  return Math.sqrt(sum);
}

function distancePx(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// Feature-space distance used for nearest-neighbor lookups: only the
// lx/ly/rx/ry components (vector indices 1-4). These are the normalized
// pupil-in-eye-socket ratios — mostly independent of head position/size —
// so "nearest calibration sample" means "looking at a similar spot", not
// "sitting in a similar position". Same rationale sampleQuality.js uses for
// its iris-variance metrics.
const NEIGHBOR_INDICES = [1, 2, 3, 4];

function neighborVector(vector) {
  return NEIGHBOR_INDICES.map(i => vector[i]);
}

function nearestSamples(vector, calibrationSamples, count) {
  const target = neighborVector(vector);
  return calibrationSamples
    .map(sample => ({ sample, distance: euclidean(target, neighborVector(sample.f)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

function faceGeometryScore(faceBox, config) {
  const centerX = (faceBox.minX + faceBox.maxX) / 2 - config.faceCenterTargetX;
  const centerY = (faceBox.minY + faceBox.maxY) / 2 - config.faceCenterTargetY;
  const centered = clamp01(1 - Math.hypot(centerX, centerY) * config.faceCenterFalloff);
  const sizeScore = scoreAboveIsGood(faceBox.width, config.targetFaceWidth);
  return (centered + sizeScore) / 2;
}

// Predicts screen coordinates for a calibration sample's own feature vector
// and compares against that sample's true target — a cheap proxy for "how
// wrong is the model near gaze directions like this one", without needing a
// held-out validation set.
function localResidualPx(model, predictGaze, neighbors, viewport) {
  if (!neighbors.length) return null;
  const residuals = neighbors.map(({ sample }) => {
    const predicted = predictGaze(model, sample.f, viewport);
    return distancePx(predicted, { x: sample.x, y: sample.y });
  });
  return residuals.reduce((a, b) => a + b, 0) / residuals.length;
}

function calibrationBounds(calibrationSamples) {
  const xs = calibrationSamples.map(s => s.x);
  const ys = calibrationSamples.map(s => s.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function levelFromScore(score, thresholds) {
  if (score >= thresholds.excellent) return "excellent";
  if (score >= thresholds.good) return "good";
  if (score >= thresholds.fair) return "fair";
  return "poor";
}

// predictGazeFn is injected (rather than imported) purely so this module has
// no hard dependency on calibrationModel.js's specific export shape beyond
// the (model, vector, viewport) => {x,y} contract it already exposes — keeps
// this file trivially testable in isolation too. app.js's default caller
// passes the real predictGaze from calibrationModel.js.
export function estimateGazeConfidence({
  currentFeatures,
  recentFeatureHistory = [],
  model,
  calibrationSamples = [],
  prediction,
  viewport,
  config = CONFIDENCE_CONFIG,
  predictGazeFn
} = {}) {
  if (!currentFeatures) {
    return { score: 0, level: "poor", reasons: ["Face not detected — check lighting and camera framing."] };
  }

  const components = []; // { key, weight, score, reason }
  const history = recentFeatureHistory.filter(Boolean);

  // Face centering/size.
  components.push({
    key: "faceGeometry",
    weight: config.weights.faceGeometry,
    score: faceGeometryScore(currentFeatures.faceBox, config),
    reason: "Face is off-center or too far/close — center your face and adjust distance from the camera."
  });

  // Eye openness (per-frame, live).
  const openness = (currentFeatures.eyeOpenness.left + currentFeatures.eyeOpenness.right) / 2;
  components.push({
    key: "eyeOpenness",
    weight: config.weights.eyeOpenness,
    score: scoreAboveIsGood(openness, config.minEyeOpennessMean),
    reason: "Eyes appear partially closed — this often means low light or squinting; try brighter, more even lighting."
  });

  // Head movement / roll / gaze stability need a short rolling history.
  if (history.length >= config.minHistoryForVariance) {
    const nx = history.map(f => f.head.nx);
    const ny = history.map(f => f.head.ny);
    const headVariance = (variance(nx) + variance(ny)) / 2;
    components.push({
      key: "headMovement",
      weight: config.weights.headMovement,
      score: scoreBelowIsGood(headVariance, config.maxHeadPositionVariance),
      reason: "Head is moving too much — try to hold your head steady."
    });

    const roll = history.map(f => f.head.roll);
    components.push({
      key: "roll",
      weight: config.weights.roll,
      score: scoreBelowIsGood(variance(roll), config.maxRollVariance),
      reason: "Head is tilting — try to keep your head level."
    });

    const lx = history.map(f => f.vector[1]);
    const ly = history.map(f => f.vector[2]);
    const rx = history.map(f => f.vector[3]);
    const ry = history.map(f => f.vector[4]);
    const irisVariance = (variance(lx) + variance(ly) + variance(rx) + variance(ry)) / 4;
    components.push({
      key: "featureStability",
      weight: config.weights.featureStability,
      score: scoreBelowIsGood(irisVariance, config.maxIrisVariance),
      reason: "Your gaze looks unsteady right now — try to fix your eyes on the target."
    });
  }

  // Calibration-coverage signals: only meaningful once we have a model and
  // enough real calibration samples to compare against.
  if (model && calibrationSamples.length >= config.minCalibrationSamplesForResidual) {
    const predict = predictGazeFn;
    const neighbors = nearestSamples(currentFeatures.vector, calibrationSamples, config.neighborCount);

    if (predict) {
      const residual = localResidualPx(model, predict, neighbors, viewport);
      if (residual !== null) {
        components.push({
          key: "localResidual",
          weight: config.weights.localResidual,
          score: scoreBelowIsGood(residual, config.maxLocalResidualPx),
          reason: "The model is uncertain in this part of your calibrated range — consider recalibrating."
        });
      }
    }

    const nearestDistance = neighbors[0]?.distance ?? 0;
    components.push({
      key: "neighborDistance",
      weight: config.weights.neighborDistance,
      score: scoreBelowIsGood(nearestDistance, config.maxNeighborFeatureDistance),
      reason: "This gaze direction is far from anything you calibrated — recalibrate to cover this area."
    });

    if (prediction && viewport) {
      const bounds = calibrationBounds(calibrationSamples);
      const marginX = viewport.width * config.regionMarginFraction;
      const marginY = viewport.height * config.regionMarginFraction;
      const expanded = {
        minX: bounds.minX - marginX, maxX: bounds.maxX + marginX,
        minY: bounds.minY - marginY, maxY: bounds.maxY + marginY
      };
      const dx = Math.max(0, expanded.minX - prediction.x, prediction.x - expanded.maxX);
      const dy = Math.max(0, expanded.minY - prediction.y, prediction.y - expanded.maxY);
      const outsideBy = Math.hypot(dx, dy);
      const screenDiagonal = Math.hypot(viewport.width, viewport.height);
      components.push({
        key: "regionCoverage",
        weight: config.weights.regionCoverage,
        score: scoreBelowIsGood(outsideBy, screenDiagonal * 0.25),
        reason: "Your gaze prediction is outside the screen area you calibrated — recalibrate or move back into the calibrated area."
      });
    }
  }

  const totalWeight = components.reduce((a, c) => a + c.weight, 0);
  const score = totalWeight > 0
    ? components.reduce((a, c) => a + c.weight * c.score, 0) / totalWeight
    : 0.5; // no components could be evaluated (e.g. no history yet, no calibration) — stay neutral, not confident/not condemned

  const level = levelFromScore(score, config.levelThresholds);
  const reasons = level === "excellent"
    ? []
    : components.filter(c => c.score < config.reasonThreshold).sort((a, b) => a.score - b.score).map(c => c.reason);

  return { score, level, reasons };
}

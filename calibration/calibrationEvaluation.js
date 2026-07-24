// Calibration model evaluation (Milestone 4).
//
// This module scores a *fitted* calibration model's quality — it never
// changes how the model itself is fit (fitCalibrationModel/ridgeSolve in
// calibrationModel.js are used exactly as-is, unmodified, possibly called
// several times here on different subsets of the same samples).
//
// Terminology: "samples" here means the post-filter per-frame training
// samples app.js already builds ({ f: featureVector, x, y }, one per
// surviving frame from assessCalibrationSample's filteredSamples) — the
// same array passed to fitCalibrationModel. A calibration "point" is the
// group of samples sharing one target (x, y): app.js computes one target
// pixel per point and pushes several filtered per-frame samples against it,
// so samples naturally cluster by point via exact (x, y) equality.

import { fitCalibrationModel, predictGaze } from "./calibrationModel.js";

export const CALIBRATION_EVALUATION_CONFIG = {
  // Leave-one-point-out validation needs at least this many distinct
  // calibration points to be meaningful — holding out 1 of only 5 points
  // (quick mode) starves the refit of ~20% of its coverage and produces a
  // noisy, not-very-informative estimate, so quick-mode runs skip
  // validation entirely and fall back to training error only.
  minPointsForHoldout: 6,

  // Coarse region grid for the "error by screen region" breakdown — 2x2
  // quadrants, per the plan's "quadrants or a coarse grid" suggestion.
  regionGridCols: 2,
  regionGridRows: 2,

  // Above this many pixels of average error (validation error if available,
  // else training error), the calibration is flagged as poor so app.js can
  // warn the user instead of silently accepting it.
  poorErrorPx: 150
};

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function pxError(model, sample, viewport) {
  const predicted = predictGaze(model, sample.f, viewport);
  return Math.hypot(predicted.x - sample.x, predicted.y - sample.y);
}

// Groups samples by their shared (x, y) target — see module comment.
function groupByPoint(samples) {
  const map = new Map();
  for (const s of samples) {
    const key = `${s.x},${s.y}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }
  return [...map.values()];
}

function regionKey(x, y, viewport, cols, rows) {
  const col = Math.min(cols - 1, Math.max(0, Math.floor((x / viewport.width) * cols)));
  const row = Math.min(rows - 1, Math.max(0, Math.floor((y / viewport.height) * rows)));
  return `${row}-${col}`;
}

// samples: [{ f, x, y }] — same shape/values fitCalibrationModel consumes.
// viewport: { width, height } the targets' pixel coordinates were measured
//   against (app.js passes window.innerWidth/innerHeight at calibration
//   time) — also used as the fit's width/height so predictGaze's viewport
//   rescaling is a no-op here (keeps evaluation independent of whatever the
//   live window size happens to be when this runs).
export function evaluateCalibration(samples, { viewport, config = CALIBRATION_EVALUATION_CONFIG, fitOptions = {} } = {}) {
  if (!samples || samples.length === 0) return null;
  const vp = viewport ?? { width: window.innerWidth, height: window.innerHeight };
  const fitOpts = { width: vp.width, height: vp.height, ...fitOptions };

  const model = fitCalibrationModel(samples, fitOpts);

  // Training error: residual measured on the same samples used to fit —
  // always computable, always optimistic (the model has seen this data).
  const trainingError = mean(samples.map(s => pxError(model, s, vp)));

  const pointGroups = groupByPoint(samples);

  // Leave-one-point-out validation: for each point, refit on every OTHER
  // point's samples and measure error predicting this point's own (unseen)
  // samples, then average across points. Approximates held-out
  // generalization without a dedicated held-out collection pass. Degrades
  // gracefully below minPointsForHoldout (see config comment above) by
  // leaving validationError as null and validationMethod as "none" —
  // finishCalibration() then falls back to trainingError for the
  // poor-quality check.
  let validationError = null;
  let validationMethod = "none";
  if (pointGroups.length >= config.minPointsForHoldout) {
    const foldErrors = [];
    for (let i = 0; i < pointGroups.length; i++) {
      const heldOut = pointGroups[i];
      const trainSamples = pointGroups.filter((_, idx) => idx !== i).flat();
      if (trainSamples.length < 4) continue; // too little left to fit a sane model on this fold
      try {
        const foldModel = fitCalibrationModel(trainSamples, fitOpts);
        foldErrors.push(mean(heldOut.map(s => pxError(foldModel, s, vp))));
      } catch (e) {
        // Singular matrix on this particular fold (e.g. degenerate feature
        // spread once a point is removed) — skip the fold rather than
        // aborting the whole evaluation.
      }
    }
    if (foldErrors.length) {
      validationError = mean(foldErrors);
      validationMethod = "leave-one-point-out";
    }
  }

  // Error by screen region (coarse grid).
  const regionSamples = new Map();
  for (const s of samples) {
    const key = regionKey(s.x, s.y, vp, config.regionGridCols, config.regionGridRows);
    if (!regionSamples.has(key)) regionSamples.set(key, []);
    regionSamples.get(key).push(pxError(model, s, vp));
  }
  const errorByRegion = {};
  for (const [key, errs] of regionSamples) errorByRegion[key] = mean(errs);

  // Worst calibration point: highest average per-point error.
  let worstPoint = null;
  let worstError = -Infinity;
  pointGroups.forEach((group, idx) => {
    const err = mean(group.map(s => pxError(model, s, vp)));
    if (err > worstError) {
      worstError = err;
      worstPoint = { x: group[0].x, y: group[0].y, pointIndex: idx, error: err };
    }
  });

  const referenceError = validationError ?? trainingError;
  const isPoor = referenceError > config.poorErrorPx;

  return {
    model, // the fit produced on ALL samples — callers can reuse this as the
           // deployed model instead of re-fitting, since it's identical to
           // calling fitCalibrationModel(samples, fitOpts) directly.
    trainingError,
    validationError,
    validationMethod,
    pointCount: pointGroups.length,
    errorByRegion,
    worstPoint,
    referenceError,
    isPoor,
    evaluatedAt: Date.now()
  };
}

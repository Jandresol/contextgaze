// Ridge-regression gaze mapping: fits screen-coordinate predictors from
// calibration feature vectors, and predicts gaze from a live feature vector.

export function dot(a, b) {
  return a.reduce((s, v, i) => s + v * b[i], 0);
}

export function gaussianSolve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-10) throw new Error("Singular calibration matrix");
    for (let j = col; j <= n; j++) M[col][j] /= d;
    for (let r = 0; r < n; r++) if (r !== col) {
      const f = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }
  return M.map(row => row[n]);
}

// weights: optional per-row array, same length as X/y, defaulting to 1 for
// every row when omitted. A weight of w scales that row's contribution to
// both normal-equation accumulators (A and b) by w — algebraically
// equivalent to duplicating the row w times (for integer w) but without
// actually growing the sample list, and it reduces to exactly today's
// unweighted formulation when every weight is 1 (each term is multiplied by
// 1, i.e. unchanged). This is what lets Milestone 5's weighted retraining
// (calibration/onlineLearning.js) reuse this function unmodified for
// unweighted callers — see that module's smoke test for the explicit
// all-weights-1-vs-no-weights-array equivalence check.
export function ridgeSolve(X, y, lambda, weights) {
  const rows = X.length, cols = X[0].length;
  const A = Array.from({ length: cols }, () => Array(cols).fill(0));
  const b = Array(cols).fill(0);
  for (let r = 0; r < rows; r++) {
    const w = weights ? weights[r] : 1;
    for (let i = 0; i < cols; i++) {
      b[i] += w * X[r][i] * y[r];
      for (let j = 0; j < cols; j++) A[i][j] += w * X[r][i] * X[r][j];
    }
  }
  for (let i = 1; i < cols; i++) A[i][i] += lambda;
  return gaussianSolve(A, b);
}

// samples: [{ f: featureVector, x, y }]
// options.weights: optional array parallel to `samples` (per-sample ridge
// weight, see ridgeSolve above). Omitted entirely for existing callers
// (Milestones 0-4, calibrationEvaluation.js), which continue to get the
// exact unweighted fit.
export function fitCalibrationModel(samples, options = {}) {
  const lambda = options.lambda ?? 0.08;
  const X = samples.map(s => s.f);
  const yx = samples.map(s => s.x);
  const yy = samples.map(s => s.y);
  const weights = options.weights;
  return {
    wx: ridgeSolve(X, yx, lambda, weights),
    wy: ridgeSolve(X, yy, lambda, weights),
    width: options.width ?? window.innerWidth,
    height: options.height ?? window.innerHeight
  };
}

// Predicts raw (unclamped, viewport-rescaled) screen coordinates.
export function predictGaze(model, featureVector, viewport = {}) {
  const vw = viewport.width ?? window.innerWidth;
  const vh = viewport.height ?? window.innerHeight;
  let x = dot(featureVector, model.wx);
  let y = dot(featureVector, model.wy);
  x *= vw / model.width;
  y *= vh / model.height;
  return { x, y };
}

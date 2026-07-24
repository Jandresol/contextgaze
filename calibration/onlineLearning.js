// Online self-calibration (Milestone 5).
//
// Observes normal dwell activations as *weak* labels (feature vector ->
// activated target) and, once enough of them look trustworthy, blends them
// into a refit of the calibration model. Nothing here ever runs eagerly on
// a single activation: every candidate sits in a pending queue for a short
// confirmation window before it can be promoted into the training pool, and
// a refit is only attempted on a cooldown/count schedule and only adopted
// if it doesn't make things worse on the original explicit calibration
// points. This module owns that bookkeeping; app.js owns the DOM (dwell
// targets, rects, Undo button) and just calls in with plain data.
//
// Deliberately deferred to Milestone 10 (correction-aware learning): this
// module only asks "was the first activation corrected?" (checkNeighborCorrection
// discards/ignores the FIRST candidate when a neighboring target is picked
// shortly after). It does not log a correction *vector* from A to B, does
// not build a weak sample *for* B, and does not look for repeated
// overshoot/undershoot bias across many corrections — that richer
// correction-aware learning is explicitly Milestone 10's job and is left
// for that milestone to add on top of the plumbing here (pendingOnlineSamples,
// candidate shape, sweep/finalize loop all already exist for it to extend).

import { medianVector } from "./sampleQuality.js";
import { fitCalibrationModel, predictGaze } from "./calibrationModel.js";

export const ONLINE_LEARNING_CONFIG = {
  // Master switch — false makes candidate creation, the pending queue, and
  // refitting a complete no-op (app.js checks this before ever calling into
  // this module's mutating functions).
  enabled: true,

  // How many frames a single dwell interaction's featureHistory/
  // predictionHistory/confidenceHistory may hold. Dwell durations are short
  // (~0.5-1.6s), but a confidence-paused dwell can sit on one target for a
  // long time without activating, so this is a defensive cap, not a
  // meaningful tuning knob.
  maxInteractionFrames: 300,

  // Confirmation window: how long a freshly-activated candidate sits in
  // state.pendingOnlineSamples before it is finalized (promoted or
  // discarded) if nothing has invalidated it sooner. Matches app.js's
  // pre-existing "was the last gaze activation within 4s of this Undo"
  // window (Milestone 3/existing accidental-activation heuristic) so the
  // two signals agree about what counts as "recent".
  confirmationWindowMs: 4000,

  // Neighbor-correction: if the user activates a *different* target within
  // this many ms of a still-pending candidate's own activation, and that
  // new target is spatially adjacent to the pending candidate's target,
  // the pending candidate is treated as corrected and discarded. Shorter
  // than confirmationWindowMs because a genuine "wrong button, meant the
  // one next to it" correction is normally near-immediate; a same-length
  // window would let unrelated later activations on a neighboring button
  // retroactively kill a perfectly good sample.
  neighborCorrectionWindowMs: 2500,
  // Two activated targets are "neighbors" when the distance between their
  // rect centers is within this multiple of their average (width+height)/2
  // — i.e. roughly "about one button-width apart or closer". Kept as a
  // single simple multiplier rather than separate x/y thresholds since the
  // app's targets (response buttons, keys, word buttons) are all roughly
  // square-ish tiles in a grid.
  neighborDistanceMultiplier: 1.6,

  // Repeated entry/exit ("flicker"): how far back to look for previous
  // dwell-target-enter events on the *same* target id, and how many
  // entries within that window count as "the user kept hovering on/off
  // this target" (a sign the eventual activation may not reflect a
  // confident, deliberate selection).
  repeatedEntryWindowMs: 5000,
  repeatedEntryThreshold: 3,

  // Self-quality gates, evaluated once at candidate-build time (all of
  // these are static facts about the dwell that already happened, so there
  // is no reason to re-derive them later at sweep time).
  //
  // mediumConfidenceThreshold is intentionally stricter than
  // CONFIDENCE_CONFIG.dwellMinimum (0.45): the dwell gate only has to be
  // cleared on every individual frame to let the timer run, so a dwell can
  // legitimately finish having spent its whole duration just barely above
  // that floor. That's an acceptable bar for *acting* on a live prediction
  // (worst case: a slow dwell), but a mediocre-confidence interaction is a
  // much worse candidate to feed back into the model as a ground-truth
  // label, so promotion uses its own, higher floor.
  mediumConfidenceThreshold: 0.55,
  highConfidenceThreshold: 0.8,
  // Same units as confidence.js's maxHeadPositionVariance/maxIrisVariance
  // (population variance of head.nx/ny and of the iris ratio vector
  // components over the dwell's own frames) — thresholds are a bit looser
  // than confidence.js's live per-frame numbers since this is an average
  // over a whole dwell, which naturally smooths out single-frame spikes.
  maxHeadMotionForPromotion: 0.002,
  maxGazeVarianceForPromotion: 0.01,
  // "Unusually long dwell" is measured against the *unpaused* elapsed time
  // (dwellDuration here is exactly the `elapsed` value app.js already uses
  // for its own activation check — dwellStart-to-now minus any
  // confidence-pause time), so a dwell that paused for a while due to a
  // low-confidence blip but was otherwise quick once resumed is not
  // penalized twice for the same thing confidence-gating already handled.
  maxDwellDurationMultiplier: 1.8,

  // Weight tiers for weighted retraining (Option A blending — see
  // buildWeightedTrainingSet). Explicit calibration samples always get
  // `explicit`; promoted implicit samples get `implicitHighConfidence` or
  // `implicitMediumConfidence` depending on their own average confidence.
  weights: {
    explicit: 3.0,
    implicitHighConfidence: 1.0,
    implicitMediumConfidence: 0.25
  },

  // Refit scheduling.
  minSamplesBeforeUpdate: 30,
  updateCooldownMs: 120000,
  maxSamples: 1000,
  // Coarse 2x2 screen-region grid (same idea as
  // calibrationEvaluation.js's errorByRegion breakdown, reimplemented here
  // locally since that module doesn't export its region-key helper) used
  // only to require that accumulated online samples aren't all clustered in
  // one corner of the screen before refitting.
  regionGridCols: 2,
  regionGridRows: 2,
  minDistinctRegionsForUpdate: 2,

  // Safety/validation margin: a refit is rejected only if BOTH a relative
  // and an absolute regression threshold are exceeded versus the current
  // model's error on the held-out explicit samples (see
  // validateCandidateModel for the rationale).
  maxRegressionRatio: 1.15,
  maxRegressionPx: 40,

  // In-memory rollback stack depth. Deliberately in-memory-only for this
  // milestone rather than persisted: the storage.js v2 envelope schema
  // (plan(1).md's Milestone 4 data model) has no rollback slot, and adding
  // one is a real schema change we don't need yet — a page reload simply
  // resumes from whatever was last saved via saveCalibration(), which is
  // always the last *adopted* (validated) model, never a rejected one. The
  // tradeoff: a rollback requested after a reload can't reach back past
  // the currently-loaded model. Good enough for a prototype milestone;
  // worth revisiting if online learning starts running for long unattended
  // sessions where in-session rollback depth matters more.
  maxModelHistory: 5,

  // Ridge lambda used for online refits — same default fitCalibrationModel
  // itself already falls back to, kept explicit here so it's one of this
  // module's tunable knobs rather than an implicit dependency on that
  // default staying 0.08.
  ridgeLambda: 0.08
};

function variance(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
}

function averageHeadMotion(featureHistory) {
  if (featureHistory.length < 2) return 0;
  const nx = featureHistory.map(f => f.head.nx);
  const ny = featureHistory.map(f => f.head.ny);
  return (variance(nx) + variance(ny)) / 2;
}

// Same rationale as confidence.js's featureStability component: vector
// indices 1-4 are the normalized pupil-in-eye-socket ratios, roughly
// head-position independent, so their variance is a direct "was the gaze
// itself steady" signal.
function averageGazeVariance(featureHistory) {
  if (featureHistory.length < 2) return 0;
  const lx = featureHistory.map(f => f.vector[1]);
  const ly = featureHistory.map(f => f.vector[2]);
  const rx = featureHistory.map(f => f.vector[3]);
  const ry = featureHistory.map(f => f.vector[4]);
  return (variance(lx) + variance(ly) + variance(rx) + variance(ry)) / 4;
}

// Converts a plain rect-like object ({left, top, width, height} — a
// DOMRect or anything shaped like one) into the {x, y, width, height}
// "target" shape used throughout this module (x/y are the rect's center,
// matching how app.js already records explicit calibration targets as
// center pixel coordinates).
function rectToTargetShape(rect) {
  if (!rect) return null;
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, width: rect.width, height: rect.height };
}

// --- Pending interaction lifecycle (dwell start -> activation) -----------

// Begins tracking a candidate interaction when a dwell target is first
// acquired. `target` is kept only for optional diagnostics (e.g. console
// inspection) — nothing in this module reads it, so passing a DOM element
// here doesn't make the module DOM-dependent in practice.
export function createPendingInteraction({ target, targetId, targetRect, startedAt }) {
  return {
    startedAt,
    targetElement: target ?? null,
    targetId,
    targetRect,
    featureHistory: [],
    predictionHistory: [],
    confidenceHistory: []
  };
}

// Appends one frame's data while dwelling on the interaction's target.
// `prediction`/`confidence` are optional — if a caller doesn't have them
// for some frame, only featureHistory grows for that frame.
export function recordInteractionFrame(interaction, { features, prediction, confidence } = {}, config = ONLINE_LEARNING_CONFIG) {
  if (!interaction || !features) return;
  interaction.featureHistory.push(features);
  if (prediction) interaction.predictionHistory.push(prediction);
  if (confidence) interaction.confidenceHistory.push(confidence);
  const cap = config.maxInteractionFrames;
  if (interaction.featureHistory.length > cap) interaction.featureHistory.shift();
  if (interaction.predictionHistory.length > cap) interaction.predictionHistory.shift();
  if (interaction.confidenceHistory.length > cap) interaction.confidenceHistory.shift();
}

let candidateSeq = 0;

function evaluateSelfQuality(candidate, dwellMsConfigured, repeatedEntry, config) {
  const reasons = [];
  if (!candidate.featureVector) reasons.push("no-feature-data");
  if (candidate.confidence < config.mediumConfidenceThreshold) reasons.push("low-confidence");
  if (candidate.headMotion > config.maxHeadMotionForPromotion) reasons.push("high-head-motion");
  if (candidate.gazeVariance > config.maxGazeVarianceForPromotion) reasons.push("unstable-gaze");
  if (dwellMsConfigured > 0 && candidate.dwellDuration > dwellMsConfigured * config.maxDwellDurationMultiplier) reasons.push("unusually-long-dwell");
  if (repeatedEntry) reasons.push("repeated-entry-exit");
  return { ok: reasons.length === 0, reasons };
}

// Builds the candidate online sample described in plan(1).md's Milestone 5
// section from a finished pending interaction, at the moment of activation.
//
// featureVector uses the MEDIAN feature vector across the dwell's own
// frames (via sampleQuality.js's medianVector, the same "resist stray bad
// frames" convention used for explicit calibration points) rather than
// just the last frame — a stray blink or glance away right at the instant
// of activation shouldn't single-handedly define the label.
//
// `predicted` uses the LAST frame's raw prediction (predictionHistory is
// appended oldest-first) as the single most representative "where the
// model thought the user was looking right before they committed to this
// target" point — unlike the feature vector, an outlier here doesn't
// corrupt training data, it's only used for diagnostics/display, so
// robustness to a single stray frame matters less than recency.
export function buildCandidateSample(interaction, { activatedAt, dwellDuration, dwellMsConfigured = 0, repeatedEntry = false, config = ONLINE_LEARNING_CONFIG } = {}) {
  const frames = interaction?.featureHistory ?? [];
  const featureVector = frames.length ? medianVector(frames) : null;
  const lastPrediction = interaction?.predictionHistory?.length
    ? interaction.predictionHistory[interaction.predictionHistory.length - 1]
    : null;
  const confidenceScores = (interaction?.confidenceHistory ?? [])
    .map(c => c.score)
    .filter(v => typeof v === "number");
  const confidence = confidenceScores.length
    ? confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length
    : 0;

  const candidate = {
    id: `ols-${Math.round(activatedAt)}-${++candidateSeq}`,
    featureVector,
    target: rectToTargetShape(interaction?.targetRect),
    predicted: lastPrediction,
    confidence,
    dwellDuration,
    headMotion: averageHeadMotion(frames),
    gazeVariance: averageGazeVariance(frames),
    activatedAt,
    source: "implicit-dwell",
    // Bookkeeping fields beyond the plan's exact candidate shape — used
    // internally by the pending-queue/sweep/refit machinery below.
    status: "pending",
    createdAt: activatedAt,
    weight: null,
    discardReason: null
  };
  candidate.selfQuality = evaluateSelfQuality(candidate, dwellMsConfigured, repeatedEntry, config);
  return candidate;
}

// --- Invalidation signals --------------------------------------------------

// Undo correlation: app.js tracks the most recently created candidate's id
// (state.lastPendingSampleId) and calls this when Undo fires. Only affects
// a candidate still awaiting confirmation — once a candidate has already
// been promoted/discarded by a sweep, Undo can no longer reach it (by then
// it's out of the pending queue entirely).
export function invalidateMostRecentSample(pendingSamples, sampleId, reason = "undo") {
  const candidate = pendingSamples.find(c => c.id === sampleId && c.status === "pending");
  if (!candidate) return false;
  candidate.status = "discarded";
  candidate.discardReason = reason;
  return true;
}

// Neighbor-correction: call this with the RECT of a just-activated target
// (before building that activation's own candidate) to check whether it
// corrects an earlier, still-pending candidate. `dist > 0` deliberately
// excludes the exact-same-target case (dist 0) — repeatedly
// activating/re-entering the *same* target is handled separately by the
// repeated-entry check, not treated as a "neighbor" correction of itself.
//
// Milestone 10 boundary: this only discards the FIRST (corrected)
// candidate. It does not create or annotate any sample for the second
// (corrective) activation, and it does not accumulate a directional
// correction vector or bias statistic across multiple corrections — that
// is Milestone 10's job.
export function checkNeighborCorrection(pendingSamples, newTargetRect, now, config = ONLINE_LEARNING_CONFIG) {
  const newTarget = rectToTargetShape(newTargetRect);
  if (!newTarget) return;
  for (const candidate of pendingSamples) {
    if (candidate.status !== "pending") continue;
    if (now - candidate.activatedAt > config.neighborCorrectionWindowMs) continue;
    if (!candidate.target) continue;
    const dist = Math.hypot(candidate.target.x - newTarget.x, candidate.target.y - newTarget.y);
    const avgSize = ((candidate.target.width + candidate.target.height) / 2 +
      (newTarget.width + newTarget.height) / 2) / 2;
    if (avgSize > 0 && dist > 0 && dist <= avgSize * config.neighborDistanceMultiplier) {
      candidate.status = "discarded";
      candidate.discardReason = "neighbor-correction";
    }
  }
}

// Repeated entry/exit ("flicker") check — app.js appends {id, at} to a
// small rolling log every time dwell acquires a NEW non-null target, and
// passes that log in here at candidate-build time.
export function countRecentEntries(enterLog, targetId, now, config = ONLINE_LEARNING_CONFIG) {
  return enterLog.filter(e => e.id === targetId && now - e.at <= config.repeatedEntryWindowMs).length;
}

export function isRepeatedEntry(enterLog, targetId, now, config = ONLINE_LEARNING_CONFIG) {
  return countRecentEntries(enterLog, targetId, now, config) >= config.repeatedEntryThreshold;
}

// --- Confirmation-window sweep ---------------------------------------------

// Finalizes any pending candidates whose confirmation window has elapsed
// (or that were already externally invalidated by Undo/neighbor-correction
// at any age) into either `confirmedSamples` (promoted) or nowhere
// (discarded). Mutates both arrays in place; returns counts for the
// caller's own bookkeeping (e.g. how many new samples became available
// toward the next refit).
//
// Iterates in reverse and splices so this can run every frame cheaply
// (pending queues are small — a handful of entries at most) without
// worrying about index shifting while removing finalized entries.
export function sweepPendingSamples(pendingSamples, confirmedSamples, now, config = ONLINE_LEARNING_CONFIG) {
  let promotedCount = 0;
  let discardedCount = 0;
  for (let i = pendingSamples.length - 1; i >= 0; i--) {
    const candidate = pendingSamples[i];
    if (candidate.status === "pending") {
      if (now - candidate.createdAt < config.confirmationWindowMs) continue; // still awaiting confirmation
      candidate.status = candidate.selfQuality.ok ? "promoted" : "discarded";
      if (candidate.status === "discarded" && !candidate.discardReason) {
        candidate.discardReason = candidate.selfQuality.reasons.join(",");
      }
    }

    if (candidate.status === "promoted") {
      candidate.weight = candidate.confidence >= config.highConfidenceThreshold
        ? config.weights.implicitHighConfidence
        : config.weights.implicitMediumConfidence;
      confirmedSamples.push(candidate);
      promotedCount++;
    } else {
      discardedCount++;
    }
    pendingSamples.splice(i, 1);
  }
  while (confirmedSamples.length > config.maxSamples) confirmedSamples.shift();
  return { promotedCount, discardedCount };
}

// --- Refit scheduling -------------------------------------------------------

function regionKeyFor(target, viewport, config) {
  const col = Math.min(config.regionGridCols - 1, Math.max(0, Math.floor((target.x / viewport.width) * config.regionGridCols)));
  const row = Math.min(config.regionGridRows - 1, Math.max(0, Math.floor((target.y / viewport.height) * config.regionGridRows)));
  return `${row}-${col}`;
}

// Pure decision function — takes the counters app.js maintains
// (newPromotedSinceUpdate, lastOnlineModelUpdateAt) plus the current
// confirmed-sample pool, rather than the whole app state object, so it has
// no implicit dependency on app.js's state shape beyond these three
// values.
export function shouldAttemptRefit({ newPromotedSinceUpdate, lastOnlineModelUpdateAt, confirmedSamples, viewport, now, config = ONLINE_LEARNING_CONFIG }) {
  if (!config.enabled) return false;
  if ((newPromotedSinceUpdate || 0) < config.minSamplesBeforeUpdate) return false;
  if (now - (lastOnlineModelUpdateAt || 0) < config.updateCooldownMs) return false;
  const regions = new Set(
    (confirmedSamples || [])
      .filter(c => c.target)
      .map(c => regionKeyFor(c.target, viewport, config))
  );
  return regions.size >= config.minDistinctRegionsForUpdate;
}

// --- Weighted retraining (blending Option A) -------------------------------

// Combines explicit calibration samples ({f, x, y}, already in
// fitCalibrationModel's input shape) with promoted online samples
// (candidate objects — converted to the same {f, x, y} shape here) into one
// training set plus a parallel per-sample weight array. Explicit samples
// always use config.weights.explicit; each online sample uses the weight
// tier sweepPendingSamples assigned it at promotion time.
export function buildWeightedTrainingSet(explicitSamples, confirmedSamples, config = ONLINE_LEARNING_CONFIG) {
  const samples = [];
  const weights = [];
  for (const s of explicitSamples) {
    samples.push({ f: s.f, x: s.x, y: s.y });
    weights.push(config.weights.explicit);
  }
  for (const c of confirmedSamples) {
    if (!c.featureVector || !c.target) continue;
    samples.push({ f: c.featureVector, x: c.target.x, y: c.target.y });
    weights.push(c.weight ?? config.weights.implicitMediumConfidence);
  }
  return { samples, weights };
}

export function refitWithOnlineSamples(explicitSamples, confirmedSamples, viewport, config = ONLINE_LEARNING_CONFIG) {
  const { samples, weights } = buildWeightedTrainingSet(explicitSamples, confirmedSamples, config);
  if (samples.length < 4) return null; // not enough data to fit sanely
  return fitCalibrationModel(samples, { lambda: config.ridgeLambda, width: viewport.width, height: viewport.height, weights });
}

// --- Safety validation ------------------------------------------------------

function meanPxError(model, samples, viewport) {
  if (!samples.length) return null;
  const errors = samples.map(s => {
    const p = predictGaze(model, s.f, viewport);
    return Math.hypot(p.x - s.x, p.y - s.y);
  });
  return errors.reduce((a, b) => a + b, 0) / errors.length;
}

// Compares a freshly-refit candidate model against the currently-deployed
// model on the ORIGINAL explicit calibration samples (ground truth, never
// touched by online learning) and decides whether to adopt it.
//
// "Materially worse" requires BOTH a large relative regression AND a
// non-trivial absolute regression (maxRegressionRatio AND maxRegressionPx)
// before rejecting — a ratio-only check would reject harmless updates when
// the current model's error is already tiny (a few extra pixels can look
// like a huge percentage), and an absolute-only check would be too
// forgiving on an already-poor calibration. Requiring both catches real
// degradations while tolerating normal fit noise.
export function validateCandidateModel(candidateModel, currentModel, explicitSamples, viewport, config = ONLINE_LEARNING_CONFIG) {
  if (!candidateModel) return { accept: false, reason: "refit produced no model" };
  if (!explicitSamples || explicitSamples.length < 4) {
    return { accept: false, reason: "not enough explicit samples to validate against" };
  }
  const newErr = meanPxError(candidateModel, explicitSamples, viewport);
  if (!currentModel) return { accept: true, newErr, oldErr: null, reason: null };
  const oldErr = meanPxError(currentModel, explicitSamples, viewport);

  const regressedRatio = newErr > oldErr * config.maxRegressionRatio;
  const regressedAbs = (newErr - oldErr) > config.maxRegressionPx;
  const accept = !(regressedRatio && regressedAbs);
  return {
    accept,
    newErr,
    oldErr,
    reason: accept ? null : `validation error regressed from ${oldErr.toFixed(1)}px to ${newErr.toFixed(1)}px`
  };
}

// --- Rollback ---------------------------------------------------------------

// Tiny, deliberately dumb in-memory stack helpers (see the maxModelHistory
// config comment for the persisted-vs-in-memory tradeoff). Kept here rather
// than inlined in app.js purely so the cap logic lives next to the config
// value it reads.
export function pushModelHistory(history, entry, config = ONLINE_LEARNING_CONFIG) {
  history.push(entry);
  while (history.length > config.maxModelHistory) history.shift();
}

export function popModelHistory(history) {
  return history.length ? history.pop() : null;
}

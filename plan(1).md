# ContextGaze v2 — Claude Execution Plan

## Mission

Upgrade ContextGaze from a research demo into a robust, extensible AAC prototype with:

- more reliable webcam gaze estimation
- shorter calibration
- continuous self-calibration
- confidence-aware dwell interaction
- modular calibration code
- better debugging and evaluation
- no backend requirement
- no framework migration
- no loss of current AAC functionality

The current application already includes:

- MediaPipe FaceLandmarker
- engineered iris and face-position features
- 13-point explicit calibration
- ridge-regression mapping from face features to screen coordinates
- exponential gaze smoothing
- dwell-based activation
- speech recognition
- text-to-speech
- rule-based and Gemini-generated response suggestions
- free-text personal memories
- a predictive keyboard

Do not replace the whole application. Improve it incrementally.

---

# Non-Negotiable Constraints

1. Keep the application client-side.
2. Preserve vanilla JavaScript, HTML, and CSS.
3. Do not migrate to React, Vue, TypeScript, or another framework.
4. Preserve all current user-facing functionality.
5. Do not expose API keys or add secrets to source control.
6. Avoid large unrelated UI redesigns.
7. Keep each milestone independently testable.
8. Prefer small, reviewable changes over one large rewrite.
9. Add comments only where the logic is non-obvious.
10. Maintain a fallback path when new gaze features fail.

---

# Recommended Work Sequence

Implement the milestones in this order:

1. Baseline instrumentation
2. Calibration module extraction
3. Calibration sample-quality validation
4. Confidence estimation
5. Improved explicit calibration
6. Online self-calibration
7. Adaptive dwell
8. Improved smoothing
9. Local gaze mapping experiment
10. Debug mode and evaluation
11. Structured memory
12. Context and intent engine

Do not start the AI or memory redesign before the gaze stack is stable.

---

# Milestone 0 — Establish a Baseline

## Goal

Make the current behavior measurable before changing the calibration system.

## Tasks

Create a small evaluation layer that records:

```js
{
  timestamp,
  predictedX,
  predictedY,
  targetX,
  targetY,
  errorPx,
  normalizedError,
  faceQuality,
  dwellDuration,
  selectedElementId
}
```

Add a reusable function:

```js
recordEvaluationSample(sample)
```

Store recent evaluation samples in memory.

Optionally persist a bounded history in `localStorage`.

Add summary metrics:

- mean pixel error
- median pixel error
- 90th-percentile error
- successful dwell count
- cancelled dwell count
- accidental activation count
- average dwell time

## Acceptance Criteria

- Existing behavior does not change.
- Evaluation data can be viewed in the console.
- Metrics can be cleared without clearing user memory.
- The application does not store unbounded data.

---

# Milestone 1 — Extract Calibration Into Modules

## Goal

Remove calibration logic from `app.js` without changing behavior.

## Suggested Structure

```text
/
  app.js
  calibration/
    featureExtraction.js
    calibrationModel.js
    calibrationSession.js
    confidence.js
    gazeFilter.js
    onlineLearning.js
    storage.js
```

## Responsibilities

### `featureExtraction.js`

Move:

- `avgPoint`
- `distance`
- `extractFeatures`
- `expandFeatures`

Return a richer object:

```js
{
  vector,
  iris,
  head,
  eyeOpenness,
  faceBox,
  timestamp
}
```

### `calibrationModel.js`

Move:

- `fitCalibration`
- `ridgeSolve`
- `gaussianSolve`
- `dot`
- model prediction logic

Expose:

```js
fitCalibrationModel(samples, options)
predictGaze(model, featureVector, viewport)
```

### `calibrationSession.js`

Own:

- calibration point sequence
- collection timing
- retry logic
- per-point validation
- final model creation

### `gazeFilter.js`

Own gaze smoothing.

Initially preserve the current exponential smoother behind:

```js
createExponentialGazeFilter(options)
```

### `storage.js`

Own:

- calibration persistence
- raw sample persistence
- versioning
- migration from old stored weights

## Acceptance Criteria

- The application behaves the same as before.
- `app.js` is meaningfully smaller.
- Calibration code can be tested independently.
- Existing saved calibration either loads or fails gracefully.
- Storage includes a schema version.

---

# Milestone 2 — Add Calibration Sample Quality Validation

## Goal

Reject unreliable samples before fitting a model.

## Collection Flow

For each target:

1. Show target.
2. Allow a settling period of 500–700 ms.
3. Clear the buffer.
4. Collect for 1,500–2,000 ms.
5. Calculate sample quality.
6. Accept or retry the current point.

## Metrics Per Point

Calculate:

- usable frame count
- iris horizontal variance
- iris vertical variance
- head-position variance
- face-width variance
- roll variance
- eye-openness mean
- eye-openness variance
- percentage of frames with valid landmarks

## Output Shape

```js
{
  accepted,
  score,
  reasons,
  rawSamples,
  filteredSamples,
  representativeVector,
  metrics
}
```

## Representative Vector

Use the median for each feature dimension rather than a simple mean.

Keep raw samples for later model fitting and analysis.

## Rejection Conditions

Reject or repeat a point when:

- too few valid frames
- face is lost repeatedly
- gaze is unstable
- head movement exceeds a threshold
- eyes appear closed for too much of the collection window
- sample quality score falls below the configured threshold

All thresholds should live in one configuration object.

## Acceptance Criteria

- A bad point is retried without restarting calibration.
- The user receives a clear reason for retry.
- Good points advance normally.
- Raw and filtered samples are retained.
- Thresholds are configurable.

---

# Milestone 3 — Build a Confidence Estimator

## Goal

Estimate whether the current gaze prediction is trustworthy.

## Inputs

Use:

- face detection presence
- face centering
- face size
- head movement
- roll
- eye openness
- feature stability
- model residual near similar calibration samples
- distance from the nearest calibration sample
- whether prediction lies far outside the calibrated region

## API

```js
estimateGazeConfidence({
  currentFeatures,
  recentFeatureHistory,
  model,
  calibrationSamples,
  prediction,
  viewport
})
```

Return:

```js
{
  score,
  level,
  reasons
}
```

Where:

- `score` is between 0 and 1
- `level` is `"excellent"`, `"good"`, `"fair"`, or `"poor"`

## Behavior

- Do not trigger dwell when confidence is below a minimum threshold.
- Do not hide all feedback; show why dwell is paused.
- Keep mouse, touch, and keyboard interaction unaffected.

## Acceptance Criteria

- Low-confidence gaze cannot accidentally activate buttons.
- Confidence appears in the existing gaze-quality area.
- The user can understand whether the issue is lighting, head position, eye visibility, or calibration coverage.
- Confidence calculations are separate from rendering.

---

# Milestone 4 — Improve Explicit Calibration

## Goal

Reduce burden while improving accuracy.

## Default Point Layout

Replace the fixed 13-point layout with a configurable layout.

Default quick calibration:

```text
top-left
top-right
center
bottom-left
bottom-right
```

Optional accuracy calibration:

```text
9 or 13 points
```

Add a mode selector only if it can be done without clutter.

## Data Model

Persist:

```js
{
  version,
  createdAt,
  updatedAt,
  screen: {
    width,
    height,
    devicePixelRatio
  },
  camera: {
    width,
    height
  },
  samples,
  pointSummaries,
  model,
  qualitySummary
}
```

## Model Evaluation

Use leave-one-point-out or holdout evaluation when enough points exist.

Calculate:

- training error
- validation error
- error by screen region
- worst calibration point

If validation error is poor, warn the user instead of silently accepting.

## Acceptance Criteria

- Quick calibration requires five accepted points.
- Accuracy mode remains available.
- Raw samples are persisted.
- Calibration quality is summarized.
- The user can recalibrate only when needed.
- Old calibration data is migrated or discarded safely.

---

# Milestone 5 — Implement Online Self-Calibration

## Goal

Allow the model to improve from normal use.

## Principle

A successful gaze activation provides a weak label:

- input: eye and head feature vector
- target: center or region of the selected interface element

Do not assume every activation is correct.

## Data Captured on Dwell Start

Store a pending interaction:

```js
{
  startedAt,
  targetElement,
  targetRect,
  featureHistory,
  predictionHistory,
  confidenceHistory
}
```

## Data Captured on Activation

Create a candidate online sample:

```js
{
  featureVector,
  target: {
    x,
    y,
    width,
    height
  },
  predicted: {
    x,
    y
  },
  confidence,
  dwellDuration,
  headMotion,
  gazeVariance,
  activatedAt,
  source: "implicit-dwell"
}
```

## Do Not Trust Immediately

Hold the sample in a pending queue for a short confirmation window.

Invalidate or down-weight it if:

- the user presses Undo
- the user quickly activates a neighboring item
- the same target is repeatedly entered and exited
- confidence was low
- head motion was high
- dwell duration was unusually long
- the selection was followed by a correction pattern

## Positive Signal

Promote the sample when:

- confidence was high
- gaze was stable
- activation was fast
- no correction occurred
- the interaction led to a normal next action

## Model Update Schedule

Do not refit on every click.

Refit when:

- at least 20–50 new high-quality samples exist
- sufficient time has passed since the last update
- samples cover more than one screen region

Use a rolling sample window.

Suggested maximum:

```js
500 to 1_500 online samples
```

## Blending

Do not replace the model abruptly.

Use one of these approaches:

### Option A — Weighted retraining

Weight explicit calibration samples more heavily than implicit samples.

Example:

```text
explicit sample weight: 3.0
high-confidence implicit sample: 1.0
medium-confidence implicit sample: 0.25
```

### Option B — Model blending

```js
newPrediction =
  oldPrediction * (1 - blend) +
  updatedPrediction * blend
```

Start with a small blend factor.

## Safety

Before adopting a new model:

1. Evaluate it on held-out explicit samples.
2. Compare it with the current model.
3. Reject the update if error becomes materially worse.
4. Persist the prior model for rollback.

## Acceptance Criteria

- Normal dwell selections create candidate samples.
- Undo invalidates recent online samples.
- The model does not update from low-confidence interactions.
- Updates are gradual.
- A worse model is not adopted.
- The prior model can be restored.
- Online learning can be disabled through configuration.

---

# Milestone 6 — Add Adaptive Dwell

## Goal

Reduce selection time without increasing accidental activations.

## Rules

Calculate dwell duration from:

- gaze confidence
- target size
- recent accidental activation rate
- recent cursor stability
- whether the target is dangerous or irreversible

Suggested defaults:

```text
confidence >= 0.90: 500 ms
confidence >= 0.75: 750 ms
confidence >= 0.60: 1,000 ms
confidence >= 0.45: 1,300 ms
confidence < 0.45: dwell disabled
```

Keep user-selected dwell time as a baseline or maximum, not as a value that is ignored.

Dangerous actions such as Help, destructive actions, or clearing text may require:

- longer dwell
- second confirmation
- or exclusion from adaptive shortening

## Acceptance Criteria

- High-confidence selections feel faster.
- Low-confidence selections slow down or pause.
- Mouse and touch behavior remain unchanged.
- The progress indicator reflects the actual dwell threshold.

---

# Milestone 7 — Improve Gaze Filtering

## Goal

Reduce jitter without adding noticeable lag.

## Phase A

Make the current exponential filter velocity-aware.

Increase smoothing when:

- gaze is nearly stationary
- confidence is low

Decrease smoothing when:

- movement is intentional
- gaze velocity is high
- confidence is high

## Phase B

Implement an optional Kalman filter.

State:

```js
[x, y, vx, vy]
```

Measurements:

```js
[predictedX, predictedY]
```

Tune:

- process noise
- measurement noise
- reset behavior
- confidence-based measurement noise

Expose a feature flag:

```js
gazeFilter: "adaptive-exponential" | "kalman"
```

## Acceptance Criteria

- Cursor jitter is reduced.
- Fast gaze movements do not feel excessively delayed.
- Filter state resets after face loss or long pauses.
- The old filter remains available for comparison.

---

# Milestone 8 — Experiment With Local Gaze Mapping

## Goal

Test whether a local model outperforms one global ridge regression.

## Keep Ridge Regression

Do not delete the existing model.

Add model selection:

```js
modelType: "ridge" | "idw" | "local-linear"
```

## Option A — Inverse Distance Weighting

For each prediction:

1. Find the nearest calibration feature vectors.
2. Weight target coordinates by inverse feature distance.
3. Include a small epsilon to avoid division by zero.
4. Limit to the nearest `k` neighbors.

## Option B — Locally Weighted Regression

1. Select nearest calibration samples.
2. Fit a small weighted local regression.
3. Predict only for the current feature vector.
4. Fall back to ridge if the local matrix is unstable.

## Evaluation

Compare models using:

- median error
- 90th-percentile error
- edge-region error
- center-region error
- stability during small head movement

Do not make the new model default unless it wins on measured performance.

## Acceptance Criteria

- Multiple model types can be compared.
- Evaluation uses the same stored dataset.
- The best-performing model can be selected through configuration.
- Unstable local models fall back safely.

---

# Milestone 9 — Add Developer Debug Mode

## Goal

Make gaze behavior inspectable.

Enable with:

```text
?debug=true
```

## Debug Panel

Show:

- current feature vector summary
- predicted coordinates
- filtered coordinates
- confidence score
- active target
- dwell elapsed
- dwell threshold
- nearest calibration sample distance
- calibration model type
- recent online sample count
- last model update time
- current median validation error

## Visualizations

Add toggles for:

- calibration target map
- gaze trail
- confidence heatmap
- selected target rectangles
- calibration residual vectors
- accepted online samples
- rejected online samples

## Export

Add a button to download anonymized calibration and evaluation data as JSON.

Do not export:

- conversation text
- personal memories
- API keys
- microphone transcripts

unless explicitly included through a separate consent flow.

## Acceptance Criteria

- Debug mode does not appear by default.
- Debug rendering does not block normal interaction.
- Data export is privacy-conscious.
- Debug information is useful enough to diagnose calibration failure.

---

# Milestone 10 — Add Correction-Aware Learning

## Goal

Use correction behavior as a negative or corrective signal.

## Detect Patterns

Examples:

### Undo pattern

```text
activate target A
undo within 3 seconds
```

Action:

- invalidate the most recent online sample
- mark target A interaction as uncertain

### Neighbor correction

```text
activate target A
then target B within a short window
```

When A and B are neighboring targets:

- down-weight sample for A
- optionally create a weak sample for B
- log the correction vector from A to B

### Repeated overshoot

If corrections frequently move in one direction:

- estimate a local bias
- include it in diagnostics
- do not apply a global shift without validation

## Acceptance Criteria

- Undo removes or invalidates the relevant sample.
- Correction events are logged.
- The model does not learn strongly from ambiguous sequences.
- Corrections influence retraining weights.

---

# Milestone 11 — Structured Personal Memory

## Goal

Replace keyword-only memory retrieval while preserving the existing UI.

## Data Model

```js
{
  entities: [
    {
      id: "person-emma",
      type: "person",
      name: "Emma",
      attributes: {
        relationship: "daughter"
      }
    }
  ],
  facts: [
    {
      subjectId: "person-emma",
      predicate: "visited",
      object: "yesterday",
      approved: true,
      source: "user"
    }
  ]
}
```

## Requirements

- Keep all memories user-approved.
- Add migration from existing one-line memories.
- Preserve a simple editing experience.
- Add retrieval by:
  - entity
  - relationship
  - recency
  - topic overlap
  - partner identity

## Acceptance Criteria

- Existing memories are not lost.
- Retrieval is more precise than token overlap.
- The UI still presents understandable memory items.
- No memory is sent to an external model unless required for the current request.

---

# Milestone 12 — Context and Intent Engine

## Goal

Separate communicative intent from final wording.

## New Pipeline

```text
partner message
+ recent conversation
+ relevant memory
+ partner identity
+ current mode
+ time and environment

↓

intent candidates

↓

response realization

↓

gaze-selectable options
```

## Intent Candidate Shape

```js
{
  id,
  type,
  label,
  confidence,
  urgency,
  supportingContext,
  suggestedUtterances
}
```

Example intent types:

- answer_yes
- answer_no
- request_clarification
- report_discomfort
- request_assistance
- continue_topic
- change_topic
- ask_personal_question
- communicate_medical_need
- social_acknowledgment

## Fallback

Keep:

- rule-based response generation
- current Gemini flow
- keyboard
- utility actions

The intent engine should enhance the app, not make it unusable without an API key.

## Acceptance Criteria

- Intent ranking is separated from wording generation.
- Rule-based operation still works offline.
- Suggestions remain short and natural.
- Emergency and utility intents remain immediately accessible.

---

# Configuration

Create a single configuration object.

Example:

```js
export const GAZE_CONFIG = {
  calibration: {
    mode: "quick",
    settleMs: 600,
    collectMs: 1800,
    minValidSamples: 12,
    sampleQualityThreshold: 0.65
  },
  confidence: {
    dwellMinimum: 0.45
  },
  onlineLearning: {
    enabled: true,
    minSamplesBeforeUpdate: 30,
    maxSamples: 1000,
    updateCooldownMs: 120000
  },
  dwell: {
    adaptive: true,
    minMs: 500,
    maxMs: 1400
  },
  model: {
    type: "ridge",
    ridgeLambda: 0.08
  },
  filter: {
    type: "adaptive-exponential"
  }
};
```

Do not scatter tuning constants throughout the codebase.

---

# Testing Requirements

## Unit-Level Tests

At minimum, test:

- median feature aggregation
- sample-quality rejection
- confidence score boundaries
- weighted calibration fitting
- model rollback
- online-sample invalidation
- correction detection
- adaptive dwell mapping
- storage migration
- local-model fallback

Use a lightweight browser-compatible test setup.

## Manual Test Matrix

Test:

### Camera and calibration

- normal lighting
- dim lighting
- glasses
- moderate head movement
- user sits closer
- user sits farther away
- face temporarily disappears
- viewport resize
- browser reload

### Interaction

- high-confidence dwell
- low-confidence dwell
- mouse click
- keyboard shortcut
- touch input
- Undo after selection
- rapid neighboring correction
- long conversation
- generated word buttons
- regenerated response buttons

### Persistence

- calibration reload
- old schema migration
- corrupted localStorage
- online model rollback
- memory persistence

---

# Privacy and Safety Requirements

1. Keep camera processing local.
2. Do not record or upload camera frames.
3. Persist numeric features only when necessary.
4. Make online learning visible in settings or status.
5. Allow the user to:
   - pause online learning
   - clear calibration data
   - clear online samples
   - export calibration diagnostics
6. Do not imply medical-device approval.
7. Keep emergency actions accessible without AI.
8. Never allow low-confidence gaze to trigger destructive actions silently.

---

# Definition of Done

The gaze system is considered meaningfully improved when:

- five-point calibration produces usable control
- poor samples are rejected
- confidence controls dwell activation
- successful dwell events create weak training samples
- corrections invalidate or reduce sample weight
- online updates are evaluated before adoption
- the prior model can be restored
- gaze feels smoother without excessive lag
- debug mode exposes model behavior
- existing AAC functions still work
- calibration and learning code are modular

---

# Claude Working Instructions

For every milestone:

1. Inspect the existing implementation before editing.
2. State which files will change.
3. Implement only the current milestone.
4. Preserve backward compatibility.
5. Run or describe relevant tests.
6. Report:
   - files changed
   - behavior added
   - tradeoffs
   - known limitations
   - next recommended milestone
7. Do not begin the next milestone automatically.
8. Avoid placeholder implementations.
9. Do not silently remove current behavior.
10. Keep code simple enough for a research prototype to inspect and modify.

---

# First Execution Task

Begin with **Milestone 0 and Milestone 1 only**.

Specifically:

1. Add baseline gaze evaluation instrumentation.
2. Extract feature extraction, calibration model, filtering, and persistence into modules.
3. Preserve exact current runtime behavior.
4. Do not yet change:
   - calibration point count
   - collection timings
   - regression algorithm
   - smoothing behavior
   - dwell behavior
   - response generation
5. Return the full patch or edited files.
6. Include a brief manual test checklist.

Stop after these two milestones.

# ContextGaze — Master Execution Plan for Claude

## Mission

Build ContextGaze as a modular, research-grade **contextual communication operating system** for people with severe motor impairments.

The system should not merely help a user type with their eyes.

It should reduce the total effort required to communicate by combining:

- robust gaze interaction
- conversational context
- structured personal memory
- partner-aware behavior
- communicative intent prediction
- adaptive interface design
- online personalization
- research instrumentation

ALS is the first application domain, not the final boundary.

The long-term product is:

> A context-aware communication intelligence platform that predicts what a user is trying to communicate and presents the smallest possible set of high-value actions for confirmation.

---

# Product Thesis

Traditional AAC systems optimize text entry.

ContextGaze should optimize **communication completion**.

That means the primary unit of optimization is not:

```text
characters per minute
```

It is:

```text
successful communicative intent
```

Examples of communicative intent:

- answer yes
- answer no
- ask for clarification
- report discomfort
- request help
- continue a story
- change the subject
- ask a personal question
- express emotion
- make a joke
- communicate urgency
- share a memory
- confirm or reject a suggestion

The system should predict intent first and generate language second.

---

# High-Level Architecture

```text
Camera / Gaze
Conversation
Personal Memory
Partner Identity
Time
Environment
Medical Context
Recent Actions
User Preferences

↓

Signal Processing Layer

↓

Context Engine

↓

Intent Inference Layer

↓

Communication Planner

↓

Adaptive Interface

↓

User Confirmation

↓

Speech / Text / Action

↓

Online Learning and Evaluation
```

---

# Core Subsystems

## 1. Gaze Engine

Responsibilities:

- face and iris feature extraction
- head-pose normalization
- calibration
- confidence estimation
- gaze filtering
- dwell interaction
- online self-calibration
- correction-aware learning
- target selection

The gaze engine is one subsystem, not the entire product.

---

## 2. Context Engine

Responsibilities:

- maintain conversation state
- retrieve relevant memories
- identify communication partner
- incorporate time and environment
- track current activity or setting
- identify unresolved questions
- estimate urgency
- prepare structured context for intent inference

The context engine should return structured data, not a giant prompt string.

---

## 3. Intent Engine

Responsibilities:

- generate candidate communicative intents
- rank candidates
- estimate uncertainty
- identify when clarification is required
- detect urgent or safety-critical intents
- avoid overconfident suggestion behavior

The system should represent multiple hypotheses.

Example:

```js
[
  {
    type: "answer_yes",
    probability: 0.54
  },
  {
    type: "request_clarification",
    probability: 0.23
  },
  {
    type: "answer_no",
    probability: 0.13
  }
]
```

---

## 4. Communication Planner

Responsibilities:

- turn intents into short selectable actions
- create natural utterances
- choose response length
- decide whether to ask a clarification question
- preserve tone and user preferences
- avoid repetitive suggestions
- support rule-based fallback
- support external LLM providers optionally

The planner should not own memory retrieval or gaze behavior.

---

## 5. Memory System

Responsibilities:

- store user-approved facts
- represent people, places, preferences, events, and relationships
- retrieve relevant context
- track recency and confidence
- preserve provenance
- support editing and deletion
- avoid sending unnecessary memories to external APIs

Memory must remain understandable to the user.

---

## 6. Partner Model

Responsibilities:

- represent who the user is communicating with
- store relationship type
- store common topics
- store communication patterns
- adapt interface and suggestions
- distinguish doctor, caregiver, family, friend, and unknown partner contexts

Partner identity should influence suggestions but must not hard-code stereotypes.

---

## 7. Adaptive Interface

Responsibilities:

- display the smallest useful action set
- adapt option size and layout
- prioritize urgent actions
- support gaze, mouse, touch, and keyboard
- maintain direct access to emergency actions
- reduce unnecessary navigation
- preserve predictable placement for essential actions
- visualize confidence and system uncertainty

The interface should adapt without becoming unstable or confusing.

---

## 8. Personalization and Learning

Responsibilities:

- improve calibration
- learn preferred wording
- learn common intents by context
- learn partner-specific habits
- learn target placement preferences
- learn dwell preferences
- detect repeated corrections
- preserve rollback and user control

No model update should silently make the application worse.

---

## 9. Research and Evaluation Platform

Responsibilities:

- log anonymized interaction metrics
- support feature flags
- support model comparison
- export study data
- measure communication effort
- measure model uncertainty
- compare interaction paradigms
- enable controlled experiments

The research layer must be built into the architecture rather than added at the end.

---

# Repository Architecture

Refactor toward the following structure without forcing unnecessary movement all at once.

```text
/
  index.html
  styles.css
  app.js

  core/
    eventBus.js
    appState.js
    config.js
    featureFlags.js

  gaze/
    featureExtraction.js
    headPose.js
    calibrationSession.js
    calibrationModel.js
    confidence.js
    gazeFilter.js
    dwellController.js
    onlineCalibration.js
    correctionLearning.js
    gazeStorage.js

  context/
    conversationState.js
    environmentContext.js
    partnerContext.js
    contextAssembler.js
    urgencyDetector.js

  intent/
    intentSchema.js
    intentGenerator.js
    intentRanker.js
    uncertainty.js
    intentFallback.js

  communication/
    responsePlanner.js
    utteranceGenerator.js
    clarificationPlanner.js
    speechOutput.js
    providerAdapters.js

  memory/
    memoryStore.js
    memoryGraph.js
    memoryMigration.js
    memoryRetriever.js
    memoryEditor.js

  interface/
    adaptiveLayout.js
    targetRegistry.js
    suggestionRenderer.js
    emergencyActions.js
    accessibility.js

  learning/
    interactionLogger.js
    personalization.js
    preferenceModel.js
    modelRegistry.js
    rollback.js

  research/
    metrics.js
    experimentConfig.js
    debugPanel.js
    dataExport.js
    evaluation.js

  tests/
```

Do not create every file immediately.

Only create modules when the relevant milestone is implemented.

---

# Shared Data Contracts

## App Context

```js
{
  timestamp,
  mode,
  partner,
  conversation,
  environment,
  relevantMemories,
  userState,
  recentActions,
  gazeState,
  safetyState
}
```

---

## Partner

```js
{
  id,
  name,
  relationship,
  role,
  preferredTopics,
  recentInteractions,
  communicationPatterns,
  confidence
}
```

---

## Conversation State

```js
{
  turns,
  currentTopic,
  unresolvedQuestions,
  recentEntities,
  sentiment,
  urgency,
  lastPartnerQuestion,
  lastUserIntent
}
```

---

## Intent Candidate

```js
{
  id,
  type,
  label,
  probability,
  urgency,
  confidence,
  evidence,
  suggestedUtterances,
  requiresConfirmation,
  safetyClass
}
```

---

## Memory Entity

```js
{
  id,
  type,
  name,
  attributes,
  aliases,
  createdAt,
  updatedAt
}
```

---

## Memory Fact

```js
{
  id,
  subjectId,
  predicate,
  object,
  confidence,
  source,
  approved,
  createdAt,
  updatedAt,
  lastUsedAt
}
```

---

## Interaction Event

```js
{
  timestamp,
  inputMode,
  targetId,
  intentId,
  dwellDuration,
  confidence,
  correction,
  outcome,
  contextSnapshotId
}
```

---

# Execution Roadmap

# Phase 0 — Baseline and Stabilization

## Objective

Understand the current implementation and establish measurable behavior before changing architecture.

## Tasks

1. Inspect the existing HTML, CSS, and JavaScript.
2. Document:
   - current application state shape
   - calibration flow
   - suggestion flow
   - memory flow
   - speech input and output flow
   - dwell activation flow
3. Add non-invasive instrumentation.
4. Add a central configuration object.
5. Add feature flags.
6. Add bounded debug logging.
7. Preserve exact current behavior.

## Required Metrics

- calibration duration
- gaze error when target coordinates are known
- dwell success count
- dwell cancellation count
- accidental activation count
- correction count
- response suggestion latency
- suggestion selection rate
- keyboard usage rate
- number of actions required per completed utterance

## Acceptance Criteria

- Existing functionality is unchanged.
- Current behavior can be measured.
- Logs do not contain private conversation or memory content by default.
- Feature flags can enable future components independently.

---

# Phase 1 — Modularize the Current System

## Objective

Separate concerns without redesigning behavior.

## Tasks

Extract:

- gaze feature extraction
- calibration model
- gaze filtering
- dwell control
- memory storage
- conversation state
- suggestion generation
- speech output
- configuration
- logging

Introduce a lightweight event bus or explicit callbacks.

Example events:

```text
gaze:updated
gaze:confidence
dwell:started
dwell:cancelled
dwell:activated
conversation:updated
intent:selected
memory:updated
speech:started
speech:finished
```

## Acceptance Criteria

- `app.js` becomes orchestration rather than implementation.
- Modules do not depend directly on DOM elements unless they are interface modules.
- No framework is introduced.
- All current features still work.

---

# Phase 2 — Robust Gaze Engine

## Objective

Make gaze interaction reliable enough to support the rest of the system.

## Workstreams

### 2.1 Sample Quality

- longer collection window
- median feature aggregation
- reject unstable points
- detect eye closure
- detect face loss
- detect excessive head movement
- retry only failed points

### 2.2 Calibration Modes

Provide:

- quick calibration
- accuracy calibration
- recalibration
- region-specific recalibration

### 2.3 Confidence

Estimate confidence from:

- face quality
- iris visibility
- eye openness
- head motion
- feature stability
- calibration coverage
- model residual
- prediction bounds

### 2.4 Filtering

Implement:

- adaptive exponential smoothing
- optional Kalman filter
- reset after face loss
- confidence-aware smoothing

### 2.5 Dwell

Implement:

- adaptive dwell time
- confidence threshold
- target-size adjustment
- destructive-action safeguards
- visual progress feedback

### 2.6 Online Calibration

Use high-confidence successful dwell events as weak labels.

Delay adoption of samples until correction risk has passed.

Support:

- sample weighting
- rolling window
- validation before adoption
- model rollback
- user control
- clearing learned data

## Acceptance Criteria

- five-point calibration is usable.
- failed points are retried individually.
- low-confidence gaze cannot activate controls.
- successful interactions can improve calibration.
- corrections invalidate recent samples.
- the previous model can be restored.
- gaze behavior is observable in debug mode.

---

# Phase 3 — Target-Based Selection

## Objective

Stop requiring exact pixel prediction when the real task is selecting an interface element.

## Approach

Combine:

- coarse gaze coordinate prediction
- target geometry
- target priors
- dwell history
- interface context
- neighboring target structure

Calculate:

```js
P(target | gaze, context, history)
```

rather than relying only on:

```js
distance(predictedPoint, targetCenter)
```

## Tasks

1. Create a target registry.
2. Assign stable IDs to gaze-selectable controls.
3. Track target rectangles.
4. Estimate selection probability per target.
5. Add target hysteresis.
6. Prevent rapid target switching.
7. Compare coordinate-only and target-probability modes.

## Acceptance Criteria

- noisy gaze near a target boundary is less disruptive.
- exact gaze pixel accuracy is no longer the only selection signal.
- target selection remains predictable.
- coordinate-only mode remains available for comparison.

---

# Phase 4 — Conversation State Engine

## Objective

Represent the conversation as structured state.

## Tasks

Track:

- speaker turns
- current topic
- last question
- unresolved questions
- recently mentioned entities
- sentiment
- urgency
- user-confirmed intent
- topic changes
- clarification history

Create:

```js
updateConversationState(previousState, newTurn)
```

The state engine should work without an external LLM.

Use rules first, then optional model enrichment.

## Acceptance Criteria

- the application knows whether the partner asked a yes/no question.
- the application tracks unresolved questions.
- current topic persists across turns.
- conversation state can be inspected in debug mode.
- failure of an external model does not break state tracking.

---

# Phase 5 — Structured Memory Graph

## Objective

Replace flat keyword-based memory with structured, user-controlled memory.

## Tasks

1. Define entity and fact schemas.
2. Migrate existing free-text memories.
3. Preserve original text during migration.
4. Add entity extraction as a suggestion, not an automatic truth.
5. Require user approval for persistent facts.
6. Add retrieval by:
   - entity
   - topic
   - relationship
   - recency
   - partner
   - event
7. Add edit and delete controls.
8. Add provenance and confidence.

## Example

```text
Emma
  relationship: daughter
  lives_in: Boston
  has_child: Noah
  likes: hiking
  last_visit: 2026-07-18
```

## Acceptance Criteria

- no existing memory is lost.
- retrieved memories are visibly relevant.
- the user can inspect and edit stored facts.
- private memories are not sent externally unless needed.
- memory retrieval is separate from language generation.

---

# Phase 6 — Partner Model

## Objective

Adapt communication support to the person the user is speaking with.

## Tasks

1. Allow manual partner selection.
2. Support unknown partner mode.
3. Track recent partner interactions.
4. Associate memories and topics with partners.
5. Adapt:
   - suggestion type
   - interface shortcuts
   - tone
   - response length
   - likely intents
6. Avoid rigid partner templates.

## Example Modes

### Doctor

Prioritize:

- symptoms
- pain
- medication
- clarification
- treatment questions
- urgency

### Family

Prioritize:

- memories
- emotions
- stories
- questions
- affection
- humor

### Caregiver

Prioritize:

- comfort
- positioning
- food
- water
- bathroom
- urgent help

## Acceptance Criteria

- partner context influences suggestions.
- essential actions remain available across all partner modes.
- unknown mode works normally.
- partner models can be reset or edited.

---

# Phase 7 — Intent Engine

## Objective

Predict communicative goals before generating text.

## Intent Taxonomy

Start with a small, inspectable taxonomy:

```text
answer_yes
answer_no
answer_uncertain
request_clarification
request_help
report_discomfort
report_pain
request_item
continue_topic
change_topic
ask_question
share_memory
express_emotion
social_acknowledgment
make_joke
urgent_alert
custom_utterance
```

Do not begin with dozens of categories.

## Tasks

1. Define intent schema.
2. Build a rule-based generator.
3. Build a ranking layer.
4. Estimate probability and uncertainty.
5. Add optional LLM enrichment.
6. Add confidence thresholds.
7. Add clarification behavior.
8. Log selected and rejected intents.
9. Learn context-specific priors over time.

## Clarification Policy

When uncertainty is high, do not generate four arbitrary sentences.

Show intent-level clarification such as:

```text
Answer
Ask something
Request help
Change topic
```

Then narrow further.

## Acceptance Criteria

- intent generation works without an API key.
- the system exposes uncertainty.
- selected intent is logged separately from wording.
- high-risk intents require confirmation.
- intent suggestions are more stable than sentence-only suggestions.

---

# Phase 8 — Communication Planner

## Objective

Convert intent into concise, natural, user-appropriate language.

## Tasks

1. Separate response planning from intent ranking.
2. Support multiple utterance lengths:
   - one word
   - short phrase
   - natural sentence
3. Learn preferred phrasing.
4. Avoid repeated suggestions.
5. Preserve user voice.
6. Use relevant memories sparingly.
7. Generate clarification questions when needed.
8. Provide rule-based fallback.
9. Support optional provider adapters.

## Provider Architecture

```js
generateUtterances(plan, provider)
```

Providers may include:

- rules
- Gemini
- future local model
- future OpenAI adapter

No provider should own application state.

## Acceptance Criteria

- the app remains usable offline.
- provider failure falls back gracefully.
- generated text is concise by default.
- user-approved memories are not hallucinated or altered.
- intent and wording can be evaluated independently.

---

# Phase 9 — Adaptive Interface

## Objective

Show the fewest high-value controls needed for the current situation.

## Stable Interface Zones

Some controls should remain in predictable locations:

- Help
- Yes
- No
- Undo
- Speak
- Keyboard
- Stop speech

Contextual controls may change elsewhere.

## Modes

### Conversation Mode

- top intent suggestions
- short utterances
- clarification
- keyboard fallback

### Medical Mode

- pain
- symptoms
- body location
- medication
- urgency
- repeat or clarify

### Care Mode

- reposition
- water
- food
- bathroom
- temperature
- help

### Social Mode

- acknowledge
- ask question
- share memory
- emotion
- humor
- topic change

### Emergency Mode

- large targets
- minimal choices
- confirmation safeguards
- no dependency on cloud services

## Tasks

1. Build adaptive layout manager.
2. Preserve stable essential actions.
3. Increase target size for likely intents.
4. Reduce visual clutter.
5. Support progressive disclosure.
6. Add uncertainty-aware presentation.
7. Add target placement consistency rules.
8. Test all modes with gaze and mouse.

## Acceptance Criteria

- interface adapts without disorienting the user.
- emergency actions are always accessible.
- likely actions receive more space.
- keyboard remains available as fallback.
- target locations do not shift excessively during dwell.

---

# Phase 10 — Personalization Engine

## Objective

Learn the user’s communication habits while preserving control and reversibility.

## Learnable Signals

- preferred phrases
- common intents by context
- common partner topics
- preferred response length
- dwell preferences
- common corrections
- interface mode usage
- frequently selected utility actions
- repeated gaze biases

## Rules

- distinguish temporary context from stable preference.
- use recency weighting.
- expose reset controls.
- do not silently rewrite memories.
- validate changes before adoption.
- keep a rollback path.

## Acceptance Criteria

- suggestions become more personally relevant over time.
- the user can clear personalization independently.
- personalization does not overwrite explicit preferences.
- model changes are inspectable in debug mode.

---

# Phase 11 — Safety and Urgency Layer

## Objective

Ensure high-priority communication remains reliable.

## Urgent Intents

Examples:

- help
- pain
- breathing difficulty
- emergency
- call caregiver
- stop
- unsafe position

## Requirements

1. Always-available emergency controls.
2. No cloud dependency.
3. Larger targets.
4. confirmation where accidental activation is dangerous.
5. optional auditory acknowledgment.
6. clear state when an alert is active.
7. no suppression by personalization.
8. low-confidence gaze cannot trigger irreversible actions.

## Acceptance Criteria

- urgent actions work offline.
- emergency controls are available in every mode.
- accidental activation safeguards are present.
- emergency mode is testable without contacting real services.

---

# Phase 12 — Research Infrastructure

## Objective

Turn ContextGaze into an experimental platform.

## Metrics

### Gaze

- median pixel error
- 90th-percentile error
- calibration time
- calibration retries
- confidence distribution
- drift over time
- online-learning improvement

### Interaction

- time to target
- dwell cancellations
- accidental activation rate
- correction rate
- target switches
- gaze travel distance
- actions per utterance

### Communication

- intent selection time
- intent prediction accuracy
- top-k intent recall
- utterance completion time
- words per minute
- percentage of interactions completed without keyboard
- clarification frequency

### User Experience

- perceived workload
- frustration
- trust
- predictability
- satisfaction
- partner satisfaction

## Experiment Configuration

```js
{
  experimentId,
  participantId,
  gazeModel,
  filterType,
  dwellMode,
  intentMode,
  memoryMode,
  interfaceMode,
  enabledFeatures
}
```

## Feature Flags

Examples:

```text
onlineCalibration
adaptiveDwell
targetProbabilitySelection
structuredMemory
partnerModel
intentEngine
adaptiveInterface
kalmanFilter
```

## Data Export

Export anonymized JSON or CSV.

Exclude by default:

- conversation text
- memory content
- audio
- video
- API keys
- identifying partner names

## Acceptance Criteria

- experiments can be configured without editing core logic.
- metrics are comparable across variants.
- privacy-sensitive content is excluded by default.
- exported data includes schema version.

---

# Phase 13 — Study Protocol Support

## Objective

Prepare the system for pilot studies.

## Tasks

1. Add guided calibration test.
2. Add standardized communication tasks.
3. Add session start and end markers.
4. Add participant code field.
5. Add consent reminder.
6. Add post-task ratings.
7. Add data export validation.
8. Add session summary.

## Example Study Tasks

- answer five yes/no questions
- request an object
- correct a wrong suggestion
- report discomfort
- tell a short story
- communicate with a known partner
- communicate with an unknown partner

## Acceptance Criteria

- sessions are reproducible.
- metrics can be compared across participants.
- no personally identifying data is required.
- study mode is separate from normal use.

---

# Phase 14 — Keyboard Reassessment

## Objective

Determine whether the keyboard should remain central, become secondary, or be removed from the main flow.

Do not remove the keyboard immediately.

Measure:

- how often it is used
- when intent suggestions fail
- which users rely on it
- whether it acts as a correction mechanism
- how many interactions can be completed without it

Possible end states:

1. keyboard remains fully available
2. keyboard becomes an explicit fallback
3. keyboard becomes context-specific
4. keyboard is hidden in research conditions
5. keyboard is replaced by intent refinement

## Acceptance Criteria

- the decision is evidence-based.
- no user loses access to free-form communication.
- research variants can hide the keyboard without deleting it.

---

# Cross-Cutting Requirements

## Accessibility

- support gaze, mouse, touch, and keyboard
- preserve high contrast
- large target sizes
- visible focus states
- no essential hover-only interaction
- no timed action without adequate feedback
- speech output controls
- reduced-motion option
- readable text sizing

## Privacy

- camera processing stays local
- no frame recording
- no automatic cloud upload
- memories remain user-controlled
- export is explicit
- API keys are not persisted insecurely
- debug logs avoid content by default

## Reliability

- app must work without an external model
- emergency functions must work offline
- corrupted storage must fail safely
- external API failures must not freeze interaction
- model updates require validation
- previous models remain recoverable

## Maintainability

- no large monolithic modules
- data contracts documented
- configuration centralized
- feature flags used
- migrations versioned
- tests added with each subsystem

---

# Test Strategy

## Unit Tests

Test:

- gaze feature aggregation
- calibration fitting
- sample rejection
- confidence boundaries
- target probability calculation
- dwell timing
- model rollback
- memory migration
- memory retrieval
- conversation state updates
- intent ranking
- uncertainty thresholds
- provider fallback
- personalization reset
- privacy-safe export

## Integration Tests

Test:

- partner message to intent suggestions
- memory retrieval to response generation
- gaze activation to online calibration
- correction to sample invalidation
- intent selection to speech output
- external provider failure to rule-based fallback
- emergency action under low-confidence gaze
- reload with persisted calibration and memory

## Manual Test Matrix

Test:

- glasses
- low light
- bright backlight
- face partially outside frame
- head movement
- camera loss
- browser resize
- different screen sizes
- slow speech recognition
- no microphone permission
- no API key
- corrupted local storage
- very long conversation
- repeated corrections
- unknown communication partner
- emergency mode

---

# Milestone Delivery Format for Claude

For each milestone, Claude must return:

## 1. Scope

What was implemented and what was intentionally deferred.

## 2. Files Changed

List each file and its purpose.

## 3. Architecture Notes

Explain data flow and module boundaries.

## 4. Patch

Provide complete edited files or a unified diff.

## 5. Tests

List automated and manual tests performed.

## 6. Known Limitations

Be explicit.

## 7. Next Milestone

Recommend only the next milestone.

Claude must stop after the assigned milestone.

---

# First Execution Task

Implement only:

## Phase 0 — Baseline and Stabilization

and

## Phase 1 — Modularize the Current System

### Required Work

1. Inspect the existing codebase.
2. Document current data flow.
3. Add a central config module.
4. Add feature flags.
5. Add privacy-safe interaction instrumentation.
6. Add a bounded event log.
7. Extract:
   - gaze feature extraction
   - calibration model
   - gaze filter
   - dwell controller
   - memory storage
   - conversation state
   - suggestion generation
   - speech output
8. Keep current runtime behavior unchanged.
9. Do not redesign the UI.
10. Do not change calibration timing, point count, model type, or dwell threshold yet.
11. Do not implement structured memory or intent prediction yet.
12. Include a manual regression checklist.

### Stop Condition

Stop after Phase 0 and Phase 1.

Do not continue automatically.

---

# Second Execution Task

After Phase 0 and Phase 1 are reviewed, implement:

## Phase 2 — Robust Gaze Engine

Do not combine it with context, memory, intent, or interface work.

---

# Third Execution Task

After the gaze engine is reviewed, implement:

## Phase 3 — Target-Based Selection

Then stop.

---

# Fourth Execution Task

Implement:

- Phase 4 — Conversation State Engine
- Phase 5 — Structured Memory Graph

Then stop.

---

# Fifth Execution Task

Implement:

- Phase 6 — Partner Model
- Phase 7 — Intent Engine

Then stop.

---

# Sixth Execution Task

Implement:

- Phase 8 — Communication Planner
- Phase 9 — Adaptive Interface

Then stop.

---

# Seventh Execution Task

Implement:

- Phase 10 — Personalization Engine
- Phase 11 — Safety and Urgency Layer

Then stop.

---

# Eighth Execution Task

Implement:

- Phase 12 — Research Infrastructure
- Phase 13 — Study Protocol Support
- Phase 14 — Keyboard Reassessment instrumentation

Then stop.

---

# Final Definition of Success

ContextGaze is successful when it demonstrates that a person with severe motor impairment can complete meaningful communication with substantially less effort than a conventional gaze keyboard.

The system should be able to answer:

- What is the user likely trying to accomplish?
- Which context supports that inference?
- How certain is the system?
- What is the smallest useful set of actions to show?
- Can the user confirm the intended action reliably?
- Did the interaction improve the system?
- Can the system explain and measure its own performance?

The core research claim should become:

> Context-aware intent prediction can reduce the interaction cost of assistive communication more effectively than improving text entry alone.

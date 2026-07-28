# ContextGaze AAC

ContextGaze is a purpose-built assistive communication tool for people who can't rely on a mouse, touchscreen, or keyboard to communicate. It lets someone hold a conversation, answer questions, ask for help, and compose messages using only their eyes, tracked through an ordinary webcam. Voice, mouse, touch, and keyboard input all keep working too, so it degrades gracefully as a person's abilities or environment change, instead of being gaze-only.

The goal isn't just "type with your eyes." ContextGaze combines calibrated gaze tracking with conversational context and personal memory so it can surface the small set of responses a person is actually likely to want next — cutting down how much precise eye control a fatigued or impaired user needs to produce a sentence, ask a question, or flag discomfort.

It runs entirely client-side: no backend, no build step, no framework. Face and eye landmarks come from MediaPipe FaceLandmarker; gaze-to-screen mapping is a ridge-regression model trained on a short on-screen calibration, then continuously refined from normal use.

## Why gaze, and why this matters

For someone who has lost reliable control of their limbs and voice, eye movement is often the motor channel that stays usable longest. A communication tool that depends on that channel needs to be:

- **Accurate enough to trust** — a wrong selection when you're asking "I need help" or "I'm in pain" is not a minor UX bug.
- **Forgiving of a shaky or uncertain signal** — webcam gaze tracking is noisier than dedicated eye-tracking hardware, so the system has to know when it doesn't know, and fail safe (pause, don't guess) rather than fail confidently wrong.
- **Fast to set up and quick to recalibrate** — drift happens every time a person's head position, lighting, or camera position shifts, and calibration time is time not spent communicating.
- **Cheap and accessible** — it should work with hardware people already have (a laptop or tablet webcam), not a $10,000 dedicated eye-tracker.

Every piece of the gaze engine in this repo — sample-quality filtering, live confidence scoring, dwell-pause gating, continuous self-calibration — exists in service of those constraints.

## How gaze control works

1. **Start camera** — grants webcam access and starts face tracking.
2. **Calibrate gaze** — look at and click through a sequence of on-screen dots. Choose **Quick (5 points)** for a fast calibration or **Accuracy (13 points)** for denser coverage. Unsteady or low-quality samples (blinks, head movement, poor lighting) are automatically detected and rejected during collection.
3. Once calibrated, dwelling on a response button, key, or word suggestion for the configured **Dwell** time activates it. A live confidence readout and dwell-pause indicator (red outline) show when the tracker is too uncertain to trust the current gaze estimate — activation is paused, not forced, while confidence is low.
4. As the person uses the app normally, high-confidence dwell activations are also fed back into the calibration model (online self-calibration), so accuracy improves over a session without requiring an explicit recalibration.
5. **Undo** reverses the last activation.

Gaze is additive, not exclusive: voice input, typed text, mouse, and touch all work side by side with it.

## Beyond gaze: context-aware communication

The rest of the interface is built around reducing how much a user has to produce, character by character, to communicate:

- **Conversation-aware suggestions** — responses are generated based on what the communication partner just said, not a static grid of phrases.
- **Personal memory** — user-approved facts (names, relationships, routines, recurring topics) are retrieved and used to make suggestions specific and relevant, and can be viewed/edited at any time.
- **Predictive keyboard** — for anything not covered by a suggestion, a full compose keyboard with word prediction is available, all gaze/voice/touch operable.
- **Utility actions** — quick access to short, high-value responses (Yes / No / Repeat that / I need help) that don't require composing anything.

## Running it

This is plain HTML/CSS/JS loaded via ES modules, so it just needs to be served over HTTP (module imports and camera access don't work from a `file://` URL):

```bash
python3 -m http.server 8843
```

Then open `http://localhost:8843` in a browser and grant camera access.

### Optional: AI-generated suggestions

`index.html` loads `config.js` (gitignored, not included in this repo) before `app.js`. If you want the context-aware response suggestions to call out to Gemini, create it yourself:

```js
// config.js
window.GEMINI_API_KEY = "your-api-key-here";
```

Without it, the app still runs — response suggestions fall back to local rule-based logic instead of the API call.

## Project structure

```
app.js                        UI wiring, camera/tracking loop, dwell/activation logic
evaluation.js                 In-browser logging of gaze accuracy/activation outcomes
index.html / styles.css       Markup and styling
vendor/mediapipe/              Vendored MediaPipe vision bundle
calibration/
  featureExtraction.js         Landmarks -> normalized gaze feature vector
  calibrationModel.js          Ridge-regression fit/predict (fitCalibrationModel/predictGaze)
  gazeFilter.js                Exponential smoothing of predicted gaze point
  sampleQuality.js             Rejects unsteady/low-quality calibration samples
  confidence.js                Live per-frame confidence scoring for dwell gating
  calibrationEvaluation.js     Leave-one-point-out accuracy evaluation of a fitted model
  storage.js                   Versioned localStorage persistence for calibration data
  onlineLearning.js            Weak-label collection from normal use, to refine calibration over time
```

## Roadmap

ContextGaze's long-term direction — described in `contextgaze_master_plan.md` — is to grow from a gaze-controlled AAC interface into a fuller context-and-intent-aware communication system: conversation state tracking, a structured personal-memory graph, a partner model, and a communication planner that predicts intent and proposes the smallest useful set of actions, on top of a gaze engine reliable enough to support it.

Near-term implementation work toward that gaze engine is tracked milestone-by-milestone in `plan(1).md`. Completed so far: baseline evaluation instrumentation, modular calibration code, sample-quality validation, live confidence estimation, and an improved explicit-calibration flow. In progress: online self-calibration, adaptive dwell, improved gaze filtering, and developer debug tooling — all gated on keeping the gaze stack solid before any further AI/memory work begins.

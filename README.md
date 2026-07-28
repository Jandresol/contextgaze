# ContextGaze

ContextGaze is context-aware communication technology. Instead of predicting your next word from what you just typed, the way ordinary autocomplete does, it predicts what you're likely trying to say from the conversation itself: what your partner just said, who they are, and what it already knows about you. It then surfaces a small set of full, relevant responses (or a next-word prediction if you're composing freely) so getting a thought across takes far less input than typing it out.

That input can be your eyes. ContextGaze includes calibrated webcam gaze tracking, so anyone — not just someone at a keyboard — can select a suggestion, answer a question, or compose a message just by looking at it. Voice, mouse, touch, and keyboard all work the same way, side by side, so the input method never limits who can use it or when.

It runs entirely client-side: no backend, no build step, no framework. Face and eye landmarks come from MediaPipe FaceLandmarker; gaze-to-screen mapping is a ridge-regression model trained on a short on-screen calibration, then continuously refined from normal use.

## Context-aware, not just predictive text

Standard autocomplete only looks backward at your own keystrokes. ContextGaze looks outward:

- **Conversation-aware suggestions** — responses are generated from what the communication partner just said, not a static phrase grid or a purely statistical next-word guess.
- **Personal memory** — user-approved facts (names, relationships, routines, recurring topics) are retrieved and folded into suggestions so they're specific, not generic, and can be viewed or edited at any time.
- **Predictive keyboard** — for anything a suggestion doesn't cover, a full compose keyboard with word prediction is available as a fallback, operable by any input method.
- **Utility actions** — one-step access to short, high-value responses (Yes / No / Repeat that / I need help) that don't require composing anything at all.

The suggestion layer is designed to work with or without an external model: it falls back to local rule-based logic if no AI provider is configured.

## Gaze as an input method

Gaze tracking exists so the suggestions above are reachable by anyone, regardless of physical ability or what their hands are doing at the moment:

1. **Start camera** — grants webcam access and starts face tracking.
2. **Calibrate gaze** — look at and click through a sequence of on-screen dots. Choose **Quick (5 points)** for a fast calibration or **Accuracy (13 points)** for denser coverage. Unsteady or low-quality samples (blinks, head movement, poor lighting) are automatically detected and rejected during collection.
3. Once calibrated, dwelling on a response button, key, or word suggestion for the configured **Dwell** time activates it. A live confidence readout and dwell-pause indicator (red outline) show when the tracker is too uncertain to trust the current gaze estimate — activation pauses rather than guessing.
4. As the app is used normally, high-confidence dwell activations are also fed back into the calibration model (online self-calibration), so accuracy improves over a session without an explicit recalibration.
5. **Undo** reverses the last activation.

Every piece of the gaze engine — sample-quality filtering, live confidence scoring, dwell-pause gating, continuous self-calibration — exists to make this input channel trustworthy enough to rely on, especially for someone using it as their primary or only way to interact.

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

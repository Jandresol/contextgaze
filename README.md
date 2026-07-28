# ContextGaze AAC

A research-prototype AAC (augmentative/alternative communication) app controlled by calibrated webcam gaze, voice, mouse, touch, or keyboard. Runs entirely client-side — no backend, no build step, no framework. Face/eye landmarks come from MediaPipe FaceLandmarker; gaze-to-screen mapping is a ridge-regression model trained on a short on-screen calibration.

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

Without it, the app still runs — response suggestions just fall back to whatever local logic is in place without the API call.

## Using gaze control

1. **Start camera** — grants webcam access and starts face tracking.
2. **Calibrate gaze** — click through the on-screen dots while looking at each one. Choose **Quick (5 points)** for a fast calibration or **Accuracy (13 points)** for denser coverage.
3. Once calibrated, dwelling on a response button, key, or word suggestion for the configured **Dwell** time activates it. A live confidence readout and dwell-pause indicator (red outline) show when the tracker is too uncertain to trust the current gaze estimate.
4. **Undo** reverses the last activation.

Gaze control is additive — voice, mouse, touch, and keyboard input all keep working independently.

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
  onlineLearning.js            Weak-label collection from normal use, for refining calibration over time
```

## Roadmap

Ongoing implementation work is tracked against `plan(1).md` (the active execution plan, milestone by milestone) and the broader vision in `contextgaze_master_plan.md`.

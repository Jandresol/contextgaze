import {
  FaceLandmarker,
  FilesetResolver
} from "./vendor/mediapipe/vision_bundle.mjs";
import { extractFeatures, distance } from "./calibration/featureExtraction.js";
import { fitCalibrationModel, predictGaze } from "./calibration/calibrationModel.js";
import { createExponentialGazeFilter } from "./calibration/gazeFilter.js";
import { saveCalibration, loadCalibration } from "./calibration/storage.js";
import { assessCalibrationSample, SAMPLE_QUALITY_CONFIG } from "./calibration/sampleQuality.js";
import { estimateGazeConfidence, CONFIDENCE_CONFIG } from "./calibration/confidence.js";
import { evaluateCalibration } from "./calibration/calibrationEvaluation.js";
import { recordEvaluationSample, recordDwellCancelled, recordAccidentalActivation } from "./evaluation.js";
import {
  ONLINE_LEARNING_CONFIG,
  createPendingInteraction,
  recordInteractionFrame,
  buildCandidateSample,
  invalidateMostRecentSample,
  checkNeighborCorrection,
  isRepeatedEntry,
  sweepPendingSamples,
  shouldAttemptRefit,
  refitWithOnlineSamples,
  validateCandidateModel,
  pushModelHistory,
  popModelHistory
} from "./calibration/onlineLearning.js";

// How many recent full feature objects (see featureExtraction.js) to keep
// for confidence's head-movement / roll / gaze-stability variance metrics.
const FEATURE_HISTORY_LIMIT = 15;

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

const state = {
  memories: [
    "Emma is the user's daughter.",
    "Emma visited yesterday.",
    "Emma has two children, Noah and Lily.",
    "The user likes asking about the grandchildren.",
    "The user's spouse is Sarah.",
    "The user's favorite baseball team is the Red Sox.",
    "The user has a neurology appointment Tuesday at 10 AM.",
    "The user often says: Please move my left arm.",
    "The user often says: I am comfortable.",
    "The user prefers short, direct sentences."
  ],
  turns: [],
  suggestions: [],
  recognition: null,
  voices: [],
  faceLandmarker: null,
  stream: null,
  running: false,
  animationId: null,
  lastVideoTime: -1,
  latestFeatures: null,
  latestLandmarks: null,
  calibration: null,
  calibrationEnvelope: null, // full persisted envelope (samples/pointSummaries/qualitySummary) for the active/loaded calibration — state.calibration stays just the bare {wx,wy,width,height} model so predictGaze/estimateGazeConfidence callers are unchanged
  calibrationSamples: [],
  calibrationPointSummaries: [],
  calibrationPointIndex: 0,
  collecting: false,
  collectionBuffer: [],
  collectionAttempts: 0,
  dwellTarget: null,
  dwellStart: 0,
  dwellTargetRect: null,
  dwellPauseAccum: 0,
  lastDwellFrameAt: 0,
  gazeFilter: createExponentialGazeFilter(),
  lastFaceQuality: null,
  lastGazeActivationAt: 0,
  lastSpoken: null,
  featureHistory: [], // bounded rolling history of recent full feature objects, oldest first
  lastGazeConfidence: null,

  // Online self-calibration (Milestone 5) — see calibration/onlineLearning.js
  // for the actual logic; these are just the bookkeeping fields app.js owns
  // and threads through on the dwell lifecycle.
  pendingInteraction: null,     // the in-progress dwell's featureHistory/predictionHistory/confidenceHistory, or null when not dwelling on anything
  pendingOnlineSamples: [],     // candidate samples awaiting confirmation (see sweepPendingSamples)
  confirmedOnlineSamples: [],   // promoted samples accumulated toward the next refit (rolling window, capped by ONLINE_LEARNING_CONFIG.maxSamples)
  newPromotedSinceUpdate: 0,    // count of confirmedOnlineSamples added since the last accepted refit
  lastOnlineModelUpdateAt: 0,   // performance.now() timestamp of the last accepted online refit (0 = never)
  lastPendingSampleId: null,    // id of the most recently created pending candidate, for Undo correlation
  dwellEnterLog: [],            // rolling log of {id, at} for repeated-entry/exit detection
  calibrationModelHistory: []   // in-memory rollback stack of prior {wx,wy,width,height} models (see ONLINE_LEARNING_CONFIG.maxModelHistory)
};

const $ = id => document.getElementById(id);
const stopWords = new Set("the a an and or but if then is are was were be been being to of in on at for with from this that it you your my me i we they he she do did does how what when where who why can could would should".split(" "));
// Configurable calibration point layouts (Milestone 4). "quick" is the
// default per the plan's exact suggestion (top-left, top-right, center,
// bottom-left, bottom-right); "accuracy" reuses the previous fixed 13-point
// layout for users who want denser coverage. currentCalibrationPoints()
// reads the live #calibrationModeSelect value; startCalibration() snapshots
// its result into state.activeCalibrationPoints for the run in progress so
// the layout can't change mid-calibration if the user edits the select
// while the dialog happens to be open.
const CALIBRATION_LAYOUTS = {
  quick: [
    [0.10, 0.10], [0.90, 0.10],
    [0.50, 0.50],
    [0.10, 0.90], [0.90, 0.90]
  ],
  accuracy: [
    [0.10, 0.10], [0.50, 0.10], [0.90, 0.10],
    [0.10, 0.50], [0.50, 0.50], [0.90, 0.50],
    [0.10, 0.90], [0.50, 0.90], [0.90, 0.90],
    [0.30, 0.30], [0.70, 0.30], [0.30, 0.70], [0.70, 0.70]
  ]
};
function currentCalibrationPoints() {
  const mode = $("calibrationModeSelect")?.value;
  return CALIBRATION_LAYOUTS[mode] || CALIBRATION_LAYOUTS.quick;
}

function setPill(id, text, on) {
  const el = $(id);
  el.textContent = text;
  el.className = `pill ${on ? "on" : "off"}`;
}

function tokenize(text) {
  return [...new Set(text.toLowerCase().replace(/[^a-z0-9'\s]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w)))];
}
function retrieveMemories(query, limit = 4) {
  const q = tokenize(query);
  return state.memories.map(memory => {
    const words = tokenize(memory);
    const overlap = q.filter(w => words.includes(w)).length;
    return { memory, score: overlap * 3 + (q.some(w => memory.toLowerCase().includes(w)) ? 1 : 0) };
  }).sort((a,b) => b.score - a.score).filter(x => x.score > 0).slice(0,limit).map(x => x.memory);
}
function lastPartnerTurn() {
  return [...state.turns].reverse().find(t => t.role === "partner")?.text || "";
}
function ruleSuggestions(text) {
  const lower = text.toLowerCase();
  if (/\b(how are you|how do you feel|feeling)\b/.test(lower))
    return ["I am comfortable.", "I am tired.", "I need help.", "Please ask me more specifically."];
  if (lower.includes("emma"))
    return ["Yes, she visited yesterday.", "It was good to see her.", "How are Noah and Lily?", "When is Emma coming back?"];
  if (/\b(appointment|doctor|neurolog)/.test(lower))
    return ["My appointment is Tuesday at 10.", "Please add that to my questions.", "Ask about my medication.", "I want Sarah there with me."];
  if (/\b(red sox|baseball|game)\b/.test(lower))
    return ["How did the Red Sox do?", "I watched the game.", "Tell me the score.", "Who are they playing next?"];
  if (/\b(did|do you|are you|is it|was it|can you)\b/.test(lower))
    return ["Yes.", "No.", "I am not sure.", "Please repeat the question."];
  return ["Tell me more.", "What happened next?", "I agree.", "I am not sure."];
}

async function generateSuggestions() {
  const text = lastPartnerTurn();
  if (!text) {
    state.suggestions = ["I am comfortable.", "Please repeat that.", "I need help.", "Tell me what is happening."];
    renderSuggestions();
    return;
  }
  const relevant = retrieveMemories(text);
  $("retrievalNote").textContent = relevant.length
    ? `Retrieved: ${relevant.join(" • ")}`
    : "No personal memory matched.";

  const key = (window.GEMINI_API_KEY || "").trim();
  if (key) {
    try {
      const memoryBlock = relevant.length
        ? `Relevant personal facts about the user:\n${relevant.map(m => `- ${m}`).join("\n")}\n\n`
        : "";
      const recentContext = state.turns.slice(-6).map(t =>
        `${t.role === "partner" ? "Partner" : "User"}: ${t.text}`).join("\n");
      const prompt = `You are an AAC (augmentative and alternative communication) assistant for a person with limited speech. Generate exactly 4 short, natural response suggestions the user could say next.

${memoryBlock}Recent conversation:
${recentContext}

Rules:
- Each suggestion must be a complete, natural spoken sentence (not just one word)
- Keep suggestions concise (under 10 words each)
- Make them directly relevant to what the partner just said
- Vary the responses (don't make them all identical in tone)
- Return ONLY a JSON array of 4 strings, nothing else

Example output: ["Yes, that sounds good.", "I am not sure.", "Tell me more about that.", "Please ask Sarah."]`;

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
      );
      if (!res.ok) throw new Error(`Gemini ${res.status}`);
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length >= 2) {
          state.suggestions = parsed.slice(0, 4);
          $("retrievalNote").textContent = (relevant.length
            ? `Retrieved: ${relevant.join(" • ")} — `
            : "") + "AI suggestions";
          renderSuggestions();
          return;
        }
      }
    } catch (e) {
      console.warn("Gemini failed, falling back to rules:", e);
      $("retrievalNote").textContent += ` (AI error: ${e.message})`;
    }
  }

  state.suggestions = ruleSuggestions(text);
  renderSuggestions();
}

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function renderTranscript() {
  const el = $("transcript");
  el.innerHTML = "";
  for (const turn of state.turns) {
    const div = document.createElement("div");
    div.className = `turn ${turn.role}`;
    div.innerHTML = `<strong>${turn.role === "partner" ? "Partner" : "User"}</strong>${escapeHtml(turn.text)}`;
    el.appendChild(div);
  }
  el.scrollTop = el.scrollHeight;
}
function renderMemory() {
  $("memoryChips").innerHTML = state.memories.map(m => `<span class="chip">${escapeHtml(m)}</span>`).join("");
}
function renderSuggestions() {
  const container = $("responses");
  container.innerHTML = "";
  state.suggestions.forEach((text, index) => {
    const button = document.createElement("button");
    button.className = "response-target";
    button.dataset.text = text;
    button.innerHTML = `<span class="shortcut">${index + 1}</span>${escapeHtml(text)}<span class="progress"></span>`;
    button.addEventListener("click", () => selectResponse(text));
    container.appendChild(button);
  });
}
function addTurn(role, text) {
  const cleaned = text.trim();
  if (!cleaned) return;
  state.turns.push({ role, text: cleaned });
  renderTranscript();
  if (role === "partner") generateSuggestions();
}
function selectResponse(text) {
  state.lastSpoken = text;
  addTurn("user", text);
  $("lastSpoken").textContent = text;
  speak(text);
}
function speak(text) {
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = state.voices[Number($("voiceSelect").value)];
  if (voice) utterance.voice = voice;
  utterance.rate = Number($("rate").value);
  speechSynthesis.speak(utterance);
}
function loadVoices() {
  state.voices = speechSynthesis.getVoices();
  $("voiceSelect").innerHTML = state.voices.map((v,i) =>
    `<option value="${i}">${escapeHtml(v.name)} (${v.lang})</option>`).join("");
}
speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

function setupSpeechRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    $("startMic").disabled = true;
    $("startMic").title = "Speech recognition is unavailable in this browser.";
    return;
  }
  const rec = new Recognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  let finalText = "";
  rec.onstart = () => setPill("micStatus", "Mic listening", true);
  rec.onend = () => setPill("micStatus", "Mic off", false);
  rec.onerror = e => setPill("micStatus", `Mic: ${e.error}`, false);
  rec.onresult = event => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const chunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += chunk + " ";
      else interim += chunk;
    }
    $("partnerInput").value = (finalText + interim).trim();
    if (finalText.trim()) {
      addTurn("partner", finalText.trim());
      finalText = "";
      $("partnerInput").value = interim.trim();
    }
  };
  state.recognition = rec;
}
setupSpeechRecognition();

async function initializeVision() {
  if (state.faceLandmarker) return;
  setPill("modelStatus", "Loading vision…", false);
  const fileset = await FilesetResolver.forVisionTasks("./vendor/mediapipe/wasm");
  state.faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  setPill("modelStatus", "Vision loaded", true);
}

async function startCamera() {
  try {
    await initializeVision();
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: "user" },
      audio: false
    });
    const video = $("camera");
    video.srcObject = state.stream;
    await video.play();
    resizeOverlay();
    state.running = true;
    setPill("gazeStatus", "Camera active", true);
    $("cameraMessage").style.display = "none";
    state.animationId = requestAnimationFrame(processFrame);
  } catch (error) {
    console.error(error);
    const message = error?.message || String(error);
    $("cameraMessage").textContent = `Camera/vision error: ${message}`;
    $("cameraMessage").style.display = "block";
    setPill("gazeStatus", "Camera failed", false);
  }
}

function stopCamera() {
  state.running = false;
  if (state.animationId) cancelAnimationFrame(state.animationId);
  state.stream?.getTracks().forEach(t => t.stop());
  state.stream = null;
  $("camera").srcObject = null;
  $("gazeDot").style.display = "none";
  setPill("gazeStatus", "Gaze off", false);
  $("qualityText").textContent = "Camera inactive.";
  $("qualityMeter").style.width = "0";
  $("confidenceText").textContent = "";
  state.lastGazeConfidence = null;
}

function resizeOverlay() {
  const video = $("camera");
  const canvas = $("cameraOverlay");
  const rect = video.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
}

async function processFrame() {
  if (!state.running) return;
  const video = $("camera");
  if (video.readyState >= 2 && video.currentTime !== state.lastVideoTime) {
    state.lastVideoTime = video.currentTime;
    const result = state.faceLandmarker.detectForVideo(video, performance.now());
    const landmarks = result.faceLandmarks?.[0];
    if (landmarks?.length >= 478) {
      state.latestLandmarks = landmarks;
      state.latestFeatures = extractFeatures(landmarks);
      state.featureHistory.push(state.latestFeatures);
      if (state.featureHistory.length > FEATURE_HISTORY_LIMIT) state.featureHistory.shift();
      drawLandmarks(landmarks);
      updateQuality(landmarks);
      // During calibration collection we keep the full feature object (not
      // just .vector) so sampleQuality.js can compute iris/head/eyeOpenness
      // variance metrics. The live prediction path below is unrelated and
      // still only ever uses the flat vector.
      if (state.collecting) {
        state.collectionBuffer.push(state.latestFeatures);
        state.collectionAttempts++;
      }
      if (state.calibration) updatePredictedGaze(state.latestFeatures);
    } else {
      state.latestFeatures = null;
      state.lastGazeConfidence = null;
      updateQuality(null);
      clearDwell();
      if (state.collecting) state.collectionAttempts++;
    }
  }
  state.animationId = requestAnimationFrame(processFrame);
}

function drawLandmarks(p) {
  const canvas = $("cameraOverlay");
  const ctx = canvas.getContext("2d");
  const sx = canvas.width, sy = canvas.height;
  ctx.clearRect(0,0,sx,sy);
  ctx.fillStyle = "rgba(37,87,214,.8)";
  for (const id of [33,133,159,145,362,263,386,374,468,473,1]) {
    ctx.beginPath();
    ctx.arc((1-p[id].x)*sx, p[id].y*sy, 3*devicePixelRatio, 0, Math.PI*2);
    ctx.fill();
  }
}
function updateQuality(p) {
  if (!p) {
    $("qualityText").textContent = "Face not detected. Center your face and improve lighting.";
    $("qualityMeter").style.width = "5%";
    $("confidenceText").textContent = "";
    return;
  }
  const eyeDistance = distance(p[33],p[263]);
  const centerX = (p[1].x - .5);
  const centerY = (p[1].y - .48);
  const centered = Math.max(0, 1 - Math.hypot(centerX, centerY)*2.3);
  const sizeScore = Math.min(1, eyeDistance/.24);
  const quality = Math.round(100 * (.55*centered + .45*sizeScore));
  state.lastFaceQuality = quality;
  $("qualityMeter").style.width = `${quality}%`;
  $("qualityText").textContent = quality > 70 ? "Good face position." :
    quality > 45 ? "Usable. Move slightly closer and center your face." :
    "Poor. Center your face and move closer.";
}

// Confidence is a distinct signal from updateQuality() above (face-position
// only, no calibration/prediction awareness) — this augments the same
// gaze-quality area with a second, clearly-labeled line rather than
// replacing or conflating the two messages. Only rendered once a calibration
// model exists (updatePredictedGaze is the only caller), so before
// calibration this area silently shows nothing extra.
function updateConfidenceDisplay(confidence) {
  const el = $("confidenceText");
  if (!confidence) {
    el.textContent = "";
    return;
  }
  if (confidence.level === "excellent") {
    el.textContent = "Gaze confidence: excellent.";
    return;
  }
  const topReason = confidence.reasons[0] ? ` — ${confidence.reasons[0]}` : "";
  el.textContent = `Gaze confidence: ${confidence.level}${topReason}`;
}

function startCalibration() {
  if (!state.running || !state.latestFeatures) {
    alert("Start the camera and wait until your face is detected.");
    return;
  }
  state.activeCalibrationPoints = currentCalibrationPoints();
  state.calibrationSamples = [];
  state.calibrationScreenPoints = [];
  state.calibrationPointSummaries = [];
  state.calibrationPointIndex = 0;
  positionCalibrationTarget();
  $("calibrationDialog").showModal();
}
function positionCalibrationTarget() {
  const points = state.activeCalibrationPoints || currentCalibrationPoints();
  const [x,y] = points[state.calibrationPointIndex];
  const target = $("calibrationTarget");
  target.style.left = `${x*100}%`;
  target.style.top = `${y*100}%`;
  $("calibrationProgress").textContent = `Point ${state.calibrationPointIndex+1} of ${points.length} — look at the dot, then click it`;
  $("calibrationTitle").textContent = "Look at the target, then select it";
}
async function collectCalibrationPoint() {
  if (state.collecting || !state.latestFeatures) return;
  state.collecting = true;
  state.collectionBuffer = [];
  state.collectionAttempts = 0;
  $("calibrationTarget").classList.add("collecting");

  // settling delay — discard samples while eyes are still moving to target
  $("calibrationTitle").textContent = "Hold still…";
  await new Promise(r => setTimeout(r, SAMPLE_QUALITY_CONFIG.settleMs));
  state.collectionBuffer = [];
  state.collectionAttempts = 0;

  // actual collection window
  $("calibrationTitle").textContent = "Hold your gaze…";
  await new Promise(r => setTimeout(r, SAMPLE_QUALITY_CONFIG.collectMs));
  state.collecting = false;
  $("calibrationTarget").classList.remove("collecting");

  const targetEl = $("calibrationTarget");
  const r = targetEl.getBoundingClientRect();
  const targetX = r.left + r.width / 2;
  const targetY = r.top + r.height / 2;
  const rawSamples = state.collectionBuffer.filter(Boolean);
  const result = assessCalibrationSample(rawSamples, { attemptedFrames: state.collectionAttempts });

  // flash screen to show sample quality: green=good, blue=ok, red=poor/retry
  const stage = $("calibrationStage");
  if (result.accepted && result.score >= 0.85) {
    flashStage(stage, "rgba(31,157,90,.35)");   // green — steady gaze
  } else if (result.accepted) {
    flashStage(stage, "rgba(37,87,214,.35)");   // blue — acceptable
  } else {
    flashStage(stage, "rgba(200,40,30,.35)");   // red — too noisy, advise retry
    $("calibrationTitle").textContent = result.reasons[0] || "Sample quality too low — try again.";
    return;
  }

  // one calibration sample per surviving filtered frame, each using that
  // frame's own feature vector (not the single representative/median
  // vector, which is kept in `result` for diagnostics only).
  for (const sample of result.filteredSamples) {
    state.calibrationSamples.push({ f: sample.vector, x: targetX, y: targetY });
  }
  state.calibrationScreenPoints = state.calibrationScreenPoints || [];
  state.calibrationScreenPoints.push({x: targetX, y: targetY});

  // Per-point summary for the persisted qualitySummary/pointSummaries data
  // model (Milestone 4): target, accepted sample count, and the same
  // metrics/score assessCalibrationSample already computed above — no new
  // scoring logic, just carrying the existing result through to storage.
  state.calibrationPointSummaries.push({
    pointIndex: state.calibrationPointIndex,
    target: { x: targetX, y: targetY },
    acceptedSampleCount: result.filteredSamples.length,
    score: result.score,
    metrics: result.metrics
  });

  const points = state.activeCalibrationPoints || currentCalibrationPoints();
  state.calibrationPointIndex++;
  if (state.calibrationPointIndex >= points.length) finishCalibration();
  else positionCalibrationTarget();
}

function flashStage(el, color) {
  el.style.transition = "background .1s";
  el.style.background = color;
  setTimeout(() => {
    el.style.background = "";
    setTimeout(() => { el.style.transition = ""; }, 400);
  }, 600);
}

function finishCalibration() {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  let evaluation;
  try {
    // evaluateCalibration() fits the model internally (via the unmodified
    // fitCalibrationModel/ridgeSolve) and additionally computes training
    // error, leave-one-point-out validation error (when enough points
    // exist — see calibrationEvaluation.js), error by screen region, and
    // the worst point. Its returned `model` is that same fit, so we reuse
    // it as state.calibration rather than fitting a second time.
    evaluation = evaluateCalibration(state.calibrationSamples, { viewport });
    if (!evaluation) throw new Error("No calibration samples collected.");
    state.calibration = evaluation.model;
  } catch (e) {
    console.error(e);
    alert("Calibration failed. Please repeat it with steadier head position.");
    return;
  }

  const qualitySummary = {
    trainingError: evaluation.trainingError,
    validationError: evaluation.validationError,
    validationMethod: evaluation.validationMethod,
    pointCount: evaluation.pointCount,
    errorByRegion: evaluation.errorByRegion,
    worstPoint: evaluation.worstPoint,
    referenceError: evaluation.referenceError,
    isPoor: evaluation.isPoor
  };

  const envelope = {
    screen: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 },
    camera: { width: $("camera").videoWidth || null, height: $("camera").videoHeight || null },
    samples: state.calibrationSamples,
    pointSummaries: state.calibrationPointSummaries,
    model: state.calibration,
    qualitySummary
  };
  saveCalibration(envelope);
  state.calibrationEnvelope = envelope;

  setPill("calibrationStatus", "Calibrated", true);
  $("calibrationDialog").close();
  $("gazeDot").style.display = "block";

  // A fit that *succeeded* (no singular matrix, etc. — that case is the
  // catch block above) can still be a poor fit: leave-one-point-out (or
  // training-error fallback in quick mode) came back above
  // CALIBRATION_EVALUATION_CONFIG.poorErrorPx. This is additive to, not a
  // replacement for, the fitting-failure alert above — same alert()
  // pattern the app already uses for calibration issues.
  if (evaluation.isPoor) {
    const px = Math.round(evaluation.referenceError);
    alert(`Calibration completed, but accuracy looks poor (~${px}px average error). Consider recalibrating with steadier head position and gaze, or try Accuracy mode for denser coverage.`);
  }
}

function updatePredictedGaze(features) {
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const raw = predictGaze(state.calibration, features.vector, viewport);

  // Confidence is estimated from the raw (pre-clamp, pre-smoothing)
  // prediction, not the smoothed dot position — smoothing already reacts
  // to instability with a lag, so scoring the smoothed point would double
  // count/mask the very jitter confidence is supposed to detect.
  state.lastGazeConfidence = estimateGazeConfidence({
    currentFeatures: features,
    recentFeatureHistory: state.featureHistory,
    model: state.calibration,
    calibrationSamples: state.calibrationSamples,
    prediction: raw,
    viewport,
    predictGazeFn: predictGaze
  });
  updateConfidenceDisplay(state.lastGazeConfidence);

  let x = Math.max(0,Math.min(window.innerWidth,raw.x));
  let y = Math.max(0,Math.min(window.innerHeight,raw.y));

  const { x: smoothX, y: smoothY } = state.gazeFilter.update(x, y);

  const dotEl = $("gazeDot");
  dotEl.style.left = `${smoothX}px`;
  dotEl.style.top = `${smoothY}px`;
  // features/raw/confidence are threaded through purely so handleDwell can
  // hand them to onlineLearning.js's recordInteractionFrame — the dwell
  // timing/gating logic itself doesn't use them (unchanged from Milestone 3).
  handleDwell(smoothX, smoothY, { features, rawPrediction: raw, confidence: state.lastGazeConfidence });
}
function gazeTargetAt(x, y) {
  return document.elementsFromPoint(x, y).find(el =>
    el.classList?.contains("response-target") ||
    el.classList?.contains("word-btn") ||
    el.classList?.contains("key")
  ) || null;
}
function activateGazeTarget(target) {
  if (target.classList.contains("key")) {
    const k = (target.childNodes[0]?.textContent || "").trim();
    if (k === "Space") composeInput.value += " ";
    else if (k === "⌫") composeInput.value = composeInput.value.slice(0, -1);
    else if (k === "Clear") composeInput.value = "";
    else if (k === "Speak") { if (composeInput.value.trim()) selectResponse(composeInput.value.trim()); }
    else composeInput.value += k;
    updateWordSuggestions();
  } else if (target.classList.contains("word-btn")) {
    composeInput.value += (composeInput.value.endsWith(" ") || composeInput.value === "" ? "" : " ") + target.textContent + " ";
  } else {
    const text = target.dataset.text || target.dataset.utility;
    if (text) selectResponse(text);
  }
}
// Gaze-only dwell gate: while confidence is below CONFIDENCE_CONFIG's
// dwellMinimum, the dwell timer is frozen (not reset) rather than letting
// it keep accumulating toward activation — this only affects the gaze
// dwell path below; click/touch/keyboard activation (selectResponse and
// the .response-target/.word-btn/.key click listeners, plus the keydown
// handler) never calls handleDwell and is unaffected.
function isDwellConfidenceSufficient() {
  const confidence = state.lastGazeConfidence;
  return !confidence || confidence.score >= CONFIDENCE_CONFIG.dwellMinimum;
}
function handleDwell(x,y) {
  if ($("calibrationDialog").open) return;
  const target = gazeTargetAt(x, y);
  const dwellMs = Number($("dwellSelect").value);
  if (target !== state.dwellTarget) {
    const cancelledEarly = state.dwellTarget && (performance.now()-state.dwellStart) > 150;
    clearDwell(cancelledEarly);
    state.dwellTarget = target || null;
    state.dwellStart = performance.now();
    state.dwellPauseAccum = 0;
    state.lastDwellFrameAt = state.dwellStart;
    state.dwellTargetRect = target ? target.getBoundingClientRect() : null;
    if (target) target.classList.add("active-gaze");
    return;
  }
  if (!target) return;
  const now = performance.now();
  const frameDelta = now - (state.lastDwellFrameAt || now);
  state.lastDwellFrameAt = now;
  const confidenceOk = isDwellConfidenceSufficient();
  if (!confidenceOk) {
    state.dwellPauseAccum += frameDelta;
    target.classList.add("dwell-paused");
  } else {
    target.classList.remove("dwell-paused");
  }
  const elapsed = now - state.dwellStart - state.dwellPauseAccum;
  const p = target.querySelector(".progress");
  if (p) p.style.width = `${Math.min(100,elapsed/dwellMs*100)}%`;
  if (!confidenceOk) return; // frozen this frame — never allowed to reach activation while paused
  if (elapsed >= dwellMs) {
    const targetCenter = state.dwellTargetRect
      ? { x: state.dwellTargetRect.left + state.dwellTargetRect.width/2, y: state.dwellTargetRect.top + state.dwellTargetRect.height/2 }
      : null;
    const errorPx = targetCenter ? distance({x, y}, targetCenter) : null;
    const screenDiagonal = Math.hypot(window.innerWidth, window.innerHeight);
    recordEvaluationSample({
      timestamp: Date.now(),
      predictedX: x,
      predictedY: y,
      targetX: targetCenter ? targetCenter.x : null,
      targetY: targetCenter ? targetCenter.y : null,
      errorPx,
      normalizedError: errorPx !== null ? errorPx / screenDiagonal : null,
      faceQuality: state.lastFaceQuality,
      dwellDuration: elapsed,
      selectedElementId: target.id || target.dataset.text || target.dataset.utility || target.textContent.trim()
    });
    clearDwell();
    state.lastGazeActivationAt = performance.now();
    activateGazeTarget(target);
  }
}
function clearDwell(cancelled = false) {
  if (cancelled) recordDwellCancelled();
  document.querySelectorAll(".response-target, .word-btn, .key").forEach(el => {
    el.classList.remove("active-gaze", "dwell-paused");
    const p=el.querySelector(".progress");
    if (p) p.style.width="0";
  });
  state.dwellTarget=null;
  state.dwellStart=0;
  state.dwellTargetRect=null;
  state.dwellPauseAccum=0;
  state.lastDwellFrameAt=0;
}

$("partnerForm").addEventListener("submit", e => {
  e.preventDefault();
  addTurn("partner",$("partnerInput").value);
  $("partnerInput").value="";
});
$("startGaze").addEventListener("click",startCamera);
$("stopGaze").addEventListener("click",stopCamera);
$("calibrate").addEventListener("click",startCalibration);
$("calibrationTarget").addEventListener("click",collectCalibrationPoint);
$("cancelCalibration").addEventListener("click",()=>$("calibrationDialog").close());
$("startMic").addEventListener("click",()=>{ try { state.recognition?.start(); } catch {} });
$("stopMic").addEventListener("click",()=>state.recognition?.stop());
$("demoTurn").addEventListener("click",()=>addTurn("partner","Did Emma enjoy her visit yesterday?"));
$("toggleGazeMap").addEventListener("click", toggleGazeMap);

function toggleGazeMap() {
  const map = $("gazeMap");
  const btn = $("toggleGazeMap");
  if (map.classList.contains("visible")) {
    map.classList.remove("visible");
    map.innerHTML = "";
    btn.textContent = "Show gaze map";
    return;
  }
  map.innerHTML = "";
  currentCalibrationPoints().forEach(([nx, ny]) => {
    const dot = document.createElement("div");
    dot.className = "gaze-map-dot";
    dot.style.left = `${nx * 100}%`;
    dot.style.top = `${ny * 100}%`;
    map.appendChild(dot);
  });
  map.classList.add("visible");
  btn.textContent = "Hide gaze map";
}
$("regenerate").addEventListener("click",generateSuggestions);
$("clearConversation").addEventListener("click",()=>{state.turns=[];renderTranscript();generateSuggestions();});
$("undo").addEventListener("click",()=>{
  const idx=[...state.turns].map(t=>t.role).lastIndexOf("user");
  if(idx>=0) state.turns.splice(idx,1);
  if (performance.now() - state.lastGazeActivationAt < 4000) recordAccidentalActivation();
  speechSynthesis.cancel();
  $("lastSpoken").textContent="Undone.";
  renderTranscript();
});
$("stopSpeaking").addEventListener("click",()=>speechSynthesis.cancel());
document.querySelectorAll("[data-utility]").forEach(b=>b.addEventListener("click",()=>selectResponse(b.dataset.utility)));
$("editMemory").addEventListener("click",()=>{
  $("memoryEditor").value=state.memories.join("\n");
  $("memoryDialog").showModal();
});
$("cancelMemory").addEventListener("click",()=>$("memoryDialog").close());
$("saveMemory").addEventListener("click",()=>{
  state.memories=$("memoryEditor").value.split("\n").map(x=>x.trim()).filter(Boolean);
  localStorage.setItem("contextGazeMemories",JSON.stringify(state.memories));
  renderMemory();generateSuggestions();$("memoryDialog").close();
});
document.addEventListener("keydown",e=>{
  if(e.code==="Space" && $("calibrationDialog").open){e.preventDefault();collectCalibrationPoint();return;}
  const n=Number(e.key);
  if(n>=1&&n<=state.suggestions.length&&document.activeElement.tagName!=="INPUT") selectResponse(state.suggestions[n-1]);
});
window.addEventListener("resize",resizeOverlay);
window.addEventListener("beforeunload",stopCamera);

const savedMemory=localStorage.getItem("contextGazeMemories");
if(savedMemory){try{state.memories=JSON.parse(savedMemory)}catch{}}
const savedCalibration=loadCalibration();
if(savedCalibration && savedCalibration.model){
  // loadCalibration() returns the full persisted envelope (see storage.js);
  // state.calibration stays just the bare {wx,wy,width,height} model so
  // predictGaze/estimateGazeConfidence's existing (model, ...) call sites
  // are unchanged. The rest of the envelope (raw samples, per-point
  // summaries, quality summary) is kept on state.calibrationEnvelope for
  // diagnostics, and state.calibrationSamples is restored from it so
  // estimateGazeConfidence's neighbor/residual lookups have real coverage
  // data immediately after a reload instead of starting empty.
  state.calibration=savedCalibration.model;
  state.calibrationEnvelope=savedCalibration;
  state.calibrationSamples=Array.isArray(savedCalibration.samples) ? savedCalibration.samples : [];
  setPill("calibrationStatus","Calibration saved",true);
}
renderMemory();
renderTranscript();
generateSuggestions();


const composeInput=document.getElementById("composeInput");
document.querySelectorAll(".key").forEach(btn=>{
 const prog = document.createElement("span");
 prog.className = "progress";
 btn.appendChild(prog);
 btn.addEventListener("click",()=>{
   const k=btn.dataset.label||btn.childNodes[0]?.textContent?.trim()||btn.textContent.trim();
   if(k==="Space") composeInput.value+=" ";
   else if(k==="⌫") composeInput.value=composeInput.value.slice(0,-1);
   else if(k==="Clear") composeInput.value="";
   else if(k==="Speak"){ if(composeInput.value.trim()) selectResponse(composeInput.value.trim());}
   else composeInput.value+=k;
   updateWordSuggestions();
 });
});
document.querySelectorAll(".word-btn").forEach(btn=>{
 const prog = document.createElement("span");
 prog.className = "progress";
 btn.appendChild(prog);
 btn.addEventListener("click",()=>{
   composeInput.value+=(composeInput.value.endsWith(" ")||composeInput.value===""?"":" ")+btn.childNodes[0]?.textContent?.trim()+" ";
 });
});
function updateWordSuggestions(){
 const v=composeInput.value.toLowerCase();
 let words=["please","comfortable","pictures","appointment","Emma"];
 if(v.includes("emma")) words=["visited","yesterday","Noah","Lily","come"];
 if(v.includes("did")) words=["you","they","he","she","it"];
 const bar=document.getElementById("wordSuggestions");
 bar.innerHTML="";
 words.forEach(w=>{
   const b=document.createElement("button");
   b.className="word-btn";
   const label=document.createTextNode(w);
   b.appendChild(label);
   const prog=document.createElement("span");
   prog.className="progress";
   b.appendChild(prog);
   b.onclick=()=>{composeInput.value+=(composeInput.value.endsWith(" ")||composeInput.value===""?"":" ")+w+" ";};
   bar.appendChild(b);
 });
}
const _oldSelect=selectResponse;
selectResponse=function(text){
 if(composeInput && composeInput.value==="") composeInput.value=text;
 _oldSelect(text);
 composeInput.value="";
};

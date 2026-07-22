import {
  FaceLandmarker,
  FilesetResolver
} from "./vendor/mediapipe/vision_bundle.mjs";

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
  calibrationSamples: [],
  calibrationPointIndex: 0,
  collecting: false,
  collectionBuffer: [],
  dwellTarget: null,
  dwellStart: 0,
  smoothX: window.innerWidth / 2,
  smoothY: window.innerHeight / 2,
  lastSpoken: null
};

const $ = id => document.getElementById(id);
const stopWords = new Set("the a an and or but if then is are was were be been being to of in on at for with from this that it you your my me i we they he she do did does how what when where who why can could would should".split(" "));
const calibrationPoints = [
  [0.10, 0.10], [0.50, 0.10], [0.90, 0.10],
  [0.10, 0.50], [0.50, 0.50], [0.90, 0.50],
  [0.10, 0.90], [0.50, 0.90], [0.90, 0.90],
  [0.30, 0.30], [0.70, 0.30], [0.30, 0.70], [0.70, 0.70]
];

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
      drawLandmarks(landmarks);
      updateQuality(landmarks);
      if (state.collecting) state.collectionBuffer.push(state.latestFeatures);
      if (state.calibration) updatePredictedGaze(state.latestFeatures);
    } else {
      state.latestFeatures = null;
      updateQuality(null);
      clearDwell();
    }
  }
  state.animationId = requestAnimationFrame(processFrame);
}

function avgPoint(points, ids) {
  const p = ids.map(i => points[i]);
  return {
    x: p.reduce((s,v) => s + v.x, 0) / p.length,
    y: p.reduce((s,v) => s + v.y, 0) / p.length,
    z: p.reduce((s,v) => s + (v.z || 0), 0) / p.length
  };
}
function distance(a,b) {
  return Math.hypot(a.x-b.x, a.y-b.y);
}
function extractFeatures(p) {
  const leftIris = avgPoint(p, [468,469,470,471,472]);
  const rightIris = avgPoint(p, [473,474,475,476,477]);

  const lOuter = p[33], lInner = p[133], lTop = p[159], lBottom = p[145];
  const rInner = p[362], rOuter = p[263], rTop = p[386], rBottom = p[374];

  const lx = (leftIris.x - lOuter.x) / Math.max(0.001, lInner.x - lOuter.x);
  const ly = (leftIris.y - lTop.y) / Math.max(0.001, lBottom.y - lTop.y);
  const rx = (rightIris.x - rInner.x) / Math.max(0.001, rOuter.x - rInner.x);
  const ry = (rightIris.y - rTop.y) / Math.max(0.001, rBottom.y - rTop.y);

  const xs = p.map(v => v.x), ys = p.map(v => v.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const nose = p[1];
  const nx = (nose.x - minX) / Math.max(0.001, maxX-minX);
  const ny = (nose.y - minY) / Math.max(0.001, maxY-minY);
  const faceWidth = maxX-minX;
  const roll = Math.atan2(p[263].y-p[33].y, p[263].x-p[33].x);

  return expandFeatures([lx,ly,rx,ry,nx,ny,faceWidth,roll]);
}
function expandFeatures(v) {
  const [lx,ly,rx,ry,nx,ny,fw,roll] = v;
  return [
    1, lx,ly,rx,ry,nx,ny,fw,roll,
    lx*lx, ly*ly, rx*rx, ry*ry, nx*nx, ny*ny,
    lx*ly, rx*ry, ((lx+rx)/2)*nx, ((ly+ry)/2)*ny
  ];
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
    return;
  }
  const eyeDistance = distance(p[33],p[263]);
  const centerX = (p[1].x - .5);
  const centerY = (p[1].y - .48);
  const centered = Math.max(0, 1 - Math.hypot(centerX, centerY)*2.3);
  const sizeScore = Math.min(1, eyeDistance/.24);
  const quality = Math.round(100 * (.55*centered + .45*sizeScore));
  $("qualityMeter").style.width = `${quality}%`;
  $("qualityText").textContent = quality > 70 ? "Good face position." :
    quality > 45 ? "Usable. Move slightly closer and center your face." :
    "Poor. Center your face and move closer.";
}

function startCalibration() {
  if (!state.running || !state.latestFeatures) {
    alert("Start the camera and wait until your face is detected.");
    return;
  }
  state.calibrationSamples = [];
  state.calibrationScreenPoints = [];
  state.calibrationPointIndex = 0;
  positionCalibrationTarget();
  $("calibrationDialog").showModal();
}
function positionCalibrationTarget() {
  const [x,y] = calibrationPoints[state.calibrationPointIndex];
  const target = $("calibrationTarget");
  target.style.left = `${x*100}%`;
  target.style.top = `${y*100}%`;
  $("calibrationProgress").textContent = `Point ${state.calibrationPointIndex+1} of ${calibrationPoints.length} — look at the dot, then click it`;
  $("calibrationTitle").textContent = "Look at the target, then select it";
}
async function collectCalibrationPoint() {
  if (state.collecting || !state.latestFeatures) return;
  state.collecting = true;
  state.collectionBuffer = [];
  $("calibrationTarget").classList.add("collecting");

  // settling delay — discard samples while eyes are still moving to target
  $("calibrationTitle").textContent = "Hold still…";
  await new Promise(r => setTimeout(r, 500));
  state.collectionBuffer = [];

  // actual collection window
  $("calibrationTitle").textContent = "Hold your gaze…";
  await new Promise(r => setTimeout(r, 900));
  state.collecting = false;
  $("calibrationTarget").classList.remove("collecting");

  const targetEl = $("calibrationTarget");
  const r = targetEl.getBoundingClientRect();
  const targetX = r.left + r.width / 2;
  const targetY = r.top + r.height / 2;
  const usable = state.collectionBuffer.filter(Boolean);
  if (usable.length < 5) {
    $("calibrationTitle").textContent = "Face lost. Try this point again.";
    return;
  }

  // outlier rejection: keep samples within 1 std-dev of mean for first two features (lx, ly)
  const trimmed = rejectOutliers(usable);
  const keepRatio = trimmed.length / usable.length;

  // flash screen to show sample quality: green=good, blue=ok, red=poor
  const stage = $("calibrationStage");
  if (keepRatio >= 0.85 && trimmed.length >= 8) {
    flashStage(stage, "rgba(31,157,90,.35)");   // green — steady gaze
  } else if (keepRatio >= 0.6 && trimmed.length >= 4) {
    flashStage(stage, "rgba(37,87,214,.35)");   // blue — acceptable
  } else {
    flashStage(stage, "rgba(200,40,30,.35)");   // red — too noisy, advise retry
    $("calibrationTitle").textContent = "Too much movement — try again for better accuracy";
    state.collecting = false;
    return;
  }

  for (const f of trimmed) state.calibrationSamples.push({f, x:targetX, y:targetY});
  state.calibrationScreenPoints = state.calibrationScreenPoints || [];
  state.calibrationScreenPoints.push({x: targetX, y: targetY});

  state.calibrationPointIndex++;
  if (state.calibrationPointIndex >= calibrationPoints.length) finishCalibration();
  else positionCalibrationTarget();
}

function rejectOutliers(samples) {
  if (samples.length < 4) return samples;
  // use indices 1 (lx) and 2 (ly) — the core iris position features
  for (const idx of [1, 2]) {
    const vals = samples.map(s => s[idx]);
    const mean = vals.reduce((a,b) => a+b, 0) / vals.length;
    const std = Math.sqrt(vals.reduce((a,b) => a + (b-mean)**2, 0) / vals.length);
    samples = samples.filter(s => Math.abs(s[idx] - mean) <= 2 * std);
  }
  return samples;
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
  try {
    state.calibration = fitCalibration(state.calibrationSamples);
    localStorage.setItem("contextGazeCalibration", JSON.stringify(state.calibration));
    setPill("calibrationStatus", "Calibrated", true);
    $("calibrationDialog").close();
    $("gazeDot").style.display = "block";
  } catch (e) {
    console.error(e);
    alert("Calibration failed. Please repeat it with steadier head position.");
  }
}

function fitCalibration(samples) {
  const X = samples.map(s => s.f);
  const yx = samples.map(s => s.x);
  const yy = samples.map(s => s.y);
  const lambda = 0.08;
  return {
    wx: ridgeSolve(X,yx,lambda),
    wy: ridgeSolve(X,yy,lambda),
    width: window.innerWidth,
    height: window.innerHeight
  };
}
function ridgeSolve(X,y,lambda) {
  const rows = X.length, cols = X[0].length;
  const A = Array.from({length:cols},()=>Array(cols).fill(0));
  const b = Array(cols).fill(0);
  for (let r=0;r<rows;r++) {
    for (let i=0;i<cols;i++) {
      b[i] += X[r][i]*y[r];
      for (let j=0;j<cols;j++) A[i][j] += X[r][i]*X[r][j];
    }
  }
  for (let i=1;i<cols;i++) A[i][i] += lambda;
  return gaussianSolve(A,b);
}
function gaussianSolve(A,b) {
  const n = b.length;
  const M = A.map((row,i)=>[...row,b[i]]);
  for (let col=0;col<n;col++) {
    let pivot=col;
    for (let r=col+1;r<n;r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot=r;
    [M[col],M[pivot]]=[M[pivot],M[col]];
    const d=M[col][col];
    if (Math.abs(d)<1e-10) throw new Error("Singular calibration matrix");
    for (let j=col;j<=n;j++) M[col][j]/=d;
    for (let r=0;r<n;r++) if (r!==col) {
      const f=M[r][col];
      for (let j=col;j<=n;j++) M[r][j]-=f*M[col][j];
    }
  }
  return M.map(row=>row[n]);
}
function dot(a,b) {
  return a.reduce((s,v,i)=>s+v*b[i],0);
}
function updatePredictedGaze(features) {
  let x = dot(features,state.calibration.wx);
  let y = dot(features,state.calibration.wy);
  x *= window.innerWidth / state.calibration.width;
  y *= window.innerHeight / state.calibration.height;
  x = Math.max(0,Math.min(window.innerWidth,x));
  y = Math.max(0,Math.min(window.innerHeight,y));

  const alpha = 0.18;
  state.smoothX += alpha*(x-state.smoothX);
  state.smoothY += alpha*(y-state.smoothY);

  const dotEl = $("gazeDot");
  dotEl.style.left = `${state.smoothX}px`;
  dotEl.style.top = `${state.smoothY}px`;
  handleDwell(state.smoothX,state.smoothY);
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
function handleDwell(x,y) {
  if ($("calibrationDialog").open) return;
  const target = gazeTargetAt(x, y);
  const dwellMs = Number($("dwellSelect").value);
  if (target !== state.dwellTarget) {
    clearDwell();
    state.dwellTarget = target || null;
    state.dwellStart = performance.now();
    if (target) target.classList.add("active-gaze");
    return;
  }
  if (!target) return;
  const elapsed = performance.now()-state.dwellStart;
  const p = target.querySelector(".progress");
  if (p) p.style.width = `${Math.min(100,elapsed/dwellMs*100)}%`;
  if (elapsed >= dwellMs) {
    clearDwell();
    activateGazeTarget(target);
  }
}
function clearDwell() {
  document.querySelectorAll(".response-target, .word-btn, .key").forEach(el => {
    el.classList.remove("active-gaze");
    const p=el.querySelector(".progress");
    if (p) p.style.width="0";
  });
  state.dwellTarget=null;
  state.dwellStart=0;
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
  calibrationPoints.forEach(([nx, ny]) => {
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
const savedCalibration=localStorage.getItem("contextGazeCalibration");
if(savedCalibration){
  try{
    state.calibration=JSON.parse(savedCalibration);
    setPill("calibrationStatus","Calibration saved",true);
  }catch{}
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

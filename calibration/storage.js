// Calibration persistence. Wraps the stored data in a versioned envelope so
// future schema changes can be migrated instead of silently breaking.
//
// Schema history:
//   (no version field) — bare { wx, wy, width, height } model, pre-Milestone-?
//   version 1          — { version: 1, model: {wx,wy,width,height}, savedAt }
//   version 2 (current)— full Milestone-4 envelope, see saveCalibration below.

const STORAGE_KEY = "contextGazeCalibration";
const CURRENT_VERSION = 2;

// envelope fields, per plan(1).md's Milestone 4 data model:
//   version, createdAt, updatedAt, screen, camera, samples, pointSummaries,
//   model, qualitySummary
export function saveCalibration(data) {
  const existingRaw = localStorage.getItem(STORAGE_KEY);
  let createdAt = Date.now();
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw);
      if (existing && typeof existing.createdAt === "number") createdAt = existing.createdAt;
    } catch (e) {
      // corrupted existing entry — fall through and treat this save as fresh
    }
  }

  const envelope = {
    version: CURRENT_VERSION,
    createdAt: data.createdAt ?? createdAt,
    updatedAt: Date.now(),
    screen: data.screen ?? null,
    camera: data.camera ?? null,
    // Full per-frame training samples, not a summary — see app.js's
    // finishCalibration() comment for the tradeoff (mainly localStorage
    // size for large accuracy-mode sessions) this accepts in exchange for
    // keeping every raw sample available to later milestones (online
    // learning, debug export) that want to re-derive or re-fit from them.
    samples: data.samples ?? [],
    pointSummaries: data.pointSummaries ?? [],
    model: data.model ?? null,
    qualitySummary: data.qualitySummary ?? null
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

// Returns the full stored envelope (version, createdAt, updatedAt, screen,
// camera, samples, pointSummaries, model, qualitySummary) or null if none is
// stored or the stored data cannot be read.
//
// app.js pulls `.model` out of the returned envelope for prediction
// (predictGaze/estimateGazeConfidence only ever need the bare
// {wx,wy,width,height} shape) while keeping the rest of the envelope around
// for diagnostics/recalibration decisions — returning the full envelope
// (rather than just the model) is the smaller change here since app.js was
// already storing calibration-adjacent state (state.calibrationSamples) as
// separate top-level state fields; this just gives it one more object to
// destructure from, instead of introducing a second load function/return
// shape purely to smuggle the extra fields out.
//
// Older stored shapes are migrated in-memory (and re-saved under the
// current version) rather than discarded, so a pre-Milestone-4 calibration
// a user already has saved keeps working:
//   - version 1: { version: 1, model, savedAt } — wraps a bare model with no
//     samples/summaries/quality info. Migrated to a version-2 envelope with
//     samples: [], pointSummaries: [], qualitySummary: null (nothing to
//     synthesize those from) and the model carried over unchanged.
//   - pre-versioning: a bare { wx, wy, width, height } object with no
//     envelope at all. Migrated the same way.
export function loadCalibration() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    console.warn("Stored calibration is corrupted; ignoring.", e);
    return null;
  }

  if (parsed && parsed.version === CURRENT_VERSION) {
    return parsed;
  }

  if (parsed && typeof parsed.version === "number") {
    // Version 1 (or any older versioned shape): bare model wrapped with
    // just { version, model, savedAt }. Synthesize the missing Milestone-4
    // fields — there is no historical sample/quality data to recover.
    const migrated = {
      version: CURRENT_VERSION,
      createdAt: parsed.savedAt ?? Date.now(),
      updatedAt: Date.now(),
      screen: null,
      camera: null,
      samples: [],
      pointSummaries: [],
      model: parsed.model || null,
      qualitySummary: null
    };
    if (migrated.model) saveCalibration(migrated);
    return migrated.model ? migrated : null;
  }

  if (parsed && parsed.wx && parsed.wy) {
    // Pre-versioning format: a bare model with no envelope at all.
    const migrated = {
      version: CURRENT_VERSION,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      screen: null,
      camera: null,
      samples: [],
      pointSummaries: [],
      model: parsed,
      qualitySummary: null
    };
    saveCalibration(migrated);
    return migrated;
  }

  console.warn("Stored calibration has an unrecognized shape; ignoring.");
  return null;
}

export function clearCalibration() {
  localStorage.removeItem(STORAGE_KEY);
}

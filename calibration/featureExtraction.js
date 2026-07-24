// Feature extraction from MediaPipe FaceLandmarker landmarks.
// `vector` is the flat numeric array consumed by the calibration model —
// its values and ordering are unchanged from the original implementation.

export function avgPoint(points, ids) {
  const p = ids.map(i => points[i]);
  return {
    x: p.reduce((s, v) => s + v.x, 0) / p.length,
    y: p.reduce((s, v) => s + v.y, 0) / p.length,
    z: p.reduce((s, v) => s + (v.z || 0), 0) / p.length
  };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function expandFeatures(v) {
  const [lx, ly, rx, ry, nx, ny, fw, roll] = v;
  return [
    1, lx, ly, rx, ry, nx, ny, fw, roll,
    lx * lx, ly * ly, rx * rx, ry * ry, nx * nx, ny * ny,
    lx * ly, rx * ry, ((lx + rx) / 2) * nx, ((ly + ry) / 2) * ny
  ];
}

// Returns { vector, iris, head, eyeOpenness, faceBox, timestamp }.
// `vector` preserves the exact flat feature array previously produced by
// extractFeatures(); the remaining fields are additional metadata for
// later milestones (sample-quality validation, confidence estimation).
export function extractFeatures(p) {
  const leftIris = avgPoint(p, [468, 469, 470, 471, 472]);
  const rightIris = avgPoint(p, [473, 474, 475, 476, 477]);

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
  const nx = (nose.x - minX) / Math.max(0.001, maxX - minX);
  const ny = (nose.y - minY) / Math.max(0.001, maxY - minY);
  const faceWidth = maxX - minX;
  const roll = Math.atan2(p[263].y - p[33].y, p[263].x - p[33].x);

  const vector = expandFeatures([lx, ly, rx, ry, nx, ny, faceWidth, roll]);

  const leftEyeWidth = Math.max(0.001, distance(lOuter, lInner));
  const rightEyeWidth = Math.max(0.001, distance(rInner, rOuter));
  const eyeOpenness = {
    left: distance(lTop, lBottom) / leftEyeWidth,
    right: distance(rTop, rBottom) / rightEyeWidth
  };

  return {
    vector,
    iris: { left: leftIris, right: rightIris },
    head: { nx, ny, faceWidth, roll },
    eyeOpenness,
    faceBox: { minX, maxX, minY, maxY, width: faceWidth, height: maxY - minY },
    timestamp: performance.now()
  };
}

// Gaze smoothing. Behavior is unchanged from the inline implementation:
// a fixed-alpha exponential moving average toward the latest prediction.

export function createExponentialGazeFilter(options = {}) {
  const alpha = options.alpha ?? 0.18;
  let x = options.initialX ?? window.innerWidth / 2;
  let y = options.initialY ?? window.innerHeight / 2;

  return {
    update(targetX, targetY) {
      x += alpha * (targetX - x);
      y += alpha * (targetY - y);
      return { x, y };
    },
    get() {
      return { x, y };
    },
    reset(resetX, resetY) {
      x = resetX;
      y = resetY;
    }
  };
}

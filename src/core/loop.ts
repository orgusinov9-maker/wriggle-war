/**
 * Fixed-timestep loop. The original ran its simulation at 50 Hz, and every
 * physics constant in this project is expressed per 1/50 s tick, so the sim
 * stays locked to that rate no matter what the display refresh is.
 */
export const TICK_HZ = 50;
export const TICK_MS = 1000 / TICK_HZ;

export function startLoop(tick: () => void, draw: (interp: number) => void): void {
  let last = performance.now();
  let acc = 0;

  const frame = (now: number) => {
    acc += Math.min(now - last, 250); // never replay more than a quarter second
    last = now;
    while (acc >= TICK_MS) {
      tick();
      acc -= TICK_MS;
    }
    draw(acc / TICK_MS);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

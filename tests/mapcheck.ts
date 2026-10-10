// Headless probe: stubs just enough DOM for Terrain, then reports land stats.
class FakeImageData {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const fakeCtx = {
  createImageData: (w: number, h: number) => new FakeImageData(w, h),
  putImageData: () => {},
};
(globalThis as any).ImageData = FakeImageData;
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };

import { generateMap, MAP_WIDTH, MAP_HEIGHT, MapStyle } from '../src/world/mapgen';

for (const style of ['island', 'ridges', 'cave'] as MapStyle[]) {
  for (const seed of [1, 12345, 999999]) {
    const m = generateMap(seed, style);
    let land = 0;
    for (let i = 0; i < m.terrain.mask.length; i++) if (m.terrain.mask[i] !== 0) land++;
    const pct = ((land / (MAP_WIDTH * MAP_HEIGHT)) * 100).toFixed(1);
    const xs = m.spawnPoints.map((p) => p.x);
    console.log(
      `${style.padEnd(7)} seed ${String(seed).padStart(6)}  land ${pct.padStart(5)}%  spawns ${String(m.spawnPoints.length).padStart(4)}` +
      `  x-range ${xs.length ? Math.min(...xs) + '..' + Math.max(...xs) : 'none'}  theme ${m.theme.name}`,
    );
  }
}
console.log(`map ${MAP_WIDTH}x${MAP_HEIGHT}`);

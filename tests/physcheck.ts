class FakeImageData {
  width: number; height: number; data: Uint8ClampedArray;
  constructor(w: number, h: number) { this.width = w; this.height = h; this.data = new Uint8ClampedArray(w * h * 4); }
}
const fakeCtx = { createImageData: (w: number, h: number) => new FakeImageData(w, h), putImageData: () => {} };
(globalThis as any).ImageData = FakeImageData;
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => fakeCtx }) };

import { Terrain, LAND } from '../src/world/terrain';
import { THEMES } from '../src/world/themes';
import { Rng } from '../src/core/rng';
import { Worm } from '../src/entities/worm';
import { Projectile, PROJECTILES, PROJECTILE_HIT_RADIUS } from '../src/entities/projectile';

const rng = new Rng(7);
function flatGround(withWall: boolean, wallX = 300, wallTop = 100) {
  const t = new Terrain(800, 400, THEMES[0], rng);
  for (let x = 0; x < 800; x++) for (let y = 300; y < 400; y++) t.setPixel(x, y, LAND);
  if (withWall) for (let x = wallX; x < wallX + 14; x++) for (let y = wallTop; y < 300; y++) t.setPixel(x, y, LAND);
  return t;
}

// --- test 1: walking actually moves --------------------------------------
{
  const t = flatGround(false);
  const w = new Worm(100, 295, 'Test', 0);
  const x0 = w.x;
  for (let i = 0; i < 100; i++) { w.walk(t, 1); w.stepPhysics(t); }
  const moved = w.x - x0;
  console.log(`walk 100 ticks -> moved ${moved.toFixed(1)} px  (expect ~${(0.95 * 100).toFixed(0)})  ${moved > 80 ? 'PASS' : 'FAIL'}`);
}

// --- test 2: a slope gets climbed, a sheer wall blocks -------------------
{
  const t = new Terrain(800, 400, THEMES[0], rng);
  for (let x = 0; x < 800; x++) {
    const top = x < 200 ? 300 : Math.max(200, 300 - (x - 200));  // 45 degree ramp
    for (let y = top; y < 400; y++) t.setPixel(x, y, LAND);
  }
  const w = new Worm(100, 295, 'Test', 0);
  for (let i = 0; i < 300; i++) { w.walk(t, 1); w.stepPhysics(t); }
  console.log(`45deg ramp -> climbed to y ${w.y.toFixed(0)} at x ${w.x.toFixed(0)}  ${w.y < 250 ? 'PASS' : 'FAIL'}`);

  const t2 = flatGround(true, 300, 100);
  const w2 = new Worm(100, 295, 'Test', 0);
  for (let i = 0; i < 400; i++) { w2.walk(t2, 1); w2.stepPhysics(t2); }
  console.log(`sheer wall  -> stopped at x ${w2.x.toFixed(0)} (wall at 300)  ${w2.x > 280 && w2.x < 300 ? 'PASS' : 'FAIL'}`);
}

// --- test 3: a blocked shot hits the wall, not the target behind it ------
{
  const t = flatGround(true, 300, 100);
  const target = new Worm(500, 295, 'Target', 1);
  const shooter = new Worm(100, 295, 'Shooter', 0);
  const v = { x: 1, y: 0 };
  const p = new Projectile(shooter.x + 9, shooter.y - 3, v.x * 9, v.y * 9, PROJECTILES.bazooka, -1, 0);
  let outcome = 'fly';
  let ticks = 0;
  while (outcome === 'fly' && ticks++ < 500) {
    outcome = p.step({ terrain: t, wind: 0, wormNear: () => false,
      hitsWorm: (x, y) => Math.hypot(target.x - x, target.y - y) <= PROJECTILE_HIT_RADIUS });
  }
  const hitWall = outcome === 'explode' && p.x < 320;
  console.log(`flat shot into wall -> ${outcome} at x ${p.x.toFixed(0)}  ${hitWall ? 'PASS (wall stopped it)' : 'FAIL'}`);
}

// --- test 4: a clear shot does reach the target --------------------------
{
  const t = flatGround(false);
  const target = new Worm(360, 295, 'Target', 1);
  const p = new Projectile(109, 292, 9 * Math.cos(-0.35), 9 * Math.sin(-0.35), PROJECTILES.bazooka, -1, 0);
  let outcome = 'fly';
  let ticks = 0;
  while (outcome === 'fly' && ticks++ < 500) {
    outcome = p.step({ terrain: t, wind: 0, wormNear: () => false,
      hitsWorm: (x, y) => Math.hypot(target.x - x, target.y - y) <= PROJECTILE_HIT_RADIUS });
  }
  console.log(`clear 20deg shot -> ${outcome} at x ${p.x.toFixed(0)} y ${p.y.toFixed(0)} after ${ticks} ticks  ${outcome === 'explode' && p.x > 340 ? 'PASS' : 'FAIL'}`);
}

// --- test 5: wind actually bends a rocket, and grenades ignore it --------
{
  const t = flatGround(false);
  const run = (wind: number, spec = PROJECTILES.bazooka) => {
    const p = new Projectile(100, 150, 6, -3, spec, 999, 0);
    for (let i = 0; i < 40; i++) p.step({ terrain: t, wind, hitsWorm: () => false, wormNear: () => false });
    return p.x;
  };
  const none = run(0), right = run(1), left = run(-1);
  const gNone = run(0, PROJECTILES.grenade), gRight = run(1, PROJECTILES.grenade);
  console.log(`wind: rocket x at 0/+1/-1 = ${none.toFixed(0)}/${right.toFixed(0)}/${left.toFixed(0)}  ${right > none + 5 && left < none - 5 ? 'PASS' : 'FAIL'}`);
  console.log(`wind: grenade unaffected ${gNone.toFixed(0)} vs ${gRight.toFixed(0)}  ${Math.abs(gNone - gRight) < 0.01 ? 'PASS' : 'FAIL'}`);
}

// --- test 6: fall damage thresholds -------------------------------------
{
  const t = flatGround(false);
  for (const drop of [10, 30, 60, 120, 250]) {
    const w = new Worm(400, 295 - drop, 'Faller', 0);
    w.state = 'airborne';
    let dmg = 0;
    for (let i = 0; i < 300 && w.state === 'airborne'; i++) dmg += w.stepPhysics(t);
    console.log(`fall ${String(drop).padStart(3)} px -> ${dmg} damage`);
  }
}

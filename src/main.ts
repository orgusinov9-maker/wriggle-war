import { Game } from './game';

const canvas = document.getElementById('view') as HTMLCanvasElement | null;
const hud = document.getElementById('hud');
if (!canvas || !hud) throw new Error('missing canvas or hud element');

const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('2d context unavailable');

new Game(canvas, ctx, hud).start();

// Offline play, once deployed. Skipped in dev so Vite's own server keeps
// serving fresh modules instead of a stale cached shell.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => {});
  });
}

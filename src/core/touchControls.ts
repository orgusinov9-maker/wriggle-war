import type { Input } from './input';

/**
 * On-screen buttons for a touch screen. Every button just drives a virtual
 * key through `Input.setHeld`, exactly as a physical key would - so `Game`
 * and `Match` need not know a touch happened at all. The rope, being built
 * from the same walk/aim-up/aim-down commands as walking, needs no controls
 * of its own: the D-pad already covers swing and climb.
 *
 * Built once, shown only on a touch-capable screen (`active`), and hidden in
 * portrait behind a rotate prompt, since the play field is wide.
 */
export class TouchControls {
  readonly active: boolean;
  private readonly root: HTMLElement | null = null;
  private readonly fuseRow: HTMLElement | null = null;

  constructor(private readonly input: Input) {
    this.active =
      (window.matchMedia?.('(pointer: coarse)').matches ?? false) || navigator.maxTouchPoints > 0;
    if (!this.active) return;

    injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'tc-root';
    document.body.appendChild(this.root);

    this.buildDpad();
    this.buildActions();
    this.fuseRow = this.buildFuseRow();
    this.buildRotatePrompt();
    this.buildStartPrompt();
  }

  /** Show or hide the fuse-length row; only adjustable-fuse weapons need it. */
  setFuseVisible(show: boolean): void {
    if (this.fuseRow) this.fuseRow.style.display = show ? 'flex' : 'none';
  }

  // --- layout ---------------------------------------------------------

  private buildDpad(): void {
    const wrap = el('div', 'tc-dpad');
    const btn = (cls: string, label: string, code: string) => {
      const b = el('button', `tc-btn tc-dpad-${cls}`, label);
      bindHold(b, this.input, code);
      wrap.appendChild(b);
    };
    btn('up', '▲', 'ArrowUp');
    btn('left', '◀', 'ArrowLeft');
    btn('right', '▶', 'ArrowRight');
    btn('down', '▼', 'ArrowDown');
    this.root!.appendChild(wrap);
  }

  private buildActions(): void {
    const wrap = el('div', 'tc-actions');

    const jump = el('button', 'tc-btn tc-jump', '⤒');
    bindHold(jump, this.input, 'Enter');
    const flip = el('button', 'tc-btn tc-flip', '⟲');
    bindHold(flip, this.input, 'Backspace');
    const fire = el('button', 'tc-btn tc-fire', 'FIRE');
    bindHold(fire, this.input, 'Space');

    wrap.appendChild(jump);
    wrap.appendChild(flip);
    wrap.appendChild(fire);
    this.root!.appendChild(wrap);

    const top = el('div', 'tc-top');
    const weapons = el('button', 'tc-btn tc-small', '☰');
    bindHold(weapons, this.input, 'Tab');
    const skip = el('button', 'tc-btn tc-small', '⏭');
    bindHold(skip, this.input, 'KeyS');
    const mute = el('button', 'tc-btn tc-small', '♪');
    bindHold(mute, this.input, 'KeyM');
    const full = el('button', 'tc-btn tc-small', '⤢');
    full.addEventListener('click', () => void enterFullscreen());
    top.appendChild(weapons);
    top.appendChild(skip);
    top.appendChild(mute);
    top.appendChild(full);
    this.root!.appendChild(top);
  }

  private buildFuseRow(): HTMLElement {
    const row = el('div', 'tc-fuse');
    row.style.display = 'none';
    for (let i = 1; i <= 5; i++) {
      const b = el('button', 'tc-btn tc-small', String(i));
      bindHold(b, this.input, `Digit${i}`);
      row.appendChild(b);
    }
    this.root!.appendChild(row);
    return row;
  }

  private buildRotatePrompt(): void {
    const p = el('div', 'tc-rotate', 'סובב את הפלאפון לרוחב\n📱 ↻');
    document.body.appendChild(p);
  }

  /**
   * Fullscreen and landscape lock both require a user gesture and are best
   * effort: iOS Safari grants neither, so the rotate prompt above is the
   * real fallback. A `click` listener, not `pointerdown`, is what browsers
   * reliably count as "direct user activation" for the Fullscreen API - a
   * raw pointerdown is sometimes not enough and fails silently.
   */
  private buildStartPrompt(): void {
    const p = el('div', 'tc-start', 'הקש כדי להתחיל\n(ואז ⤢ למעלה אם המסך עדיין לא מלא)');
    p.addEventListener('click', () => {
      p.style.display = 'none';
      void enterFullscreen();
    }, { once: true });
    document.body.appendChild(p);
  }
}

/** Best-effort fullscreen + landscape lock; silently does nothing where unsupported. */
function enterFullscreen(): Promise<void> {
  const root = document.documentElement;
  return (root.requestFullscreen?.() ?? Promise.resolve())
    .then(() =>
      (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })
        .lock?.('landscape')
        .catch(() => {}),
    )
    .catch(() => {});
}

function el(tag: string, cls: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Presses the code down on touchstart/pointerdown and releases it on lift. */
function bindHold(button: HTMLElement, input: Input, code: string): void {
  const down = (e: Event) => {
    e.preventDefault();
    input.setHeld(code, true);
  };
  const up = (e: Event) => {
    e.preventDefault();
    input.setHeld(code, false);
  };
  button.addEventListener('pointerdown', down);
  button.addEventListener('pointerup', up);
  button.addEventListener('pointercancel', up);
  button.addEventListener('contextmenu', (e) => e.preventDefault());
}

let styled = false;
/** One shared stylesheet for every button, injected once regardless of how many matches load. */
function injectStyle(): void {
  if (styled) return;
  styled = true;
  const style = document.createElement('style');
  style.textContent = `
    .tc-root { position: fixed; inset: 0; pointer-events: none; z-index: 20;
      padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
    .tc-btn { pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none;
      background: rgba(20,26,32,.5); color: #e8f2f8; border: 1px solid rgba(255,255,255,.28);
      border-radius: 9px; font: bold 16px Verdana, sans-serif; display: flex; align-items: center;
      justify-content: center; }
    .tc-btn:active { background: rgba(255,225,77,.35); }
    .tc-dpad { position: absolute; left: 12px; bottom: 12px; width: 126px; height: 126px; pointer-events: none; }
    .tc-dpad .tc-btn { position: absolute; width: 42px; height: 42px; }
    .tc-dpad-up { left: 42px; top: 0; } .tc-dpad-down { left: 42px; top: 84px; }
    .tc-dpad-left { left: 0; top: 42px; } .tc-dpad-right { left: 84px; top: 42px; }
    .tc-actions { position: absolute; right: 12px; bottom: 12px; width: 140px; height: 122px; pointer-events: none; }
    .tc-actions .tc-fire { position: absolute; right: 0; bottom: 0; width: 66px; height: 66px; border-radius: 50%;
      background: rgba(217,74,58,.5); font-size: 13px; }
    .tc-actions .tc-jump { position: absolute; right: 76px; bottom: 40px; width: 42px; height: 42px; border-radius: 50%; }
    .tc-actions .tc-flip { position: absolute; right: 76px; bottom: 0; width: 42px; height: 42px; border-radius: 50%; font-size: 14px; }
    .tc-top { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; pointer-events: none; }
    .tc-small { width: 32px; height: 32px; font-size: 13px; }
    .tc-fuse { position: absolute; right: 90px; bottom: 20px; display: flex; gap: 3px; pointer-events: none; }
    .tc-fuse .tc-btn { width: 24px; height: 24px; font-size: 11px; }
    .tc-rotate, .tc-start { position: fixed; inset: 0; z-index: 40; display: none; align-items: center;
      justify-content: center; text-align: center; white-space: pre-line; background: rgba(6,10,14,.94);
      color: #e8f2f8; font: bold 20px Verdana, sans-serif; }
    .tc-start { display: flex; }
    @media (pointer: coarse) and (orientation: portrait) { .tc-rotate { display: flex; } .tc-root { display: none; } }
  `;
  document.head.appendChild(style);
}

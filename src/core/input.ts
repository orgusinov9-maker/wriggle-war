/**
 * Keyboard + pointer state. Keys are reported both as "held" and as one-shot
 * presses. Pointer Events unify mouse, pen and single-finger touch, so a tap
 * on the map targets exactly like a click; two fingers together are read
 * separately, as a pinch-zoom and pan for the camera.
 *
 * On-screen touch buttons (see `TouchControls`) drive this same state through
 * `setHeld`, so nothing downstream needs to know whether a key came from a
 * keyboard or a thumb.
 */
export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  readonly mouse = { x: 0, y: 0, down: false, clicked: false, rightClicked: false, wheel: 0 };

  /** Two-finger pinch since the last tick; 1 = no change, >1 = fingers spreading. */
  touchZoom = 1;
  /** Two-finger pan since the last tick, in screen pixels. */
  touchPanX = 0;
  touchPanY = 0;

  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchPrevDist: number | null = null;
  private pinchPrevMid: { x: number; y: number } | null = null;
  /** True once a gesture has ever had a second finger, so lifting back to one does not fire a click. */
  private gestureWasMulti = false;

  constructor(target: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressed.add(e.code);
      // F1-F6 pick weapon groups, so the browser must not claim them.
      if (e.code.startsWith('Arrow') || e.code.startsWith('F') || e.code === 'Space' || e.code === 'Tab') {
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());

    const toCanvas = (e: PointerEvent) => {
      const r = target.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * target.width, y: ((e.clientY - r.top) / r.height) * target.height };
    };

    target.addEventListener('pointerdown', (e) => {
      target.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, toCanvas(e));
      if (this.pointers.size === 1) {
        this.gestureWasMulti = false;
        const p = toCanvas(e);
        this.mouse.x = p.x;
        this.mouse.y = p.y;
        if (e.button === 2) this.mouse.rightClicked = true;
        else this.mouse.down = true;
      } else {
        this.gestureWasMulti = true;
        this.mouse.down = false; // a second finger cancels a drag in progress
        this.pinchPrevDist = null;
        this.pinchPrevMid = null;
      }
    });

    target.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.set(e.pointerId, toCanvas(e));
      if (this.pointers.size === 1) {
        const p = toCanvas(e);
        this.mouse.x = p.x;
        this.mouse.y = p.y;
      } else if (this.pointers.size === 2) {
        this.updatePinch();
      }
    });

    const release = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size === 0) {
        this.mouse.down = false;
        this.pinchPrevDist = null;
        this.pinchPrevMid = null;
      } else if (this.pointers.size === 1) {
        // Dropped back to one finger: resume tracking it, but this was a
        // pinch gesture, so it does not resume as a click-drag.
        this.pinchPrevDist = null;
        this.pinchPrevMid = null;
      }
    };
    target.addEventListener('pointerup', (e) => {
      // A tap: exactly one finger down throughout, lifted where it started.
      if (this.pointers.size === 1 && !this.gestureWasMulti) this.mouse.clicked = true;
      release(e);
    });
    target.addEventListener('pointercancel', release);

    target.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    // Touch devices insist on their own gestures unless told otherwise.
    target.style.touchAction = 'none';
  }

  /** Updates the pinch-zoom/pan accumulators from the current two pointers. */
  private updatePinch(): void {
    const [a, b] = [...this.pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (this.pinchPrevDist !== null && this.pinchPrevMid !== null) {
      if (this.pinchPrevDist > 4) this.touchZoom *= dist / this.pinchPrevDist;
      this.touchPanX += mid.x - this.pinchPrevMid.x;
      this.touchPanY += mid.y - this.pinchPrevMid.y;
    }
    this.pinchPrevDist = dist;
    this.pinchPrevMid = mid;
  }

  /** Two or more fingers on the glass right now: a deliberate camera gesture, not a tap. */
  get twoFingers(): boolean {
    return this.pointers.size >= 2;
  }

  down(code: string): boolean {
    return this.held.has(code);
  }

  /** True only on the frame the key went down. */
  hit(code: string): boolean {
    return this.pressed.has(code);
  }

  /**
   * Drives a virtual key exactly as a physical keydown/keyup would: the rising
   * edge registers as a one-shot `hit`, and it stays `down` until released.
   * On-screen touch buttons call this so the rest of the game never needs to
   * know where a key came from.
   */
  setHeld(code: string, on: boolean): void {
    if (on) {
      if (!this.held.has(code)) this.pressed.add(code);
      this.held.add(code);
    } else {
      this.held.delete(code);
    }
  }

  /** Call once at the end of every logic tick. */
  endTick(): void {
    this.pressed.clear();
    this.mouse.clicked = false;
    this.mouse.rightClicked = false;
    this.mouse.wheel = 0;
    this.touchZoom = 1;
    this.touchPanX = 0;
    this.touchPanY = 0;
  }
}

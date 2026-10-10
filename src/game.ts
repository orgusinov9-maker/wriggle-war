import { Sound } from './audio/sound';
import { Input } from './core/input';
import { TouchControls } from './core/touchControls';
import { TICK_HZ, startLoop } from './core/loop';
import { randomSeed } from './core/rng';
import { WEAPONS, WEAPON_GROUPS, WeaponId } from './entities/weapons';
import { GIRDER_ANGLES } from './world/girder';
import { Match, TurnCommand } from './match';
import { Camera } from './render/camera';
import { TOUCH_SCALE, fitMenuScale, menuLayout, tileAt } from './render/menuLayout';
import { TEAM_COLORS } from './render/palette';
import { Renderer } from './render/renderer';
import { GeneratedMap, MAP_HEIGHT, MAP_WIDTH, MapStyle, generateMap } from './world/mapgen';

/** Ticks of held fire key to reach full power - about 0.9 s, as in the original. */
const FULL_CHARGE_TICKS = 45;

const TEAM_NAMES = ['Red Team', 'Blue Team'] as const;

/** F1..F6 map onto the six weapon groups, as the function keys did originally. */
const GROUP_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6'] as const;

/**
 * Input, camera and presentation. All game rules live in `Match`; this class
 * only turns key state into a `TurnCommand` and draws whatever the match says.
 */
export class Game {
  private readonly camera: Camera;
  private readonly input: Input;
  private readonly touch: TouchControls;
  private readonly sound = new Sound();
  private renderer!: Renderer;
  private match!: Match;
  private map!: GeneratedMap;

  private aimDistance = 62;
  private lastJumpTick = -99;
  private tickCount = 0;
  /** Ticks the fire key has been held, or null when not charging. */
  private charge: number | null = null;
  private fuseSeconds = 3;
  /** Girder orientation, turned with the arrow keys while the girder is selected. */
  private girderStep = 0;
  /** Worm the camera was last told to frame, so a new turn snaps to it. */
  private lastFramed: unknown = null;

  /** Weapon panel state. While it is open the worm takes no orders. */
  private menuOpen = false;
  private menuHover: WeaponId | null = null;
  /** Aim point picked for a homing missile or air strike, in world space. */
  private target: { x: number; y: number } | null = null;
  /** Which weapon the target was picked for, so swapping clears it. */
  private targetFor: WeaponId | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
    private readonly hud: HTMLElement,
  ) {
    this.input = new Input(canvas);
    this.touch = new TouchControls(this.input);
    this.camera = new Camera(MAP_WIDTH, MAP_HEIGHT);
    this.newMatch();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    // A hidden tab stops the loop, so the power-bar tone must not hang on.
    document.addEventListener('visibilitychange', () => this.sound.charge(null));
  }

  start(): void {
    startLoop(() => this.tick(), () => this.draw());
  }

  private resize(): void {
    const w = Math.floor(window.innerWidth);
    const h = Math.floor(window.innerHeight);
    this.canvas.width = w;
    this.canvas.height = h;
    // Pin the CSS box to the exact same pixel count as the backing store.
    // On a mobile browser, CSS `100vh`/`100%` can briefly disagree with
    // `window.innerHeight` while the address bar is showing or animating
    // away; when they disagree the browser stretches the canvas bitmap to
    // fill the CSS box instead of just resizing it, which pushes whatever is
    // drawn near the bottom - like the weapon panel - off the visible edge.
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.camera.resize(w, h);
  }

  private newMatch(style?: MapStyle): void {
    this.map = generateMap(randomSeed(), style);
    this.match = new Match(this.map, TEAM_NAMES);
    this.renderer = new Renderer(this.ctx, this.camera, this.map, this.match.particles);
    this.charge = null;
    this.lastFramed = null;
    this.menuOpen = false;
    this.clearTarget();

    const worm = this.match.activeWorm;
    if (worm) {
      this.camera.x = worm.x;
      this.camera.y = worm.y;
    }
  }

  private clearTarget(): void {
    this.target = null;
    this.targetFor = null;
  }

  /** True when the selected weapon wants an aim point that has not been set. */
  private get awaitingTarget(): boolean {
    const spec = WEAPONS[this.match.selectedWeapon];
    return spec.needsTarget && this.target === null;
  }

  /**
   * The weapon panel is drawn and hit-tested larger on a touch screen, but
   * never larger than the screen itself - there is no way to scroll it, so a
   * short landscape phone shrinks it instead of letting it run off the edges.
   */
  private get menuScale(): number {
    const desired = this.touch.active ? TOUCH_SCALE : 1;
    return fitMenuScale(this.camera.viewWidth, this.camera.viewHeight, desired);
  }

  private tick(): void {
    this.tickCount++;
    const input = this.input;

    if (input.hit('KeyR')) this.newMatch();
    if (input.hit('KeyZ')) this.newMatch('island');
    if (input.hit('KeyX')) this.newMatch('ridges');
    if (input.hit('KeyC')) this.newMatch('cave');
    // Fuse length, exactly the 1-5 of the original.
    for (let i = 1; i <= 5; i++) {
      if (input.hit(`Digit${i}`)) this.fuseSeconds = i;
    }
    if (input.hit('KeyM')) this.sound.toggleMute();
    if (input.hit('Minus') || input.hit('NumpadSubtract')) this.sound.changeVolume(-0.1);
    if (input.hit('Equal') || input.hit('NumpadAdd')) this.sound.changeVolume(0.1);

    const cmd = this.readCommand();
    this.match.tick(cmd);
    this.touch.setFuseVisible(WEAPONS[this.match.selectedWeapon].adjustableFuse);
    // A weapon swap invalidates an aim point picked for the previous one.
    if (this.targetFor !== null && this.targetFor !== this.match.selectedWeapon) this.clearTarget();
    this.updateCamera();
    this.sound.play(this.match.events, {
      x: this.camera.x,
      y: this.camera.y,
      halfWidth: this.camera.viewWidth / (2 * this.camera.zoom),
    });
    this.sound.charge(this.charge === null ? null : this.charge / FULL_CHARGE_TICKS);
    this.renderer.tick();
    input.endTick();
  }

  /** Translates raw key state into the command the match understands. */
  private readCommand(): TurnCommand {
    const input = this.input;
    const worm = this.match.activeWorm;
    const playable = this.match.canMove && worm !== null && worm.alive;
    const idle: TurnCommand = { walk: 0, aimUp: false, aimDown: false, jump: false, backflip: false, skip: false };

    if (!playable) {
      // Never carry a half-charged shot or an open panel across a turn boundary.
      this.charge = null;
      this.menuOpen = false;
      this.clearTarget();
      return idle;
    }

    // The click that picks from the panel must not also drop a girder.
    const panelWasOpen = this.menuOpen;
    const selectWeapon = this.readWeaponChoice();
    if (this.menuOpen || panelWasOpen) {
      this.charge = null;
      return { ...idle, selectWeapon };
    }

    let walk: -1 | 0 | 1 = 0;
    if (WEAPONS[this.match.selectedWeapon].mode === 'girder' && !this.match.torching) {
      // With a girder in hand, left and right turn the beam instead of walking.
      if (input.hit('ArrowLeft')) this.girderStep = (this.girderStep + GIRDER_ANGLES - 1) % GIRDER_ANGLES;
      if (input.hit('ArrowRight')) this.girderStep = (this.girderStep + 1) % GIRDER_ANGLES;
    } else if (input.down('ArrowLeft')) walk = -1;
    else if (input.down('ArrowRight')) walk = 1;

    let jump = false;
    if (input.hit('Enter') || input.hit('NumpadEnter')) {
      jump = true;
      // Two jumps in quick succession is the classic high hop.
      if (this.tickCount - this.lastJumpTick < 14 && worm) worm.vy *= 1.28;
      this.lastJumpTick = this.tickCount;
    }

    // A targeted weapon takes its aim point from a click on the map.
    if (input.mouse.clicked && this.awaitingTarget) {
      this.target = {
        x: this.camera.worldX(input.mouse.x),
        y: this.camera.worldY(input.mouse.y),
      };
      this.targetFor = this.match.selectedWeapon;
    }

    return {
      walk,
      aimUp: input.down('ArrowUp'),
      aimDown: input.down('ArrowDown'),
      jump,
      backflip: input.hit('Backspace'),
      skip: input.hit('KeyS'),
      selectWeapon,
      fire: this.readFireOrder(),
    };
  }

  /**
   * The trigger. Weapons that charge build power while the key is held and go
   * off on release; the rest fire the moment the key goes down.
   */
  private readFireOrder(): TurnCommand['fire'] {
    const input = this.input;
    const spec = WEAPONS[this.match.selectedWeapon];
    const order = (power: number): TurnCommand['fire'] => ({
      power,
      fuseSeconds: this.fuseSeconds,
      target: this.target ?? undefined,
    });

    if (this.match.torching) {
      // A burning torch has used its round, so the selection may already have
      // moved on; whatever is selected, a tap of the trigger puts it out.
      this.charge = null;
      return input.hit('Space') ? order(1) : undefined;
    }

    if (spec.mode === 'girder') {
      // Dropped where the pointer clicks.
      this.charge = null;
      if (!input.mouse.clicked || !this.match.canFire) return undefined;
      return { ...order(1)!, target: this.pointerWorld(), girderStep: this.girderStep };
    }

    if (!spec.charged) {
      this.charge = null;
      return input.hit('Space') && this.match.canFire && !this.awaitingTarget ? order(1) : undefined;
    }

    if (this.match.canFire && !this.awaitingTarget && input.down('Space')) {
      this.charge = Math.min(FULL_CHARGE_TICKS, (this.charge ?? 0) + 1);
      return undefined;
    }
    if (this.charge !== null) {
      const power = Math.max(0.06, this.charge / FULL_CHARGE_TICKS);
      this.charge = null;
      return order(power);
    }
    return undefined;
  }

  private pointerWorld(): { x: number; y: number } {
    const m = this.input.mouse;
    return { x: Math.round(this.camera.worldX(m.x)), y: Math.round(this.camera.worldY(m.y)) };
  }

  /** Where the girder would land, while one is in hand and can still be placed. */
  private girderGhost(): { x: number; y: number; step: number; ok: boolean } | null {
    const match = this.match;
    if (WEAPONS[match.selectedWeapon].mode !== 'girder' || !match.canFire || match.torching || this.menuOpen) return null;
    const worm = match.activeWorm;
    if (!match.canMove || !worm || !worm.alive) return null;
    const p = this.pointerWorld();
    return { ...p, step: this.girderStep, ok: match.canPlaceGirder(p.x, p.y, this.girderStep) };
  }

  /** Panel clicks and the F1..F6 group keys, both producing a weapon id. */
  private readWeaponChoice(): WeaponId | undefined {
    const input = this.input;

    if (input.hit('Tab') || input.mouse.rightClicked) this.menuOpen = !this.menuOpen;
    if (input.hit('Escape')) this.menuOpen = false;

    if (this.menuOpen) {
      const layout = menuLayout(this.camera.viewWidth, this.camera.viewHeight, this.menuScale);
      this.menuHover = tileAt(layout, input.mouse.x, input.mouse.y);
      if (input.mouse.clicked) {
        const picked = this.menuHover;
        this.menuOpen = false;
        if (picked && this.match.ammoOf(picked) !== 0) return picked;
      }
      return undefined;
    }
    this.menuHover = null;

    // A group key selects its first weapon, and cycles onward if already held.
    for (let g = 0; g < GROUP_KEYS.length && g < WEAPON_GROUPS.length; g++) {
      if (!input.hit(GROUP_KEYS[g])) continue;
      const ids = WEAPON_GROUPS[g].ids.filter((id) => this.match.ammoOf(id) !== 0);
      if (ids.length === 0) return undefined;
      const at = ids.indexOf(this.match.selectedWeapon);
      return ids[(at + 1) % ids.length];
    }
    return undefined;
  }

  private updateCamera(): void {
    // Two fingers on the glass is a deliberate look-around; auto-follow would
    // just fight it, snapping straight back to the worm every tick.
    if (!this.input.twoFingers) {
      // A shot in flight owns the camera, then the bomber, then the active worm.
      const live = this.match.projectiles[this.match.projectiles.length - 1];
      const plane = this.match.airstrikes[0];
      if (live && !live.resting) {
        this.camera.follow(live.x, live.y, 0.14);
      } else if (plane) {
        this.camera.follow(plane.x, plane.y + 90, 0.12);
      } else {
        const worm = this.match.activeWorm;
        if (worm && worm.alive) {
          // A new worm gets snapped to quickly, then followed gently.
          const rate = worm === this.lastFramed ? 0.1 : 0.22;
          this.lastFramed = worm;
          const v = worm.aimVector();
          this.camera.follow(worm.x + v.x * 40, worm.y + v.y * 24 - 10, rate);
        }
      }
    }

    const m = this.input.mouse;
    if (m.wheel !== 0) this.camera.zoomBy(m.wheel);
    if (this.input.touchZoom !== 1) this.camera.zoomMultiply(this.input.touchZoom);
    if (this.input.touchPanX || this.input.touchPanY) {
      // Content follows the fingers, so the camera moves the other way.
      this.camera.panBy(-this.input.touchPanX, -this.input.touchPanY);
    }
    if (this.menuOpen) return; // the pointer belongs to the panel

    // Edge scrolling, as in the original: push the pointer at a screen border.
    const edge = 26;
    const speed = 7;
    let dx = 0;
    let dy = 0;
    if (m.x < edge) dx = -speed;
    else if (m.x > this.canvas.width - edge) dx = speed;
    if (m.y < edge) dy = -speed;
    else if (m.y > this.canvas.height - edge) dy = speed;
    if (dx || dy) this.camera.panBy(dx, dy);
  }

  private draw(): void {
    const match = this.match;
    const spec = WEAPONS[match.selectedWeapon];
    const timedPhase = match.phase === 'play' || match.phase === 'retreat';

    this.renderer.draw({
      worms: match.worms,
      activeWorm: match.activeWorm,
      projectiles: match.projectiles,
      airstrikes: match.airstrikes,
      tracers: match.tracers,
      graves: match.graves,
      aimDistance: this.aimDistance,
      charge: this.charge === null ? null : this.charge / FULL_CHARGE_TICKS,
      wind: match.wind,
      weapon: spec,
      ammo: match.activeTeam ? match.activeTeam.ammo : ({} as Record<WeaponId, number>),
      fuseSeconds: spec.adjustableFuse ? this.fuseSeconds : null,
      menuOpen: this.menuOpen,
      menuHover: this.menuHover,
      target: this.target,
      awaitingTarget: this.awaitingTarget && match.canFire,
      waterLevel: match.waterLevel,
      secondsLeft: timedPhase ? match.secondsLeft : null,
      teams: match.teams.map((team) => ({
        name: team.name,
        color: TEAM_COLORS[team.colorIndex % TEAM_COLORS.length],
        health: match.teamHealth(team),
        maxHealth: match.teamMaxHealth(team),
        active: team === match.activeTeam,
      })),
      round: match.round,
      suddenDeath: match.suddenDeath,
      banner: match.banner,
      interactive: match.canMove && !this.menuOpen,
      // As in the original, the weapon comes out only while standing still to aim.
      holding: match.torching
        ? 'blowtorch'
        : match.phase === 'play' && !this.menuOpen && match.activeWorm?.state === 'idle'
          ? match.selectedWeapon
          : null,
      holdAim: match.torching || match.selectedWeapon === 'blowtorch' ? match.torchAim : null,
      girderGhost: this.girderGhost(),
      rope: match.rope ? match.rope.path() : null,
      menuScale: this.menuScale,
    });
    this.updateHud();
  }

  private updateHud(): void {
    const match = this.match;
    const worm = match.activeWorm;
    const aimDeg = worm ? Math.round((-worm.aim * 180) / Math.PI) : 0;
    this.hud.textContent = [
      `STAGE 3B  -  ninja rope, blowtorch, girder`,
      `map    ${this.map.style} / ${this.map.theme.name}   seed ${this.map.seed}`,
      `turn   ${match.activeTeam?.name ?? '-'}  /  ${worm ? worm.name : '-'}   hp ${worm ? worm.health : '-'}`,
      `phase  ${match.phase}   aim ${aimDeg > 0 ? '+' : ''}${aimDeg} deg   wind ${match.wind > 0 ? '+' : ''}${match.wind.toFixed(2)}`,
      ``,
      `arrows  walk / aim        SPACE  fire (hold to charge)`,
      `Enter   jump (x2 higher)  Backspace  backflip     S  skip turn`,
      `TAB / right-click  weapon panel     F1-F6  weapon groups   1-5  fuse`,
      `R new match   Z island  X ridges  C cave   wheel zoom   ${TICK_HZ} Hz sim`,
      `Ninja Rope (F6): SPACE fire / let go, arrows swing + climb, Enter drop off`,
      `Blowtorch (F6): SPACE start / stop, up-down angle   Girder (F6): click to place, left-right turn`,
      `M mute   - / +  volume   ${this.sound.muted ? 'MUTED' : `vol ${Math.round(this.sound.volume * 100)}%`}`,
    ].join('\n');
  }
}

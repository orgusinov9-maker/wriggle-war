import { WEAPON_GROUPS, WeaponId } from '../entities/weapons';

export const TILE = 46;
export const GAP = 4;
const PAD = 10;
const LABEL_W = 62;
/** Scale applied to every dimension for a touch panel, so tiles clear a fingertip. */
export const TOUCH_SCALE = 1.3;

export interface MenuTile {
  readonly id: WeaponId;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface MenuLayout {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly labelW: number;
  readonly rows: readonly { readonly label: string; readonly y: number; readonly tiles: readonly MenuTile[] }[];
  readonly tiles: readonly MenuTile[];
}

/**
 * The largest scale that still fits the panel on screen, so it is never
 * taller or wider than the view - there is no way to scroll it, so it must
 * simply always fit. `desired` is what a roomy screen would get.
 */
export function fitMenuScale(viewWidth: number, viewHeight: number, desired = 1): number {
  const cols = Math.max(...WEAPON_GROUPS.map((g) => g.ids.length));
  const rows = WEAPON_GROUPS.length;
  const naturalW = PAD * 2 + LABEL_W + cols * TILE + (cols - 1) * GAP;
  const naturalH = PAD * 2 + rows * TILE + (rows - 1) * GAP;
  const margin = 0.92; // leaves a border so the panel never touches the screen edge
  const fit = Math.min((viewWidth * margin) / naturalW, (viewHeight * margin) / naturalH);
  return Math.max(0.45, Math.min(desired, fit));
}

/**
 * The weapon panel geometry, computed once and shared: the renderer draws from
 * it and the input layer hit-tests against it, so the two can never disagree
 * about where a tile is.
 */
export function menuLayout(viewWidth: number, viewHeight: number, scale = 1): MenuLayout {
  const tile = TILE * scale;
  const gap = GAP * scale;
  const pad = PAD * scale;
  const labelW = LABEL_W * scale;
  const cols = Math.max(...WEAPON_GROUPS.map((g) => g.ids.length));
  const w = pad * 2 + labelW + cols * tile + (cols - 1) * gap;
  const h = pad * 2 + WEAPON_GROUPS.length * tile + (WEAPON_GROUPS.length - 1) * gap;
  const x = Math.round(viewWidth / 2 - w / 2);
  const y = Math.round(viewHeight / 2 - h / 2);

  const tiles: MenuTile[] = [];
  const rows = WEAPON_GROUPS.map((group, r) => {
    const ry = y + pad + r * (tile + gap);
    const rowTiles = group.ids.map((id, c) => {
      const t: MenuTile = {
        id,
        x: x + pad + labelW + c * (tile + gap),
        y: ry,
        w: tile,
        h: tile,
      };
      tiles.push(t);
      return t;
    });
    return { label: group.label, y: ry, tiles: rowTiles };
  });

  return { x, y, w, h, labelW, rows, tiles };
}

/** The weapon under a screen-space point, or null. */
export function tileAt(layout: MenuLayout, px: number, py: number): WeaponId | null {
  for (const t of layout.tiles) {
    if (px >= t.x && px <= t.x + t.w && py >= t.y && py <= t.y + t.h) return t.id;
  }
  return null;
}

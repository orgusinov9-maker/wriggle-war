/** Scrolling, zooming view onto the map. Screen space is device pixels. */
export class Camera {
  /** Centre of the view, in world pixels. */
  x = 0;
  y = 0;
  zoom = 1;
  viewWidth = 1;
  viewHeight = 1;

  constructor(private readonly mapWidth: number, private readonly mapHeight: number) {}

  resize(w: number, h: number): void {
    this.viewWidth = w;
    this.viewHeight = h;
  }

  /** Ease toward a world point; `rate` is the fraction closed per tick. */
  follow(tx: number, ty: number, rate = 0.12): void {
    this.x += (tx - this.x) * rate;
    this.y += (ty - this.y) * rate;
    this.clamp();
  }

  panBy(dx: number, dy: number): void {
    this.x += dx / this.zoom;
    this.y += dy / this.zoom;
    this.clamp();
  }

  zoomBy(steps: number): void {
    this.zoomMultiply(Math.pow(1.15, -steps));
    // A discrete wheel click is a big jump; round it to a tidy number.
    this.zoom = Math.round(this.zoom * 100) / 100;
  }

  /**
   * Continuous zoom, driven by a pinch gesture rather than discrete wheel
   * steps. Deliberately not rounded: a pinch moves the zoom by a fraction of
   * a percent per frame, and rounding that to two decimals swallowed most
   * frames' change and then jumped, which read as stuttery.
   */
  zoomMultiply(factor: number): void {
    this.zoom = Math.min(3, Math.max(0.5, this.zoom * factor));
    this.clamp();
  }

  /**
   * Keeps the view over the map. Sky above the map is allowed (worms fly up
   * there), but the view never runs off the sides or below the sea bed.
   */
  private clamp(): void {
    const halfW = this.viewWidth / (2 * this.zoom);
    const halfH = this.viewHeight / (2 * this.zoom);

    if (halfW * 2 >= this.mapWidth) this.x = this.mapWidth / 2;
    else this.x = Math.min(this.mapWidth - halfW, Math.max(halfW, this.x));

    const topLimit = -this.mapHeight * 0.55 + halfH;
    const bottomLimit = this.mapHeight + 40 - halfH;
    this.y = Math.min(Math.max(this.y, topLimit), Math.max(topLimit, bottomLimit));
  }

  screenX(worldX: number): number {
    return (worldX - this.x) * this.zoom + this.viewWidth / 2;
  }

  screenY(worldY: number): number {
    return (worldY - this.y) * this.zoom + this.viewHeight / 2;
  }

  worldX(screenX: number): number {
    return (screenX - this.viewWidth / 2) / this.zoom + this.x;
  }

  worldY(screenY: number): number {
    return (screenY - this.viewHeight / 2) / this.zoom + this.y;
  }

  /** Applies the camera as a canvas transform so world coords can be drawn directly. */
  apply(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(
      this.zoom,
      0,
      0,
      this.zoom,
      this.viewWidth / 2 - this.x * this.zoom,
      this.viewHeight / 2 - this.y * this.zoom,
    );
  }
}

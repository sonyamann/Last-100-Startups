// The clump: one Matter.js body per bubble. Bodies are rounded blobs that never
// rotate (so names stay readable). The DOM pills are moved to match the
// bodies every frame.
//
// Two phases:
// 1. Settle (before first paint): pills are packed by a pull toward the
//    middle. Desktop pulls toward a centre line along the long side (a wide
//    rounded band); phones pull toward the centre point, with the walls
//    holding the width, so the column fills the screen edge to edge.
// 2. Live: each pill remembers where it settled ("home") and springs gently
//    back toward it, with random nudges, so the clump jostles like frog eggs.
//    Pressure stays local, so pills don't overlap.
// Dragging (M4): the dragged bubble becomes a sensor, passing over the others
// so it can be dropped onto one to merge; let go elsewhere, it drifts home.
// Bubbles can be removed (merged, eaten) and added (the merged bubble).
// (A single global pull for both phases, tried first, either overlapped
// pills on phones or left a single-file trail at the ends of the column.)

import Matter from "matter-js";

const { Engine, Bodies, Body, Composite, Events } = Matter;

// A blob body matching the CSS shape: a superellipse (|x/a|^n + |y/b|^n = 1)
// with n = 2.6, between an ellipse (n = 2, too pointy) and a rounded
// rectangle. 32-sided and convex, so no decomposition is needed.
const SUPERELLIPSE_N = 2.6;
function blob(x: number, y: number, w: number, h: number, options: Matter.IChamferableBodyDefinition): Matter.Body {
  const n = 32;
  const e = 2 / SUPERELLIPSE_N;
  const verts = Array.from({ length: n }, (_, k) => {
    const t = (k / n) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    return { x: (Math.sign(c) * Math.abs(c) ** e * w) / 2, y: (Math.sign(s) * Math.abs(s) ** e * h) / 2 };
  });
  return Bodies.fromVertices(x, y, [verts], options);
}

function makeBody(it: PillItem, x: number, y: number, frictionAir: number): Matter.Body {
  return blob(x, y, it.w + GAP, it.h + GAP, {
    frictionAir,
    friction: 0.02,
    frictionStatic: 0,
    restitution: 0.15,
    slop: 0.01,
    inertia: Infinity,
  });
}

export interface PillItem {
  el: HTMLElement;
  w: number;
  h: number;
}

interface Placed extends PillItem {
  body: Matter.Body;
  home: { x: number; y: number };
}

export interface ClumpOptions {
  width: number;
  height: number;
  reducedMotion: boolean;
}

// Space between pills, so neighbours touch only at their soft outer edge.
const GAP = 4;
const SETTLE_STEPS = 360;
const RELAX_STEPS = 90;
const SETTLE_SHAKE = 2.6e-4;   // random shaking while packing
const SETTLE_PULL = 6e-6;      // packing pull during the settle phase
const CENTRE_SHARE_WIDE = 0.08; // desktop: extra pull to the centre point, rounding the band's ends
const HOME_PULL = 9e-6;        // live: spring back toward home
const JOSTLE = 6e-5;         // size of the random nudges
const JOSTLE_RATE = 0.04;      // chance per pill per frame of a nudge

export class Clump {
  readonly engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 } });
  private placed: Placed[] = [];
  private width: number;
  private height: number;
  private reducedMotion: boolean;
  private raf = 0;
  private dragging: { p: Placed; x: number; y: number } | null = null;
  private quietFrames = 0;
  private settling = true;
  private relaxing = false;

  constructor(items: PillItem[], opts: ClumpOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.reducedMotion = opts.reducedMotion;
    this.engine.positionIterations = 10;
    this.engine.velocityIterations = 6;

    // Seed positions packed in rows (biggest pills in the middle rows) so the
    // clump starts nearly settled: across ~86% of the width on desktop, the
    // full width on phones. Seeded loosely, late arrivals ended up stacked
    // single file on the clump like a tower.
    const wide = this.width >= this.height;
    const seeds = this.seedRows(items, wide ? this.width * 0.86 : this.width - 8);
    const placed = new Array<Placed>(items.length);
    items.forEach((it, i) => {
      const { x, y } = seeds[i]!;
      placed[i] = { ...it, body: makeBody(it, x, y, 0.05), home: { x, y } };
    });
    this.placed = placed;
    Composite.add(this.engine.world, placed.map((p) => p.body));
    this.addWalls();
    Events.on(this.engine, "beforeUpdate", () => this.forces());

    // Settle before anyone sees it; then relax with no pull, so any pills
    // pressed together push apart; then remember where everyone ended up.
    for (let i = 0; i < SETTLE_STEPS; i++) Engine.update(this.engine, 1000 / 60);
    this.relaxing = true;
    for (let i = 0; i < RELAX_STEPS; i++) Engine.update(this.engine, 1000 / 60);
    this.relaxing = false;
    for (const p of this.placed) {
      p.home = { x: p.body.position.x, y: p.body.position.y };
      p.body.frictionAir = 0.09;
      Body.setVelocity(p.body, { x: 0, y: 0 });
    }
    this.settling = false;
    this.render();
  }

  // Rows across the width. The sequence puts the biggest pills in the
  // middle (alternately appended front and back), then fills rows in order.
  private seedRows(items: PillItem[], rowWidth: number): { x: number; y: number }[] {
    const order = items.map((it, i) => ({ it, i })).sort((a, b) => b.it.w * b.it.h - a.it.w * a.it.h);
    const seq: typeof order = [];
    order.forEach((o, k) => (k % 2 ? seq.push(o) : seq.unshift(o)));
    const rows: { members: typeof order; w: number; h: number }[] = [];
    let row = { members: [] as typeof order, w: 0, h: 0 };
    for (const o of seq) {
      const w = o.it.w + GAP;
      if (row.members.length && row.w + w > rowWidth) {
        rows.push(row);
        row = { members: [], w: 0, h: 0 };
      }
      row.members.push(o);
      row.w += w;
      row.h = Math.max(row.h, o.it.h + GAP);
    }
    if (row.members.length) rows.push(row);
    const total = rows.reduce((s, r) => s + r.h, 0);
    const out = new Array<{ x: number; y: number }>(items.length);
    let y = Math.max(0, (this.height - total) / 2);
    for (const r of rows) {
      let x = (this.width - r.w) / 2 + (Math.random() - 0.5) * Math.max(0, rowWidth - r.w);
      for (const o of r.members) {
        const w = o.it.w + GAP;
        // Jitter within the row, so rows don't read as rows.
        out[o.i] = { x: x + w / 2, y: y + r.h / 2 + (Math.random() - 0.5) * r.h * 0.5 };
        x += w;
      }
      y += r.h;
    }
    return out;
  }

  private walls: Matter.Body[] = [];

  private addWalls(): void {
    const t = 400;
    const { width: w, height: h } = this;
    Composite.remove(this.engine.world, this.walls);
    this.walls = [
      Bodies.rectangle(w / 2, -t / 2, w + 2 * t, t, { isStatic: true }),
      Bodies.rectangle(w / 2, h + t / 2, w + 2 * t, t, { isStatic: true }),
      Bodies.rectangle(-t / 2, h / 2, t, h + 2 * t, { isStatic: true }),
      Bodies.rectangle(w + t / 2, h / 2, t, h + 2 * t, { isStatic: true }),
    ];
    Composite.add(this.engine.world, this.walls);
  }

  // Shrink the container to the settled clump plus `pad` above and below,
  // shifting everything up to match. The starting height is only an
  // estimate from the bubbles' area, and the clump often settles smaller,
  // leaving empty space. Returns the new height.
  fitHeight(pad: number): number {
    let top = Infinity;
    let bottom = -Infinity;
    for (const p of this.placed) {
      top = Math.min(top, p.body.bounds.min.y);
      bottom = Math.max(bottom, p.body.bounds.max.y);
    }
    if (!Number.isFinite(top)) return this.height;
    const shift = Math.max(0, top - pad);
    const height = Math.min(this.height - shift, Math.ceil(bottom - shift + pad));
    for (const p of this.placed) {
      Body.setPosition(p.body, { x: p.body.position.x, y: p.body.position.y - shift });
      p.home = { x: p.home.x, y: p.home.y - shift };
    }
    this.height = height;
    this.addWalls();
    this.render();
    return height;
  }

  private forces(): void {
    if (this.relaxing) return;
    if (this.settling) return this.settleForces();
    for (const p of this.placed) {
      const b = p.body;
      if (this.dragging?.p === p) {
        // Steer the dragged pill toward the pointer; collisions still apply,
        // so it shoulders its neighbours aside.
        const d = this.dragging;
        Body.setVelocity(b, { x: (d.x - b.position.x) * 0.35, y: (d.y - b.position.y) * 0.35 });
        continue;
      }
      Body.applyForce(b, b.position, {
        x: (p.home.x - b.position.x) * HOME_PULL * b.mass,
        y: (p.home.y - b.position.y) * HOME_PULL * b.mass,
      });
      if (!this.reducedMotion && Math.random() < JOSTLE_RATE) {
        const a = Math.random() * Math.PI * 2;
        Body.applyForce(b, b.position, { x: Math.cos(a) * JOSTLE * b.mass, y: Math.sin(a) * JOSTLE * b.mass });
      }
    }
  }

  private settleForces(): void {
    const cx = this.width / 2;
    const cy = this.height / 2;
    const wide = this.width >= this.height;
    const half = (this.width - this.height) / 2;
    for (const p of this.placed) {
      const b = p.body;
      // Desktop: toward a centre line (plus a little toward the centre
      // point). Phones: toward the centre point; the walls keep the width.
      const tx = wide ? Math.max(cx - half, Math.min(cx + half, b.position.x)) : cx;
      const share = wide ? CENTRE_SHARE_WIDE : 0;
      Body.applyForce(b, b.position, {
        x: ((tx - b.position.x) + (cx - b.position.x) * share) * SETTLE_PULL * b.mass,
        y: (cy - b.position.y) * (wide ? 1 + share : 1) * SETTLE_PULL * b.mass,
      });
      // Shake while packing, so the seed rows break up into an organic clump.
      if (Math.random() < 0.3) {
        const a = Math.random() * Math.PI * 2;
        Body.applyForce(b, b.position, { x: Math.cos(a) * SETTLE_SHAKE * b.mass, y: Math.sin(a) * SETTLE_SHAKE * b.mass });
      }
    }
  }

  private render(): void {
    for (const p of this.placed) {
      const { x, y } = p.body.position;
      p.el.style.transform = `translate3d(${(x - p.w / 2).toFixed(1)}px, ${(y - p.h / 2).toFixed(1)}px, 0)`;
    }
  }

  start(): void {
    // A fixed step per frame keeps the simulation stable; a hidden tab
    // pauses requestAnimationFrame, so nothing piles up.
    const tick = () => {
      Engine.update(this.engine, 1000 / 60);
      this.render();
      // With reduced motion, stop once everything is still (and no drag).
      if (this.reducedMotion && !this.dragging) {
        const moving = this.placed.some((p) => p.body.speed > 0.05);
        this.quietFrames = moving ? 0 : this.quietFrames + 1;
        if (this.quietFrames > 30) {
          this.raf = 0;
          return;
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    if (!this.raf) this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  private find(el: HTMLElement): Placed | undefined {
    return this.placed.find((p) => p.el === el);
  }

  // Where a bubble lives in the clump (it may be elsewhere while dragged).
  homeOf(el: HTMLElement): { x: number; y: number } | null {
    const p = this.find(el);
    return p ? { ...p.home } : null;
  }

  position(el: HTMLElement): { x: number; y: number } | null {
    const p = this.find(el);
    return p ? { x: p.body.position.x, y: p.body.position.y } : null;
  }

  // Drag: the bubble follows (x, y), in container coordinates, passing over
  // the others (a sensor) so it can be dropped onto one.
  startDrag(el: HTMLElement, x: number, y: number): void {
    const p = this.find(el);
    if (!p) return;
    this.dragging = { p, x, y };
    p.body.isSensor = true;
    this.start();
  }

  // The dragged bubble may leave the clump (to reach the acquirers below);
  // as a sensor it passes through the walls.
  moveDrag(x: number, y: number): void {
    if (!this.dragging) return;
    this.dragging.x = x;
    this.dragging.y = y;
  }

  endDrag(): void {
    const d = this.dragging;
    if (!d) return;
    // Dropped outside the clump: put it back inside before it collides
    // again, or the walls would fling it.
    const b = d.p.body;
    const x = Math.max(d.p.w / 2, Math.min(this.width - d.p.w / 2, b.position.x));
    const y = Math.max(d.p.h / 2, Math.min(this.height - d.p.h / 2, b.position.y));
    if (x !== b.position.x || y !== b.position.y) {
      Body.setPosition(b, { x, y });
      Body.setVelocity(b, { x: 0, y: 0 });
    }
    d.p.body.isSensor = false;
    this.dragging = null;
    this.quietFrames = 0;
    this.start();
  }

  // The bubble under (x, y), other than `except`.
  pillAt(x: number, y: number, except: HTMLElement | null): HTMLElement | null {
    for (const p of this.placed) {
      if (p.el === except) continue;
      if (Matter.Bounds.contains(p.body.bounds, { x, y }) && Matter.Vertices.contains(p.body.vertices, { x, y })) return p.el;
    }
    return null;
  }

  // A new bubble at (x, y). Its home is (x, y) too unless given, in which
  // case it floats there (a standby startup rising into an eaten one's
  // place). Neighbours are shoved aside, then settle around it.
  add(item: PillItem, x: number, y: number, home?: { x: number; y: number }): void {
    const clampX = (v: number) => Math.max(item.w / 2, Math.min(this.width - item.w / 2, v));
    const clampY = (v: number) => Math.max(item.h / 2, Math.min(this.height - item.h / 2, v));
    const cx = clampX(x);
    const cy = clampY(y);
    const p: Placed = { ...item, body: makeBody(item, cx, cy, 0.09), home: home ? { x: clampX(home.x), y: clampY(home.y) } : { x: cx, y: cy } };
    this.placed.push(p);
    Composite.add(this.engine.world, p.body);
    this.render();
    this.quietFrames = 0;
    this.start();
  }

  remove(el: HTMLElement): void {
    const p = this.find(el);
    if (!p) return;
    if (this.dragging?.p === p) this.dragging = null;
    Composite.remove(this.engine.world, p.body);
    this.placed.splice(this.placed.indexOf(p), 1);
  }

  // Swap a bubble's size (its name changed) in place.
  resize(el: HTMLElement, w: number, h: number): void {
    const p = this.find(el);
    if (!p) return;
    const { x, y } = p.body.position;
    Composite.remove(this.engine.world, p.body);
    p.w = w;
    p.h = h;
    p.body = makeBody(p, x, y, 0.09);
    Composite.add(this.engine.world, p.body);
    this.quietFrames = 0;
    this.start();
  }

  destroy(): void {
    this.stop();
    Engine.clear(this.engine);
  }
}

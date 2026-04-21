/**
 * pen-detector.js v1.0
 * Events: pendown(evt), penmove(evt), penup()
 * evt = { x, y, tool, pressure, velocity, metric, pointCount, radiusX, radiusY, radiusMag, bboxW, bboxH, bboxArea }
 * tool = 'penThin' | 'penThick' | 'eraser' | 'none'
 *
 * Options:
 *   element   — required DOM element
 *   mode      — 'ir' (Touch Events) | 'ink' (Pointer Events)
 *   thresholds — override default IR ranges
 *   smooth    — { xy: 0..1, pressure: 0..1 }  0=raw, 1=max smooth (default: xy=0.2, pressure=0.6)
 */
export const VERSION = '1.1';

const DEFAULTS = {
  penThin:  { min: 0,   max: 1.2 },
  penThick: { min: 1.2, max: 2.5 },
  eraser:   { min: 10,  max: 30  },
  // 2.5–10 = finger touch → 'none', not drawn
};

export class PenDetector {
  constructor({ element, mode = 'ir', thresholds, smooth = {} } = {}) {
    if (!element) throw new Error('PenDetector: element required');
    this._el   = element;
    this._mode = mode;
    this._thr  = Object.assign({}, DEFAULTS, thresholds);
    this._ev   = {};
    this._active     = new Set();
    this._b          = {};
    this._strokeTool = null;

    // Smoothing coefficients  (weight of the OLD value, 0=raw, 1=frozen)
    this._smXY = Math.max(0, Math.min(0.95, smooth.xy       ?? 0.2));
    this._smP  = Math.max(0, Math.min(0.95, smooth.pressure ?? 0.6));

    // EMA state (reset each stroke)
    this._sPos  = null;   // { x, y }
    this._velPos = null;  // { x, y, t }
    this._sP    = 0.5;   // smoothed pressure

    this._el.style.touchAction = 'none';
    mode === 'ir' ? this._initIR() : this._initInk();
  }

  // ── tiny event emitter ───────────────────────────────────────────────────
  on(e, fn)   { (this._ev[e] = this._ev[e] || []).push(fn); return this; }
  off(e, fn)  { if (this._ev[e]) this._ev[e] = this._ev[e].filter(h => h !== fn); return this; }
  _emit(e, d) { (this._ev[e] || []).slice().forEach(fn => fn(d)); }

  // ── IR (Touch Events) ────────────────────────────────────────────────────
  _initIR() {
    const o = { passive: false };
    this._b.ts = e => { e.preventDefault(); this._irHandle(e); };
    this._b.tm = e => { e.preventDefault(); this._irHandle(e); };
    this._b.te = e => {
      e.preventDefault();
      if (!e.touches.length) {
        this._strokeTool = null;
        this._sPos = null; this._velPos = null; this._sP = 0.5;
        this._emit('penup', {});
      }
    };
    this._el.addEventListener('touchstart',  this._b.ts, o);
    this._el.addEventListener('touchmove',   this._b.tm, o);
    this._el.addEventListener('touchend',    this._b.te, o);
    this._el.addEventListener('touchcancel', this._b.te, o);
  }

  _irHandle(e) {
    const ts = e.touches;
    if (!ts.length) return;
    const rect = this._el.getBoundingClientRect();

    let rSum = 0, cx = 0, cy = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of ts) {
      rSum += ((t.radiusX || 0) + (t.radiusY || 0)) / 2;
      const x = t.clientX - rect.left, y = t.clientY - rect.top;
      cx += x; cy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const n         = ts.length;
    const bboxW     = maxX - minX;
    const bboxH     = maxY - minY;
    const bboxArea  = bboxW * bboxH;
    const avgRadius = rSum / n;
    const metric    = avgRadius;
    const t0 = ts[0];
    const rx = t0.radiusX || 0, ry = t0.radiusY || 0;

    const x  = cx / n, y = cy / n;

    // Only classify and emit 'pendown' on the FIRST touch of a stroke.
    // Additional touchstart events (tilt, accidental finger) emit 'penmove'.
    const isFirst = e.type === 'touchstart' && this._strokeTool === null;
    if (isFirst) {
      this._strokeTool = this._classify(metric);
      this._sPos = null; this._velPos = null; this._sP = 0.5;
    }
    const tool = this._strokeTool || 'none';

    const { x: sx, y: sy } = this._smoothXY(x, y);
    const { pressure, velocity } = this._velPressure(x, y);

    this._emit(isFirst ? 'pendown' : 'penmove', {
      x: sx, y: sy, tool, pressure, velocity, metric,
      pointCount: n,
      radiusX: rx, radiusY: ry,
      radiusMag: Math.sqrt(rx * rx + ry * ry),
      bboxW, bboxH, bboxArea,
    });
  }

  // ── Ink (Pointer Events) ─────────────────────────────────────────────────
  _initInk() {
    this._b.pd = e => this._inkDown(e);
    this._b.pm = e => this._inkMove(e);
    this._b.pu = e => this._inkUp(e);
    this._el.addEventListener('pointerdown',   this._b.pd);
    this._el.addEventListener('pointermove',   this._b.pm);
    this._el.addEventListener('pointerup',     this._b.pu);
    this._el.addEventListener('pointercancel', this._b.pu);
  }

  _inkBuild(e) {
    const rect = this._el.getBoundingClientRect();
    const rawX = e.clientX - rect.left, rawY = e.clientY - rect.top;
    const { x, y } = this._smoothXY(rawX, rawY);
    const rawP = e.pressure || 0;
    this._sP = this._smP * this._sP + (1 - this._smP) * rawP;
    return { x, y, tool: this._strokeTool, pressure: this._sP, velocity: 0, metric: rawP, pointCount: 1 };
  }

  _inkDown(e) {
    if (e.pointerType !== 'pen') return;
    e.preventDefault();
    this._el.setPointerCapture(e.pointerId);
    this._active.add(e.pointerId);
    this._sPos = null; this._sP = e.pressure || 0;
    const isErase = (e.buttons & 32) !== 0;
    const p = e.pressure || 0;
    this._strokeTool = isErase ? 'eraser' : p > 0.45 ? 'penThick' : 'penThin';
    this._emit('pendown', this._inkBuild(e));
  }

  _inkMove(e) {
    if (e.pointerType !== 'pen' || !this._active.has(e.pointerId)) return;
    e.preventDefault();
    this._emit('penmove', this._inkBuild(e));
  }

  _inkUp(e) {
    if (e.pointerType !== 'pen') return;
    this._active.delete(e.pointerId);
    if (!this._active.size) {
      this._strokeTool = null;
      this._sPos = null; this._sP = 0.5;
      this._emit('penup', {});
    }
  }

  // ── smoothing helpers ────────────────────────────────────────────────────
  _smoothXY(x, y) {
    if (this._smXY === 0 || !this._sPos) {
      this._sPos = { x, y };
      return { x, y };
    }
    this._sPos.x = this._smXY * this._sPos.x + (1 - this._smXY) * x;
    this._sPos.y = this._smXY * this._sPos.y + (1 - this._smXY) * y;
    return { x: this._sPos.x, y: this._sPos.y };
  }

  // Velocity-based pressure: slow stroke = high pressure. Returns smoothed value.
  _velPressure(x, y) {
    const now = Date.now();
    let velocity = 0;
    if (this._velPos) {
      const dx = x - this._velPos.x, dy = y - this._velPos.y;
      const dt = Math.max(1, now - this._velPos.t);
      velocity = Math.sqrt(dx * dx + dy * dy) / dt; // px/ms
      const raw = 1 - Math.min(1, velocity / 3);
      this._sP = this._smP * this._sP + (1 - this._smP) * raw;
    }
    this._velPos = { x, y, t: now };
    return { pressure: this._sP, velocity };
  }

  // ── classification ───────────────────────────────────────────────────────
  _classify(m) {
    const t = this._thr;
    if (m >= t.penThin.min  && m <= t.penThin.max)  return 'penThin';
    if (m >= t.penThick.min && m <= t.penThick.max) return 'penThick';
    if (m >= t.eraser.min   && m <= t.eraser.max)   return 'eraser';
    return 'none';
  }

  // ── public API ───────────────────────────────────────────────────────────
  get thresholds() { return this._thr; }
  get mode()       { return this._mode; }

  setThresholds(thr) { Object.assign(this._thr, thr); return this; }

  /** Change smoothing at runtime. xy/pressure each 0 (raw) – 1 (max smooth). */
  setSmooth({ xy, pressure } = {}) {
    if (xy       !== undefined) this._smXY = Math.max(0, Math.min(0.95, xy));
    if (pressure !== undefined) this._smP  = Math.max(0, Math.min(0.95, pressure));
    return this;
  }

  destroy() {
    const el = this._el;
    if (this._mode === 'ir') {
      el.removeEventListener('touchstart',  this._b.ts);
      el.removeEventListener('touchmove',   this._b.tm);
      el.removeEventListener('touchend',    this._b.te);
      el.removeEventListener('touchcancel', this._b.te);
    } else {
      el.removeEventListener('pointerdown',   this._b.pd);
      el.removeEventListener('pointermove',   this._b.pm);
      el.removeEventListener('pointerup',     this._b.pu);
      el.removeEventListener('pointercancel', this._b.pu);
    }
  }
}

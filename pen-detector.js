/**
 * pen-detector.js v0.4 — minimal IR / Windows Ink detection
 * Events: pendown(evt), penmove(evt), penup()
 * evt = { x, y, tool, pressure, metric, pointCount }
 * tool = 'penThin' | 'penThick' | 'eraser' | 'none'
 */
export const VERSION = '0.7';

const DEFAULTS = {
  penThin:  { min: 0,    max: 1.2 },
  penThick: { min: 1.4,  max: 2.8 },
  eraser:   { min: 13,   max: 20  },
};

export class PenDetector {
  constructor({ element, mode = 'ir', thresholds } = {}) {
    if (!element) throw new Error('PenDetector: element required');
    this._el     = element;
    this._mode   = mode;
    this._thr    = Object.assign({}, DEFAULTS, thresholds);
    this._ev     = {};
    this._active = new Set(); // ink pointer ids
    this._b      = {};
    this._strokeTool = null; // locked tool for current stroke

    this._el.style.touchAction = 'none';
    mode === 'ir' ? this._initIR() : this._initInk();
  }

  // ── tiny event emitter ───────────────────────────────────────────────────
  on(e, fn)      { (this._ev[e] = this._ev[e] || []).push(fn); return this; }
  off(e, fn)     { if (this._ev[e]) this._ev[e] = this._ev[e].filter(h => h !== fn); return this; }
  _emit(e, d)    { (this._ev[e] || []).slice().forEach(fn => fn(d)); }

  // ── IR (Touch Events) ────────────────────────────────────────────────────
  _initIR() {
    const o = { passive: false };
    this._b.ts = e => { e.preventDefault(); this._irHandle(e); };
    this._b.tm = e => { e.preventDefault(); this._irHandle(e); };
    this._b.te = e => { e.preventDefault(); if (!e.touches.length) { this._strokeTool = null; this._emit('penup', {}); } };
    this._el.addEventListener('touchstart',  this._b.ts, o);
    this._el.addEventListener('touchmove',   this._b.tm, o);
    this._el.addEventListener('touchend',    this._b.te, o);
    this._el.addEventListener('touchcancel', this._b.te, o);
  }

  _irHandle(e) {
    const ts   = e.touches;
    if (!ts.length) return;
    const rect = this._el.getBoundingClientRect();

    // Centroid + avg radius + bounding box — all in one pass
    let rSum = 0, cx = 0, cy = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of ts) {
      rSum += ((t.radiusX || 0) + (t.radiusY || 0)) / 2;
      const x = t.clientX - rect.left, y = t.clientY - rect.top;
      cx += x; cy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const n       = ts.length;
    const bboxW   = maxX - minX;
    const bboxH   = maxY - minY;
    const bboxArea = bboxW * bboxH;          // px² — spread of all contacts
    const avgRadius = rSum / n;              // avg (rX+rY)/2 per touch point

    // Use avgRadius as classification metric (swap for bboxArea if screen reports fixed radius)
    const metric = avgRadius;
    const t0  = ts[0];
    const rx  = t0.radiusX || 0;
    const ry  = t0.radiusY || 0;

    // Lock tool ONLY on the very first contact of the stroke.
    // Tilt adds new touch points → fires more touchstart events → must NOT re-classify.
    if (e.type === 'touchstart' && this._strokeTool === null) {
      this._strokeTool = this._classify(metric);
    }
    const tool = this._strokeTool || 'none';

    this._emit(e.type === 'touchstart' ? 'pendown' : 'penmove', {
      x: cx / n,
      y: cy / n,
      tool,
      pressure:   this._pressure(metric, tool),
      metric,
      pointCount: n,
      radiusX:    rx,
      radiusY:    ry,
      radiusMag:  Math.sqrt(rx * rx + ry * ry),
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
    const p    = e.pressure || 0;
    return {
      x: e.clientX - rect.left, y: e.clientY - rect.top,
      tool:       this._strokeTool,
      pressure:   p,
      metric:     p,
      pointCount: 1,
    };
  }

  _inkDown(e) {
    if (e.pointerType !== 'pen') return;
    e.preventDefault();
    this._el.setPointerCapture(e.pointerId);
    this._active.add(e.pointerId);
    // Lock tool at stroke start
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
    if (!this._active.size) { this._strokeTool = null; this._emit('penup', {}); }
  }

  // ── helpers ──────────────────────────────────────────────────────────────
  _classify(m) {
    const t = this._thr;
    if (m >= t.penThin.min  && m <= t.penThin.max)  return 'penThin';
    if (m >= t.penThick.min && m <= t.penThick.max) return 'penThick';
    if (m >= t.eraser.min   && m <= t.eraser.max)   return 'eraser';
    return 'none';
  }

  _pressure(m, tool) {
    const t = this._thr[tool];
    if (!t || t.max <= t.min) return 0;
    return Math.max(0, Math.min(1, (m - t.min) / (t.max - t.min)));
  }

  // ── public API ───────────────────────────────────────────────────────────
  get thresholds() { return this._thr; }
  get mode()       { return this._mode; }

  setThresholds(thr) { Object.assign(this._thr, thr); return this; }

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

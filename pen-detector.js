/**
 * pen-detector.js v2.0 — IR touchscreen pen detection
 * Events: pendown(evt), penmove(evt), penup()
 * evt = { x, y, tool, pressure, velocity, metric, pointCount,
 *         radiusX, radiusY, radiusMag, bboxW, bboxH, bboxArea }
 * tool = 'penThin' | 'penThick' | 'eraser' | 'none'
 *
 * Options:
 *   element    — required DOM element
 *   thresholds — { penThin, penThick, eraser } range overrides
 *   smooth     — { xy: 0..1, pressure: 0..1 }  (default xy=0.2, pressure=0.6)
 */
export const VERSION = '2.0';

const DEFAULTS = {
  penThin:  { min: 0,   max: 1.2 },
  penThick: { min: 1.2, max: 2.5 },
  eraser:   { min: 10,  max: 30  },
  // 2.5–10 = finger → 'none'
};

export class PenDetector {
  constructor({ element, thresholds, smooth = {} } = {}) {
    if (!element) throw new Error('PenDetector: element required');
    this._el  = element;
    this._thr = Object.assign({}, DEFAULTS, thresholds);
    this._ev  = {};
    this._b   = {};
    this._strokeTool = null;
    this._trackId    = null;

    this._smXY = Math.max(0, Math.min(0.95, smooth.xy       ?? 0.2));
    this._smP  = Math.max(0, Math.min(0.95, smooth.pressure ?? 0.6));
    this._sPos   = null;
    this._velPos = null;
    this._sP     = 0.5;

    this._el.style.touchAction = 'none';
    this._init();
  }

  // ── event emitter ────────────────────────────────────────────────────────
  on(e, fn)   { (this._ev[e] = this._ev[e] || []).push(fn); return this; }
  off(e, fn)  { if (this._ev[e]) this._ev[e] = this._ev[e].filter(h => h !== fn); return this; }
  _emit(e, d) { (this._ev[e] || []).slice().forEach(fn => fn(d)); }

  // ── touch listeners ───────────────────────────────────────────────────────
  _init() {
    const o = { passive: false };
    this._b.ts = e => { e.preventDefault(); this._handle(e); };
    this._b.tm = e => { e.preventDefault(); this._handle(e); };
    this._b.te = e => {
      e.preventDefault();
      const trackedLifted = this._trackId !== null &&
        Array.from(e.changedTouches).some(t => t.identifier === this._trackId);
      if (!e.touches.length || trackedLifted) {
        this._strokeTool = null; this._trackId = null;
        this._sPos = null; this._velPos = null; this._sP = 0.5;
        this._emit('penup', {});
      }
    };
    this._el.addEventListener('touchstart',  this._b.ts, o);
    this._el.addEventListener('touchmove',   this._b.tm, o);
    this._el.addEventListener('touchend',    this._b.te, o);
    this._el.addEventListener('touchcancel', this._b.te, o);
  }

  _handle(e) {
    const ts = e.touches;
    if (!ts.length) return;
    const rect = this._el.getBoundingClientRect();

    // Full-contact stats for debug / calibration
    let rSum = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of ts) {
      rSum += ((t.radiusX || 0) + (t.radiusY || 0)) / 2;
      const tx = t.clientX - rect.left, ty = t.clientY - rect.top;
      if (tx < minX) minX = tx; if (tx > maxX) maxX = tx;
      if (ty < minY) minY = ty; if (ty > maxY) maxY = ty;
    }
    const n      = ts.length;
    const bboxW  = maxX - minX, bboxH = maxY - minY;
    const metric = rSum / n;

    // Classify and lock touch ID only on the very first contact
    const isFirst = e.type === 'touchstart' && this._strokeTool === null;
    if (isFirst) {
      this._strokeTool = this._classify(metric);
      this._trackId    = ts[0].identifier;
      this._sPos = null; this._velPos = null; this._sP = 0.5;
    }

    // Palm rejection: follow only the locked touch ID
    const tracked = Array.from(ts).find(t => t.identifier === this._trackId) || ts[0];
    const rx   = tracked.radiusX || 0, ry = tracked.radiusY || 0;
    const rawX = tracked.clientX - rect.left, rawY = tracked.clientY - rect.top;

    const { x, y }           = this._smoothXY(rawX, rawY);
    const { pressure, velocity } = this._velPressure(rawX, rawY);

    this._emit(isFirst ? 'pendown' : 'penmove', {
      x, y,
      tool: this._strokeTool || 'none',
      pressure, velocity, metric,
      pointCount: n,
      radiusX: rx, radiusY: ry,
      radiusMag: Math.sqrt(rx * rx + ry * ry),
      bboxW, bboxH, bboxArea: bboxW * bboxH,
    });
  }

  // ── smoothing ─────────────────────────────────────────────────────────────
  _smoothXY(x, y) {
    if (!this._smXY || !this._sPos) { this._sPos = { x, y }; return { x, y }; }
    this._sPos.x = this._smXY * this._sPos.x + (1 - this._smXY) * x;
    this._sPos.y = this._smXY * this._sPos.y + (1 - this._smXY) * y;
    return { x: this._sPos.x, y: this._sPos.y };
  }

  _velPressure(x, y) {
    const now = Date.now();
    let velocity = 0;
    if (this._velPos) {
      const dx = x - this._velPos.x, dy = y - this._velPos.y;
      const dt = Math.max(1, now - this._velPos.t);
      velocity = Math.sqrt(dx * dx + dy * dy) / dt;
      const raw = 1 - Math.min(1, velocity / 3);
      this._sP = this._smP * this._sP + (1 - this._smP) * raw;
    }
    this._velPos = { x, y, t: now };
    return { pressure: this._sP, velocity };
  }

  // ── classification ────────────────────────────────────────────────────────
  _classify(m) {
    const t = this._thr;
    if (m >= t.penThin.min  && m <= t.penThin.max)  return 'penThin';
    if (m >= t.penThick.min && m <= t.penThick.max) return 'penThick';
    if (m >= t.eraser.min   && m <= t.eraser.max)   return 'eraser';
    return 'none';
  }

  // ── public API ────────────────────────────────────────────────────────────
  get thresholds() { return this._thr; }

  setThresholds(thr) { Object.assign(this._thr, thr); return this; }

  setSmooth({ xy, pressure } = {}) {
    if (xy       !== undefined) this._smXY = Math.max(0, Math.min(0.95, xy));
    if (pressure !== undefined) this._smP  = Math.max(0, Math.min(0.95, pressure));
    return this;
  }

  destroy() {
    this._el.removeEventListener('touchstart',  this._b.ts);
    this._el.removeEventListener('touchmove',   this._b.tm);
    this._el.removeEventListener('touchend',    this._b.te);
    this._el.removeEventListener('touchcancel', this._b.te);
  }
}

import { EventEmitter } from '../EventEmitter.js';

// Pressure thresholds for Ink tool classification
const DEFAULT_PRESSURE_THRESHOLDS = {
  penThin:  { min: 0,    max: 0.45 },
  penThick: { min: 0.45, max: 1.0  },
};

export class InkDetector extends EventEmitter {
  constructor(element, options = {}) {
    super();
    this._el      = element;
    this._pThr    = { ...DEFAULT_PRESSURE_THRESHOLDS, ...(options.pressureThresholds || {}) };
    this._last    = null;
    this._active  = new Set(); // active pointerIds
    this._prevTool = null;

    this._bound = {
      down:   e => this._onDown(e),
      move:   e => this._onMove(e),
      up:     e => this._onUp(e),
      cancel: e => this._onUp(e),
    };
    this._el.style.touchAction = 'none';
    this._attach();
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  _attach() {
    this._el.addEventListener('pointerdown',   this._bound.down);
    this._el.addEventListener('pointermove',   this._bound.move);
    this._el.addEventListener('pointerup',     this._bound.up);
    this._el.addEventListener('pointercancel', this._bound.cancel);
  }

  _isEraser(e) {
    // Eraser button (bit 5) or some hardware marks eraser tip as buttons=32
    return (e.buttons & 32) !== 0;
  }

  _classifyTool(pressure, isEraser) {
    if (isEraser) return 'eraser';
    if (pressure <= this._pThr.penThin.max) return 'penThin';
    return 'penThick';
  }

  _motion(x, y, now) {
    if (!this._last) return { dx: 0, dy: 0, vx: 0, vy: 0, speed: 0, direction: 0 };
    const dt = Math.max(now - this._last.time, 0.001);
    const dx = x - this._last.x;
    const dy = y - this._last.y;
    const vx = dx / dt;
    const vy = dy / dt;
    return {
      dx, dy, vx, vy,
      speed:     Math.sqrt(vx * vx + vy * vy),
      direction: Math.atan2(dy, dx) * 180 / Math.PI,
    };
  }

  _build(e, type) {
    const rect     = this._el.getBoundingClientRect();
    const x        = e.clientX - rect.left;
    const y        = e.clientY - rect.top;
    const pressure = e.pressure || 0;
    const isEraser = this._isEraser(e);
    const tool     = this._classifyTool(pressure, isEraser);
    const tiltX    = e.tiltX || 0;
    const tiltY    = e.tiltY || 0;
    const now      = performance.now();
    const motion   = this._motion(x, y, now);

    // tiltMagnitude: 0 = perpendicular, 1 = fully flat (90° tilt)
    const tiltMagnitude = Math.min(1, Math.sqrt(tiltX * tiltX + tiltY * tiltY) / 90);
    const tiltAngle     = Math.atan2(tiltY, tiltX) * 180 / Math.PI; // -180..180

    this._last = { x, y, time: now };

    return {
      type,
      // Position
      x, y,
      ...motion,           // dx, dy, vx, vy, speed, direction
      // Tool
      tool,
      pressure,            // 0..1, native from hardware
      // Tilt
      tiltX,               // -90..90 degrees
      tiltY,               // -90..90 degrees
      tiltMagnitude,       // 0..1
      tiltAngle,           // degrees
      // Contact info
      pointCount: 1,
      bbox: null,          // not applicable for Ink
      // Meta
      source:    'ink',
      timestamp: now,
      // Raw hardware values
      raw: {
        pressure,
        tiltX,
        tiltY,
        twist:     e.twist     || 0,   // 0..359° barrel rotation
        width:     e.width     || 0,   // contact width (px)
        height:    e.height    || 0,   // contact height (px)
        pointerId: e.pointerId,
        buttons:   e.buttons,
      },
    };
  }

  // ─── Event handlers ──────────────────────────────────────────────────────

  _onDown(e) {
    if (e.pointerType !== 'pen') return;
    e.preventDefault();
    this._el.setPointerCapture(e.pointerId);
    this._active.add(e.pointerId);

    const evt = this._build(e, 'start');
    this.emit('pendown', evt);

    if (evt.tool !== this._prevTool) {
      this._prevTool = evt.tool;
      this.emit('tool:change', { tool: evt.tool, metric: evt.pressure });
    }
  }

  _onMove(e) {
    if (e.pointerType !== 'pen' || !this._active.has(e.pointerId)) return;
    e.preventDefault();

    const evt = this._build(e, 'move');
    this.emit('penmove', evt);

    if (evt.tool !== this._prevTool) {
      this._prevTool = evt.tool;
      this.emit('tool:change', { tool: evt.tool, metric: evt.pressure });
    }
  }

  _onUp(e) {
    if (e.pointerType !== 'pen') return;
    this._active.delete(e.pointerId);
    if (this._active.size === 0) {
      this._last     = null;
      this._prevTool = null;
      this.emit('penup', { type: 'end', source: 'ink', timestamp: performance.now() });
    }
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  destroy() {
    this._el.removeEventListener('pointerdown',   this._bound.down);
    this._el.removeEventListener('pointermove',   this._bound.move);
    this._el.removeEventListener('pointerup',     this._bound.up);
    this._el.removeEventListener('pointercancel', this._bound.cancel);
  }
}

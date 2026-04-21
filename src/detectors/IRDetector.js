import { EventEmitter }       from '../EventEmitter.js';
import { ThresholdClassifier, DEFAULT_IR_THRESHOLDS } from '../classifiers/ThresholdClassifier.js';
import { CalibrationSession } from '../calibration/CalibrationSession.js';
import { CalibrationStore }   from '../calibration/CalibrationStore.js';

export class IRDetector extends EventEmitter {
  constructor(element, options = {}) {
    super();
    this._el   = element;
    this._last = null; // { x, y, time }

    const stored = new CalibrationStore(options.storageKey).load();
    this._classifier = new ThresholdClassifier(
      options.thresholds || stored || DEFAULT_IR_THRESHOLDS
    );
    this._calSession = new CalibrationSession(options.tolerance ?? 0.2);
    this._calStore   = new CalibrationStore(options.storageKey);
    this._prevTool   = null;

    this._bound = {
      start:  e => this._handle(e, 'start'),
      move:   e => this._handle(e, 'move'),
      end:    e => this._handleEnd(e),
      cancel: e => this._handleEnd(e),
    };
    this._attach();
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  _attach() {
    const o = { passive: false };
    this._el.addEventListener('touchstart',  this._bound.start,  o);
    this._el.addEventListener('touchmove',   this._bound.move,   o);
    this._el.addEventListener('touchend',    this._bound.end,    o);
    this._el.addEventListener('touchcancel', this._bound.cancel, o);
  }

  // Average (radiusX + radiusY)/2 across all touches → classification metric
  _metric(touches) {
    if (!touches.length) return 0;
    let sum = 0;
    for (const t of touches) sum += ((t.radiusX || 0) + (t.radiusY || 0)) / 2;
    return sum / touches.length;
  }

  // Centroid of all touch positions (canvas-relative)
  _centroid(touches, rect) {
    let sx = 0, sy = 0;
    for (const t of touches) { sx += t.clientX - rect.left; sy += t.clientY - rect.top; }
    return { x: sx / touches.length, y: sy / touches.length };
  }

  // Bounding box of all touch positions
  _bbox(touches, rect) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const t of touches) {
      const x = t.clientX - rect.left, y = t.clientY - rect.top;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  // Touch with the largest average radius → most relevant for tilt
  // Array.from() required: TouchList has no .reduce()
  _primary(touches) {
    return Array.from(touches).reduce((best, t) => {
      const r = ((t.radiusX || 0) + (t.radiusY || 0)) / 2;
      const b = ((best.radiusX || 0) + (best.radiusY || 0)) / 2;
      return r > b ? t : best;
    }, touches[0]);
  }

  // Tilt derived from the shape of the contact ellipse
  // If radiusY >> radiusX the pen is tilted toward the Y axis, etc.
  _tilt(touch) {
    const rx  = touch.radiusX || 0;
    const ry  = touch.radiusY || 0;
    const max = Math.max(rx, ry, 0.001);

    // How elongated the ellipse is (0 = circle/perpendicular, 1 = fully flat)
    const tiltMagnitude = Math.abs(rx - ry) / max;

    // rotationAngle: degrees the major axis deviates from the X axis (0..90)
    const tiltAngle = touch.rotationAngle || 0;
    const rad       = tiltAngle * Math.PI / 180;

    // Project onto X/Y axes in degrees (-90..90)
    const tiltX = tiltMagnitude * Math.cos(rad) * 90;
    const tiltY = tiltMagnitude * Math.sin(rad) * 90;

    return { tiltX, tiltY, tiltMagnitude, tiltAngle };
  }

  // Velocity, delta and direction since last event
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
      direction: Math.atan2(dy, dx) * 180 / Math.PI, // -180..180
    };
  }

  _build(touches, type) {
    if (!touches.length) return null;
    const rect     = this._el.getBoundingClientRect();
    const metric   = this._metric(touches);
    const tool     = this._classifier.classify(metric);
    const pressure = this._classifier.normalizePressure(metric, tool);
    const { x, y } = this._centroid(touches, rect);
    const primary  = this._primary(touches);
    const tilt     = this._tilt(primary);
    const now      = performance.now();
    const motion   = this._motion(x, y, now);
    const bbox     = this._bbox(touches, rect);

    this._last = { x, y, time: now };

    return {
      type,
      // Position
      x, y,
      ...motion,           // dx, dy, vx, vy, speed, direction
      // Tool
      tool,
      pressure,            // 0..1, normalized from radiusXY
      // Tilt (from ellipse shape)
      tiltX:         tilt.tiltX,
      tiltY:         tilt.tiltY,
      tiltMagnitude: tilt.tiltMagnitude,  // 0..1
      tiltAngle:     tilt.tiltAngle,      // degrees, rotation of contact ellipse
      // Contact info
      pointCount: touches.length,
      bbox,                // { x, y, w, h } bounding box of all contacts
      // Meta
      source:    'ir',
      timestamp: now,
      // Raw hardware values — for custom processing
      raw: {
        metric,
        radiusX:       primary.radiusX || 0,
        radiusY:       primary.radiusY || 0,
        rotationAngle: primary.rotationAngle || 0,
        touches: Array.from(touches).map(t => ({
          id:      t.identifier,
          x:       t.clientX - rect.left,
          y:       t.clientY - rect.top,
          radiusX: t.radiusX || 0,
          radiusY: t.radiusY || 0,
        })),
      },
    };
  }

  // ─── Event handlers ──────────────────────────────────────────────────────

  _handle(e, type) {
    e.preventDefault();
    if (!e.touches.length) return;

    const evt = this._build(e.touches, type);
    if (!evt) return;

    // Calibration mode — record reading, don't draw
    if (this._calSession.isActive) {
      const reading = this._calSession.record(evt.raw.metric);
      if (reading) this.emit('calibration:reading', reading);
      return;
    }

    const eventName = type === 'start' ? 'pendown' : 'penmove';
    this.emit(eventName, evt);

    // Notify tool change
    if (evt.tool !== this._prevTool) {
      this._prevTool = evt.tool;
      this.emit('tool:change', { tool: evt.tool, metric: evt.raw.metric });
    }
  }

  _handleEnd(e) {
    e.preventDefault();
    if (e.touches.length > 0) return; // still has other touches
    this._last     = null;
    this._prevTool = null;
    this.emit('penup', { type: 'end', source: 'ir', timestamp: performance.now() });
  }

  // ─── Calibration API ─────────────────────────────────────────────────────

  startCalibration(tool) {
    this._calSession.start(tool);
    this.emit('calibration:start', { tool });
    return this;
  }

  stopCalibration() {
    const result = this._calSession.finish();
    if (result) {
      this._classifier.setThreshold(result.tool, result.min, result.max);
      this._calStore.save(this._classifier.thresholds);
      this.emit('calibration:done', result);
    }
    return result;
  }

  cancelCalibration() {
    this._calSession.cancel();
    this.emit('calibration:cancel');
    return this;
  }

  // ─── Threshold API ───────────────────────────────────────────────────────

  get thresholds() { return this._classifier.thresholds; }

  setThresholds(thresholds) {
    Object.entries(thresholds).forEach(([tool, range]) => {
      this._classifier.setThreshold(tool, range.min, range.max);
    });
    this._calStore.save(this._classifier.thresholds);
    return this;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  destroy() {
    this._el.removeEventListener('touchstart',  this._bound.start);
    this._el.removeEventListener('touchmove',   this._bound.move);
    this._el.removeEventListener('touchend',    this._bound.end);
    this._el.removeEventListener('touchcancel', this._bound.cancel);
  }
}

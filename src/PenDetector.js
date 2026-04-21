import { IRDetector }  from './detectors/IRDetector.js';
import { InkDetector } from './detectors/InkDetector.js';

/**
 * PenDetector — unified IR / Windows Ink detection library
 *
 * Events emitted:
 *   pendown  (PenEvent)  — first contact
 *   penmove  (PenEvent)  — movement while in contact
 *   penup    ({source, timestamp}) — contact ended
 *   tool:change ({tool, metric}) — tool type changed mid-stroke
 *
 *   calibration:start   ({tool})         — IR only
 *   calibration:reading ({tool, current, min, max, count, preview})
 *   calibration:done    ({tool, min, max, readings})
 *   calibration:cancel  ()
 *
 * PenEvent fields:
 *   x, y           — canvas-relative position (px)
 *   dx, dy         — delta from previous point (px)
 *   vx, vy         — velocity (px/ms)
 *   speed          — velocity magnitude (px/ms)
 *   direction      — movement angle in degrees (-180..180)
 *   tool           — 'penThin' | 'penThick' | 'eraser' | 'none'
 *   pressure       — 0..1 (radiusXY normalized for IR, native for Ink)
 *   tiltX          — -90..90 degrees
 *   tiltY          — -90..90 degrees
 *   tiltMagnitude  — 0..1 (0=perpendicular, 1=flat)
 *   tiltAngle      — degrees, direction of tilt / ellipse rotation
 *   pointCount     — simultaneous touch points (IR: 1–40, Ink: always 1)
 *   bbox           — { x, y, w, h } bounding box of all contacts (IR only)
 *   source         — 'ir' | 'ink'
 *   timestamp      — performance.now()
 *   raw            — original hardware values
 */
export class PenDetector {
  constructor(options = {}) {
    const { element, mode = 'ir', ...rest } = options;
    if (!element) throw new Error('PenDetector: element is required');
    if (mode !== 'ir' && mode !== 'ink') {
      throw new Error('PenDetector: mode must be "ir" or "ink"');
    }
    this._mode     = mode;
    this._detector = mode === 'ir'
      ? new IRDetector(element, rest)
      : new InkDetector(element, rest);
  }

  on(event, fn)  { this._detector.on(event, fn);  return this; }
  off(event, fn) { this._detector.off(event, fn); return this; }

  // ─── Calibration (IR only) ───────────────────────────────────────────────

  startCalibration(tool) {
    if (this._mode !== 'ir') { console.warn('PenDetector: calibration only in IR mode'); return this; }
    this._detector.startCalibration(tool);
    return this;
  }

  stopCalibration() {
    return this._mode === 'ir' ? this._detector.stopCalibration() : null;
  }

  cancelCalibration() {
    if (this._mode === 'ir') this._detector.cancelCalibration();
    return this;
  }

  // ─── Thresholds (IR only) ────────────────────────────────────────────────

  setThresholds(thresholds) {
    if (this._mode === 'ir') this._detector.setThresholds(thresholds);
    return this;
  }

  get thresholds() {
    return this._mode === 'ir' ? this._detector.thresholds : null;
  }

  // ─── Info ────────────────────────────────────────────────────────────────

  get mode() { return this._mode; }

  destroy() { this._detector.destroy(); }
}

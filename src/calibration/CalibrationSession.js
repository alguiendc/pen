export class CalibrationSession {
  constructor(tolerance = 0.2) {
    this.tolerance = tolerance;
    this._tool  = null;
    this._min   = Infinity;
    this._max   = -Infinity;
    this._count = 0;
  }

  get isActive() { return !!this._tool; }
  get tool()     { return this._tool; }
  get count()    { return this._count; }

  start(tool) {
    this._tool  = tool;
    this._min   = Infinity;
    this._max   = -Infinity;
    this._count = 0;
  }

  // Returns live reading snapshot, or null if not active
  record(metric) {
    if (!this._tool) return null;
    if (metric < this._min) this._min = metric;
    if (metric > this._max) this._max = metric;
    this._count++;
    return {
      tool:    this._tool,
      current: metric,
      min:     this._min,
      max:     this._max,
      count:   this._count,
      // Preview of what would be saved (with tolerance)
      preview: {
        min: Math.max(0, parseFloat((this._min - this.tolerance).toFixed(2))),
        max: parseFloat((this._max + this.tolerance).toFixed(2)),
      },
    };
  }

  // Returns the final threshold range to save, or null if no readings
  finish() {
    if (!this._tool || this._count === 0) { this.cancel(); return null; }
    const result = {
      tool:     this._tool,
      min:      Math.max(0, parseFloat((this._min - this.tolerance).toFixed(2))),
      max:      parseFloat((this._max + this.tolerance).toFixed(2)),
      readings: this._count,
    };
    this.cancel();
    return result;
  }

  cancel() {
    this._tool  = null;
    this._min   = Infinity;
    this._max   = -Infinity;
    this._count = 0;
  }
}

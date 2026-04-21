export const DEFAULT_IR_THRESHOLDS = {
  penThin:  { min: 0,    max: 1.2 },
  penThick: { min: 1.4,  max: 2.8 },
  eraser:   { min: 13,   max: 20  },
};

export const DEFAULT_INK_THRESHOLDS = {
  penThin:  { min: 0,    max: 0.45 },
  penThick: { min: 0.45, max: 1.0  },
  eraser:   { min: -1,   max: -1   }, // handled via eraser button
};

export class ThresholdClassifier {
  constructor(thresholds) {
    this.thresholds = { ...DEFAULT_IR_THRESHOLDS, ...thresholds };
  }

  classify(metric) {
    const t = this.thresholds;
    if (metric >= t.penThin.min  && metric <= t.penThin.max)  return 'penThin';
    if (metric >= t.penThick.min && metric <= t.penThick.max) return 'penThick';
    if (metric >= t.eraser.min   && metric <= t.eraser.max)   return 'eraser';
    return 'none';
  }

  // Normalize metric to 0..1 within its tool's range
  normalizePressure(metric, tool) {
    const t = this.thresholds[tool];
    if (!t || t.max <= t.min) return 0;
    return Math.max(0, Math.min(1, (metric - t.min) / (t.max - t.min)));
  }

  setThreshold(tool, min, max) {
    this.thresholds[tool] = { min, max };
  }
}

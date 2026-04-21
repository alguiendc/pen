export class CalibrationStore {
  constructor(key = 'pen-detector-thresholds') {
    this.key = key;
  }

  load() {
    try {
      const data = JSON.parse(localStorage.getItem(this.key));
      if (data?.penThin && data?.penThick && data?.eraser) return data;
    } catch {}
    return null;
  }

  save(thresholds) {
    try { localStorage.setItem(this.key, JSON.stringify(thresholds)); } catch {}
  }

  clear() {
    try { localStorage.removeItem(this.key); } catch {}
  }
}

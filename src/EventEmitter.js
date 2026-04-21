export class EventEmitter {
  constructor() { this._h = {}; }

  on(event, fn) {
    (this._h[event] = this._h[event] || []).push(fn);
    return this;
  }

  off(event, fn) {
    if (this._h[event]) this._h[event] = this._h[event].filter(h => h !== fn);
    return this;
  }

  emit(event, data) {
    (this._h[event] || []).slice().forEach(fn => fn(data));
  }
}

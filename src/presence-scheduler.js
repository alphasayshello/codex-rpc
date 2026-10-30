// Our conservative local publishing policy, not a claim about Discord limits:
// one steady update per interval, with a small bounded reserve for transitions.
export class PresenceScheduler {
  constructor({ now = Date.now, intervalMs = 15000, capacity = 2 } = {}) {
    this.now = now;
    this.intervalMs = intervalMs;
    this.capacity = capacity;
    this.validatePolicy();
    this.reset();
  }
  validatePolicy() {
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 15000)
      throw new Error("Presence interval must be at least 15000ms");
    if (!Number.isInteger(this.capacity) || this.capacity < 1 || this.capacity > 4)
      throw new Error("Presence burst capacity must be between 1 and 4");
  }
  setPolicy({ intervalMs = this.intervalMs, capacity = this.capacity } = {}) {
    this.refill();
    const old = { intervalMs: this.intervalMs, capacity: this.capacity };
    this.intervalMs = intervalMs;
    this.capacity = capacity;
    try { this.validatePolicy(); } catch (error) { Object.assign(this, old); throw error; }
    this.tokens = Math.min(this.tokens, this.capacity);
  }
  reset() {
    this.generation = (this.generation || 0) + 1;
    this.tokens = this.capacity;
    this.refilledAt = this.now();
    this.lastAttemptAt = -Infinity;
    this.acknowledged = undefined;
    this.acknowledgedMajor = undefined;
    this.pending = null;
  }
  refill() {
    const now = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.refilledAt) / this.intervalMs);
    this.refilledAt = Math.max(this.refilledAt, now);
  }
  update(payload, majorKey = "") {
    const encoded = JSON.stringify(payload);
    // A new observation replaces the whole buffer; there is no stale queue.
    this.pending = { payload, encoded, majorKey };
    if (!this.inFlight && encoded === this.acknowledged) this.pending = null;
  }
  async flush(send) {
    if (this.inFlight || !this.pending) return false;
    const candidate = this.pending;
    if (candidate.encoded === this.acknowledged) { this.pending = null; return false; }
    this.refill();
    const clearing = candidate.payload === null;
    const major = this.acknowledged === undefined || candidate.majorKey !== this.acknowledgedMajor;
    if (!clearing && (this.tokens < 1 || (!major && this.now() - this.lastAttemptAt < this.intervalMs))) return false;
    if (!clearing) this.tokens = Math.max(0, this.tokens - 1);
    this.lastAttemptAt = this.now();
    const generation = this.generation;
    // Start in a microtask so synchronous send failures follow the same path.
    const attempt = Promise.resolve().then(() => send(candidate.payload));
    this.inFlight = attempt;
    try {
      await attempt;
      if (generation === this.generation) {
        this.acknowledged = candidate.encoded;
        this.acknowledgedMajor = candidate.majorKey;
        if (this.pending === candidate) this.pending = null;
      }
      return true;
    } finally {
      if (this.inFlight === attempt) this.inFlight = null;
    }
  }
  async clear(send) {
    this.update(null, "clear");
    // Stop can arrive while an activity is awaiting its ACK. Clear after it,
    // including after failure, so an older publish cannot overtake the clear.
    if (this.inFlight) await this.inFlight.catch(() => {});
    return this.flush(send);
  }
}

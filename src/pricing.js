// USD per million tokens. Legacy model snapshots, not subscription billing.
// See README pricing provenance; update or override when rates change.
export const PRICES = Object.freeze({
  o3: [2, 8, 0.5],
  "o4-mini": [1.1, 4.4, 0.275],
  "gpt-5": [1.25, 10, 0.125],
  "codex-mini-latest": [1.5, 6, 0.375],
  "gpt-5-codex": [1.25, 10, 0.125],
  "gpt-5.3-codex": [1.75, 14, 0.175],
  "gpt-6.1-sol": [2, 10, 0.1],
  "gpt-6.1-terra": [1, 5, 0.05],
});
export function modelPrice(model, overrides = {}) {
  const rates = { ...PRICES, ...overrides };
  return (
    rates[model] ||
    Object.entries(rates)
      .sort((a, b) => b[0].length - a[0].length)
      .find(([k]) => model?.startsWith(k + "-"))?.[1] ||
    null
  );
}
export function estimateCost(model, usage, overrides) {
  const p = modelPrice(model, overrides);
  if (!p) return null;
  const input = Math.max(0, Number(usage.input) || 0),
    cached = Math.min(input, Math.max(0, Number(usage.cached) || 0));
  // Reasoning is a subset of output, never charge it twice.
  return (
    ((input - cached) * p[0] +
      (Number(usage.output) || 0) * p[1] +
      cached * p[2]) /
    1e6
  );
}

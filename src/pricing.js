// USD per million tokens; includes owner-supplied estimates, not subscription billing.
// Extended model rates are not independently verified OpenAI prices.
// See README pricing provenance; update or override when rates change.
export const PRICES = Object.freeze({
  // --- Daybreak Specialized & Security Tiers ---
  "daybreak-blue": [4, 20, 0.4],
  "gpt-daybreak-blue-latest": [4, 20, 0.4],
  "daybreak-red": [12.5, 75, 1.25],
  "gpt-daybreak-red-latest": [12.5, 75, 1.25],
  "gpt-5.6-cyber": [12.5, 75, 1.25],

  // --- GPT-6 Series ---
  "gpt-6-astra": [10, 50, 1.0],
  "gpt-6-sol": [2, 10, 0.2],
  "gpt-6.1-sol": [2, 10, 0.1],
  "gpt-6.1-terra": [1, 5, 0.05],
  "gpt-6-luna": [0.1, 0.5, 0.01],

  // --- GPT-5.6 & Mid-Generations ---
  "gpt-5.6": [4, 20, 0.4],
  "gpt-5.6-sol": [4, 20, 0.4],
  "gpt-5.6-terra": [2, 12, 0.2],
  "gpt-5.6-luna": [0.2, 1.2, 0.02],
  "gpt-5.5": [5, 30, 0.5],
  "gpt-5.4": [2.5, 15, 0.25],
  "gpt-5.4-mini": [0.75, 4.5, 0.075],
  "gpt-5.4-nano": [0.2, 1.25, 0.02],
  "gpt-5.2": [1.75, 14, 0.175],
  "gpt-5.1": [1.25, 10, 0.125],
  "gpt-5": [1.25, 10, 0.125],
  "gpt-5-mini": [0.25, 2, 0.025],
  "gpt-5-nano": [0.05, 0.4, 0.005],
  "gpt-5-pro": [15, 120, 1.5],

  // --- Codex & Agentic Coding Models ---
  "codex-mini-latest": [1.5, 6, 0.375],
  "gpt-5.3-codex": [1.75, 14, 0.175],
  "gpt-5.2-codex": [1.75, 14, 0.175],
  "gpt-5.1-codex-max": [1.25, 10, 0.125],
  "gpt-5.1-codex": [1.25, 10, 0.125],
  "gpt-5.1-codex-mini": [0.25, 2, 0.025],
  "gpt-5-codex": [1.25, 10, 0.125],

  // --- Reasoning Models ---
  "o3": [2, 8, 0.5],
  "o3-mini": [1.1, 4.4, 0.55],
  "o4-mini": [1.1, 4.4, 0.275],
  "o1": [15, 60, 7.5],
  "o1-mini": [3, 12, 1.5],
  "o1-pro": [150, 600, 75],

  // --- Realtime & Multimodal Generation ---
  "gpt-realtime-2.1": [4, 24, 0.4],
  "gpt-realtime-2.1-mini": [0.6, 2.4, 0.06],
  "gpt-image-2": [5, 30, 0.5],

  // --- GPT-4.1 Series ---
  "gpt-4.1": [2, 8, 0.5],
  "gpt-4.1-mini": [0.4, 1.6, 0.1],
  "gpt-4.1-nano": [0.1, 0.4, 0.025],

  // --- GPT-4o Series ---
  "gpt-4o": [2.5, 10, 1.25],
  "gpt-4o-mini": [0.15, 0.6, 0.075],
  "chatgpt-4o-latest": [5, 15, 2.5],

  // --- Legacy Models ---
  "gpt-4-turbo": [10, 30, 5],
  "gpt-4": [30, 60, null],
  "gpt-3.5-turbo": [0.5, 1.5, null],
  "gpt-3.5-turbo-instruct": [1.5, 2, null],
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
      cached * (p[2] ?? p[0])) /
    1e6
  );
}

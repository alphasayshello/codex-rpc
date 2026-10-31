// Portable custom-pet format. Every animation is authored in the uploaded art;
// extra scene names share the nearest available animation rather than inventing
// new poses or applying the original Codex character's hand rig.
export const corePetStates = Object.freeze(["idle", "thinking", "waiting", "writing", "patching", "error", "done"]);
export const petStateFallbacks = Object.freeze({
  idle: "idle", thinking: "thinking", waiting: "thinking", writing: "writing", patching: "writing", error: "error", done: "done",
  reading: "thinking", searching: "thinking", terminal: "writing", testing: "writing", building: "patching", installing: "writing",
  reviewing: "thinking", debugging: "thinking", connecting: "thinking", focus: "thinking", celebrating: "done", "idle-cozy": "idle",
});
export const bloomStates = Object.freeze({
  idle: "sleeping", thinking: "thinking", waiting: "thinking", writing: "coding", patching: "coding", error: "error", done: "success",
  reading: "reading", searching: "searching", terminal: "coding", testing: "building", building: "building", installing: "deploying",
  reviewing: "reading", debugging: "debugging", connecting: "deploying", focus: "thinking", celebrating: "success", "idle-cozy": "sleeping",
});
export const petFileAliases = Object.freeze({ coding: "writing", working: "writing", sleeping: "idle", success: "done", deploying: "installing" });
export function completePetStates(files) {
  const resolve = (state, seen = new Set()) => {
    if (files[state]) return files[state];
    if (seen.has(state)) return null;
    seen.add(state); return resolve(petStateFallbacks[state], seen);
  };
  return Object.fromEntries(Object.keys(petStateFallbacks).map((state) => [state, resolve(state)]).filter(([, file]) => file));
}

export interface SpringState { value: number; velocity: number }

/** Exact damped spring step; frequency is Hz, damping is a ratio in (0, 1]. */
export function advanceSpring(state: SpringState, target: number, dt: number, frequency: number, damping: number): void {
  if (!Number.isFinite(dt) || dt <= 0) return;
  const omega = 2 * Math.PI * frequency;
  const offset = state.value - target;
  const decayRate = omega * damping;
  const decay = Math.exp(-decayRate * dt);
  if (damping >= 1) {
    const b = state.velocity + omega * offset;
    state.value = target + (offset + b * dt) * decay;
    state.velocity = (state.velocity - omega * b * dt) * decay;
    return;
  }
  const damped = omega * Math.sqrt(1 - damping * damping);
  const coefficient = (state.velocity + decayRate * offset) / damped;
  const phase = damped * dt;
  const wave = offset * Math.cos(phase) + coefficient * Math.sin(phase);
  state.value = target + decay * wave;
  state.velocity = decay * (-decayRate * wave + damped * (-offset * Math.sin(phase) + coefficient * Math.cos(phase)));
}

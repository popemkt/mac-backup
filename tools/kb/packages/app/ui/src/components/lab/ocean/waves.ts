/**
 * The Ocean's waves: a set of Gerstner (trochoidal) waves, as plain numbers
 * the CPU builds when a slider moves and the shader reads as uniforms.
 *
 * A Gerstner wave moves each point of the surface round a circle: up and
 * down, and toward and away along the wave's direction — so crests sharpen
 * and troughs flatten, as real swell does, where a sine only bobs. A wave is
 * its direction D, wavenumber k = 2π/λ, steepness s (0–1) and amplitude
 * a = s/k; it travels at the deep-water speed c = √(g/k), so long waves
 * outrun short ones (dispersion, again). The steepnesses sum to at most 1:
 * past that a crest folds over itself and the surface loops.
 */

export const WAVE_COUNT = 8;
const GRAVITY = 9.81;

export interface Wave {
  /** Unit direction on the water, x and z. */
  readonly dx: number;
  readonly dz: number;
  readonly k: number;
  readonly amplitude: number;
  readonly speed: number;
  readonly steepness: number;
}

/**
 * The set for a `height` (the total steepness, 0–1), a longest `wavelength`
 * and a wind direction (radians from −z). Each wave is shorter than the one
 * before and turned a little further off the wind, alternately either side;
 * steepness falls with it, so the swell leads and the chop rides on it.
 */
export function waveSet(height: number, wavelength: number, wind: number): Wave[] {
  const weights = Array.from({ length: WAVE_COUNT }, (_, i) => 0.78 ** i);
  const total = weights.reduce((a, b) => a + b, 0);
  const steep = Math.max(0, Math.min(1, height));
  return weights.map((weight, i) => {
    const lambda = wavelength * 0.72 ** i;
    const k = (Math.PI * 2) / lambda;
    const turn = wind + (i % 2 === 0 ? 1 : -1) * (0.18 + i * 0.13);
    const steepness = (steep * weight) / total;
    return {
      dx: Math.sin(turn),
      dz: -Math.cos(turn),
      k,
      amplitude: steepness / k,
      speed: Math.sqrt(GRAVITY / k),
      steepness,
    };
  });
}

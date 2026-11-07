// Original materials for the shared deforming sphere renderer. Geometry and motion
// stay in its frame; these materials supply light and colour on that moving body.
export const AI_BLOB = /* glsl */ `
const float CORE_WIDTH = 68.0;
float rimPhase(float time, float thinking) { return time * uColorSpeed * (0.22 + 0.38 * thinking); }
vec3 rimPalette(float angle) {
  float side = 0.5 + 0.5 * cos(angle);
  vec3 ribbon = mix(vec3(0.015, 0.92, 1.0), vec3(1.0, 0.025, 0.64), side);
  ribbon = mix(ribbon, vec3(0.48, 0.16, 1.0), smoothstep(0.1, 0.95, sin(angle)) * 0.75);
  ribbon = mix(ribbon, vec3(1.0, 0.65, 0.02), exp(-pow((angle + 1.57) / 0.12, 2.0)) * 0.85);
  return ribbon;
}
vec3 body(Ctx c) {
  vec2 pointer = clamp(uPointer, vec2(-1.0), vec2(1.0)) * uHoverTilt;
  float voice = c.level * c.speak * uReactivity;
  float phase = rimPhase(c.t, c.think);
  float drift = snoise(c.dir * max(uNoiseScale, 0.1) + vec3(0.0, phase, 0.0));
  // A narrow luminous skin, rather than a filled Fresnel band.
  float radius = length(c.p) * sqrt(15.0) / (4.0 - c.z);
  float angle = atan(c.p.y, c.p.x) + phase + drift * (0.035 + 0.05 * uWobble);
  vec3 ribbon = rimPalette(angle);
  ribbon = mix(vec3(0.55, 0.65, 0.8), ribbon, clamp(c.vivid, 0.0, 1.0));
  float width = 0.017 * max(uRimWidth, 0.05) * (1.0 + 0.08 * drift);
  float rim = exp(-pow((radius - 0.985) / width, 2.0));
  float skirt = exp(-pow((radius - 0.985) / (width * 3.3), 2.0)) * 0.12;
  vec2 center = vec2(0.025 * sin(phase), 0.015 * cos(phase)) + pointer * 0.055;
  vec2 q = c.p - center - uVelocity * 0.008;
  float core = exp(-dot(q, q) * CORE_WIDTH / max(uCoreSize * uCoreSize, 0.01));
  float pulse = 1.0 + uPulseStrength * (0.06 * sin(phase * 3.0) + c.think * 0.16 * sin(c.t * 2.2));
  float shimmer = 0.96 + 0.04 * snoise(c.dir * max(uNoiseScale, 0.1) * 9.3 + vec3(phase));
  vec3 col = vec3(0.0015, 0.002, 0.005);
  col += ribbon * (rim + skirt) * (1.4 + 0.7 * c.listen + voice) * shimmer * c.glow * uRimIntensity;
  col += vec3(1.15, 0.75, 1.6) * core * (1.5 + voice + 0.35 * uTap) * pulse * c.glow * uCoreIntensity;
  // Soft refractive ribbons below the core: curved wisps, no surface grain.
  float curl = q.x + 0.13 * sin(q.y * 12.0 + phase) + 0.04 * drift;
  float wisp = exp(-pow(curl / 0.065, 2.0)) * exp(-pow((q.y + 0.3) / 0.22, 2.0));
  float veil = exp(-pow((curl + 0.14) / 0.09, 2.0)) * exp(-pow((q.y + 0.16) / 0.3, 2.0));
  col += vec3(0.12, 0.18, 0.65) * (wisp * 0.3 + veil * 0.15) * c.glow;
  float wave = exp(-pow((length(c.p - uTapPoint * 0.7) - 0.5) / 0.15, 2.0));
  col += ribbon * wave * min(abs(uTap), 1.0) * 0.12 * c.glow;
  col += vec3(0.5, 0.75, 1.0) * rim * exp(-pow((angle - 2.3) / 0.16, 2.0)) * 0.4 * uGlints;
  return hueShift(col, c.tint);
}
// The halo uses the same angular palette as the luminous skin.
vec3 haloColor(Ctx c) { return hueShift(rimPalette(atan(c.p.y, c.p.x) + rimPhase(c.t, uThink)), c.tint); }
#define HALO (0.04 * uHalo)
#define HALO_VOICE (0.12 * uHalo)
const float HALO_FALLOFF = 5.2;
const float LIGHTING = 0.25;
`;

export const GRADIENT_BLOB = /* glsl */ `
// Broad translucent colour fields follow the curved surface without grain.
#define METALLIC_SHEEN uMetallic
vec3 body(Ctx c) {
  vec2 pointer = clamp(uPointer, vec2(-1.0), vec2(1.0)) * uCursorMorph;
  float phase = c.t * uRotationSpeed * (0.08 + 0.12 * c.think);
  float drift = 0.12 * sin(phase);
  float side = smoothstep(-0.4, 0.65, c.dir.x + 0.22 * c.dir.y + drift + pointer.x * 0.2);
  vec3 shadow = vec3(0.065, 0.008, 0.49);
  vec3 rose = vec3(0.68, 0.22, 0.56);
  vec3 pigment = mix(shadow, rose, side);
  // A lavender veil across the crown makes the light appear to pass through it.
  float crown = smoothstep(-0.1, 0.9, c.dir.y + c.dir.z * 0.24 + pointer.y * 0.12);
  pigment = mix(pigment, vec3(0.48, 0.25, 0.72), crown * 0.5);
  float base = smoothstep(-0.85, 0.3, c.dir.y);
  pigment *= 0.68 + 0.32 * base;
  pigment = mix(vec3(0.38, 0.23, 0.52), pigment, clamp(c.vivid, 0.0, 1.0));
  vec3 light = normalize(vec3(0.7 + pointer.x * 0.2, 0.55 + pointer.y * 0.2, 0.65));
  float diffuse = max(dot(c.n, light), 0.0);
  vec3 col = pigment * (0.85 + 0.15 * diffuse);
  float veil = pow(max(dot(c.n, normalize(vec3(0.65, 0.3, 0.8))), 0.0), 3.0);
  col += vec3(0.35, 0.11, 0.28) * veil * (0.1 + 0.1 * c.listen + 0.15 * c.level * c.speak + 0.08 * uTap) * c.glow;
  float sheen = pow(max(dot(c.r, light), 0.0), 24.0);
  col += mix(vec3(0.85, 0.7, 1.0), pigment, 0.5) * sheen * METALLIC_SHEEN;
  col += studio(c.r) * METALLIC_SHEEN * (0.08 + 0.22 * c.fres);
  return hueShift(col, c.tint);
}
vec3 haloColor(Ctx c) { return hueShift(vec3(0.65, 0.37, 0.92), c.tint); }
const float HALO = 0.09;
const float HALO_VOICE = 0.2;
const float HALO_FALLOFF = 6.0;
const float LIGHTING = 0.0;
`;

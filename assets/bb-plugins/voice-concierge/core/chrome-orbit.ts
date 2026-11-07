// Original gyroscope geometry and material. Ring coordinates are (major angle,
// cross-section angle, ring index); the vertex shader owns their size and pose.
export const CHROME_VERTEX = /* glsl */ `
mat3 turnX(float a) { float s = sin(a), c = cos(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
mat3 turnY(float a) { float s = sin(a), c = cos(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 turnZ(float a) { float s = sin(a), c = cos(a); return mat3(c,s,0, -s,c,0, 0,0,1); }
void main() {
  float ring = aPos.z;
  float radius = max(0.12, 1.0 - ring * uSpacing - uBandWidth * 0.5);
  vec2 circle = vec2(cos(aPos.x), sin(aPos.x));
  // Rounded rectangle: broad planar faces joined by a small polished bevel.
  // The section parameter is the outward normal angle, so normals remain exact
  // on both flat faces and the circular bevel instead of smoothing into a wire.
  vec2 sectionNormal = vec2(cos(aPos.y), sin(aPos.y));
  vec2 halfSize = vec2(uBandWidth * 0.5, uBandThickness);
  float bevel = min(halfSize.x, halfSize.y) * 0.28;
  vec2 side = sign(sectionNormal) * step(vec2(0.00001), abs(sectionNormal));
  vec2 corner = side * (halfSize - bevel);
  vec2 profile = corner + sectionNormal * bevel;
  vec3 p = vec3(circle * (radius + profile.x), profile.y);
  vec3 n = vec3(circle * sectionNormal.x, sectionNormal.y);
  float time = uFlow * 1.1;
  float phase = ring * 0.73;
  float aligned = pow(clamp(uAlign, 0.0, 1.0), 1.0 + ring * 0.22);
  float gyro = 1.0 - aligned;
  float overshoot = uAlign - clamp(uAlign, 0.0, 1.0);
  float tilt = radians(mix(uTilt, uHaloTilt, aligned));
  // Each band rolls on two drifting axes rather than spinning as a rigid stack.
  // Rotations preserve the silhouette radius even at maximum interaction strength.
  float angle = time * (0.46 + ring * 0.17) + phase;
  float roll = angle * (0.56 + ring * 0.11)
    + sin(time * 0.72 + phase) * 0.22;
  float idle = sin(time * 0.53) * 0.07;
  vec2 inertia = clamp(uVelocity, vec2(-3.0), vec2(3.0)) * 0.045;
  vec2 pointer = clamp(uPointer, vec2(-1.2), vec2(1.2));
  float response = min(uParallax, 2.5);
  float impulse = uTap * (0.13 + ring * 0.026);
  float stagger = sin(phase + aligned * 3.14159) * aligned * gyro * 0.3;
  mat3 pose = turnY((pointer.x * 0.48 + inertia.x) * response + idle)
    * turnX(tilt - (pointer.y * 0.38 + inertia.y) * response
      + impulse * (0.7 + uTapPoint.y * 0.3))
    * turnZ(time * 0.16 * gyro + sin(time * 0.41) * 0.055
      + impulse * uTapPoint.x + uPress * 0.08 * sin(phase))
    * turnY(angle * gyro + stagger + overshoot * sin(phase + 0.4) * 1.5)
    * turnX(roll * gyro + overshoot * cos(phase) * 1.2);
  float reveal = mix(0.82, 1.0, clamp(uIntro, 0.0, 1.08));
  float pressScale = 1.0 - clamp(uPress, 0.0, 1.0) * 0.025;
  p = pose * p * uBreath * reveal * pressScale * (1.0 + uLevel * 0.06 * uMotion);
  vNormal = pose * n;
  vPos = p;
  vDir = normalize(p);
  vDisp = 0.0;
  vCavity = 0.0;
  float f = 0.72 * sqrt(4.0 * 4.0 - 1.0);
  vec2 aspect = vec2(min(uRes.x, uRes.y)) / uRes;
  gl_Position = ring < uRings - 0.5 ? vec4(p.xy * f * aspect, -0.3 * p.z, 4.0 - p.z) : vec4(4.0, 4.0, 4.0, 1.0);
}`;

export const CHROME_ORBIT = /* glsl */ `
vec3 body(Ctx c) {
  // A reflected room with broad white softboxes and two coloured gel lights.
  float drift = (c.t * 0.19 + sin(c.t * 0.31) * 0.16) * uLightDrift
    + uPointer.x * 0.12 * uParallax + uVelocity.x * 0.018;
  vec3 r = vec3(c.r.x * cos(drift) - c.r.z * sin(drift), c.r.y, c.r.x * sin(drift) + c.r.z * cos(drift));
  r = normalize(vec3(r.x, r.y + sin(c.t * 0.23) * 0.08 * uLightDrift, r.z));
  float rough = clamp(uRoughness / 0.6, 0.0, 1.0);
  // A dark studio broken by large luminous panels makes polished metal read
  // through sharp light/dark transitions; roughness softens their boundaries.
  float blur = mix(0.025, 0.3, rough);
  float panel = smoothstep(0.16 - blur, 0.16 + blur, r.y)
    * (1.0 - smoothstep(0.73 - blur, 0.73 + blur, abs(r.x)));
  float strip = 1.0 - smoothstep(0.09, 0.09 + blur, abs(r.x + 0.65));
  float lower = smoothstep(0.35 - blur, 0.35 + blur, -r.y)
    * smoothstep(-0.4, 0.3, r.x);
  vec3 room = vec3(0.055, 0.062, 0.078)
    + vec3(0.5, 0.54, 0.62) * panel
    + vec3(0.72, 0.78, 0.9) * strip
    + vec3(0.19, 0.22, 0.3) * lower;
  float gelA = pow(max(dot(r, normalize(vec3(-0.8, 0.2, 0.5))), 0.0), mix(10.0, 2.0, rough));
  float gelB = pow(max(dot(r, normalize(vec3(0.7, -0.3, 0.4))), 0.0), mix(12.0, 3.0, rough));
  vec3 col = room * vec3(0.92, 0.94, 0.98);
  col += (vec3(0.4, 0.08, 1.0) * gelA + vec3(1.0, 0.12, 0.55) * gelB)
    * (0.2 + c.vivid * 0.45) * (0.45 + c.glow * 0.55);
  vec3 spectrum = 0.55 + 0.45 * cos((1.0 - c.ndv) * 12.0 + vec3(0.0, 2.1, 4.2));
  col += spectrum * pow(1.0 - c.ndv, 2.0) * uIridescence * c.glow;
  col += room * c.level * 0.25;
  return hueShift(col, c.tint);
}
vec3 haloColor(Ctx c) { return hueShift(vec3(0.45, 0.28, 0.9), c.tint); }
const float HALO = 0.04;
const float HALO_VOICE = 0.12;
const float HALO_FALLOFF = 7.0;
const float LIGHTING = 0.1;
`;

/** Closed beveled bands, consistently wound for back-face culling. */
export function orbitBands(): { positions: Float32Array; indices: Uint16Array } {
  const positions: number[] = [], indices: number[] = [];
  const around = 128, section = 16;
  for (let ring = 0; ring < 9; ring++) {
    const base = positions.length / 3;
    for (let i = 0; i < around; i++) for (let j = 0; j < section; j++) {
      positions.push(i / around * Math.PI * 2, j / section * Math.PI * 2, ring);
      const a = base + i * section + j;
      const b = base + ((i + 1) % around) * section + j;
      const c = base + ((i + 1) % around) * section + (j + 1) % section;
      const d = base + i * section + (j + 1) % section;
      indices.push(a, b, d, b, c, d);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint16Array(indices) };
}

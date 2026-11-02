// The sphere's art styles. Each style is one GLSL function, `vec3 body(Ctx c)`, the colour of the sphere's surface
// at a point; a shared frame shades a real, deforming body around it. The body is a mesh (an icosphere, see
// sphere.ts) whose vertex shader displaces the surface with slow noise driven by the voice and the call's phase, and
// derives its normals from that displacement, so light, rim and gloss follow the moving shape; a second, cheap pass
// draws the halo behind it. Rules every style keeps: almost a perfect ball when silent, soft low-frequency swells
// (finer and livelier for the owner's voice, broader and rounder for the concierge's, a slow roll while thinking),
// one hue family whose states differ by brightness, a small hue shift and speed, translucent glow, no sharp lines.
//
// The 3D simplex noise is Ashima Arts' / Stefan Gustavson's webgl-noise (MIT).

export const SPHERE_STYLES = ["jelly", "moonstone", "aurora", "frosted"] as const;
export type SphereStyle = (typeof SPHERE_STYLES)[number];
export const STYLE_LABELS: Record<SphereStyle, string> = {
  jelly: "Candy jelly",
  moonstone: "Moonstone",
  aurora: "Aurora orb",
  frosted: "Frosted globe",
};

/** A CSS swatch for each style, for the picker. */
export const STYLE_SWATCHES: Record<SphereStyle, string> = {
  jelly: "radial-gradient(circle at 35% 30%, #ffd7c8 0%, #ff5a4a 38%, #8a0f22 100%)",
  moonstone: "radial-gradient(circle at 35% 30%, #eef2ff 0%, #9fb0d6 45%, #2b3350 100%)",
  aurora: "radial-gradient(circle at 35% 30%, #9be7f0 0%, #6b6cf0 45%, #1a1636 100%)",
  frosted: "radial-gradient(circle at 50% 50%, #ffe2b0 0%, #a89a86 45%, #3a3a3e 100%)",
};

export const isSphereStyle = (s: string): s is SphereStyle => (SPHERE_STYLES as readonly string[]).includes(s);

const NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
float fbm3(vec3 p) { return 0.57 * snoise(p) + 0.29 * snoise(p * 2.03 + 1.7) + 0.14 * snoise(p * 4.07 - 2.3); }
vec3 warp(vec3 p, float t) {
  return p + 0.5 * vec3(snoise(p * 0.8 + vec3(0.0, 0.0, t)), snoise(p * 0.8 + vec3(5.2, 1.3, -t)), snoise(p * 0.8 + vec3(2.1, 7.7, t * 0.7)));
}
// A small hue rotation (YIQ): listening turns a touch cooler, speaking a touch warmer, inside one hue family.
vec3 hueShift(vec3 c, float a) {
  mat3 toYiq = mat3(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312);
  mat3 toRgb = mat3(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703);
  vec3 y = toYiq * c;
  float cs = cos(a), sn = sin(a);
  return toRgb * vec3(y.x, y.y * cs - y.z * sn, y.y * sn + y.z * cs);
}`;

/** What a style's `body` gets (see the frame below). */
const CTX = /* glsl */ `
struct Ctx {
  vec2 p;        // where the point sits on the ball, seen from the front: the unit disc (it moves with the surface)
  float z;       // depth of the front surface there, 1 at the centre, 0 at the rim
  vec3 n;        // the deformed surface's normal, facing the camera along +z
  float fres;    // soft fresnel, 0 facing, 1 at the rim
  float t;       // drift time: slow, faster while thinking
  float level;   // voice loudness, smoothed, 0..1
  float listen;  // 0..1 weights of the state, eased
  float speak;
  float think;
  float tint;    // hue shift for the state, radians
  vec3 key;      // key light direction
};`;

const JELLY = /* glsl */ `
// Candy jelly: a boiled sweet / gummy. Warm light passes through the body (Beer-Lambert absorption over the
// thickness): the thin rim and the lower half, where the back light shines up through it, glow; the thick upper
// middle is deep and saturated. The light focuses into a soft caustic crescent opposite the key light, slow sugar
// swirls vary the density, a few tiny suspended bubbles rise, and a glossy window sits on the shell.
uniform float uBubbles;
vec3 body(Ctx c) {
  vec3 sigma = vec3(0.16, 1.55, 1.20);                // absorbs green, then blue: a raspberry-red sweet
  float sw = 0.0;
  for (int i = 0; i < 3; i++) {
    float k = (float(i) + 0.5) / 3.0;
    vec3 q = vec3(c.p, mix(c.z, -c.z, k));
    sw += fbm3(warp(q * 1.05 + vec3(0.0, -c.t * 0.02, 0.0), c.t * 0.05));
  }
  sw /= 3.0;
  float thick = 2.0 * c.z * (0.80 + 0.55 * sw) * (1.1 - 0.35 * smoothstep(0.4, -0.9, c.p.y));
  vec3 back = vec3(1.0, 0.85, 0.68) * (1.45 + 0.35 * c.level + 0.25 * c.speak);
  vec3 col = back * exp(-sigma * thick);
  // light scattered inside, strongest low in the body where the back light shines up through it
  float glow = exp(-length((c.p - vec2(0.05, -0.32)) * vec2(1.0, 1.25)) * 1.9);
  col += vec3(1.0, 0.45, 0.30) * glow * (0.50 + 0.30 * c.level + 0.10 * c.think);
  // the light focused through the sweet: a soft caustic crescent opposite the key light
  float r = length(c.p);
  float crescent = exp(-pow((r - 0.74) / 0.16, 2.0)) * pow(max(dot(c.p / max(r, 1e-3), vec2(0.42, -0.66)), 0.0), 2.0);
  col += vec3(1.0, 0.70, 0.50) * crescent * (0.55 + 0.35 * c.level);
  // the thinking shimmer: a soft light orbiting slowly inside
  vec2 orbit = 0.42 * vec2(cos(c.t * 0.9), sin(c.t * 0.9) * 0.6);
  col += vec3(1.0, 0.60, 0.45) * c.think * 0.32 * exp(-dot(c.p - orbit, c.p - orbit) * 9.0);
  // wrapped diffuse: soft, no terminator
  col *= 0.80 + 0.28 * (dot(c.n, c.key) + 0.7) / 1.7;
  // warm transmission at the rim, brighter while listening
  col += vec3(1.0, 0.58, 0.44) * pow(c.fres, 1.3) * (0.26 + 0.25 * c.listen * c.level);
  // tiny bubbles drifting up
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 bc = vec2(sin(fi * 2.39 + 0.3) * 0.5, mod(fi * 0.37 - c.t * 0.015 * (0.6 + 0.1 * fi), 2.0) - 1.0);
    float br = 0.016 + 0.01 * fract(fi * 0.618);
    float d = length(c.p - bc);
    float ring = smoothstep(br, br * 0.45, d) - 0.65 * smoothstep(br * 0.6, 0.0, d);
    col += vec3(1.0, 0.92, 0.86) * 0.30 * uBubbles * ring * smoothstep(1.0, 0.75, length(bc));
  }
  // gloss: a soft rounded window, a tiny second glint, and a broad, low specular
  vec2 w = (c.n.xy - vec2(-0.34, 0.42)) / vec2(0.20, 0.12);
  col += vec3(1.0, 0.97, 0.95) * 0.42 * exp(-pow(dot(w, w), 2.0) * 2.2);
  vec2 g2 = (c.n.xy - vec2(0.36, -0.30)) / 0.05;
  col += vec3(1.0, 0.95, 0.9) * 0.10 * exp(-dot(g2, g2));
  vec3 h = normalize(c.key + vec3(0.0, 0.0, 1.0));
  col += vec3(1.0) * pow(max(dot(c.n, h), 0.0), 14.0) * 0.07;
  return hueShift(col, c.tint);
}
vec3 haloColor(Ctx c) { return hueShift(vec3(1.0, 0.42, 0.34), c.tint); }
const float HALO = 0.13;
const float HALO_VOICE = 0.20;
const float HALO_FALLOFF = 7.0;
const float LIGHTING = 0.35;
const float GLOSS = 0.0;`;

const MOONSTONE = /* glsl */ `
// Moonstone: a milky, translucent stone, more transparent at the rim, with the blue adularescence (a soft glow that
// floats just under the surface) gliding slowly across it and faint milky veils drifting deeper inside.
vec3 body(Ctx c) {
  vec3 deep = vec3(0.10, 0.12, 0.18), milk = vec3(0.62, 0.66, 0.74), blue = vec3(0.42, 0.62, 1.0);
  float veil = 0.0;
  for (int i = 0; i < 3; i++) {
    float k = (float(i) + 0.5) / 3.0;
    veil += fbm3(warp(vec3(c.p * 0.9, mix(c.z, -c.z, k)) + vec3(0.0, 0.0, c.t * 0.02), c.t * 0.04));
  }
  veil = 0.5 + 0.5 * veil / 3.0;
  vec3 col = mix(deep, milk, 0.18 + 0.55 * c.z * (0.75 + 0.5 * veil));
  // the adularescence: a broad soft glow under the surface, drifting with time, brighter with the voice
  float a = c.t * 0.22 + c.think * c.t * 0.3;
  vec2 dir = vec2(cos(a), sin(a));
  float band = exp(-pow((dot(c.n.xy, dir) - 0.15) / 0.42, 2.0)) * smoothstep(0.0, 0.35, c.z);
  float shimmer = 0.6 + 0.4 * snoise(vec3(c.p * 1.4, c.t * 0.08));
  col += blue * band * shimmer * (0.42 + 0.32 * c.level + 0.12 * c.listen + 0.15 * c.think);
  col *= 0.86 + 0.18 * (dot(c.n, c.key) + 0.6) / 1.6;
  col += milk * pow(c.fres, 1.6) * (0.16 + 0.22 * c.level);
  vec3 h = normalize(c.key + vec3(0.0, 0.0, 1.0));
  col += vec3(0.9, 0.95, 1.0) * pow(max(dot(c.n, h), 0.0), 9.0) * 0.07;
  return hueShift(col, c.tint * 0.6);
}
vec3 haloColor(Ctx c) { return hueShift(vec3(0.45, 0.58, 0.95), c.tint * 0.6); }
const float HALO = 0.09;
const float HALO_VOICE = 0.18;
const float HALO_FALLOFF = 8.0;
const float LIGHTING = 1.0;
const float GLOSS = 0.12;`;

const AURORA = /* glsl */ `
// Aurora orb: a clear, dark glass sphere with soft clouds of blue, violet and cyan light flowing inside it; only a
// very gentle rim. The voice brightens and warms the clouds; thinking makes them flow faster.
vec3 body(Ctx c) {
  vec3 cA = vec3(0.30, 0.42, 0.95), cB = vec3(0.62, 0.40, 0.95), cC = vec3(0.26, 0.80, 0.90);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    float k = (float(i) + 0.5) / 4.0;
    vec3 q = warp(vec3(c.p, mix(c.z, -c.z, k)) * 0.75, c.t * 0.06);
    float a = 0.5 + 0.5 * snoise(q + vec3(0.0, 0.0, c.t * 0.05));
    float b = 0.5 + 0.5 * snoise(q * 1.1 + vec3(3.1, 0.0, -c.t * 0.04));
    float d = 0.5 + 0.5 * snoise(q * 0.9 + vec3(0.0, 4.2, c.t * 0.03));
    acc += (cA * a * a + cB * b * b * 1.15 + cC * d * d) * (1.1 - 0.5 * k);
  }
  acc /= 4.0;
  // an inner light so the clouds float in something, never in black
  vec3 col = vec3(0.11, 0.12, 0.24) * (0.6 + 0.4 * c.z) + acc * 1.05 * (0.9 + 0.6 * c.level + 0.2 * c.think) * (0.6 + 0.4 * c.z);
  col += vec3(0.55, 0.65, 1.0) * pow(c.fres, 2.0) * (0.18 + 0.22 * c.level);
  vec3 h = normalize(c.key + vec3(0.0, 0.0, 1.0));
  col += vec3(1.0) * pow(max(dot(c.n, h), 0.0), 20.0) * 0.05;
  return hueShift(col, c.tint);
}
vec3 haloColor(Ctx c) { return hueShift(vec3(0.42, 0.45, 1.0), c.tint); }
const float HALO = 0.2;
const float HALO_VOICE = 0.24;
const float HALO_FALLOFF = 5.5;
const float LIGHTING = 0.8;
const float GLOSS = 0.1;`;

const FROSTED = /* glsl */ `
// Frosted globe: a frosted-glass shell with a warm light inside; soft caustics from the light drift slowly through
// the frost. The core glows brighter with the voice; thinking makes the light wander.
vec3 body(Ctx c) {
  vec3 warm = vec3(1.0, 0.84, 0.6), shell = vec3(0.74, 0.76, 0.8);
  vec2 corePos = 0.12 * c.think * vec2(cos(c.t * 0.8), sin(c.t * 0.8));
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float k = (float(i) + 0.5) / 5.0;
    vec3 q = vec3(c.p - corePos, mix(c.z, -c.z, k));
    float core = exp(-dot(q, q) * (7.0 - 2.0 * c.level));
    float caustic = pow(1.0 - abs(snoise(q * 1.2 + vec3(0.0, 0.0, c.t * 0.08))), 4.0);
    acc += warm * (core * 0.36 + caustic * 0.015 * core);
  }
  float frost = snoise(vec3(c.p * 46.0, 3.0)) * 0.5 + 0.5; // fixed to the shell: a frosted grain, not moving
  vec3 col = mix(vec3(0.08, 0.085, 0.1), shell, 0.3 + 0.28 * c.fres + 0.05 * frost);
  col += acc * (0.9 + 0.6 * c.level + 0.2 * c.speak);
  col += shell * pow(c.fres, 1.8) * 0.18;
  return hueShift(col, c.tint * 0.7);
}
vec3 haloColor(Ctx c) { return hueShift(vec3(1.0, 0.78, 0.52), c.tint * 0.7); }
const float HALO = 0.08;
const float HALO_VOICE = 0.20;
const float HALO_FALLOFF = 7.5;
const float LIGHTING = 1.0;
const float GLOSS = 0.1;`;

const BODIES: Record<SphereStyle, string> = { jelly: JELLY, moonstone: MOONSTONE, aurora: AURORA, frosted: FROSTED };

/** The ball's radius on screen as a share of half the canvas, before breath and voice. */
const R_SCREEN = "0.72";
/** Camera distance in ball radii: a little perspective, so the deformations read in depth. */
const CAMERA = "4.0";

const UNIFORMS = /* glsl */ `
uniform vec2 uRes;
uniform float uTime, uFlow, uBreath, uLevel, uListen, uSpeak, uThink, uConnect, uSpin, uMute;`;

// The surface: a radial displacement of the unit sphere. Idle: a breath and an almost still surface. The owner's
// voice: finer, livelier ripples; the concierge's voice: broad, round swells; thinking and connecting: a slow roll.
// The domain is gently warped so the shapes stay organic, never regular lobes.
const DISPLACE = /* glsl */ `
float displacement(vec3 d) {
  vec3 q = d + 0.1 * vec3(snoise(d * 0.8 + vec3(0.0, 0.0, uFlow * 0.1)), snoise(d * 0.8 + vec3(4.3, 0.0, -uFlow * 0.08)), 0.0);
  float broad = snoise(q * 0.95 + vec3(uSpin * 0.2, 0.0, uFlow * 0.3));
  float lobes = sin(2.0 * atan(d.y, d.x) + uSpin * 0.7) * (1.0 - d.z * d.z);
  float slow = snoise(q * 0.75 + vec3(0.0, 0.0, uTime * 0.1));
  // the voice inflates the ball and moves it in broad, slow swells; the concierge's voice a touch rounder and fuller
  float voice = uLevel * (0.04 + uListen * 0.045 * broad + uSpeak * (0.045 * broad + 0.03 * lobes));
  return voice * (1.0 - uMute) + slow * (0.012 + 0.004 * uThink + 0.008 * uConnect);
}`;

export const MESH_VERTEX_SOURCE = /* glsl */ `#version 300 es
precision highp float;
in vec3 aPos;
${UNIFORMS}
out vec3 vDir;
out vec3 vPos;
out vec3 vNormal;
out float vDisp;
${NOISE}
${DISPLACE}
vec3 surface(vec3 d) { return d * (1.0 + displacement(d)) * uBreath; }
void main() {
  vec3 d = normalize(aPos);
  vec3 t = normalize(cross(d, abs(d.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 b = cross(d, t);
  vDisp = displacement(d);
  vec3 p = d * (1.0 + vDisp) * uBreath;
  // the normal of the displaced surface, from two nearby points on it
  vNormal = normalize(cross(surface(normalize(d + t * 0.012)) - p, surface(normalize(d + b * 0.012)) - p));
  vDir = d;
  vPos = p;
  float f = ${R_SCREEN} * sqrt(${CAMERA} * ${CAMERA} - 1.0);
  vec2 aspect = vec2(min(uRes.x, uRes.y)) / uRes;
  float w = ${CAMERA} - p.z;
  gl_Position = vec4(p.xy * f * aspect, -0.3 * p.z, w);
}`;

/** The ball's surface for one style: the shared frame around the style's `body`. */
export function meshFragmentSource(style: SphereStyle): string {
  return /* glsl */ `#version 300 es
precision highp float;
${UNIFORMS}
in vec3 vDir;
in vec3 vPos;
in vec3 vNormal;
in float vDisp;
out vec4 outColor;
${NOISE}
${CTX}
${BODIES[style]}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  Ctx c;
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vec3(0.0, 0.0, ${CAMERA}) - vPos);
  c.p = vDir.xy;
  c.z = max(vDir.z, 0.0);
  c.n = n;
  c.fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.4);
  c.t = uTime;
  c.level = uLevel;
  c.listen = uListen;
  c.speak = uSpeak;
  c.think = uThink;
  c.tint = -0.07 * uListen + 0.07 * uSpeak;
  c.key = normalize(vec3(-0.45, 0.6, 0.65));
  vec3 col = body(c);
  // shared soft lighting: a wrapped key and a gentle terminator low on the right, so every style reads as a ball
  float lam = 0.62 + 0.5 * max(dot(n, c.key) + 0.4, 0.0) / 1.4;
  float term = mix(0.8, 1.0, smoothstep(-0.75, 0.35, dot(n.xy, vec2(-0.6, 0.8))));
  col *= mix(1.0, lam * term, LIGHTING);
  // a soft window highlight near the key light
  vec2 win = (n.xy - vec2(-0.42, 0.5)) / vec2(0.14, 0.07);
  col += vec3(1.0, 0.98, 0.96) * GLOSS * exp(-pow(dot(win, win), 2.0) * 3.5);
  // soft cavities: the valleys of the deformation a touch deeper, the crests a touch brighter
  col *= clamp(1.0 + 1.5 * vDisp, 0.84, 1.1);
  // muted: the ball rests, paler and dimmer
  float grey = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, mix(vec3(grey), col, 0.45) * 0.72, uMute);
  col = col / (1.0 + 0.35 * max(max(col.r, col.g), col.b)); // soft shoulder: no clipped highlights
  col += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 128.0;
  outColor = vec4(col, 1.0);
}`;
}

export const HALO_VERTEX_SOURCE = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** The halo behind the ball: a soft glow in the style's colour, brighter with the voice, fading before the edge. */
export function haloFragmentSource(style: SphereStyle): string {
  return /* glsl */ `#version 300 es
precision highp float;
${UNIFORMS}
out vec4 outColor;
${NOISE}
${CTX}
${BODIES[style]}
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y) * 2.0;
  float R = ${R_SCREEN} * uBreath * (1.0 + 0.05 * uLevel);
  Ctx c;
  c.tint = -0.07 * uListen + 0.07 * uSpeak;
  float window = smoothstep(1.0, 0.86, max(abs(uv.x), abs(uv.y)));
  float glow = (HALO + HALO_VOICE * uLevel) * exp(-max(length(uv) - R, 0.0) * HALO_FALLOFF) * window;
  outColor = vec4(haloColor(c) * glow, glow); // premultiplied, over whatever bb's background is
}`;
}

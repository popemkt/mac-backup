// The sphere's art styles, each a material that should read as itself at a glance: a candy (glossy, translucent,
// glowing from within), a moonstone (milky, with the blue adularescence floating under its surface), an aurora globe
// (curtains of the northern lights drifting inside dark glass) and a frosted glass globe (a warm light refracted and
// scattered by the frost). Each style is one GLSL function, `vec3 body(Ctx c)`, the colour of the sphere's surface
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
  aurora: "linear-gradient(180deg, #d24bd6 0%, #2fd6c3 45%, #3cff8a 62%, #0b1226 100%)",
  frosted: "radial-gradient(circle at 50% 55%, #fff1d6 0%, #f0c98a 28%, #9ea3ad 60%, #4a4d55 100%)",
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
  vec3 dir;      // the same material point on the unit sphere: textures fixed to the surface use it
  vec3 n;        // the deformed surface's normal, facing the camera along +z
  vec3 v;        // toward the camera
  vec3 r;        // the view reflected by the surface
  float ndv;     // dot(n, v)
  float fres;    // soft fresnel, 0 facing, 1 at the rim
  float t;       // drift time: slow, faster while thinking
  float level;   // voice loudness, smoothed, 0..1
  float listen;  // 0..1 weights of the state, eased
  float speak;
  float think;
  float tint;    // hue shift for the state, radians
  vec3 key;      // key light direction
  float vivid;   // the style's knobs: 1 is its own look
  float glow;
};
float schlick(float f0, float ndv) { return f0 + (1.0 - f0) * pow(1.0 - clamp(ndv, 0.0, 1.0), 5.0); }
// A soft studio for reflections: a large rounded softbox up and to the left, a thin cool strip on the right, a dark
// room. Glossy materials show it as a bright window that slides over the moving surface.
vec3 studio(vec3 r) {
  vec3 b = normalize(vec3(-0.5, 0.6, 0.62));
  vec3 bu = normalize(cross(vec3(0.0, 1.0, 0.0), b));
  vec3 bv = cross(b, bu);
  float f = dot(r, b);
  vec2 q = vec2(dot(r, bu), dot(r, bv)) / max(f, 1e-3);
  float box = f > 0.0 ? 1.0 - smoothstep(0.7, 1.0, max(abs(q.x) / 0.45, abs(q.y) / 0.32)) : 0.0;
  float strip = smoothstep(0.965, 0.995, dot(r, normalize(vec3(0.95, -0.05, 0.3))));
  return vec3(1.0) * box * 1.7 + vec3(0.65, 0.75, 1.0) * strip * 0.7 + vec3(0.03, 0.035, 0.05) + vec3(0.04) * smoothstep(0.2, -0.8, r.y);
}`;

const JELLY = /* glsl */ `
// Candy: a boiled sweet. Light passes through the body and is absorbed over its thickness (Beer-Lambert): the thin
// rim and the lower half, where the back light shines up through it, glow; the thick middle is deep and saturated.
// Light scattered inside glows through it (subsurface), focuses into a soft caustic crescent, slow sugar swirls vary
// the density, a few tiny bubbles rise, and the glassy shell reflects the studio with a sharp glint.
uniform float uBubbles;
vec3 body(Ctx c) {
  vec3 sigma = vec3(0.5, 2.2, 1.7) * (0.65 + 0.45 * c.vivid); // absorbs green, then blue: a raspberry sweet
  float sw = 0.0;
  for (int i = 0; i < 2; i++) {
    float k = (float(i) + 0.5) / 2.0;
    sw += fbm3(warp(vec3(c.p, mix(c.z, -c.z, k)) * 1.05 + vec3(0.0, -c.t * 0.02, 0.0), c.t * 0.05));
  }
  sw *= 0.5;
  float thick = 2.0 * c.z * (0.85 + 0.45 * sw) * (1.1 - 0.35 * smoothstep(0.4, -0.9, c.p.y));
  vec3 back = vec3(1.0, 0.86, 0.7) * (1.45 + 0.7 * c.level + 0.3 * c.speak);
  vec3 col = back * exp(-sigma * thick);
  // subsurface: light scattered inside glows through the thin rim and low in the body
  float sss = 0.55 * pow(1.0 - c.ndv, 1.6) + exp(-length((c.p - vec2(0.05, -0.35)) * vec2(1.0, 1.3)) * 2.0);
  col += vec3(1.0, 0.34, 0.24) * sss * (0.5 + 0.55 * c.level + 0.1 * c.think) * c.glow;
  float r = length(c.p);
  float crescent = exp(-pow((r - 0.74) / 0.16, 2.0)) * pow(max(dot(c.p / max(r, 1e-3), vec2(0.42, -0.66)), 0.0), 2.0);
  col += vec3(1.0, 0.7, 0.5) * crescent * (0.6 + 0.5 * c.level) * c.glow;
  vec2 orbit = 0.42 * vec2(cos(c.t * 0.9), sin(c.t * 0.9) * 0.6);
  col += vec3(1.0, 0.6, 0.45) * c.think * 0.4 * exp(-dot(c.p - orbit, c.p - orbit) * 9.0);
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 bc = vec2(sin(fi * 2.39 + 0.3) * 0.5, mod(fi * 0.37 - c.t * 0.015 * (0.6 + 0.1 * fi), 2.0) - 1.0);
    float br = 0.016 + 0.01 * fract(fi * 0.618);
    float d = length(c.p - bc);
    float ring = smoothstep(br, br * 0.45, d) - 0.65 * smoothstep(br * 0.6, 0.0, d);
    col += vec3(1.0, 0.92, 0.86) * 0.3 * uBubbles * ring * smoothstep(1.0, 0.75, length(bc));
  }
  // the glassy shell: the studio reflected, and a sharp glint of the key light
  float F = schlick(0.05, c.ndv);
  col = col * (1.0 - F) + studio(c.r) * F * 4.5;
  col += vec3(1.0, 0.98, 0.95) * pow(max(dot(c.r, c.key), 0.0), 180.0) * 2.4;
  return hueShift(col, c.tint);
}
vec3 haloColor(Ctx c) { return hueShift(vec3(1.0, 0.36, 0.3), c.tint); }
const float HALO = 0.15;
const float HALO_VOICE = 0.3;
const float HALO_FALLOFF = 6.5;
const float LIGHTING = 0.3;`;

const MOONSTONE = /* glsl */ `
// Moonstone: a polished, milky cabochon. Its adularescence, a billowy blue light, floats just under the surface: it
// is strongest where the surface faces a slowly turning axis, seen a little below the surface, so it glides across
// the stone as the shape moves and as the voice turns it, and a fainter violet sheen answers it from the other side.
vec3 body(Ctx c) {
  vec3 milk = vec3(0.5, 0.52, 0.57), deep = vec3(0.07, 0.08, 0.12);
  float veil = 0.5 + 0.5 * fbm3(warp(vec3(c.p * 0.9, c.z) + vec3(0.0, 0.0, c.t * 0.03), c.t * 0.04));
  vec3 col = mix(deep, milk, 0.2 + 0.55 * c.z * (0.6 + 0.6 * veil));
  col += vec3(0.75, 0.78, 0.85) * pow(1.0 - c.ndv, 2.0) * 0.25; // the milky rim, where light scatters back out
  float a = c.t * 0.25 + c.level * 1.4 + c.think * c.t * 0.2;
  vec3 axis = normalize(vec3(0.55 * cos(a), 0.55 * sin(a) + 0.2, 0.85));
  vec3 below = normalize(c.n - c.v * 0.35);
  float sheen = pow(smoothstep(0.45, 0.98, dot(below, axis)), 1.5);
  float billow = 0.5 + 0.5 * snoise(vec3(c.p * 0.75 + c.n.xy * 0.6, c.t * 0.1));
  col += vec3(0.2, 0.5, 1.0) * sheen * (0.55 + 0.7 * billow) * (1.2 + 1.2 * c.level + 0.3 * c.listen) * (0.55 + 0.6 * c.vivid) * c.glow;
  float sheen2 = smoothstep(0.85, 1.0, dot(below, normalize(vec3(-axis.x, -axis.y, 0.9))));
  col += vec3(0.55, 0.4, 1.0) * sheen2 * 0.25 * c.vivid * c.glow;
  // polished: a glassy reflection
  float F = schlick(0.045, c.ndv);
  col = col * (1.0 - 0.6 * F) + studio(c.r) * F * 2.6;
  return hueShift(col, c.tint * 0.6);
}
vec3 haloColor(Ctx c) { return hueShift(vec3(0.4, 0.6, 1.0), c.tint * 0.6); }
const float HALO = 0.13;
const float HALO_VOICE = 0.3;
const float HALO_FALLOFF = 7.0;
const float LIGHTING = 0.7;`;

const AURORA = /* glsl */ `
// Aurora: a dark glass globe with the northern lights inside. Three curtains hang at different depths, folded and
// streaked with fine vertical rays, and drift across; each is green at its sharp lower edge, turning teal and then
// rose-violet toward the top. The voice brightens them, lifts them and makes them drift faster.
vec3 body(Ctx c) {
  vec3 col = vec3(0.01, 0.018, 0.045) + vec3(0.02, 0.035, 0.08) * c.z;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x = c.p.x * (1.0 - 0.12 * fi) + fi * 0.37 + c.t * (0.05 + 0.02 * fi) * (1.0 + c.level);
    float base = -0.45 + 0.22 * snoise(vec3(x * 1.3, fi * 4.0, c.t * 0.07)) + 0.09 * fi - 0.1 * c.level;
    float h = c.p.y - base;
    float foot = smoothstep(-0.02, 0.035, h);
    float rise = exp(-max(h, 0.0) * (2.5 - 0.9 * c.level));
    float fold = 0.3 + 0.7 * pow(0.5 + 0.5 * snoise(vec3(x * 2.6, fi * 7.0, c.t * 0.12)), 1.5);
    float rays = 0.5 + 0.5 * pow(0.5 + 0.5 * snoise(vec3(x * 16.0, fi, c.t * 0.25)), 2.0);
    vec3 tone = mix(vec3(0.15, 1.0, 0.45), vec3(0.1, 0.78, 0.92), smoothstep(0.05, 0.3, h));
    tone = mix(tone, vec3(0.88, 0.25, 0.85), smoothstep(0.3, 0.8, h));
    acc += tone * foot * rise * fold * rays * (1.0 - 0.25 * fi);
  }
  col += acc * (1.0 + 0.9 * c.level + 0.25 * c.think) * (0.7 + 0.5 * c.vivid) * c.glow * (0.65 + 0.35 * c.z);
  float star = pow(max(snoise(vec3(c.p * 38.0, 1.0)), 0.0), 16.0) * 1.6;
  col += vec3(0.8, 0.85, 1.0) * star * (1.0 - smoothstep(0.0, 0.25, length(acc)));
  float F = schlick(0.04, c.ndv);
  col = col * (1.0 - F) + studio(c.r) * F * 2.2;
  return hueShift(col, c.tint * 0.5);
}
vec3 haloColor(Ctx c) { return hueShift(vec3(0.2, 0.9, 0.6), c.tint * 0.5); }
const float HALO = 0.13;
const float HALO_VOICE = 0.3;
const float HALO_FALLOFF = 6.0;
const float LIGHTING = 0.5;`;

const FROSTED = /* glsl */ `
// Frosted glass: a globe of frosted glass with a warm light inside. Looking in, each ray is refracted by the shell, so
// the light swells toward the rim; the frost, a fine grain fixed on the shell, blurs it into a soft glow where the
// glass is seen face on and catches tiny glints of the key light. The voice brightens and grows the light; thinking
// lets it wander.
vec3 body(Ctx c) {
  vec3 rd = refract(-c.v, c.n, 1.0 / 1.45);
  vec3 core = vec3(0.12 * c.think * cos(c.t * 0.8), 0.12 * c.think * sin(c.t * 0.8), 0.0);
  vec3 ro = vec3(c.p, c.z);
  float d = length(ro + rd * max(dot(core - ro, rd), 0.0) - core);
  float grain = 0.5 + 0.5 * snoise(c.dir * 90.0);
  float grain2 = 0.5 + 0.5 * snoise(c.dir * 31.0 + 7.0);
  float frost = 0.55 + 0.25 * grain + 0.2 * grain2;
  float size = 0.1 + 0.12 * c.z * frost + 0.06 * c.level;
  float bulb = exp(-d * d / (size * size));
  float scatter = exp(-d * 3.0);
  vec3 warm = vec3(1.0, 0.8, 0.52);
  vec3 col = mix(vec3(0.05, 0.055, 0.065), vec3(0.7, 0.73, 0.78), 0.16 + 0.32 * c.fres) * (0.85 + 0.3 * grain);
  col += warm * (bulb * 1.7 + scatter * 0.5 * frost) * (0.8 + 0.9 * c.level + 0.2 * c.speak) * c.glow;
  float glint = pow(grain, 14.0) * pow(max(dot(c.r, c.key), 0.0), 5.0);
  col += vec3(1.0) * glint * 1.5 * c.vivid;
  float F = schlick(0.04, c.ndv);
  col += studio(c.r) * F * 0.8; // satin: the frost blurs the reflection
  return hueShift(col, c.tint * 0.7);
}
vec3 haloColor(Ctx c) { return hueShift(vec3(1.0, 0.78, 0.5), c.tint * 0.7); }
const float HALO = 0.1;
const float HALO_VOICE = 0.28;
const float HALO_FALLOFF = 7.0;
const float LIGHTING = 0.7;`;

const BODIES: Record<SphereStyle, string> = { jelly: JELLY, moonstone: MOONSTONE, aurora: AURORA, frosted: FROSTED };

/** The ball's radius on screen as a share of half the canvas, before breath and voice. */
const R_SCREEN = "0.72";
/** Camera distance in ball radii: a little perspective, so the deformations read in depth. */
const CAMERA = "4.0";

const UNIFORMS = /* glsl */ `
uniform vec2 uRes;
uniform float uTime, uFlow, uBreath, uLevel, uListen, uSpeak, uThink, uConnect, uSpin, uMute;
uniform float uVivid, uMotion, uGlow, uHue;`;

// The surface: a radial displacement of the unit sphere. The voice inflates the ball and moves it in broad, slow
// swells (the concierge's voice a touch rounder, with two slow lobes); idle and thinking, a slow roll. The domain is
// gently warped so the shapes stay organic. The motion knob scales all of it.
const DISPLACE = /* glsl */ `
float displacement(vec3 d) {
  vec3 q = d + 0.1 * vec3(snoise(d * 0.8 + vec3(0.0, 0.0, uFlow * 0.1)), snoise(d * 0.8 + vec3(4.3, 0.0, -uFlow * 0.08)), 0.0);
  float broad = snoise(q * 0.95 + vec3(uSpin * 0.2, 0.0, uFlow * 0.3));
  float lobes = sin(2.0 * atan(d.y, d.x) + uSpin * 0.7) * (1.0 - d.z * d.z);
  float slow = snoise(q * 0.75 + vec3(0.0, 0.0, uTime * 0.1));
  float voice = uLevel * (0.05 + uListen * 0.042 * broad + uSpeak * (0.055 * broad + 0.035 * lobes));
  return uMotion * (voice * (1.0 - uMute) + slow * (0.012 + 0.006 * uThink + 0.008 * uConnect));
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
  gl_Position = vec4(p.xy * f * aspect, -0.3 * p.z, ${CAMERA} - p.z);
}`;

// A filmic curve (Narkowicz's ACES fit): rich contrast and saturation, highlights that roll off instead of clipping.
const FINISH = /* glsl */ `
vec3 filmic(vec3 x) { return clamp(x * (2.51 * x + 0.03) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
vec3 vividness(vec3 col, float k) {
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  return max(mix(vec3(l), col, 0.55 + 0.6 * k), 0.0);
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
${FINISH}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  Ctx c;
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vec3(0.0, 0.0, ${CAMERA}) - vPos);
  c.p = vDir.xy;
  c.z = max(vDir.z, 0.0);
  c.dir = vDir;
  c.n = n;
  c.v = v;
  c.r = reflect(-v, n);
  c.ndv = clamp(dot(n, v), 0.0, 1.0);
  c.fres = pow(1.0 - c.ndv, 2.4);
  c.t = uTime;
  c.level = uLevel;
  c.listen = uListen;
  c.speak = uSpeak;
  c.think = uThink;
  c.tint = -0.07 * uListen + 0.07 * uSpeak;
  c.key = normalize(vec3(-0.45, 0.6, 0.65));
  c.vivid = uVivid;
  c.glow = uGlow;
  vec3 col = body(c);
  // shared soft lighting: a wrapped key and a gentle terminator low on the right, so every style reads as a ball
  float lam = 0.62 + 0.5 * max(dot(n, c.key) + 0.4, 0.0) / 1.4;
  float term = mix(0.8, 1.0, smoothstep(-0.75, 0.35, dot(n.xy, vec2(-0.6, 0.8))));
  col *= mix(1.0, lam * term, LIGHTING);
  // soft cavities: the valleys of the deformation a touch deeper, the crests a touch brighter
  col *= clamp(1.0 + 1.5 * vDisp, 0.84, 1.12);
  col = hueShift(vividness(col, uVivid), uHue);
  // muted: the ball rests, paler and dimmer
  float grey = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(col, mix(vec3(grey), col, 0.45) * 0.72, uMute);
  col = filmic(col * 1.05);
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
  float R = ${R_SCREEN} * uBreath * (1.0 + 0.06 * uLevel * uMotion);
  Ctx c;
  c.tint = -0.07 * uListen + 0.07 * uSpeak;
  float window = smoothstep(1.0, 0.86, max(abs(uv.x), abs(uv.y)));
  float glow = min((HALO + HALO_VOICE * uLevel) * uGlow * (1.0 - 0.5 * uMute), 0.9) * exp(-max(length(uv) - R, 0.0) * HALO_FALLOFF) * window;
  vec3 col = hueShift(haloColor(c), uHue);
  outColor = vec4(col * glow, glow); // premultiplied, over whatever bb's background is
}`;
}

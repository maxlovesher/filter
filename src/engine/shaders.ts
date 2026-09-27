/** Fullscreen triangle from gl_VertexID — no vertex buffers needed. vUv (0,0) is bottom-left. */
export const VERT = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Downsample pass. The source is mipmapped, so sampling into a smaller target averages correctly. */
export const COPY_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
void main() { outColor = texture(uTex, vUv); }`;

/** One direction of a separable 9-tap Gaussian. */
export const BLUR_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uDir;
const float W[5] = float[](0.227027, 0.1945946, 0.1216216, 0.054054, 0.016216);
void main() {
  vec4 c = texture(uTex, vUv) * W[0];
  for (int i = 1; i < 5; i++) {
    vec2 o = uDir * float(i);
    c += texture(uTex, vUv + o) * W[i];
    c += texture(uTex, vUv - o) * W[i];
  }
  outColor = c;
}`;

/**
 * The whole Lightroom-style develop pipeline in one pass. Order roughly follows Lightroom:
 * local contrast (texture/clarity/dehaze) → white balance → exposure → contrast → tone ranges →
 * tone curve → color mixer → vibrance/saturation → color grading → vignette → grain.
 * Blurred copies of the source (uBlurS/M/L) are precomputed once per image.
 */
export const MAIN_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSrc;
uniform sampler2D uBlurS;
uniform sampler2D uBlurM;
uniform sampler2D uBlurL;
uniform sampler2D uCurve;

uniform float uExposure;
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uTemp;
uniform float uTint;
uniform float uVibrance;
uniform float uSaturation;
uniform float uTexture;
uniform float uClarity;
uniform float uDehaze;
uniform vec4 uVignette;   // amount, midpoint, roundness, feather
uniform vec3 uGrain;      // amount, size, roughness
uniform vec2 uImageSize;
uniform bool uHslOn;
uniform vec3 uHsl[8];     // hue, sat, lum per color, -1..1
uniform vec3 uGrade[4];   // shadows, midtones, highlights, global: hue (deg), sat 0..1, lum -1..1
uniform float uBlending;
uniform float uBalance;
uniform sampler3D uLut;
uniform float uLutAmount; // 0 = off
uniform float uLutSize;

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
const float CURVE_N = 1024.0;
const float CENTERS[9] = float[](0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 270.0, 300.0, 360.0);

float luma(vec3 c) { return dot(c, LUMA); }

vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toGamma(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

vec3 rgb2hsl(vec3 c) {
  float mx = max(max(c.r, c.g), c.b);
  float mn = min(min(c.r, c.g), c.b);
  float l = (mx + mn) * 0.5;
  float d = mx - mn;
  float h = 0.0;
  float s = 0.0;
  if (d > 1e-5) {
    s = l > 0.5 ? d / (2.0 - mx - mn) : d / (mx + mn);
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, s, l);
}
float hue2rgb(float p, float q, float t) {
  t = fract(t);
  if (t < 1.0 / 6.0) return p + (q - p) * 6.0 * t;
  if (t < 0.5) return q;
  if (t < 2.0 / 3.0) return p + (q - p) * (2.0 / 3.0 - t) * 6.0;
  return p;
}
vec3 hsl2rgb(vec3 hsl) {
  if (hsl.y <= 0.0) return vec3(hsl.z);
  float q = hsl.z < 0.5 ? hsl.z * (1.0 + hsl.y) : hsl.z + hsl.y - hsl.z * hsl.y;
  float p = 2.0 * hsl.z - q;
  return vec3(hue2rgb(p, q, hsl.x + 1.0 / 3.0), hue2rgb(p, q, hsl.x), hue2rgb(p, q, hsl.x - 1.0 / 3.0));
}
vec3 hueColor(float deg) {
  return clamp(abs(mod(deg / 60.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
}

// Color-mixer adjustment for a hue, blended smoothly between the two nearest color bands.
vec3 hslAdjust(float hueDeg) {
  for (int i = 0; i < 8; i++) {
    if (hueDeg < CENTERS[i + 1]) {
      float t = smoothstep(0.0, 1.0, (hueDeg - CENTERS[i]) / (CENTERS[i + 1] - CENTERS[i]));
      return mix(uHsl[i], uHsl[(i + 1) % 8], t);
    }
  }
  return uHsl[0];
}

vec3 gradeZone(vec3 z, float w) {
  vec3 col = hueColor(z.x);
  vec3 off = col - luma(col);
  return (off * z.y * 0.5 + z.z * 0.2) * w;
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y); // textures hold the image top row first
  vec3 src = texture(uSrc, uv).rgb;
  vec3 bS = texture(uBlurS, uv).rgb;
  vec3 bM = texture(uBlurM, uv).rgb;
  vec3 bL = texture(uBlurL, uv).rgb;

  // --- Texture / Clarity: add back (or remove) detail at two scales
  vec3 c = src;
  float y0 = luma(src);
  float midW = clamp(1.0 - pow(abs(y0 * 2.0 - 1.0), 2.0), 0.0, 1.0);
  c += uTexture * 0.9 * (src - bS);
  float clarityW = uClarity > 0.0 ? (0.4 + 0.6 * midW) : 1.0;
  c += uClarity * 0.8 * clarityW * (src - bM);
  // Negative clarity also lets bright areas bloom into their surroundings (the "dreamy" glow).
  if (uClarity < 0.0) c = mix(c, max(c, bM), -uClarity * 0.3);

  // --- Dehaze: positive strips the local haze floor, negative lays a bright veil over the image
  if (uDehaze > 0.0) {
    float dark = min(min(bL.r, bL.g), bL.b);
    float k = uDehaze * 0.6 * dark;
    c = (c - k) / max(1.0 - k, 0.2);
    c = mix(vec3(luma(c)), c, 1.0 + uDehaze * 0.25);
  } else if (uDehaze < 0.0) {
    vec3 veil = mix(vec3(luma(bL)), bL, 0.5) * 0.6 + 0.3;
    c = mix(c, veil, -uDehaze * 0.35);
  }
  c = max(c, 0.0);

  // --- White balance + exposure (linear light)
  vec3 lin = toLinear(c);
  vec3 wb = vec3(1.0 + 0.5 * uTemp + 0.12 * uTint, 1.0 - 0.4 * uTint, 1.0 - 0.75 * uTemp + 0.12 * uTint);
  wb /= luma(wb);
  lin *= wb * exp2(uExposure);
  vec3 g = toGamma(lin);

  // --- Contrast: S-curve around mid grey
  float k = exp2(uContrast * 1.1);
  vec3 gc = clamp(g, 0.0, 1.0);
  vec3 lo = 0.5 * pow(2.0 * gc, vec3(k));
  vec3 hi = 1.0 - 0.5 * pow(2.0 * (1.0 - gc), vec3(k));
  g = mix(lo, hi, step(0.5, gc)) + (g - gc);

  // --- Highlights / Shadows / Whites / Blacks: luminance-masked lifts
  float Y = luma(g);
  float Yc = clamp(Y, 0.0, 1.0);
  float mS = 6.75 * Yc * (1.0 - Yc) * (1.0 - Yc);
  float mH = smoothstep(0.35, 0.8, Y) * (1.0 - 0.4 * smoothstep(0.9, 1.2, Y));
  float mW = smoothstep(0.5, 1.0, Y);
  float mB = 1.0 - smoothstep(0.0, 0.3, Y);
  float delta = uShadows * 0.16 * mS + uHighlights * 0.22 * mH + uWhites * 0.12 * mW + uBlacks * 0.12 * mB;
  float ratio = (Y + delta) / max(Y, 1e-4);
  g = mix(g + delta, g * ratio, 0.6 * smoothstep(0.02, 0.2, Y));

  // --- Tone curve (RGB master composed with R/G/B curves in one LUT)
  g = clamp(g, 0.0, 1.0);
  vec3 cu = g * ((CURVE_N - 1.0) / CURVE_N) + 0.5 / CURVE_N;
  g = vec3(texture(uCurve, vec2(cu.r, 0.5)).r, texture(uCurve, vec2(cu.g, 0.5)).g, texture(uCurve, vec2(cu.b, 0.5)).b);

  // --- Color mixer (HSL per color band)
  if (uHslOn) {
    vec3 hsl = rgb2hsl(g);
    float chroma = max(max(g.r, g.g), g.b) - min(min(g.r, g.g), g.b);
    float cw = smoothstep(0.0, 0.12, chroma);
    vec3 adj = hslAdjust(hsl.x * 360.0) * cw;
    hsl.x = fract(hsl.x + adj.x * (30.0 / 360.0));
    hsl.y = clamp(hsl.y * (1.0 + adj.y), 0.0, 1.0);
    hsl.z = clamp(hsl.z + adj.z * 0.22 * (1.0 - abs(hsl.z * 2.0 - 1.0) * 0.5), 0.0, 1.0);
    g = hsl2rgb(hsl);
  }

  // --- Vibrance (protects already-saturated colors) & Saturation
  float Yv = luma(g);
  float sat = max(max(g.r, g.g), g.b) - min(min(g.r, g.g), g.b);
  float v = uVibrance > 0.0 ? uVibrance * (1.0 - sat) : uVibrance;
  g = mix(vec3(Yv), g, 1.0 + v);
  g = mix(vec3(Yv), g, 1.0 + uSaturation);

  // --- Color grading: shadows / midtones / highlights wheels + global
  float Yg = clamp(luma(g), 0.0, 1.0);
  float width = mix(0.12, 0.5, uBlending);
  float pivot = 0.5 - uBalance * 0.3;
  float t = smoothstep(pivot - width, pivot + width, Yg);
  float wS = (1.0 - t) * (1.0 - t);
  float wH = t * t;
  float wM = 2.0 * t * (1.0 - t);
  g += gradeZone(uGrade[0], wS) + gradeZone(uGrade[1], wM * 1.6) + gradeZone(uGrade[2], wH) + gradeZone(uGrade[3], 1.0);

  // --- Creative LUT (.cube)
  if (uLutAmount > 0.0) {
    vec3 lc = clamp(g, 0.0, 1.0) * ((uLutSize - 1.0) / uLutSize) + 0.5 / uLutSize;
    g = mix(g, texture(uLut, lc).rgb, uLutAmount);
  }

  // --- Post-crop vignette
  if (uVignette.x != 0.0) {
    vec2 p = uv * 2.0 - 1.0;
    float aspect = uImageSize.x / uImageSize.y;
    float r = uVignette.z;
    vec2 circ = aspect >= 1.0 ? vec2(1.0, 1.0 / aspect) : vec2(aspect, 1.0);
    vec2 q = p * mix(vec2(1.0), circ, max(r, 0.0));
    float n = 2.0 + max(-r, 0.0) * 6.0;
    vec2 aq = abs(q);
    float d = pow(pow(aq.x, n) + pow(aq.y, n), 1.0 / n);
    float mid = mix(0.3, 1.4, uVignette.y);
    float f = mix(0.05, 1.2, uVignette.w);
    float m = smoothstep(mid - f * 0.5, mid + f * 0.5, d);
    if (uVignette.x < 0.0) g *= 1.0 + uVignette.x * m;
    else g = mix(g, vec3(1.0), uVignette.x * m);
  }

  // --- Film grain (scaled to the image, so preview and export match)
  if (uGrain.x > 0.0) {
    vec2 px = uv * uImageSize / max(uImageSize.x, uImageSize.y);
    vec2 q = px * (1500.0 / mix(0.6, 3.5, uGrain.y));
    float gn = mix(vnoise(q), vnoise(q * 2.7 + 31.7), uGrain.z * 0.6) - 0.5;
    float Yn = clamp(luma(g), 0.0, 1.0);
    g += gn * uGrain.x * 0.16 * (0.35 + 2.6 * Yn * (1.0 - Yn));
  }

  outColor = vec4(clamp(g, 0.0, 1.0), 1.0);
}`;

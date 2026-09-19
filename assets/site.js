/* ══ Oblivion ─ field, glass, scroll ════════════════════════════════════════
   One WebGL2 canvas draws the whole ground in two passes:

     A  the fluid field, into a half-resolution texture
     B  that texture upscaled, with the glass body refracting it

   The glass is a body in the shader rather than a sprite over it, so what
   you see through it is the field as it is this frame, not a blur of a
   copy of it. Everything else here is scroll bookkeeping.
   ══════════════════════════════════════════════════════════════════════ */

const reduced = matchMedia('(prefers-reduced-motion: reduce)');

/* ── the mark ─────────────────────────────────────────────────────────────
   The real logo: three filled paths in a -112..112 box, lifted straight
   from the site rather than traced. Filled paths with arc fillets have no
   tidy analytic distance field, so it is rasterised once and run through a
   Euclidean distance transform. The shader then samples one texture
   instead of evaluating 24 line segments, which is both exact and faster.
   ──────────────────────────────────────────────────────────────────────── */

const MARK_VIEW = 224;   // the -112..112 box the paths are authored in

const MARK_PATHS = [
  'M 42.69 -97.63 L 42.69 -58.89 L 42.56 -58.91 A 8.63 8.63 0 0 1 38.64 -52.71 L 38.63 -52.72 L -8.03 -19.55 L -7.75 -19.12 A 20.79 20.79 0 0 0 -14.89 -11.39 L -15.41 -11.66 L -20.68 -1.17 L -22.81 7.84 L -22.42 17.97 L -18.87 37.10 L -45.17 19.53 L -45.07 19.40 A 5.74 5.74 0 0 1 -48.77 13.84 L -49.01 13.83 L -49.01 -32.02 L -48.43 -32.04 A 7.58 7.58 0 0 1 -44.25 -39.10 L -44.49 -39.43 L 36.22 -98.61 L 36.60 -98.32 A 3.36 3.36 0 0 1 42.98 -97.69 Z',
  'M 38.08 -33.79 L 84.02 -3.10 L 83.76 -2.69 A 5.51 5.51 0 0 1 87.06 3.43 L 87.40 3.56 L 86.94 93.68 L 87.04 93.68 A 3.08 3.08 0 0 1 81.75 95.73 L 81.55 95.85 L 56.81 79.61 L 56.92 79.45 A 4.98 4.98 0 0 1 53.51 73.99 L 52.99 73.91 L 52.91 32.78 L 50.36 23.88 L 45.45 14.44 L 38.35 6.11 L 7.99 -14.74 L 7.93 -14.68 A 2.42 2.42 0 0 1 8.70 -19.35 L 8.62 -19.47 L 30.00 -34.44 L 30.06 -34.36 A 6.22 6.22 0 0 1 37.98 -33.63 Z',
  'M -56.20 22.64 L -11.88 51.81 L -11.63 51.39 A 31.27 31.27 0 0 0 7.09 55.51 L 7.16 55.90 L 18.51 52.74 L 27.18 47.92 L 40.47 34.54 L 40.20 34.21 A 3.02 3.02 0 0 1 44.80 37.48 L 45.10 37.55 L 44.97 65.22 L 44.25 65.22 A 6.17 6.17 0 0 1 41.03 71.40 L 41.12 71.56 L 3.13 98.38 L 2.97 98.17 A 6.62 6.62 0 0 1 -5.32 98.15 L -5.44 98.27 L -85.49 44.84 L -85.37 44.64 A 3.53 3.53 0 0 1 -85.43 38.22 L -85.55 38.09 L -63.22 22.55 L -62.96 22.86 A 5.08 5.08 0 0 1 -56.41 22.86 Z',
];

/* 8SSEDT: two sweeps propagating the nearest-seed offset. Run it twice, once
   toward the ink, once away from it, and the difference is signed. */
function distanceTransform(mask, size, want) {
  const N = size * size, INF = 1e9;
  const gx = new Float32Array(N), gy = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const seed = mask[i] === want;
    gx[i] = seed ? 0 : INF;
    gy[i] = seed ? 0 : INF;
  }
  const put = (x, y, ox, oy) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const bx = x + ox, by = y + oy;
    if (bx < 0 || by < 0 || bx >= size || by >= size) return;
    const i = y * size + x, k = by * size + bx;
    const nx = gx[k] + ox, ny = gy[k] + oy;
    if (nx * nx + ny * ny < gx[i] * gx[i] + gy[i] * gy[i]) { gx[i] = nx; gy[i] = ny; }
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) { put(x,y,-1,0); put(x,y,0,-1); put(x,y,-1,-1); put(x,y,1,-1); }
    for (let x = size - 1; x >= 0; x--) put(x,y,1,0);
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) { put(x,y,1,0); put(x,y,0,1); put(x,y,-1,1); put(x,y,1,1); }
    for (let x = 0; x < size; x++) put(x,y,-1,0);
  }
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = Math.hypot(gx[i], gy[i]);
  return d;
}

/* Signed distance in units of the half-box, so 1.0 is the body radius. */
function markField(size) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const s = size / MARK_VIEW;
  // Canvas y runs down and the shader's runs up, so flip here once rather
  // than fighting it per-sample later.
  ctx.setTransform(s, 0, 0, -s, size / 2, size / 2);
  ctx.fillStyle = '#fff';
  for (const d of MARK_PATHS) ctx.fill(new Path2D(d));

  const px = ctx.getImageData(0, 0, size, size).data;
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;

  const outside = distanceTransform(mask, size, 1);
  const inside = distanceTransform(mask, size, 0);
  const half = size / 2;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    out[i] = (mask[i] ? -inside[i] : outside[i]) / half;
  }
  return out;
}

/* ── the field ──────────────────────────────────────────────────────── */

const VERT = `#version 300 es
in vec2 pos;
void main() { gl_Position = vec4(pos, 0.0, 1.0); }`;

/* Pass A, domain-warped fbm. Two warps, five octaves; the warp vector is
   kept because its magnitude is what draws the pale filaments. */
const FIELD = `#version 300 es
precision highp float;
uniform vec2  uRes;
uniform float uTime;
uniform vec2  uMouse;
out vec4 frag;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(dot(hash2(i + vec2(0, 0)), f - vec2(0, 0)),
                 dot(hash2(i + vec2(1, 0)), f - vec2(1, 0)), u.x),
             mix(dot(hash2(i + vec2(0, 1)), f - vec2(0, 1)),
                 dot(hash2(i + vec2(1, 1)), f - vec2(1, 1)), u.x), u.y);
}

/* Seven metaballs. Noise alone never makes a shape, only texture, and
   pushing its contrast only makes louder texture. A body needs a boundary,
   and the inverse-square sum gives one that merges and separates the way
   liquid actually does. The sample position is displaced by the flow field
   before evaluation, so the silhouettes wobble instead of reading as
   seven clean circles. */
float blobs(vec2 p, float t) {
  float s = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    vec2 c = vec2(
      sin(t * (0.19 + fi * 0.031) + fi * 2.13) * 0.62,
      cos(t * (0.15 + fi * 0.026) + fi * 1.71) * 0.44);
    float r = 0.135 + 0.055 * sin(fi * 3.1 + 1.0);
    vec2 d = p - c;
    s += r * r / max(dot(d, d), 2e-4);
  }
  return s;
}

float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = m * p; a *= 0.5; }
  return s;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p  = (gl_FragCoord.xy - 0.5 * uRes) / min(uRes.x, uRes.y);

  // How far from the middle of the frame, normalised so 1.0 is the short
  // edge. The whole palette hangs off this rather than off the noise.
  float rad = length(p) * 2.0;

  vec2 pn = p;          // unscaled: the blob field works in this space
  p *= 1.9;
  float t = uTime * 0.14;

  // The pointer displaces the field rather than lighting it, like a hand in water.
  vec2 md = p - uMouse * 1.9;
  p += normalize(md + 1e-5) * 0.11 * exp(-3.4 * dot(md, md));

  // A bulk current every level shares, so the field travels as one body.
  // Opposing drifts per level cancel into churn: the pattern then morphs in
  // place and never goes anywhere, which measured as a 2px shift over five
  // seconds when it should have been twenty-five.
  vec2 flow = vec2(t * 0.75, t * 0.30);
  vec2 q = vec2(fbm(p + flow), fbm(p + flow + vec2(5.2, 1.3)));
  vec2 r = vec2(fbm(p + flow * 0.92 + 1.7 * q + vec2(1.7, 9.2)),
                fbm(p + flow * 0.92 + 1.7 * q + vec2(8.3, 2.8)));
  float f = fbm(p + flow * 0.84 + 1.85 * r);

  // A lit centre falling to near-black at the edges: the ground is a lamp
  // behind the page, and the liquid only modulates it.
  const vec3 core = vec3(0.145, 0.388, 0.788);
  const vec3 mid  = vec3(0.055, 0.165, 0.361);
  const vec3 edge = vec3(0.016, 0.043, 0.102);
  const vec3 ice  = vec3(0.812, 0.886, 1.000);

  vec3 ramp = mix(core, mid, smoothstep(0.05, 1.20, rad));
  ramp = mix(ramp, edge, smoothstep(1.05, 2.05, rad));

  float v = clamp(f * 0.5 + 0.5, 0.0, 1.0);
  v = smoothstep(0.14, 0.86, v);
  vec3 col = ramp * (0.44 + 0.74 * v);

  // Caustics. Folding the field back on itself and taking a high power of
  // the fold leaves thin bright filaments, the net light makes through
  // moving water, and the single strongest signal that this is liquid.
  float fold  = 1.0 - abs(fract(f * 2.6 + length(r) * 0.55 + uTime * 0.085) * 2.0 - 1.0);
  float caust = pow(fold, 15.0) * smoothstep(0.18, 0.70, v);
  col += mix(core, ice, 0.68) * caust * 0.34 * (1.0 - smoothstep(0.30, 1.40, rad));

  // Wet sheen: read the field as a height map and light it. Derivatives are
  // safe here because this pass has no branching.
  vec2  grad  = vec2(dFdx(f), dFdy(f)) * 90.0;
  vec3  nrm   = normalize(vec3(-grad, 1.0));
  float la    = uTime * 0.055;
  vec3  ldir  = normalize(vec3(-0.40 + 0.26 * sin(la), 0.66 + 0.16 * cos(la * 0.8), 0.64));
  float sheen = pow(max(dot(nrm, ldir), 0.0), 9.0);
  col += vec3(0.80, 0.89, 1.0) * sheen * 0.10 * (1.0 - smoothstep(0.4, 1.6, rad));

  // Tooth. A high-frequency layer keeps the gradient from reading as vector
  // art; it is the texture the grain overlay alone could not carry.
  col += vec3(0.72, 0.82, 1.0) * (noise(p * 9.5) * 0.5) * 0.085;

  // Bodies. The flow displaces the lookup, so an edge ripples with the
  // current rather than sitting still on a mathematical circle.
  float bs   = blobs(pn + r * 0.045, uTime);
  float mask = smoothstep(0.88, 1.22, bs);
  float rim  = smoothstep(0.86, 1.02, bs) * (1.0 - smoothstep(1.02, 1.30, bs));

  // Inside is the same liquid, lifted and given more of the caustic, so a
  // body reads as deeper water rather than as a sticker over the top.
  col = mix(col, col * 1.17 + mix(core, ice, 0.35) * 0.018, mask);
  col += mix(core, ice, 0.75) * caust * 0.16 * mask;

  // Surface tension: the line where the meniscus catches the light. Enough
  // to draw the edge, not enough to outline it.
  col += vec3(0.78, 0.88, 1.0) * rim * 0.115 * (1.0 - smoothstep(0.55, 1.7, rad));

  // A little haze where the liquid piles up, only near the lit middle.
  col += ice * smoothstep(0.66, 1.0, v) * 0.05 * (1.0 - smoothstep(0.15, 0.95, rad));

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  const float cap = 0.26;
  if (lum > cap) col *= mix(1.0, cap / lum, 0.88);

  frag = vec4(col, 1.0);
}`;

/* Pass B, the composite. The glass body is a rotated squircle whose thickness
   profile bends the field behind it, with a per-channel split at the rim. */
const GLASS = `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform vec2  uRes;
uniform float uTime;
uniform vec3  uBody;   // x, y (px, top-left origin), radius (px)
uniform vec2  uBodyFx; // rotation (rad), presence 0..1
uniform sampler2D uMark;  // signed distance, 1.0 = body radius
out vec4 frag;

vec2 rot(vec2 p, float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c) * p;
}

/* The mark's distance field, rasterised from the real paths on the CPU and
   uploaded once. One texture read replaces twenty-four segment evaluations,
   and it is the actual logo rather than an approximation of it. */
float sdMark(vec2 p, float r, float t) {
  vec2 uv = p / (r * 2.0) + 0.5;
  // Outside the field's box there is nothing to shade; report far away.
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return r;
  // The swell that keeps it reading as liquid rather than as a solid.
  return (texture(uMark, uv).r - 0.012 * sin(t * 0.42)) * r;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;

  vec2  rd = uv - 0.5;
  float r2 = dot(rd, rd);
  vec3 col = vec3(
    texture(uField, uv - rd * r2 * 0.028).r,
    texture(uField, uv).g,
    texture(uField, uv + rd * r2 * 0.028).b);

  float amt = uBodyFx.y;
  if (amt > 0.001) {
    float R = uBody.z;
    vec2  c = vec2(uBody.x, uRes.y - uBody.y);          // to GL origin
    vec2  p = rot(gl_FragCoord.xy - c, uBodyFx.x);

    // Nothing past the mark's reach can contribute, and the field costs 24
    // segment evaluations a sample, so reject most of the screen first.
    if (dot(p, p) < R * R * 2.1) {
      float d = sdMark(p, R, uTime);

      // Cast first, so the body sits on the field instead of over it.
      float sh = 1.0 - smoothstep(0.0, R * 0.20, sdMark(p - vec2(0.0, R * 0.08), R, uTime));
      col *= 1.0 - 0.24 * sh * sh * amt;

      float halo = exp(-max(d, 0.0) / (R * 0.11)) * step(0.0, d);
      col += vec3(0.52, 0.70, 1.0) * halo * 0.105 * amt;

      float cover = 1.0 - smoothstep(-1.2, 1.2, d);
      if (cover > 0.001) {
        /* A bevel, not a dome. The deepest interior point of the mark is
           only 0.19R, so the old profile saturated across the whole slab
           and the surface read flat. A narrow rounded band at the edge
           with a flat top is what thick glass actually looks like, and it
           gives the highlight an edge to run along. */
        float bev = clamp(-d / (R * 0.085), 0.0, 1.0);
        float h = sqrt(max(bev * (2.0 - bev), 0.0));

        vec2 eps = vec2(1.1, 0.0);
        vec2 g = normalize(vec2(
          sdMark(p + eps.xy, R, uTime) - d,
          sdMark(p + eps.yx, R, uTime) - d) + 1e-6);

        vec3 nrm = normalize(vec3(g * (1.0 - h) * 2.1, max(h, 0.05)));
        vec3 ref = refract(vec3(0.0, 0.0, -1.0), nrm, 1.0 / 1.52);
        vec2 off = ref.xy * (R * 0.55) / uRes;

        // Dispersion is strongest where the glass bends most, so it rides
        // the bevel rather than sitting flat across the whole body.
        float disp = 0.018 * (1.0 + (1.0 - h) * 2.6);
        vec3 g2 = vec3(
          texture(uField, uv + off * (1.0 - disp)).r,
          texture(uField, uv + off).g,
          texture(uField, uv + off * (1.0 + disp)).b);

        float fres = pow(1.0 - h, 2.6);
        vec3  L    = normalize(vec3(-0.46, 0.72, 0.52));
        vec3  L2   = normalize(vec3(0.62, -0.42, 0.66));
        vec3  V    = vec3(0.0, 0.0, 1.0);
        // Tighter than the rod version wanted: on a bevel the highlight is
        // a line along the crown, not a wash across a tube.
        float spec = pow(max(dot(reflect(-L, nrm), V), 0.0), 44.0);
        float fill = pow(max(dot(reflect(-L2, nrm), V), 0.0), 22.0);
        float crown = smoothstep(0.58, 0.93, h) * (1.0 - smoothstep(0.93, 1.0, h));

        vec3 body = g2 * (0.92 + 0.34 * h);
        body += vec3(0.88, 0.93, 1.0) * fres * 0.42;               // rim
        body += vec3(1.0) * spec * 1.15;                           // highlight
        body += vec3(0.84, 0.90, 1.0) * fill * 0.22;               // counter-light
        body += vec3(0.80, 0.88, 1.0) * crown * 0.15;              // the bevel crown
        body += vec3(0.90, 0.94, 1.0)
              * (1.0 - smoothstep(0.0, 1.6, abs(d))) * 0.26;       // silhouette
        body += vec3(0.62, 0.74, 1.0) * (0.045 + 0.035 * h);      // the glass tint

        col = mix(col, body, cover * amt);
      }
    }
  }

  frag = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || 'shader failed');
  }
  return sh;
}

function program(gl, fragSrc) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.bindAttribLocation(p, 0, 'pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  }
  return p;
}

function startField(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;

  // Half-float lets the field keep its headroom through the refraction pass.
  let halfFloat = !!(gl.getExtension('EXT_color_buffer_half_float')
                  || gl.getExtension('EXT_color_buffer_float'));

  const fieldProg = program(gl, FIELD);
  const glassProg = program(gl, GLASS);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  /* R16F keeps the dome smooth; an 8-bit field banded visibly at this size.
     WebGL2 accepts FLOAT data for an R16F texture and converts on upload,
     and R16F is filterable in core, so no extension is needed. */
  const MARK_SIZE = 384;
  const markTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, markTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, MARK_SIZE, MARK_SIZE, 0,
                gl.RED, gl.FLOAT, markField(MARK_SIZE));

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const u = (p, name) => gl.getUniformLocation(p, name);
  const uF = { res: u(fieldProg, 'uRes'), time: u(fieldProg, 'uTime'), mouse: u(fieldProg, 'uMouse') };
  const uG = {
    field: u(glassProg, 'uField'), res: u(glassProg, 'uRes'), time: u(glassProg, 'uTime'),
    mark: u(glassProg, 'uMark'),
    body: u(glassProg, 'uBody'), fx: u(glassProg, 'uBodyFx'),
  };

  // Under full resolution on purpose: the softness is the look and the
  // headroom pays for the second pass. Not half, either, because the upscale
  // eats the caustics and the tooth, which are fine detail.
  const FIELD_SCALE = 0.85;
  let w = 0, h = 0, fw = 0, fh = 0;

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.75);
    const nw = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const nh = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (nw === w && nh === h) return;
    w = canvas.width = nw;
    h = canvas.height = nh;
    fw = Math.max(1, Math.round(w * FIELD_SCALE));
    fh = Math.max(1, Math.round(h * FIELD_SCALE));
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (halfFloat) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, fw, fh, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        halfFloat = false;   // fall through to RGBA8 below, once, for good
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    if (!halfFloat) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
  }

  /* Each page builds its own WebGL context, so without this the field
     restarts and the liquid jumps back to where it began mid-transition.
     Carrying the clock in sessionStorage makes the ground one continuous
     surface across the whole site. */
  const startTime = Number(sessionStorage.getItem('oblivion:t')) || 37.5;

  const state = {
    time: startTime, mouse: [0, 0], body: [0, 0, 0],
    rot: -0.14,   // final rotation handed to the shader
    spin: -0.14,  // the part of it that accumulates with time
    lean: 0,      // the part that comes from scrolling through the act
    amt: 0,
  };

  function draw() {
    resize();

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, fw, fh);
    gl.useProgram(fieldProg);
    gl.uniform2f(uF.res, fw, fh);
    gl.uniform1f(uF.time, state.time);
    gl.uniform2f(uF.mouse, state.mouse[0], state.mouse[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.useProgram(glassProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uG.field, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, markTex);
    gl.uniform1i(uG.mark, 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(uG.res, w, h);
    gl.uniform1f(uG.time, state.time);
    const s = w / canvas.clientWidth;   // CSS px → device px
    gl.uniform3f(uG.body, state.body[0] * s, state.body[1] * s, state.body[2] * s);
    gl.uniform2f(uG.fx, state.rot, state.amt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // pagehide fires on navigation where unload is unreliable, including
  // when the page goes into the back/forward cache.
  addEventListener('pagehide', () => {
    try { sessionStorage.setItem('oblivion:t', String(state.time)); } catch {}
  });

  return { state, draw, gl };
}

/* ── scroll bookkeeping ─────────────────────────────────────────────── */

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

function main() {
  const canvas = document.getElementById('field');
  const field = startField(canvas);

  if (!field) {
    // No WebGL2: the site still needs a ground, so CSS paints a still one.
    document.body.classList.add('no-gl');
    canvas.remove();
  }

  const acts = [...document.querySelectorAll('.act')];
  const masthead = document.getElementById('masthead');
  const bodyEl = document.querySelector('[data-glass-body]');

  /* Reveal on entry. Once seen, it stays seen. A section that re-animates
     every time you scroll back past it is a section you stop reading. */
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.setAttribute('data-seen', '');
      seen.unobserve(e.target);
    }
  }, { rootMargin: '0px 0px -12% 0px', threshold: 0.18 });

  /* Every selector whose styles are gated on [data-seen] must appear here.
     One left out never receives the attribute and stays at opacity 0 for
     good, which reads as a layout bug rather than a missing observer. */
  const REVEAL = '.act, [data-row], [data-rise], [data-tier]';
  for (const el of document.querySelectorAll(REVEAL)) seen.observe(el);

  /* ── pricing ─────────────────────────────────────────────────────── */

  /* Each digit is a reel of ten. Rebuilding on every change means the roll
     always starts from zero, which reads as counting rather than sliding,
     and it sidesteps the case where the two plans have different digit
     counts and the reels would not line up. */
  function roll(el, value) {
    el.textContent = '';
    for (const ch of String(value)) {
      const cell = document.createElement('i');
      if (ch === '.') {
        cell.className = 'dot';
        cell.textContent = '.';
      } else {
        const reel = document.createElement('span');
        for (let n = 0; n <= 9; n++) {
          const b = document.createElement('b');
          b.textContent = String(n);
          reel.append(b);
        }
        cell.append(reel);
        cell.dataset.n = ch;
      }
      el.append(cell);
    }
    // Forced reflow rather than a frame: requestAnimationFrame never runs in
    // a background tab and this page can load in one. The reels still roll,
    // but the price is correct without waiting for them.
    el.getBoundingClientRect();
    for (const cell of el.querySelectorAll('i[data-n]')) {
      cell.firstElementChild.style.setProperty('--n', cell.dataset.n);
    }
  }

  const swap = document.querySelector('[data-plan]')?.closest('.swap');
  if (swap) {
    const setPlan = (plan) => {
      for (const b of swap.querySelectorAll('.swap-opt')) {
        b.setAttribute('aria-pressed', String(b.dataset.plan === plan));
      }
      for (const odo of document.querySelectorAll('.odo')) {
        roll(odo, odo.dataset[plan]);
      }
      for (const per of document.querySelectorAll('[data-per]')) {
        fadeTo(per, plan === 'month' ? '/ month' : '/ 2 weeks');
      }
      for (const alt of document.querySelectorAll('[data-alt]')) {
        const tier = alt.closest('.tier').querySelector('.odo').dataset;
        fadeTo(alt, plan === 'month'
          ? 'or $' + tier.fortnight + ' for 2 weeks'
          : 'or $' + tier.month + ' a month');
      }
    };
    swap.addEventListener('click', (ev) => {
      const b = ev.target.closest('.swap-opt');
      if (b) { setPlan(b.dataset.plan); placePlan(true); }
    });
    setPlan('fortnight');
    const placePlan = slideThumb(swap);
  }

  /* ── the segmented control ────────────────────────────────────────── */

  /* The thumb is measured from the live button rather than assumed, so it
     tracks whatever the text actually wraps to. Placing it without a
     transition on first paint and on resize stops it sliding in from zero. */
  function slideThumb(group) {
    const thumb = document.createElement('span');
    thumb.className = 'swap-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    group.prepend(thumb);

    const place = (animate) => {
      const on = group.querySelector('[aria-pressed="true"]');
      if (!on) return;
      const g = group.getBoundingClientRect();
      const b = on.getBoundingClientRect();
      if (!g.width) return;               // laid out yet?
      if (!animate) thumb.style.transition = 'none';
      thumb.style.width = b.width + 'px';
      thumb.style.transform = 'translateX(' + (b.left - g.left - 4) + 'px)';
      if (!animate) { thumb.getBoundingClientRect(); thumb.style.transition = ''; }
    };

    place(false);
    addEventListener('resize', () => place(false), { passive: true });
    // The system face settles after first paint and the labels reflow with it.
    document.fonts?.ready.then(() => place(false));
    return place;
  }

  /* Fades the old label out, swaps it, fades it back. */
  function fadeTo(el, text) {
    if (el.textContent === text) return;
    el.style.opacity = '0';
    setTimeout(() => { el.textContent = text; el.style.opacity = '1'; }, 170);
  }

  /* ── feedback ─────────────────────────────────────────────────────── */

  /* Set this to a URL that accepts a JSON POST of {kind, message} and the
     form submits to it. Left empty, the form does NOT pretend to send:
     it says where to post instead and selects the text so it can be
     copied. A form that silently swallows a bug report is worse than no
     form at all. */
  const FEEDBACK_ENDPOINT = '';
  const DISCORD = 'https://discord.gg/WC8zdytZTE';

  const feedback = document.getElementById('feedback');
  if (feedback) {
    const kinds = feedback.querySelector('.swap');
    const note = document.getElementById('feedbackNote');
    const field = document.getElementById('message');
    let kind = 'feedback';

    kinds.addEventListener('click', (ev) => {
      const b = ev.target.closest('.swap-opt');
      if (!b) return;
      kind = b.dataset.kind;
      for (const o of kinds.querySelectorAll('.swap-opt')) {
        o.setAttribute('aria-pressed', String(o === b));
      }
      placeKind(true);
    });
    const placeKind = slideThumb(kinds);

    feedback.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const message = field.value.trim();
      if (!message) { field.focus(); return; }

      if (!FEEDBACK_ENDPOINT) {
        note.innerHTML = 'No endpoint is wired up yet, so nothing was sent. ' +
          'Post it in the <a href="' + DISCORD + '" target="_blank" rel="noopener">Discord</a> ' +
          '— your message is selected, ready to copy.';
        field.select();
        return;
      }

      note.textContent = 'Sending…';
      try {
        const res = await fetch(FEEDBACK_ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind, message }),
        });
        if (!res.ok) throw new Error(res.status);
        note.textContent = 'Sent. Thank you, I read every message.';
        field.value = '';
      } catch {
        note.innerHTML = 'That did not send. Try the ' +
          '<a href="' + DISCORD + '" target="_blank" rel="noopener">Discord</a> instead.';
      }
    });
  }

  /* The line. Clipboard writes reject on an insecure origin and when the
     document is not focused, so the failure path has to leave the user
     something to do rather than a button that silently did nothing. */
  const copyBtn = document.getElementById('copy');
  if (copyBtn) {
    const label = document.getElementById('copyText');
    const code = document.getElementById('run');
    let revert;
    copyBtn.addEventListener('click', async () => {
      const line = code.textContent.trim();
      try {
        await navigator.clipboard.writeText(line);
        label.textContent = 'Copied';
      } catch {
        // Select it instead, so ctrl-C still works.
        const range = document.createRange();
        range.selectNodeContents(code);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        label.textContent = 'Press ⌘C';
      }
      copyBtn.setAttribute('data-done', '');
      clearTimeout(revert);
      revert = setTimeout(() => {
        label.textContent = 'Copy';
        copyBtn.removeAttribute('data-done');
      }, 2000);
    });
  }

  /* Cross-document view transitions are the real thing, but they are not
     everywhere, and a browser that cannot run one should still show motion
     between pages. This only arms when the native path is missing, so the
     two never play at once. */
  const nativeTransitions =
    CSS.supports('selector(::view-transition)') && 'onpagereveal' in window;

  if (!nativeTransitions) {
    addEventListener('click', (ev) => {
      if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey) return;
      const a = ev.target instanceof Element ? ev.target.closest('a[href]') : null;
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('/') || a.target === '_blank') return;
      ev.preventDefault();
      document.documentElement.setAttribute('data-leaving', '');
      // Slightly longer than the CSS, so the paint lands before the swap.
      setTimeout(() => { location.href = href; }, 270);
    });
  }

  /* Where the flood starts. Captured on the way out, applied on the way in
     The new document is a different document, so the only way it knows
     where you clicked is to be told. */
  addEventListener('click', (ev) => {
    const a = ev.target instanceof Element ? ev.target.closest('a[href]') : null;
    if (!a) return;
    const href = a.getAttribute('href') || '';
    // Same-origin page links only; hashes and the Discord go elsewhere.
    if (!href.startsWith('/') || a.target === '_blank') return;
    try {
      sessionStorage.setItem('oblivion:origin', ev.clientX + 'px ' + ev.clientY + 'px');
    } catch {}
  }, { capture: true });

  /* The nav blob's light follows the cursor along the link, so the liquid
     looks like it is welling up under the pointer rather than centred. */
  if (matchMedia('(hover: hover)').matches) {
    for (const a of document.querySelectorAll('.masthead-nav a:not(.pill)')) {
      a.addEventListener('pointermove', (ev) => {
        const r = a.getBoundingClientRect();
        a.style.setProperty('--nx', ((ev.clientX - r.left) / r.width) * 100 + '%');
      }, { passive: true });
    }
  }

  /* Pointer-tracked specular. One listener for every glass surface. */
  if (matchMedia('(hover: hover)').matches) {
    addEventListener('pointermove', (ev) => {
      if (field) {
        field.state.mouse[0] = (ev.clientX / innerWidth - 0.5) * (innerWidth / Math.min(innerWidth, innerHeight));
        field.state.mouse[1] = (0.5 - ev.clientY / innerHeight) * (innerHeight / Math.min(innerWidth, innerHeight));
      }
      const el = ev.target instanceof Element ? ev.target : null;
      if (!el) return;

      /* Both, not the nearest of the two: a tier's CTA is itself .glass, so
         closest() on a combined selector would stop at the button and the
         card's own light would freeze while the pointer was over it. */
      for (const sel of ['.glass', '.tier']) {
        const t = el.closest(sel);
        if (!t) continue;
        const r = t.getBoundingClientRect();
        t.style.setProperty('--gx', ((ev.clientX - r.left) / r.width) * 100 + '%');
        t.style.setProperty('--gy', ((ev.clientY - r.top) / r.height) * 100 + '%');
      }

      const q = el.closest('.quiet');
      if (q) {
        const qr = q.getBoundingClientRect();
        q.style.setProperty('--qx', ((ev.clientX - qr.left) / qr.width) * 100 + '%');
      }
    }, { passive: true });
  }

  /* Per-frame: act progress, the masthead ground, and where the glass body
     has to be for the shader and the layout to agree. */
  // Act geometry is layout, not scroll, so measure it once and on resize
  // rather than forcing a reflow on every frame.
  let layout = [];
  const measure = () => {
    layout = acts.map((el) => ({ el, top: el.offsetTop, h: el.offsetHeight }));
  };
  measure();
  addEventListener('resize', measure, { passive: true });
  // Card copy reflows as the system face settles, and that moves the height
  // of every act below the system section.
  document.fonts?.ready.then(measure);

  let smoothY = scrollY;

  function sync() {
    const vh = innerHeight;

    for (const a of layout) {
      const budget = Math.max(1, a.h - vh);
      a.el.style.setProperty('--p', clamp01((smoothY - a.top) / budget).toFixed(4));
    }

    // The bar is a control, not a scroll effect, so it should not lag.
    masthead.toggleAttribute('data-stuck', scrollY > 64);

    if (field && bodyEl) {
      const r = bodyEl.getBoundingClientRect();
      field.state.body[0] = r.left + r.width / 2;
      field.state.body[1] = r.top + r.height / 2;
      field.state.body[2] = Math.min(r.width, r.height) * 0.47;
      // Fades with distance from the middle of the viewport, so it arrives
      // and leaves with its own copy rather than popping.
      const off = Math.abs(r.top + r.height / 2 - vh / 2) / (vh * 0.95);
      field.state.amt = clamp01(1.25 - off * 1.25);

      // The body turns as you scroll through its act, so it reads as part
      // of the page rather than as a loop playing behind it.
      const twin = layout.find((a) => a.el.classList.contains('act-twin'));
      if (twin) {
        const p = clamp01((smoothY - twin.top) / Math.max(1, twin.h - vh));
        field.state.lean = (p - 0.5) * 0.85;
      }
    }
  }

  document.documentElement.setAttribute('data-booted', '');

  if (reduced.matches) {
    let queued = false;
    const redraw = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        smoothY = scrollY;   // no damping when motion is not wanted
        sync();
        field?.draw();
      });
    };
    redraw();
    addEventListener('scroll', redraw, { passive: true });
    addEventListener('resize', redraw, { passive: true });
    return;
  }

  // A page that loads in a background tab gets no rAF at all, so the first
  // state has to be written synchronously or --p stays unset until the tab
  // is looked at.
  sync();
  field?.draw();

  let last = performance.now();
  let running = true;

  function frame(now) {
    if (!running) return;
    const dt = Math.min((now - last) / 1000, 1 / 20);
    last = now;

    // Exponential follow, framed in dt so it behaves the same at 60 and 120Hz.
    smoothY += (scrollY - smoothY) * (1 - Math.exp(-dt * 10));

    if (field) {
      field.state.time += dt;
      field.state.spin += dt * 0.085;
      field.state.rot = field.state.spin + field.state.lean;
    }
    sync();
    field?.draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // A hidden tab has nothing to animate for.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { running = false; return; }
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  });
}

main();

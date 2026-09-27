import { buildCurveLut, CURVE_LUT_SIZE } from '../lib/curve';
import { getLut, type Lut } from '../lib/luts';
import { GRADE_ZONES, HSL_COLORS, type Settings } from '../lib/types';
import { BLUR_FRAG, COPY_FRAG, MAIN_FRAG, VERT } from './shaders';

export type ImageSource = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

/** A blurred copy of the source at one scale; `b` is scratch space for the separable passes. */
interface BlurLevel {
  a: Target;
  b: Target;
  passes: number;
}

/** Long edge (px) and pass count of each blur level: texture detail, clarity, dehaze. */
const BLUR_LEVELS: [number, number][] = [
  [1024, 1],
  [160, 2],
  [40, 2],
];

class Program {
  readonly prog: WebGLProgram;
  private locs = new Map<string, WebGLUniformLocation | null>();

  constructor(private gl: WebGL2RenderingContext, vs: string, fs: string) {
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Shader link failed: ${gl.getProgramInfoLog(prog)}`);
    this.prog = prog;
  }

  loc(name: string): WebGLUniformLocation | null {
    if (!this.locs.has(name)) this.locs.set(name, this.gl.getUniformLocation(this.prog, name));
    return this.locs.get(name)!;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(sh)}`);
  return sh;
}

/**
 * GPU develop engine: load an image (or a video frame) once, then render any Settings to its canvas.
 * Loading a same-sized frame again reuses every GPU buffer, so video playback stays cheap.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly maxSize: number;
  private gl: WebGL2RenderingContext;
  private main: Program;
  private blur: Program;
  private copy: Program;
  private src: WebGLTexture | null = null;
  private blurs: BlurLevel[] = [];
  private curveTex: WebGLTexture;
  private curveKey = '';
  private lutTex: WebGLTexture;
  private lutKey = '';
  private lutSize = 2;
  private imgW = 0;
  private imgH = 0;

  constructor(canvas: HTMLCanvasElement = document.createElement('canvas')) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false, antialias: false });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.main = new Program(gl, VERT, MAIN_FRAG);
    this.blur = new Program(gl, VERT, BLUR_FRAG);
    this.copy = new Program(gl, VERT, COPY_FRAG);
    this.curveTex = this.createTexture(false);
    this.lutTex = gl.createTexture()!;
    // 2³ identity so the sampler always has something valid bound
    this.uploadLut(2, new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255, 0, 255, 255, 0, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]));
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
    this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE), dims[0], dims[1], 16384);
  }

  get width() {
    return this.imgW;
  }
  get height() {
    return this.imgH;
  }

  setImage(img: ImageSource): void {
    const gl = this.gl;
    const w = img.width;
    const h = img.height;
    const reuse = this.src !== null && w === this.imgW && h === this.imgH;
    this.imgW = w;
    this.imgH = h;

    if (reuse) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.src);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
    } else {
      if (this.src) gl.deleteTexture(this.src);
      this.src = this.createTexture(true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
      for (const level of this.blurs) {
        this.deleteTarget(level.a);
        this.deleteTarget(level.b);
      }
      // Blur sizes are relative to the image, so the look is the same at preview and export size.
      this.blurs = BLUR_LEVELS.map(([edge, passes]) => {
        const scale = Math.min(1, edge / Math.max(w, h));
        const bw = Math.max(1, Math.round(w * scale));
        const bh = Math.max(1, Math.round(h * scale));
        return { a: this.createTarget(bw, bh), b: this.createTarget(bw, bh), passes };
      });
    }
    // createTarget() rebinds TEXTURE0, so bind the source again before building its mipmaps —
    // without them the (mipmapped) source texture is incomplete and samples as black.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.generateMipmap(gl.TEXTURE_2D);
    for (const level of this.blurs) this.runBlur(level);
  }

  render(s: Settings, width = this.imgW, height = this.imgH): void {
    if (!this.src) return;
    const { gl, canvas } = this;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.updateCurve(s);
    const lut = s.lut.id && s.lut.amount > 0 ? getLut(s.lut.id) : undefined;
    this.updateLut(lut);

    const p = this.main;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.useProgram(p.prog);

    const textures = [this.src, this.blurs[0].a.tex, this.blurs[1].a.tex, this.blurs[2].a.tex, this.curveTex];
    const names = ['uSrc', 'uBlurS', 'uBlurM', 'uBlurL', 'uCurve'];
    textures.forEach((tex, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(p.loc(names[i]), i);
    });
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.uniform1i(p.loc('uLut'), 5);

    const f = (name: string, v: number) => gl.uniform1f(p.loc(name), v);
    f('uExposure', s.exposure);
    f('uContrast', s.contrast / 100);
    f('uHighlights', s.highlights / 100);
    f('uShadows', s.shadows / 100);
    f('uWhites', s.whites / 100);
    f('uBlacks', s.blacks / 100);
    f('uTemp', s.temp / 100);
    f('uTint', s.tint / 100);
    f('uVibrance', s.vibrance / 100);
    f('uSaturation', s.saturation / 100);
    f('uTexture', s.texture / 100);
    f('uClarity', s.clarity / 100);
    f('uDehaze', s.dehaze / 100);
    f('uBlending', s.grading.blending / 100);
    f('uBalance', s.grading.balance / 100);
    f('uLutAmount', lut ? s.lut.amount / 100 : 0);
    f('uLutSize', this.lutSize);
    const v = s.vignette;
    gl.uniform4f(p.loc('uVignette'), v.amount / 100, v.midpoint / 100, v.roundness / 100, v.feather / 100);
    const gr = s.grain;
    gl.uniform3f(p.loc('uGrain'), gr.amount / 100, gr.size / 100, gr.roughness / 100);
    gl.uniform2f(p.loc('uImageSize'), this.imgW, this.imgH);

    const hsl = new Float32Array(24);
    let hslOn = false;
    HSL_COLORS.forEach((c, i) => {
      const a = s.hsl[c];
      hsl.set([a.hue / 100, a.sat / 100, a.lum / 100], i * 3);
      if (a.hue || a.sat || a.lum) hslOn = true;
    });
    gl.uniform1i(p.loc('uHslOn'), hslOn ? 1 : 0);
    gl.uniform3fv(p.loc('uHsl'), hsl);

    const grade = new Float32Array(12);
    GRADE_ZONES.forEach((z, i) => {
      const g = s.grading[z];
      grade.set([g.hue, g.sat / 100, g.lum / 100], i * 3);
    });
    gl.uniform3fv(p.loc('uGrade'), grade);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Reads the last render back as RGBA rows, top row first. */
  readPixels(): Uint8ClampedArray {
    const { gl } = this;
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    const flipped = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, flipped);
    const out = new Uint8ClampedArray(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) out.set(flipped.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    return out;
  }

  toBlob(type: string, quality?: number): Promise<Blob> {
    return new Promise((resolve, reject) =>
      this.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, quality),
    );
  }

  dispose(): void {
    const gl = this.gl;
    if (this.src) gl.deleteTexture(this.src);
    for (const level of this.blurs) {
      this.deleteTarget(level.a);
      this.deleteTarget(level.b);
    }
    gl.deleteTexture(this.curveTex);
    gl.deleteTexture(this.lutTex);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private updateCurve(s: Settings) {
    const key = JSON.stringify(s.curve);
    if (key === this.curveKey) return;
    this.curveKey = key;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.curveTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, CURVE_LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildCurveLut(s.curve));
  }

  /** Uploads the LUT only when it changes; when off, the old texture just sits unused. */
  private updateLut(lut: Lut | undefined) {
    if (!lut || lut.id === this.lutKey) return;
    this.lutKey = lut.id;
    this.uploadLut(lut.size, lut.data);
  }

  /** RGB bytes, red fastest — the .cube order maps directly onto a 3D texture's x/y/z. */
  private uploadLut(size: number, data: Uint8Array) {
    const gl = this.gl;
    this.lutSize = size;
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, size, size, size, 0, gl.RGB, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  }

  private createTexture(mipmap: boolean): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmap ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private createTarget(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.createTexture(false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }

  private deleteTarget(t: Target) {
    this.gl.deleteFramebuffer(t.fb);
    this.gl.deleteTexture(t.tex);
  }

  private pass(target: Target, prog: Program, input: WebGLTexture, dir?: [number, number]) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
    gl.viewport(0, 0, target.w, target.h);
    gl.useProgram(prog.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, input);
    gl.uniform1i(prog.loc('uTex'), 0);
    if (dir) gl.uniform2f(prog.loc('uDir'), dir[0], dir[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private runBlur({ a, b, passes }: BlurLevel) {
    this.pass(a, this.copy, this.src!);
    for (let i = 0; i < passes; i++) {
      this.pass(b, this.blur, a.tex, [1 / a.w, 0]);
      this.pass(a, this.blur, b.tex, [0, 1 / a.h]);
    }
  }
}

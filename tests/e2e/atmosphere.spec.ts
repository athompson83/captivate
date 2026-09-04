import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * The atmosphere shader, rendered and measured.
 *
 * A fragment shader is the one part of this codebase a unit test cannot reach,
 * and it is where a fault looks least like one: the field's Y axis was
 * reflected for two commits, and it read as an odd-looking gradient rather
 * than as a bug. It survived a code review, an offline render and a
 * screenshot before a measurement caught it.
 *
 * So this compiles the committed GLSL — read out of the component, never a
 * copy — draws it on a bare canvas with two regions of known colour and known
 * position, and reads the pixels back. No server, no account, no React.
 */

const component = readFileSync("src/components/stage/atmosphere.tsx", "utf8");
const library = readFileSync("src/lib/present/atmosphere.ts", "utf8");

function glsl(name: string): string {
  const start = component.indexOf(`const ${name} = /* glsl */ \``);
  expect(start, `${name} not found in atmosphere.tsx`).toBeGreaterThan(-1);
  const open = component.indexOf("`", start);
  return component.slice(open + 1, component.indexOf("`;", open + 1));
}

const MAX_REGIONS = Number(/export const MAX_REGIONS = (\d+)/.exec(library)![1]);
const FRAGMENT = glsl("FRAGMENT").replaceAll("${MAX_REGIONS}", String(MAX_REGIONS));
const VERTEX = glsl("VERTEX");

const W = 480;
const H = 360;

/** sRGB hex to OKLab, matching `src/lib/utils/color.ts`. */
function toOklab(hex: string): [number, number, number] {
  const channel = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const [r, g, b] = [lin(channel(0)), lin(channel(1)), lin(channel(2))];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

interface Region {
  x: number;
  y: number;
  canvas: [number, number, number];
  accent: [number, number, number];
}

/** Ember and Signal: the warmest and coldest accents the themes ship with. */
const WARM = { canvas: toOklab("#17110E"), accent: toOklab("#E8734A") };
const COLD = { canvas: toOklab("#101418"), accent: toOklab("#28E0A6") };

/** The stirring a flight puts into the air, as the shader receives it. */
interface Stir {
  motion: number;
  heading: [number, number];
  depth?: number;
}

async function draw(
  page: Page,
  regions: Region[],
  camera: { x: number; y: number; width: number; rotation: number },
  stir: Stir = { motion: 0, heading: [0, 0] },
) {
  return page.evaluate(
    ({ vertex, fragment, max, regions, camera, stir, W, H }) => {
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      document.body.append(canvas);
      const gl = canvas.getContext("webgl2");
      if (!gl) throw new Error("no webgl2");

      const compile = (type: number, src: string, prelude: string) => {
        const shader = gl.createShader(type)!;
        gl.shaderSource(shader, prelude + src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader) ?? "compile failed");
        }
        return shader;
      };

      const program = gl.createProgram()!;
      gl.attachShader(
        program,
        compile(gl.VERTEX_SHADER, vertex, "attribute vec3 position;\nattribute vec2 uv;\n"),
      );
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment, ""));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) ?? "link failed");
      }
      gl.useProgram(program);

      // Two triangles matching three's PlaneGeometry(2, 2): uv.v = 1 at the
      // +Y vertices, which is exactly the convention the flip exists for.
      const position = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
      const uv = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
      for (const [name, data] of [
        ["position", position],
        ["uv", uv],
      ] as const) {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        const location = gl.getAttribLocation(program, name);
        if (location >= 0) {
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
        }
      }

      const positions = new Float32Array(max * 2);
      const canvasCols = new Float32Array(max * 3);
      const accents = new Float32Array(max * 3);
      regions.forEach((region, i) => {
        positions[i * 2] = region.x;
        positions[i * 2 + 1] = region.y;
        canvasCols.set(region.canvas, i * 3);
        accents.set(region.accent, i * 3);
      });

      const u = (n: string) => gl.getUniformLocation(program, n);
      gl.uniform2f(u("uResolution"), W, H);
      gl.uniform2f(u("uCamera"), camera.x, camera.y);
      gl.uniform2f(u("uHalf"), W / 2, H / 2);
      gl.uniform1f(u("uInvScale"), camera.width / W);
      gl.uniform1f(u("uRotation"), (camera.rotation * Math.PI) / 180);
      gl.uniform1f(u("uTime"), 0);
      gl.uniform1f(u("uDepth"), stir.depth ?? 0.55);
      gl.uniform1f(u("uFalloff"), 1600 * 0.85);
      gl.uniform1f(u("uStage"), 1600);
      gl.uniform1f(u("uMotion"), stir.motion);
      gl.uniform2f(u("uHeading"), stir.heading[0], stir.heading[1]);
      gl.uniform1i(u("uCount"), regions.length);
      gl.uniform2fv(u("uPositions"), positions);
      gl.uniform3fv(u("uCanvas"), canvasCols);
      gl.uniform3fv(u("uAccent"), accents);
      gl.uniform3f(u("uBaseCanvas"), ...(regions[0]?.canvas ?? [0, 0, 0]));
      gl.uniform3f(u("uBaseAccent"), ...(regions[0]?.accent ?? [0, 0, 0]));

      gl.viewport(0, 0, W, H);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.finish();

      // gl y = 0 is the bottom row of the drawing buffer.
      const read = (x: number, y: number) => {
        const px = new Uint8Array(4);
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return [px[0], px[1], px[2]] as [number, number, number];
      };

      // The whole frame, for the tests that measure how much of it is stirred.
      const all = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, all);

      canvas.remove();
      return {
        top: read(W / 2, H - 8),
        bottom: read(W / 2, 8),
        left: read(8, H / 2),
        right: read(W - 8, H / 2),
        centre: read(W / 2, H / 2),
        frame: Array.from(all),
      };
    },
    { vertex: VERTEX, fragment: FRAGMENT, max: MAX_REGIONS, regions, camera, stir, W, H },
  );
}

/** Mean absolute difference per channel between two frames. */
function difference(a: number[], b: number[]): number {
  let total = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    count += 3;
  }
  return total / count;
}

/** Positive is warm, negative is cold. */
const warmth = (p: [number, number, number]) => p[0] - p[2];

test.beforeEach(async ({ page }) => {
  await page.setContent("<!doctype html><body></body>");
});

test("the shader compiles as committed", async ({ page }) => {
  const out = await draw(page, [{ x: 0, y: 0, ...COLD }], { x: 0, y: 0, width: 1600, rotation: 0 });
  expect(out.centre).toHaveLength(3);
});

test("a region above the camera lights the top of the screen", async ({ page }) => {
  // The regression this file exists for. three's PlaneGeometry puts uv.v = 1
  // at the top and screen space puts y = 0 there, so reading vUv straight
  // through reflected the field about the camera's horizontal axis.
  const out = await draw(
    page,
    [
      { x: 0, y: -1400, ...WARM },
      { x: 0, y: 1400, ...COLD },
    ],
    { x: 0, y: 0, width: 4000, rotation: 0 },
  );

  expect(warmth(out.top)).toBeGreaterThan(warmth(out.bottom));
});

test("a region left of the camera lights the left of the screen", async ({ page }) => {
  const out = await draw(
    page,
    [
      { x: -1400, y: 0, ...WARM },
      { x: 1400, y: 0, ...COLD },
    ],
    { x: 0, y: 0, width: 4000, rotation: 0 },
  );

  expect(warmth(out.left)).toBeGreaterThan(warmth(out.right));
});

test("the field turns with the camera", async ({ page }) => {
  // Rotating the camera a quarter turn should bring a region that was above
  // round to the side, not leave it where it was and not send it the wrong way.
  const regions: Region[] = [
    { x: 0, y: -1400, ...WARM },
    { x: 0, y: 1400, ...COLD },
  ];
  const upright = await draw(page, regions, { x: 0, y: 0, width: 4000, rotation: 0 });
  const turned = await draw(page, regions, { x: 0, y: 0, width: 4000, rotation: 90 });

  expect(warmth(upright.top)).toBeGreaterThan(warmth(upright.bottom));
  // A quarter turn puts the warm region on one side; which side is a sign
  // convention, so assert only that the vertical split has genuinely gone.
  expect(Math.abs(warmth(turned.top) - warmth(turned.bottom))).toBeLessThan(
    Math.abs(warmth(upright.top) - warmth(upright.bottom)),
  );
  expect(Math.abs(warmth(turned.left) - warmth(turned.right))).toBeGreaterThan(
    Math.abs(warmth(upright.left) - warmth(upright.right)),
  );
});

test("standing on one region renders that region's own colour", async ({ page }) => {
  // Not a wash of everything on the canvas: the room you are in is the room
  // you are in. Midnight's canvas is rgb(15,17,23); an averaged field was
  // rendering rgb(83,78,73) here.
  const MIDNIGHT = { canvas: toOklab("#0F1117"), accent: toOklab("#F0B858") };
  const out = await draw(
    page,
    Array.from({ length: 6 }, (_, i) => ({ x: i * 1728, y: 0, ...MIDNIGHT })),
    { x: 0, y: 0, width: 1600, rotation: 0 },
  );

  for (const channel of out.centre) {
    expect(channel).toBeLessThan(40);
  }
});

test.describe("depth", () => {
  const MIDNIGHT = { canvas: toOklab("#0F1117"), accent: toOklab("#F0B858") };
  const regions = [{ x: 0, y: 0, ...MIDNIGHT }];
  const camera = { x: 0, y: 0, width: 1600, rotation: 0 };

  test("a flight stirs the air, and a still camera barely does", async ({ page }) => {
    // The layer exists to move during a transition and to disappear on a
    // scene. Flat is what the journey's depth setting at zero asks for, so
    // that is the baseline: no motes at all.
    const flat = await draw(page, regions, camera, { motion: 0, heading: [0, 0], depth: 0 });
    const resting = await draw(page, regions, camera, { motion: 0, heading: [0, 0] });
    const flying = await draw(page, regions, camera, { motion: 1, heading: [1, 0] });

    const atRest = difference(resting.frame, flat.frame);
    const inFlight = difference(flying.frame, resting.frame);

    // Mean per-channel differences over the whole frame. The dust covers a
    // small fraction of it, and this canvas is a quarter the width of a real
    // viewport so every mote is proportionally smaller — the flight threshold
    // is a floor on "visibly changed", not a claim about how much.
    expect(atRest, "resting dust should be faint").toBeLessThan(1.5);
    expect(inFlight, "a flight should visibly stir the air").toBeGreaterThan(0.3);
  });

  test("the dust is anchored to the world, not to the screen", async ({ page }) => {
    // A pan has to move it — a layer that stayed put under a moving camera is
    // wallpaper, and the point of depth is that the room travels through it.
    // With the drift frozen (t = 0) and no motion, the only thing that can
    // change between these frames is where the camera is.
    const before = await draw(page, regions, camera, { motion: 0, heading: [0, 0] });
    const panned = await draw(page, regions, { ...camera, x: 120 }, { motion: 0, heading: [0, 0] });
    expect(difference(panned.frame, before.frame)).toBeGreaterThan(0.05);
  });

  test("a streak lies along the heading", async ({ page }) => {
    // Stretched along x, a frame changes less under a small x shift than under
    // the same y shift: the elongated discs cover the neighbouring x pixels
    // already. Direction is the thing the room should read from a streak.
    const along = await draw(page, regions, camera, { motion: 1, heading: [1, 0] });
    const shiftedX = await draw(page, regions, { ...camera, x: 6 }, { motion: 1, heading: [1, 0] });
    const shiftedY = await draw(page, regions, { ...camera, y: 6 }, { motion: 1, heading: [1, 0] });
    expect(difference(shiftedX.frame, along.frame)).toBeLessThan(
      difference(shiftedY.frame, along.frame),
    );
  });
});

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { ScenePlacement } from "@/lib/schema/presentation";
import type { Palette } from "@/lib/present/ambient";
import type { Camera, Size } from "@/lib/present/camera";
import {
  MAX_REGIONS,
  STILL,
  atmosphereDpr,
  cameraMotion,
  falloffFor,
  nearestRegions,
  packRegions,
  regionBuffers,
  settleMotion,
  viewUniforms,
  webglAvailable,
  type Motion,
} from "@/lib/present/atmosphere";

/**
 * The colour of the air.
 *
 * The world's background was one radial gradient whose colour tracked the
 * camera, plus a dot grid for parallax. Both were compromises with what CSS can
 * express: one gradient means the whole screen is one colour, so standing
 * between a cold region and a warm one shows their *average* rather than
 * showing cold on the left and warm on the right. And a dot grid is the visual
 * language of a design tool, which is the one thing a presentation should never
 * look like.
 *
 * This draws the field properly. Every pixel is turned back into a world
 * position and the air there is the inverse-square blend of the regions around
 * it, in OKLab — the same blend `ambientAt` does for one point, done for all of
 * them. Depth is two layers of drifting fbm parallaxed against the camera, so
 * travelling has something to travel *through* that is light rather than
 * furniture.
 *
 * Behind that, three layers of soft motes at different depths give the room a
 * third dimension. Each is the content plane seen by a camera sitting further
 * back, so a pan slides it slower than the content and a zoom grows it less —
 * genuine parallax, not a texture scrolled at a made-up rate. While the
 * presenter stands on a scene they are barely there: a faint, slowly drifting
 * dust that nobody's eye should catch. During a flight they brighten and
 * streak along the direction of travel, so the transition is the one moment
 * the background is allowed to be seen moving. The stirring settles in under
 * half a second of landing.
 *
 * Three rules it inherits:
 *
 *  - **It carries no information.** `aria-hidden`, never read, never a
 *    control. If it fails to initialise the CSS wash underneath is still
 *    there and nothing is missing.
 *  - **It never goes through React.** `draw()` is called from the same
 *    imperative loop that writes the camera transform.
 *  - **It paints no rectangle.** There is no edge anywhere in it.
 */

export interface AtmosphereHandle {
  /**
   * Paint the air for this camera. Called from the flight loop.
   *
   * Returns whether a frame was actually rendered, which is false whenever
   * there is no renderer — no WebGL, or a context the driver took back. The
   * caller uses that to decide whether the CSS wash underneath is still doing
   * the work, so it must be the truth rather than an assumption.
   */
  draw: (camera: Camera) => boolean;
}

export interface AtmosphereProps {
  /**
   * Hands the caller something to call every frame, and `null` on teardown.
   *
   * A callback rather than a ref because this component is loaded lazily, and
   * a ref through a lazy wrapper is a promise about someone else's forwarding
   * behaviour. A registration call is a promise about this component's.
   */
  onReady?: (handle: AtmosphereHandle | null) => void;
  placements: ScenePlacement[];
  palettes: Palette[];
  base: Palette;
  stage: Size;
  viewport: Size;
  /** The journey's depth setting: 0 flattens the parallax entirely. */
  depth: number;
  /** Freeze the drift. The field still renders; it simply stops moving. */
  still: boolean;
}

const VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/**
 * OKLab in, sRGB out.
 *
 * Ottosson's inverse, matching `src/lib/utils/color.ts` term for term. The
 * blend has to happen in OKLab and the framebuffer has to receive sRGB, so the
 * conversion belongs at the very end — converting earlier and blending after
 * would put the mud back.
 */
const FRAGMENT = /* glsl */ `
  precision highp float;

  varying vec2 vUv;

  uniform vec2  uResolution;
  uniform vec2  uCamera;
  uniform vec2  uHalf;
  uniform float uInvScale;
  uniform float uRotation;
  uniform float uTime;
  uniform float uDepth;
  uniform float uFalloff;
  uniform float uStage;
  uniform float uMotion;
  uniform vec2  uHeading;
  uniform int   uCount;

  uniform vec2 uPositions[${MAX_REGIONS}];
  uniform vec3 uCanvas[${MAX_REGIONS}];
  uniform vec3 uAccent[${MAX_REGIONS}];

  uniform vec3 uBaseCanvas;
  uniform vec3 uBaseAccent;

  vec3 oklabToLinear(vec3 c) {
    float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;

    float l = l_ * l_ * l_;
    float m = m_ * m_ * m_;
    float s = s_ * s_ * s_;

    return vec3(
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    );
  }

  vec3 linearToSrgb(vec3 c) {
    c = clamp(c, 0.0, 1.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }

  // Value noise, on a hash with no transcendental in it.
  //
  // The usual sin-based hash costs one sin per lattice corner, which is four
  // per noise sample and thirty-three per pixel once the two fbm calls and the
  // dither are counted. That is not what a comment calling this "one
  // full-screen gradient" describes, and it is the difference between a layer
  // software rendering can afford and one it cannot.
  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  // Three octaves, normalised. The fourth was half a percent of the amplitude
  // and a quarter of the cost.
  float fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    float sum = 0.0;
    for (int i = 0; i < 3; i++) {
      total += noise(p) * amplitude;
      sum += amplitude;
      p *= 2.03;
      amplitude *= 0.5;
    }
    return total / sum;
  }

  // A field of soft motes at one depth behind the content.
  //
  // The layer is the content plane seen by a camera 'depth' scene-widths
  // further back: its world-units-per-pixel is the camera's plus the extra
  // distance divided by the viewport. Nothing else is needed for it to pan
  // slower and zoom less than the content, which is what depth looks like.
  //
  // One lookup per pixel: a mote is jittered within the middle of its cell
  // and its radius never reaches the edge, so no neighbour can intrude and
  // there is no 3×3 search. Presence is thinned so the field is not a lattice.
  // Under motion the disc is stretched along the heading — a streak, not a
  // blur, because the thing the room should read is direction.
  float motes(vec2 fragment, float c, float s, float depth, float seed, vec2 heading, float streak) {
    float inv = uInvScale + depth * uStage / uResolution.x;
    vec2 d = (fragment - uHalf) * inv;
    vec2 p = uCamera + vec2(d.x * c - d.y * s, d.x * s + d.y * c);

    float cell = uStage * (0.19 + seed * 0.04);
    vec2 g = p / cell;
    vec2 i = floor(g);
    vec2 f = g - i;

    // Thinned to a scatter at rest; a flight brings more of the field out.
    float presence = hash(i + seed * 17.0);
    float alive = step(0.5 - 0.25 * uMotion, presence);

    vec2 jitter = 0.3 + 0.4 * vec2(hash(i + 3.1 + seed), hash(i + 7.7 + seed));
    jitter += 0.03 * vec2(sin(uTime * 0.15 + presence * 6.28), cos(uTime * 0.11 + presence * 3.1));
    float size = 0.05 + 0.07 * hash(i + 11.3 + seed);

    // Stretch in screen pixels, where a streak has a length, then back to
    // cells, where the disc has a size.
    float pxPerCell = cell / inv;
    vec2 dpx = (f - jitter) * pxPerCell;
    float along = dot(dpx, heading);
    float across = dpx.x * heading.y - dpx.y * heading.x;
    float dist = length(vec2(along / (1.0 + streak), across)) / pxPerCell;

    float disc = 1.0 - smoothstep(size * 0.25, size, dist);
    return alive * disc * disc * (0.5 + 0.5 * presence);
  }

  void main() {
    // v is flipped on the way in.
    //
    // three's PlaneGeometry puts uv.v = 1 at the +Y vertices, which WebGL puts
    // at the *top* of the viewport, while every screen coordinate this file
    // deals with — worldTransform, viewUniforms, screenToWorld — has y = 0 at
    // the top. Reading vUv straight through therefore reflected the whole
    // field about the camera's horizontal axis: a region above you lit the
    // bottom of the screen. It looked like weather rather than like a bug,
    // which is why fragmentFromUv exists and is tested.
    vec2 fragment = vec2(vUv.x, 1.0 - vUv.y) * uResolution;

    // The inverse of the world transform: screen back to world.
    vec2 d = (fragment - uHalf) * uInvScale;
    float c = cos(uRotation);
    float s = sin(uRotation);
    vec2 world = uCamera + vec2(d.x * c - d.y * s, d.x * s + d.y * c);

    // The air here is the inverse-square blend of the regions around it. The
    // floor on the denominator is what stops a region winning by an unbounded
    // margin when the camera sits exactly on it.
    vec3 canvasSum = vec3(0.0);
    vec3 accentSum = vec3(0.0);
    float weightSum = 0.0;
    float accentSum_w = 0.0;

    for (int i = 0; i < ${MAX_REGIONS}; i++) {
      if (i >= uCount) break;

      vec2 delta = (world - uPositions[i]) / uFalloff;
      float d2 = dot(delta, delta);

      float w = 1.0 / (0.25 + d2);
      canvasSum += uCanvas[i] * w;
      weightSum += w;

      // The accent reaches less far than the canvas colour: it is the light a
      // region throws, not the colour of the room. Quadratic rather than
      // quartic — a quartic falloff made each region a discrete lump of colour
      // hanging in space, which is a rectangle by another name.
      float wa = 1.0 / (0.35 + d2 * 2.5);
      accentSum += uAccent[i] * wa;
      accentSum_w += wa;
    }

    vec3 air = weightSum > 0.0 ? canvasSum / weightSum : uBaseCanvas;
    vec3 glow = accentSum_w > 0.0 ? accentSum / accentSum_w : uBaseAccent;

    // How present the glow is, rather than what colour it is. Saturates late,
    // so a dense cluster of regions does not blow out.
    float glowAmount = accentSum_w / (accentSum_w + 6.0);

    // Depth. Two layers at different scales drifting at different rates, in
    // world space so they are anchored to the place rather than to the screen,
    // and parallaxed by uDepth so they slide against the content.
    vec2 drift = world * uDepth;
    float coarse = fbm(drift * 0.0016 + vec2(uTime * 0.006, uTime * -0.004));
    float fine = fbm(drift * 0.0061 + vec2(uTime * -0.011, uTime * 0.008));
    float field = coarse * 0.68 + fine * 0.32;

    // The noise modulates lightness only. Pushing a and b would tint the room
    // at random, and the room's colour is supposed to mean something.
    air.x += (field - 0.5) * 0.05 * uDepth;

    // Regions bloom into the air around them, in their own accent.
    //
    // The ceiling here is low on purpose. At 0.42 this was not a bloom, it was
    // a repaint: standing on a midnight region rendered the room mid-grey when
    // midnight's own canvas is very nearly black. The colour of the room is
    // the theme's; the accent is a suggestion of light on top of it.
    air = mix(air, glow, glowAmount * (0.09 + field * 0.05));

    // The dust. Three depths, nearest first; each further one is smaller on
    // screen by construction, so the far layer reads as distance rather than
    // as a second copy of the near one. The heading falls back to an axis so a
    // still camera measures a round disc rather than a degenerate one.
    if (uStage > 0.0 && uDepth > 0.0) {
      vec2 heading = length(uHeading) > 0.5 ? uHeading : vec2(1.0, 0.0);
      // Bounded so a stretched disc still fits its cell (see motes).
      float streak = uMotion * 1.3;
      float dust = motes(fragment, c, s, 0.6, 0.0, heading, streak) * 0.55
        + motes(fragment, c, s, 2.2, 1.0, heading, streak) * 0.8
        + motes(fragment, c, s, 6.0, 2.0, heading, streak);

      // Faint at rest, present in flight. Lightness moves away from the room's
      // own — up in a dark room, down in a light one — so a mote is visible on
      // every theme and never clips to white on paper.
      float lit = uDepth * (0.035 + 0.16 * uMotion) * dust;
      float dir = air.x < 0.55 ? 1.0 : -1.0;
      air.x += dir * lit;
      air.yz = mix(air.yz, glow.yz, min(1.0, lit * 1.5));
    }

    // A vignette pulls the eye to the middle of the frame, which is where the
    // camera has just put the thing worth looking at.
    vec2 centred = vUv - 0.5;
    float vignette = 1.0 - dot(centred, centred) * 0.55;
    air.x *= vignette;

    vec3 srgb = linearToSrgb(oklabToLinear(air));

    // Dither, at the very end.
    //
    // Everything above is a gradient with no edge in it, and an 8-bit
    // framebuffer cannot hold one: the noise field was quantising into
    // terraced contour lines that read exactly like a topographic map. A
    // sub-quantum of noise per pixel breaks the steps and costs nothing.
    srgb += (hash(fragment) - 0.5) / 255.0;

    gl_FragColor = vec4(srgb, 1.0);
  }
`;

export function Atmosphere({
  onReady,
  placements,
  palettes,
  base,
  stage,
  viewport,
  depth,
  still,
}: AtmosphereProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /**
   * A context the driver took back.
   *
   * It happens: a GPU reset, a laptop switching cards, a machine waking. The
   * canvas is opaque, so leaving it in place after that would paint black over
   * the world. Standing down restores the CSS wash underneath, which is a
   * complete background on its own.
   */
  const [lost, setLost] = useState(false);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const uniformsRef = useRef<Record<string, THREE.IUniform> | null>(null);
  // Allocated once per component and reused every frame. `useRef` does
  // evaluate its argument on each render and discard all but the first — three
  // small arrays, ~768 bytes — which is the price of not writing a ref during
  // render, and that is the right trade under the React Compiler rules.
  const buffersRef = useRef(regionBuffers());
  const lastCameraRef = useRef<Camera | null>(null);
  /**
   * How stirred the air is, and which way.
   *
   * Measured from consecutive cameras handed to `draw` and settled here rather
   * than in the world: the idle loop below also paints, and it has to keep
   * settling the same value after the last flight frame or the streak would
   * freeze mid-air until the next advance.
   */
  const motionRef = useRef<Motion>(STILL);
  const lastPaintAtRef = useRef(0);

  // Props the imperative draw loop reads. Kept in a ref because `draw` is
  // called from outside React and must never see a stale closure — and written
  // in an effect, because a ref written during render is a render with a side
  // effect in it.
  //
  // The ordering this depends on is React's own: a child's effects run before
  // its parent's, so this is current before the world's flight effect calls
  // `draw` for the first time.
  const inputsRef = useRef({ placements, palettes, base, stage, depth, viewport, still });

  useEffect(() => {
    inputsRef.current = { placements, palettes, base, stage, depth, viewport, still };
  });

  const render = useCallback((camera: Camera, timeSeconds: number, motion: Motion): boolean => {
    const renderer = rendererRef.current;
    const uniforms = uniformsRef.current;
    const scene = sceneRef.current;
    const orthographic = cameraRef.current;
    if (!renderer || !uniforms || !scene || !orthographic) return false;

    const { placements, palettes, base, stage, depth, viewport } = inputsRef.current;
    if (viewport.width === 0 || viewport.height === 0) return false;

    const view = viewUniforms(camera, viewport);
    const count = packRegions(nearestRegions(camera, placements, palettes), buffersRef.current);

    uniforms.uCamera.value.set(view.cameraX, view.cameraY);
    uniforms.uHalf.value.set(view.halfWidth, view.halfHeight);
    uniforms.uInvScale.value = view.invScale;
    uniforms.uRotation.value = view.rotation;
    uniforms.uResolution.value.set(viewport.width, viewport.height);
    uniforms.uFalloff.value = falloffFor(stage);
    uniforms.uStage.value = stage.width;
    uniforms.uDepth.value = depth;
    uniforms.uTime.value = timeSeconds;
    uniforms.uMotion.value = motion.amount;
    uniforms.uHeading.value.set(motion.headingX, motion.headingY);
    uniforms.uCount.value = count;
    uniforms.uBaseCanvas.value.set(base.canvas.L, base.canvas.a, base.canvas.b);
    uniforms.uBaseAccent.value.set(base.accent.L, base.accent.a, base.accent.b);

    renderer.render(scene, orthographic);
    return true;
  }, []);

  /**
   * One frame, with the motion bookkeeping every path shares.
   *
   * Under a reduced-motion preference the air is never stirred: the drift is
   * frozen at t=0 and the motion is pinned to still, so the depth layers sit
   * exactly where a static background would.
   */
  const paint = useCallback(
    (camera: Camera, nowMs: number): boolean => {
      const { still, viewport } = inputsRef.current;
      const dt = lastPaintAtRef.current > 0 ? (nowMs - lastPaintAtRef.current) / 1000 : 0;
      const sample = still ? STILL : cameraMotion(lastCameraRef.current, camera, dt, viewport);
      motionRef.current = still ? STILL : settleMotion(motionRef.current, sample, dt);
      lastCameraRef.current = camera;
      lastPaintAtRef.current = nowMs;
      return render(camera, still ? 0 : nowMs / 1000, motionRef.current);
    },
    [render],
  );

  useEffect(() => {
    if (!onReady || lost) return;
    onReady({
      draw: (camera: Camera) => paint(camera, performance.now()),
    });
    return () => onReady(null);
  }, [onReady, paint, lost]);

  // Set-up and teardown. Context creation can fail — an old driver, a
  // blocklisted GPU, too many live contexts — and that is a normal outcome
  // rather than an error: the CSS wash underneath is a complete background on
  // its own, so the page is correct either way.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!webglAvailable()) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "low-power",
        // Deliberately NOT failIfMajorPerformanceCaveat. That flag refuses a
        // software-rendered context, and software rendering is what you get on
        // a VM, a remote desktop or a blocklisted driver — a lectern PC, which
        // is this product's whole audience. Refusing it cost the feature
        // entirely on the machines most likely to be presenting from.
        //
        // What makes that affordable is the shader being cheap: a hash with no
        // transcendental in it, three octaves rather than four, a pixel ratio
        // capped at 1.5, and twelve frames a second while nobody is flying.
      });
    } catch {
      return;
    }

    renderer.setPixelRatio(atmosphereDpr(window.devicePixelRatio));

    const onLost = (event: Event) => {
      // Without preventDefault the browser will not attempt a restore, but we
      // do not attempt one either: standing down is the honest response and
      // the fallback is already correct.
      event.preventDefault();
      setLost(true);
    };
    canvas.addEventListener("webglcontextlost", onLost);

    const uniforms: Record<string, THREE.IUniform> = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCamera: { value: new THREE.Vector2() },
      uHalf: { value: new THREE.Vector2() },
      uInvScale: { value: 1 },
      uRotation: { value: 0 },
      uTime: { value: 0 },
      uDepth: { value: 0.55 },
      uFalloff: { value: 1 },
      uStage: { value: 0 },
      uMotion: { value: 0 },
      uHeading: { value: new THREE.Vector2() },
      uCount: { value: 0 },
      uPositions: { value: buffersRef.current.positions },
      uCanvas: { value: buffersRef.current.canvas },
      uAccent: { value: buffersRef.current.accent },
      uBaseCanvas: { value: new THREE.Vector3() },
      uBaseAccent: { value: new THREE.Vector3() },
    };

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });

    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

    rendererRef.current = renderer;
    sceneRef.current = scene;
    cameraRef.current = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    uniformsRef.current = uniforms;

    // Paint immediately if the camera is already known.
    //
    // The chunk is lazy, so on a cold load the world's flight effect has often
    // already run and set its destination by the time this mounts — and it
    // will not run again for an unchanged destination. Without this the layer
    // sits unpainted until the presenter first advances, which on an opaque
    // canvas is a black rectangle over the world and on a transparent one is
    // no atmosphere at all.
    const first = inputsRef.current.viewport;
    renderer.setSize(first.width, first.height, false);
    if (lastCameraRef.current) {
      render(
        lastCameraRef.current,
        inputsRef.current.still ? 0 : performance.now() / 1000,
        motionRef.current,
      );
    }

    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      material.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      renderer.dispose();
      // Deliberately NOT forceContextLoss().
      //
      // It is the textbook way to stop contexts accumulating, and here it is a
      // bug: React mounts, unmounts and mounts again in development, reusing
      // the same <canvas>. A canvas has one context for its lifetime, so the
      // second mount inherits the context the first one just destroyed and
      // renders nothing — the field came back as a flat white sheet over the
      // whole world, while a pixel read taken before the teardown still showed
      // the correct colour. `dispose()` releases three's own caches; the
      // context goes when the detached canvas is collected.
      rendererRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      uniformsRef.current = null;
    };
    // `render` is a stable callback with no dependencies of its own; it is
    // listed so this effect can never quietly close over a stale one.
  }, [render]);

  // Size follows the viewport the world already measured, so both agree by
  // construction rather than by two ResizeObservers racing.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || viewport.width === 0 || viewport.height === 0) return;

    renderer.setSize(viewport.width, viewport.height, false);
    if (lastCameraRef.current) {
      // Real time, not zero: rendering a resize at t=0 snapped the field back
      // to where it started, up to twelve times a second, while a window was
      // being dragged.
      render(
        lastCameraRef.current,
        inputsRef.current.still ? 0 : performance.now() / 1000,
        motionRef.current,
      );
    }
  }, [viewport.width, viewport.height, render]);

  /**
   * The drift, when nothing else is happening.
   *
   * A flight already redraws this every frame. This loop exists only so the
   * air keeps moving while the presenter stands still and talks — which is
   * most of a presentation. It runs at a twelfth of the display's rate,
   * because the motion it carries takes tens of seconds to cross the screen
   * and rendering it faster would be heat with nothing to show for it.
   *
   * `lost` stops it, and that is not a tidiness point. Nothing else does:
   * losing the context de-registers the handle so the world stops calling
   * `draw`, but this loop calls `render` directly. Without the guard a GPU
   * reset left it driving a dead context twelve times a second, forever,
   * behind a canvas already hidden — every frame a wasted wake-up and a WebGL
   * warning, on the machine that had just proved it was struggling.
   */
  useEffect(() => {
    if (still || depth <= 0 || lost) return;

    let frame = 0;
    let last = 0;
    const INTERVAL = 1000 / 12;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < INTERVAL) return;
      last = now;
      if (document.visibilityState === "hidden") return;
      if (lastCameraRef.current) paint(lastCameraRef.current, now);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [still, depth, lost, paint]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-atmosphere
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={lost ? { display: "none" } : undefined}
    />
  );
}

export default Atmosphere;

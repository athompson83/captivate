"use client";

import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import type { ScenePlacement } from "@/lib/schema/presentation";
import type { Palette } from "@/lib/present/ambient";
import type { Camera, Size } from "@/lib/present/camera";
import {
  MAX_REGIONS,
  atmosphereDpr,
  falloffFor,
  nearestRegions,
  packRegions,
  regionBuffers,
  viewUniforms,
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
  /** Paint the air for this camera. Called from the flight loop. */
  draw: (camera: Camera) => void;
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

  // Value noise. Cheap, and this is a field of light — nothing here has an edge
  // that would betray the lattice.
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
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

  float fbm(vec2 p) {
    float total = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      total += noise(p) * amplitude;
      p *= 2.03;
      amplitude *= 0.5;
    }
    return total;
  }

  void main() {
    vec2 fragment = vUv * uResolution;

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

      // The accent hugs its region much more tightly than the canvas does: it
      // is the light a region throws, not the colour of the room.
      float wa = 1.0 / (0.04 + d2 * d2 * 9.0);
      accentSum += uAccent[i] * wa;
      accentSum_w += wa;
    }

    vec3 air = weightSum > 0.0 ? canvasSum / weightSum : uBaseCanvas;
    vec3 glow = accentSum_w > 0.0 ? accentSum / accentSum_w : uBaseAccent;

    // How present the glow is, rather than what colour it is. Saturates, so a
    // dense cluster of regions does not blow out.
    float glowAmount = accentSum_w / (accentSum_w + 2.2);

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
    air = mix(air, mix(air, glow, 0.42), glowAmount * (0.34 + field * 0.22));

    // A vignette pulls the eye to the middle of the frame, which is where the
    // camera has just put the thing worth looking at.
    vec2 centred = vUv - 0.5;
    float vignette = 1.0 - dot(centred, centred) * 0.55;
    air.x *= vignette;

    gl_FragColor = vec4(linearToSrgb(oklabToLinear(air)), 1.0);
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
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const uniformsRef = useRef<Record<string, THREE.IUniform> | null>(null);
  const buffersRef = useRef(regionBuffers());
  const lastCameraRef = useRef<Camera | null>(null);

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

  const render = useCallback((camera: Camera, timeSeconds: number) => {
    const renderer = rendererRef.current;
    const uniforms = uniformsRef.current;
    const scene = sceneRef.current;
    const orthographic = cameraRef.current;
    if (!renderer || !uniforms || !scene || !orthographic) return;

    const { placements, palettes, base, stage, depth, viewport } = inputsRef.current;
    if (viewport.width === 0 || viewport.height === 0) return;

    const view = viewUniforms(camera, viewport);
    const count = packRegions(nearestRegions(camera, placements, palettes), buffersRef.current);

    uniforms.uCamera.value.set(view.cameraX, view.cameraY);
    uniforms.uHalf.value.set(view.halfWidth, view.halfHeight);
    uniforms.uInvScale.value = view.invScale;
    uniforms.uRotation.value = view.rotation;
    uniforms.uResolution.value.set(viewport.width, viewport.height);
    uniforms.uFalloff.value = falloffFor(stage);
    uniforms.uDepth.value = depth;
    uniforms.uTime.value = timeSeconds;
    uniforms.uCount.value = count;
    uniforms.uBaseCanvas.value.set(base.canvas.L, base.canvas.a, base.canvas.b);
    uniforms.uBaseAccent.value.set(base.accent.L, base.accent.a, base.accent.b);

    renderer.render(scene, orthographic);
  }, []);

  useEffect(() => {
    if (!onReady) return;
    onReady({
      draw: (camera: Camera) => {
        lastCameraRef.current = camera;
        render(camera, inputsRef.current.still ? 0 : performance.now() / 1000);
      },
    });
    return () => onReady(null);
  }, [onReady, render]);

  // Set-up and teardown. Context creation can fail — an old driver, a
  // blocklisted GPU, too many live contexts — and that is a normal outcome
  // rather than an error: the CSS wash underneath is a complete background on
  // its own, so the page is correct either way.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        alpha: false,
        powerPreference: "low-power",
        failIfMajorPerformanceCaveat: true,
      });
    } catch {
      return;
    }

    renderer.setPixelRatio(atmosphereDpr(window.devicePixelRatio));

    const uniforms: Record<string, THREE.IUniform> = {
      uResolution: { value: new THREE.Vector2(1, 1) },
      uCamera: { value: new THREE.Vector2() },
      uHalf: { value: new THREE.Vector2() },
      uInvScale: { value: 1 },
      uRotation: { value: 0 },
      uTime: { value: 0 },
      uDepth: { value: 0.55 },
      uFalloff: { value: 1 },
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

    return () => {
      material.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      renderer.dispose();
      rendererRef.current = null;
      sceneRef.current = null;
      uniformsRef.current = null;
    };
  }, []);

  // Size follows the viewport the world already measured, so both agree by
  // construction rather than by two ResizeObservers racing.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || viewport.width === 0 || viewport.height === 0) return;

    renderer.setSize(viewport.width, viewport.height, false);
    if (lastCameraRef.current) render(lastCameraRef.current, 0);
  }, [viewport.width, viewport.height, render]);

  /**
   * The drift, when nothing else is happening.
   *
   * A flight already redraws this every frame. This loop exists only so the
   * air keeps moving while the presenter stands still and talks — which is
   * most of a presentation. It runs at a twelfth of the display's rate,
   * because the motion it carries takes tens of seconds to cross the screen
   * and rendering it faster would be heat with nothing to show for it.
   */
  useEffect(() => {
    if (still || depth <= 0) return;

    let frame = 0;
    let last = 0;
    const INTERVAL = 1000 / 12;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - last < INTERVAL) return;
      last = now;
      if (document.visibilityState === "hidden") return;
      if (lastCameraRef.current) render(lastCameraRef.current, now / 1000);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [still, depth, render]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-atmosphere
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}

export default Atmosphere;

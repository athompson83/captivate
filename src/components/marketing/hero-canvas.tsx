"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { webglAvailable } from "@/lib/present/atmosphere";
import {
  HERO_SCENES,
  LOOP_MS,
  cameraAt,
  flightPath,
  wideShot,
  type HeroScene,
  type HeroSceneKind,
} from "@/lib/marketing/hero-world";

/**
 * The landing hero: the product's thesis, running.
 *
 * "There is no slide reel" is a claim, and a claim on a landing page is worth
 * about as much as any other. So the hero does not illustrate the idea — it
 * *is* the idea: six scenes placed once in one continuous space, a camera
 * travelling between them, and one small aside tucked beside its parent that
 * the flight dives into. Nothing here is a slide, and nothing advances.
 *
 * Three rules, inherited from the stage's own atmosphere layer:
 *
 *  - **It carries no information.** `aria-hidden`, never a control. The copy
 *    beside it says the same thing in words, and if WebGL is unavailable the
 *    CSS picture underneath is a complete hero on its own.
 *  - **It never goes through React.** Sixty camera writes a second are sixty
 *    writes to one object's position, not sixty renders.
 *  - **It stops when nobody is looking.** Off screen or on a hidden tab, the
 *    loop is cancelled rather than throttled — a marketing page is the last
 *    thing that should be spending a visitor's battery in a background tab.
 *
 * Reduced motion is not a frozen frame of the flight: a frame of a flight is
 * one scene filling the view, which says nothing. It is the wide shot the
 * flight travels around — the same claim, held still.
 */

const FOV = 42;

/**
 * The hero's own palette.
 *
 * Deliberately fixed rather than read from the theme: this is a night sky, and
 * it is the same night sky whether the visitor's system is set to light or
 * dark. Amber is the key, violet the rim, and the ground is a blue-black deep
 * enough that the scenes are the only light in the frame.
 */
const PALETTE = {
  ground: "#07060d",
  fog: "#141031",
  scene: "#1c1930",
  sceneEdge: "rgba(255, 214, 160, 0.42)",
  ink: "rgba(255, 247, 234, 0.94)",
  bar: "rgba(214, 214, 240, 0.34)",
  barBright: "rgba(238, 240, 255, 0.66)",
  amber: "#ffb765",
  violet: "#a98bff",
  cyan: "#7fe3d4",
} as const;

/** Pixels of texture per world unit. Enough to stay crisp when flown into. */
const TEXELS_PER_UNIT = 128;

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** One scene's face, drawn once into a texture. */
function paintScene(kind: HeroSceneKind, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * TEXELS_PER_UNIT);
  canvas.height = Math.round(height * TEXELS_PER_UNIT);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const w = canvas.width;
  const h = canvas.height;
  const pad = Math.round(w * 0.075);

  ctx.fillStyle = PALETTE.scene;
  roundedRect(ctx, 0, 0, w, h, w * 0.035);
  ctx.fill();
  ctx.strokeStyle = PALETTE.sceneEdge;
  ctx.lineWidth = Math.max(1.5, w * 0.004);
  ctx.stroke();

  const bar = (top: number, fraction: number, colour: string, thickness = 0.028) => {
    ctx.fillStyle = colour;
    roundedRect(ctx, pad, top, (w - pad * 2) * fraction, h * thickness, h * 0.014);
    ctx.fill();
  };

  if (kind === "title") {
    ctx.fillStyle = PALETTE.ink;
    ctx.font = `600 ${Math.round(h * 0.15)}px Georgia, serif`;
    ctx.textBaseline = "top";
    ctx.fillText("Hold the room", pad, h * 0.24);
    bar(h * 0.52, 0.6, PALETTE.bar, 0.032);
    bar(h * 0.62, 0.4, PALETTE.bar, 0.032);
    ctx.fillStyle = PALETTE.amber;
    roundedRect(ctx, pad, h * 0.76, w * 0.13, h * 0.012, h * 0.006);
    ctx.fill();
  } else if (kind === "bullets") {
    bar(h * 0.18, 0.62, PALETTE.barBright, 0.05);
    bar(h * 0.38, 0.88, PALETTE.bar);
    bar(h * 0.51, 0.74, PALETTE.bar);
    bar(h * 0.64, 0.8, PALETTE.bar);
    bar(h * 0.77, 0.46, PALETTE.amber, 0.03);
  } else if (kind === "chart") {
    bar(h * 0.15, 0.5, PALETTE.barBright, 0.05);
    const bars = [0.42, 0.68, 0.31, 0.88, 0.55];
    const slot = (w - pad * 2) / bars.length;
    bars.forEach((value, index) => {
      ctx.fillStyle = index === 3 ? PALETTE.amber : PALETTE.bar;
      const barHeight = value * h * 0.42;
      roundedRect(
        ctx,
        pad + index * slot + slot * 0.18,
        h * 0.84 - barHeight,
        slot * 0.64,
        barHeight,
        slot * 0.16,
      );
      ctx.fill();
    });
  } else if (kind === "quote") {
    ctx.fillStyle = PALETTE.amber;
    ctx.font = `600 ${Math.round(h * 0.46)}px Georgia, serif`;
    ctx.textBaseline = "top";
    ctx.fillText("“", pad, h * 0.04);
    bar(h * 0.48, 0.84, PALETTE.bar, 0.034);
    bar(h * 0.6, 0.7, PALETTE.bar, 0.034);
    bar(h * 0.72, 0.34, PALETTE.barBright, 0.034);
  } else if (kind === "media") {
    const image = ctx.createLinearGradient(pad, pad, w - pad, h * 0.72);
    image.addColorStop(0, "rgba(255, 170, 92, 0.55)");
    image.addColorStop(0.55, "rgba(169, 139, 255, 0.42)");
    image.addColorStop(1, "rgba(127, 227, 212, 0.32)");
    ctx.fillStyle = image;
    roundedRect(ctx, pad, pad, w - pad * 2, h * 0.66, w * 0.02);
    ctx.fill();
    bar(h * 0.82, 0.42, PALETTE.bar, 0.03);
  } else {
    // The aside. Small enough that anything but two marks would be mush.
    bar(h * 0.26, 0.78, PALETTE.amber, 0.09);
    bar(h * 0.52, 0.56, PALETTE.bar, 0.09);
  }

  return canvas;
}

/** A soft round light, used to bloom each scene into the air around it. */
function paintGlow(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255, 186, 120, 0.42)");
  gradient.addColorStop(0.35, "rgba(169, 139, 255, 0.16)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  return canvas;
}

/** A round dust mote, so points are not square. */
function paintMote(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255, 255, 255, 0.9)");
  gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return canvas;
}

function textureFrom(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function HeroCanvas() {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = host.current;
    if (!mount || !webglAvailable()) return;

    // Everything created below is pushed here and disposed on teardown. A
    // renderer left holding a context is a lost context for the next page.
    const disposables: { dispose: () => void }[] = [];

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "low-power",
      });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setClearColor(new THREE.Color(PALETTE.ground), 0);
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    // Light fog. Enough that the far scenes recede and the near ones lead,
    // not so much that the world turns to soup — the first pass at this was
    // dense enough to make the whole hero read as a dark rectangle.
    scene.fog = new THREE.FogExp2(new THREE.Color(PALETTE.fog), 0.011);

    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 120);

    const glow = textureFrom(paintGlow());
    disposables.push(glow);

    // The air itself. Two lights a long way back, in world space rather than
    // on the page, so travelling changes which one the room is lit by — the
    // same thing the stage's atmosphere layer does for a real presentation.
    for (const [x, y, tint, scale] of [
      [-7, 3, PALETTE.amber, 30],
      [7, -3, PALETTE.violet, 34],
      [2, 4, PALETTE.cyan, 22],
    ] as const) {
      const airMaterial = new THREE.MeshBasicMaterial({
        map: glow,
        transparent: true,
        opacity: 0.5,
        color: new THREE.Color(tint),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const airGeometry = new THREE.PlaneGeometry(scale, scale);
      const air = new THREE.Mesh(airGeometry, airMaterial);
      air.position.set(x, y, -9);
      scene.add(air);
      disposables.push(airMaterial, airGeometry);
    }

    const place = (target: THREE.Object3D, source: HeroScene) => {
      target.position.set(source.x, source.y, source.z);
    };

    for (const heroScene of HERO_SCENES) {
      const face = textureFrom(paintScene(heroScene.kind, heroScene.width, heroScene.height));
      const faceMaterial = new THREE.MeshBasicMaterial({
        map: face,
        transparent: true,
        depthWrite: false,
      });
      const faceGeometry = new THREE.PlaneGeometry(heroScene.width, heroScene.height);
      const mesh = new THREE.Mesh(faceGeometry, faceMaterial);
      place(mesh, heroScene);
      scene.add(mesh);
      disposables.push(face, faceMaterial, faceGeometry);

      // The air around a scene, not a box behind it: additive, unbounded,
      // and larger than the scene so it has no edge of its own.
      const haloMaterial = new THREE.MeshBasicMaterial({
        map: glow,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const haloGeometry = new THREE.PlaneGeometry(heroScene.width * 2.6, heroScene.height * 2.9);
      const halo = new THREE.Mesh(haloGeometry, haloMaterial);
      place(halo, heroScene);
      halo.position.z -= 0.05;
      scene.add(halo);
      disposables.push(haloMaterial, haloGeometry);
    }

    // The flight path, dashed — the same dotted line the world view draws.
    const pathGeometry = new THREE.BufferGeometry().setFromPoints(
      [...flightPath(), flightPath()[0]].map((p) => new THREE.Vector3(p.x, p.y, p.z - 0.02)),
    );
    const pathMaterial = new THREE.LineDashedMaterial({
      color: new THREE.Color(PALETTE.amber),
      transparent: true,
      opacity: 0.5,
      dashSize: 0.22,
      gapSize: 0.34,
    });
    const path = new THREE.Line(pathGeometry, pathMaterial);
    path.computeLineDistances();
    scene.add(path);
    disposables.push(pathGeometry, pathMaterial);

    // Dust, for parallax. Travel needs something to travel through.
    const moteCount = 420;
    const positions = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i += 1) {
      positions[i * 3] = (Math.random() - 0.5) * 34;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 22;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 16 - 3;
    }
    const dustGeometry = new THREE.BufferGeometry();
    dustGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mote = textureFrom(paintMote());
    const dustMaterial = new THREE.PointsMaterial({
      map: mote,
      size: 0.1,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      color: new THREE.Color(PALETTE.violet),
    });
    const dust = new THREE.Points(dustGeometry, dustMaterial);
    scene.add(dust);
    disposables.push(dustGeometry, dustMaterial, mote);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Pointer parallax, held in a ref-like local rather than state: this is
    // read sixty times a second and never rendered.
    const pointer = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
    };

    let width = 1;
    let height = 1;
    const resize = () => {
      const rect = mount.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      draw(performance.now());
    };

    let start = performance.now();
    const draw = (now: number) => {
      const aspect = width / height;
      const target = reduced.matches ? wideShot(aspect, FOV) : cameraAt(now - start, aspect, FOV);
      // Parallax is a nudge, not a control: the camera is flying its own path
      // and the pointer only leans it.
      camera.position.set(target.x + pointer.x * 0.45, target.y - pointer.y * 0.3, target.z);
      camera.lookAt(target.x + pointer.x * 0.18, target.y - pointer.y * 0.12, 0);
      if (!reduced.matches) {
        dust.rotation.z = ((now - start) / LOOP_MS) * 0.25;
      }
      renderer.render(scene, camera);
    };

    let frame = 0;
    const tick = (now: number) => {
      draw(now);
      frame = requestAnimationFrame(tick);
    };

    let running = false;
    const play = () => {
      if (running || reduced.matches) return;
      running = true;
      // Rebase the clock so a paused tab does not resume mid-flight having
      // "travelled" the whole time it was hidden.
      start = performance.now() - ((performance.now() - start) % LOOP_MS);
      frame = requestAnimationFrame(tick);
    };
    const pause = () => {
      running = false;
      cancelAnimationFrame(frame);
    };

    let onScreen = true;
    const settle = () => {
      if (onScreen && !document.hidden && !reduced.matches) play();
      else {
        pause();
        draw(performance.now());
      }
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        settle();
      },
      { threshold: 0 },
    );
    observer.observe(mount);

    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(mount);

    document.addEventListener("visibilitychange", settle);
    reduced.addEventListener("change", settle);
    mount.addEventListener("pointermove", onPointerMove);

    resize();
    settle();

    return () => {
      pause();
      observer.disconnect();
      sizeObserver.disconnect();
      document.removeEventListener("visibilitychange", settle);
      reduced.removeEventListener("change", settle);
      mount.removeEventListener("pointermove", onPointerMove);
      for (const item of disposables) item.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={host} aria-hidden className="absolute inset-0" />;
}

export default HeroCanvas;

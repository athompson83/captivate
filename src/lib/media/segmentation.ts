"use client";

/**
 * On-device person segmentation for the presenter camera.
 *
 * Everything runs locally: MediaPipe's selfie segmenter (a ~250KB model,
 * committed to this repo) executes in wasm served from this origin, so no
 * frame of camera video ever leaves the machine. That is not an optimisation —
 * a presenter's face is the most personal pixel stream the app touches, and
 * shipping it to a service to cut out a background would be indefensible.
 *
 * Failure is soft by design, exactly like the stage atmosphere: if wasm is
 * unavailable, the model file is missing, or the browser refuses a context,
 * `createPersonSegmenter` resolves to null and every caller shows the raw
 * camera instead. A presenter never loses their feed to a nicety.
 */

export type CameraBackground = "none" | "remove" | "blur";

export interface PersonSegmenter {
  /**
   * Returns a canvas containing the current camera frame with the background
   * treated. The canvas is owned by the segmenter and redrawn on every call —
   * draw it somewhere, do not keep it.
   */
  render(
    video: HTMLVideoElement,
    timestampMs: number,
    mode: Exclude<CameraBackground, "none">,
  ): HTMLCanvasElement | null;
  /** What this segmenter is actually doing, for the presenter and for tests. */
  health(): SegmenterHealth;
  close(): void;
}

export interface SegmenterHealth {
  /** Which delegate the model ended up on. */
  delegate: "GPU" | "CPU";
  /** Frames per second the segmenter is currently willing to run at. */
  targetFps: number;
  /** Rolling mean cost of one `render` call, in milliseconds. */
  meanCostMs: number;
  /**
   * True once the machine has proved it cannot keep up even at the slowest
   * rate. Callers stop asking and show the raw camera: a presentation that
   * stutters is worse than one where the background is simply still there.
   */
  givenUp: boolean;
}

/**
 * The rates the segmenter will step down through under load.
 *
 * 30 matches what the recorder encodes. 20 and 12 are still legible motion for
 * a talking head; below that the inset reads as a slideshow of the presenter,
 * so the next step is to stop rather than to go slower.
 */
const FPS_LADDER = [30, 20, 12] as const;

/** Fraction of a frame's budget segmentation may take before stepping down. */
const BUDGET_SHARE = 0.7;

/** Frames to average before believing a cost measurement. */
const COST_WINDOW = 30;

/**
 * What to do about a measured cost: stay, slow down, or stop.
 *
 * Pure and exported so the policy can be tested without a GPU, a camera or a
 * model — the thing that actually needs pinning is the decision, not the
 * arithmetic around it.
 */
export function nextRung(meanCostMs: number, rung: number): { rung: number; givenUp: boolean } {
  const budget = (1000 / FPS_LADDER[Math.min(rung, FPS_LADDER.length - 1)]) * BUDGET_SHARE;
  if (meanCostMs <= budget) return { rung, givenUp: false };
  if (rung < FPS_LADDER.length - 1) return { rung: rung + 1, givenUp: false };
  return { rung, givenUp: true };
}

/** The rate the segmenter runs at on a given rung. */
export function fpsForRung(rung: number): number {
  return FPS_LADDER[Math.min(Math.max(0, rung), FPS_LADDER.length - 1)];
}

/** Where the copy script stages the wasm runtime (see scripts/copy-mediapipe-wasm.mjs). */
const WASM_BASE = "/mediapipe/wasm";
const MODEL_URL = "/models/selfie_segmenter.tflite";

/** Frames below this confidence are background. Chosen by eye on the model's own demo. */
const PERSON_THRESHOLD = 0.55;

/**
 * How much of each new mask to believe, against the frame before it.
 *
 * Low enough that a boundary pixel stops flickering, high enough that real
 * movement is not smeared: at 0.45 a genuinely changed pixel is most of the way
 * there within three frames, an eighth of a second.
 */
const MASK_RESPONSIVENESS = 0.45;

let shared: Promise<PersonSegmenter | null> | null = null;

/**
 * The shared segmenter for this page. One model instance serves both the
 * on-stage feed and the recorder inset — running two would double the cost of
 * the most expensive thing the page does per frame.
 */
export function sharedPersonSegmenter(): Promise<PersonSegmenter | null> {
  shared ??= createPersonSegmenter();
  return shared;
}

export async function createPersonSegmenter(): Promise<PersonSegmenter | null> {
  if (typeof window === "undefined") return null;
  try {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(WASM_BASE);

    /**
     * GPU first, CPU if that fails.
     *
     * The GPU delegate is several times faster and is the right default, but
     * it is also the half that breaks: a blocked WebGL context, a driver the
     * browser has blacklisted, or one of the delegate's own platform bugs
     * (iOS Safari scrambles this model's output on GPU) took the whole
     * feature out, because a throw here resolved to null and the presenter
     * got no background removal at all. CPU on a 256×256 model is slow, not
     * impossible — and the frame-rate ladder below is what makes it usable.
     */
    let delegate: SegmenterHealth["delegate"] = "GPU";
    let segmenter: Awaited<ReturnType<typeof vision.ImageSegmenter.createFromOptions>>;
    try {
      segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    } catch {
      delegate = "CPU";
      segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "VIDEO",
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
    }

    const out = document.createElement("canvas");
    const outCtx = out.getContext("2d");
    const maskCanvas = document.createElement("canvas");
    const maskCtx = maskCanvas.getContext("2d");
    const person = document.createElement("canvas");
    const personCtx = person.getContext("2d");
    if (!outCtx || !maskCtx || !personCtx) {
      segmenter.close();
      return null;
    }

    let maskImage: ImageData | null = null;
    /**
     * The previous frame's alpha, blended into this one.
     *
     * The model is run per frame and has no memory, so a pixel near the
     * decision boundary — the edge of a shoulder, a strand of hair, anything
     * moving — flips in and out between frames. Each frame is defensible on its
     * own; the sequence shimmers, which is what "clunky" background removal
     * actually looks like. Carrying most of the previous frame's answer forward
     * costs one array and removes nearly all of it. Motion still gets through:
     * a genuinely changed pixel converges within a few frames.
     */
    let previousAlpha: Float32Array | null = null;
    let lastTimestamp = -1;
    let closed = false;

    /* What the machine is actually managing, and what to do about it. */
    let rung = 0;
    let costSum = 0;
    let costCount = 0;
    let meanCostMs = 0;
    let givenUp = false;
    let lastRenderedAt = -Infinity;

    const health = (): SegmenterHealth => ({
      delegate,
      targetFps: FPS_LADDER[rung],
      meanCostMs,
      givenUp,
    });

    const render: PersonSegmenter["render"] = (video, timestampMs, mode) => {
      if (closed || givenUp || !video.videoWidth) return null;

      // The video clock must be monotonic for VIDEO running mode; a repeated
      // or rewound timestamp (tab restored, stream restarted) throws inside
      // the wasm. Re-render the previous composite instead of crashing.
      if (timestampMs <= lastTimestamp) return out;

      /*
       * Rate limiting lives here rather than in the caller.
       *
       * The caller now asks once per decoded video frame, which is the right
       * question — but on a machine that cannot segment at the camera's rate,
       * answering every time is how a presentation starts to stutter. The
       * ladder below decides what "keeping up" means; this is where the
       * decision is enforced, for every caller at once.
       */
      const interval = 1000 / FPS_LADDER[rung];
      if (timestampMs - lastRenderedAt < interval) return out;
      lastRenderedAt = timestampMs;
      lastTimestamp = timestampMs;

      const startedAt = performance.now();
      try {
        const result = segmenter.segmentForVideo(video, timestampMs);
        const mask = result.confidenceMasks?.[0];
        if (!mask) {
          result.close();
          return null;
        }

        const mw = mask.width;
        const mh = mask.height;
        if (maskCanvas.width !== mw || maskCanvas.height !== mh || !maskImage) {
          maskCanvas.width = mw;
          maskCanvas.height = mh;
          maskImage = maskCtx.createImageData(mw, mh);
        }

        // Confidence → alpha. Values near the threshold ramp rather than
        // step, which is what keeps hair from becoming a hard sticker edge.
        const confidence = mask.getAsFloat32Array();
        const px = maskImage.data;
        if (!previousAlpha || previousAlpha.length !== confidence.length) {
          previousAlpha = new Float32Array(confidence.length);
          previousAlpha.set(confidence);
        }
        const prev = previousAlpha;
        for (let i = 0; i < confidence.length; i++) {
          // Smoothed first, then thresholded — the other order would ramp an
          // already-hard edge and leave the flicker underneath it.
          const c = prev[i] * (1 - MASK_RESPONSIVENESS) + confidence[i] * MASK_RESPONSIVENESS;
          prev[i] = c;
          const a =
            c <= PERSON_THRESHOLD - 0.15
              ? 0
              : c >= PERSON_THRESHOLD + 0.15
                ? 255
                : Math.round(((c - (PERSON_THRESHOLD - 0.15)) / 0.3) * 255);
          const o = i * 4;
          px[o] = 255;
          px[o + 1] = 255;
          px[o + 2] = 255;
          px[o + 3] = a;
        }
        maskCtx.putImageData(maskImage, 0, 0);
        result.close();

        const w = video.videoWidth;
        const h = video.videoHeight;
        if (person.width !== w || person.height !== h) {
          person.width = w;
          person.height = h;
        }
        if (out.width !== w || out.height !== h) {
          out.width = w;
          out.height = h;
        }

        /*
         * The person, alone on transparency: the frame masked by the
         * confidence alpha, feathered on the way in.
         *
         * The mask is 256 wide and the frame is up to 1920, so bilinear
         * upscaling leaves the whole edge decision inside about five source
         * pixels — which along a shoulder reads as a cut-out sticker. The
         * blur belongs on this draw rather than in a pass of its own:
         * `filter` applies to the image before it is composited, so the
         * feather is free of an extra canvas and an extra clear.
         *
         * Drawn a radius oversized because a blur pulls transparency in from
         * beyond the edges, and the presenter's shoulder is often exactly
         * there.
         */
        const radius = Math.max(1, Math.round(w / 480));
        personCtx.clearRect(0, 0, w, h);
        personCtx.drawImage(video, 0, 0, w, h);
        personCtx.globalCompositeOperation = "destination-in";
        personCtx.imageSmoothingEnabled = true;
        personCtx.imageSmoothingQuality = "high";
        personCtx.filter = `blur(${radius}px)`;
        personCtx.drawImage(maskCanvas, -radius, -radius, w + radius * 2, h + radius * 2);
        personCtx.filter = "none";
        personCtx.globalCompositeOperation = "source-over";

        outCtx.clearRect(0, 0, w, h);
        if (mode === "blur") {
          outCtx.save();
          outCtx.filter = `blur(${Math.max(8, Math.round(w / 80))}px)`;
          // Overdraw past the edges so the blur doesn't vignette to transparent.
          outCtx.drawImage(video, -16, -16, w + 32, h + 32);
          outCtx.restore();
        }
        outCtx.drawImage(person, 0, 0);

        /*
         * Step down, or stop.
         *
         * Measured over a window rather than per frame, because one slow frame
         * is a garbage collection and not a verdict on the machine. Past the
         * bottom of the ladder the honest answer is that this hardware cannot
         * do this — so say so and hand the caller the raw camera, rather than
         * spending the presentation's frame budget on a background.
         */
        costSum += performance.now() - startedAt;
        costCount += 1;
        if (costCount >= COST_WINDOW) {
          meanCostMs = costSum / costCount;
          costSum = 0;
          costCount = 0;
          const verdict = nextRung(meanCostMs, rung);
          rung = verdict.rung;
          givenUp = verdict.givenUp;
        }
        return out;
      } catch {
        // One bad frame must not kill the feed; the caller draws raw video.
        return null;
      }
    };

    return {
      render,
      health,
      close() {
        closed = true;
        try {
          segmenter.close();
        } catch {
          // Already torn down with the page.
        }
      },
    };
  } catch {
    return null;
  }
}

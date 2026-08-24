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
  render(video: HTMLVideoElement, timestampMs: number, mode: Exclude<CameraBackground, "none">): HTMLCanvasElement | null;
  close(): void;
}

/** Where the copy script stages the wasm runtime (see scripts/copy-mediapipe-wasm.mjs). */
const WASM_BASE = "/mediapipe/wasm";
const MODEL_URL = "/models/selfie_segmenter.tflite";

/** Frames below this confidence are background. Chosen by eye on the model's own demo. */
const PERSON_THRESHOLD = 0.55;

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
    const segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });

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
    let lastTimestamp = -1;
    let closed = false;

    const render: PersonSegmenter["render"] = (video, timestampMs, mode) => {
      if (closed || !video.videoWidth) return null;

      // The video clock must be monotonic for VIDEO running mode; a repeated
      // or rewound timestamp (tab restored, stream restarted) throws inside
      // the wasm. Re-render the previous composite instead of crashing.
      if (timestampMs <= lastTimestamp) return out;
      lastTimestamp = timestampMs;

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
        for (let i = 0; i < confidence.length; i++) {
          const c = confidence[i];
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

        // The person, alone on transparency: frame masked by the (smoothly
        // upscaled) confidence alpha.
        personCtx.clearRect(0, 0, w, h);
        personCtx.drawImage(video, 0, 0, w, h);
        personCtx.globalCompositeOperation = "destination-in";
        personCtx.imageSmoothingEnabled = true;
        personCtx.drawImage(maskCanvas, 0, 0, w, h);
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
        return out;
      } catch {
        // One bad frame must not kill the feed; the caller draws raw video.
        return null;
      }
    };

    return {
      render,
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

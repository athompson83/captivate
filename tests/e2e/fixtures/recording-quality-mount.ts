/**
 * The recorder's encoding decisions, exercised by a real MediaRecorder.
 *
 * The presenter's report was "the video file that exported is low definition",
 * and the two things that could cause it are invisible from the source: the
 * capture being resampled below the display, and the encoder being handed a
 * budget or a profile too small for hard-edged text. Both only show up in the
 * file, so this encodes one and reads it back.
 *
 * It imports `pickMimeType` and `bitrateForFrame` from the recorder itself,
 * never a copy, and is imported by nothing under `src/`.
 */

import { bitrateForFrame, pickMimeType } from "@/lib/record/recorder";

declare global {
  interface Window {
    codecSupport: () => Record<string, boolean>;
    chosenMimeType: () => string | null;
    bitrateFor: (w: number, h: number, fps: number) => number;
    /** Encodes a moving text pattern and reports what the file actually is. */
    encode: (
      width: number,
      height: number,
      fps: number,
      ms: number,
    ) => Promise<{
      mimeType: string;
      bytes: number;
      decodedWidth: number;
      decodedHeight: number;
      durationMs: number;
      requestedBitrate: number;
      actualBitrate: number;
    }>;
  }
}

const PROBED = [
  "video/mp4;codecs=avc1.640033,mp4a.40.2",
  "video/mp4;codecs=avc1.64002A,mp4a.40.2",
  "video/mp4;codecs=avc1.640029,mp4a.40.2",
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/webm;codecs=vp9,opus",
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/webm;codecs=vp8,opus",
];

window.codecSupport = () =>
  Object.fromEntries(PROBED.map((type) => [type, MediaRecorder.isTypeSupported(type)]));
window.chosenMimeType = () => pickMimeType();
window.bitrateFor = (w, h, fps) => bitrateForFrame(w, h, fps);

window.encode = async (width, height, fps, ms) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false })!;

  let frame = 0;
  const paint = () => {
    // Fine text on flat colour: the content a screen recording is made of,
    // and the first thing a starved encoder smears.
    ctx.fillStyle = "#0b0b0e";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#ffffff";
    ctx.font = `${Math.round(height / 36)}px monospace`;
    for (let line = 0; line < 24; line++) {
      ctx.fillText(
        `movement ${line} · the argument continues here — frame ${frame}`,
        24,
        (line + 1) * (height / 26),
      );
    }
    frame += 1;
  };
  paint();

  const stream = canvas.captureStream(fps);
  const mimeType = pickMimeType()!;
  const requestedBitrate = bitrateForFrame(width, height, fps);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: requestedBitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);

  const painting = setInterval(paint, 1000 / fps);
  const startedAt = performance.now();
  recorder.start();
  await new Promise((r) => setTimeout(r, ms));
  const stopped = new Promise<void>((r) => (recorder.onstop = () => r()));
  recorder.stop();
  await stopped;
  clearInterval(painting);
  const elapsed = performance.now() - startedAt;
  stream.getTracks().forEach((t) => t.stop());

  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("the encoded file would not decode"));
    setTimeout(() => reject(new Error("decode timed out")), 10_000);
  });

  const result = {
    mimeType,
    bytes: blob.size,
    decodedWidth: video.videoWidth,
    decodedHeight: video.videoHeight,
    durationMs: Math.round(elapsed),
    requestedBitrate,
    actualBitrate: Math.round((blob.size * 8) / (elapsed / 1000)),
  };
  URL.revokeObjectURL(url);
  return result;
};

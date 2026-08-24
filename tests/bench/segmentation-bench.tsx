import { createPersonSegmenter } from "@/lib/media/segmentation";

declare global {
  interface Window {
    runBench: (frames: number) => Promise<unknown>;
  }
}

window.runBench = async (frames: number) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  await new Promise((r) => setTimeout(r, 400));

  const segmenter = await createPersonSegmenter();
  if (!segmenter) return { error: "no segmenter" };

  const probe = document.createElement("canvas");
  probe.width = 64;
  probe.height = 36;
  const probeCtx = probe.getContext("2d", { willReadFrequently: true })!;

  const costs: number[] = [];
  let previous: Uint8ClampedArray | null = null;
  const flicker: number[] = [];
  let t = 1000;

  for (let i = 0; i < frames; i++) {
    t += 1000 / 30;
    const started = performance.now();
    const out = segmenter.render(video, t, "remove");
    const elapsed = performance.now() - started;
    if (!out) continue;
    costs.push(elapsed);

    // Alpha churn between consecutive masks: the number that *is* shimmer.
    probeCtx.clearRect(0, 0, 64, 36);
    probeCtx.drawImage(out, 0, 0, 64, 36);
    const alpha = probeCtx.getImageData(0, 0, 64, 36).data;
    if (previous) {
      let churn = 0;
      for (let p = 3; p < alpha.length; p += 4) churn += Math.abs(alpha[p] - previous[p]);
      flicker.push(churn / (64 * 36));
    }
    previous = new Uint8ClampedArray(alpha);
    await new Promise((r) => setTimeout(r, 0));
  }

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  const sorted = [...costs].sort((a, b) => a - b);
  stream.getTracks().forEach((track) => track.stop());
  segmenter.close();
  return {
    frames: costs.length,
    health: segmenter.health(),
    meanCostMs: Number(mean(costs).toFixed(2)),
    p95CostMs: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(2)),
    maxCostMs: Number((sorted[sorted.length - 1] ?? 0).toFixed(2)),
    meanAlphaChurn: Number(mean(flicker).toFixed(2)),
    source: { width: video.videoWidth, height: video.videoHeight },
  };
};

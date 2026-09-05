# Recording

## What browsers can actually do

Being straight about this matters, because the alternative is a feature that
looks finished and produces black video.

**There is no API that records a DOM subtree.** Not `html2canvas`, not
`MediaRecorder` on an element, not anything. The only way to capture what the
audience really sees — including live annotations, video elements, CSS
transitions and web fonts — is `getDisplayMedia`, where the _user_ picks what to
share.

So that is what Captivate does, and the UI says so: "Captivate records the stage
by capturing this browser tab." Choosing this tab gives the cleanest result. A
picker appears because the browser insists on one, and no amount of engineering
removes it.

What engineering _can_ do is make the right choice the easy one, and notice a
wrong one. `preferCurrentTab` and `selfBrowserSurface: "include"` put this tab
in front of the presenter; `surfaceSwitching` and `systemAudio` are excluded
because nothing here needs the presenter's other windows and offering them is
how a private tab ends up in a published recording. The setup dialog names the
tab to look for — the deck's own title. And once the share exists, the recorder
reads `displaySurface` from the track: a whole screen or another window earns
an immediate warning, because sharing the screen this tab is on puts the
preview inside its own capture, and hearing that in the first second is better
than at the end of a talk.

**Container support is not universal.** Chromium with proprietary codecs and
Safari produce MP4; a Chromium built without them produces WebM. The recorder
asks `MediaRecorder.isTypeSupported` down an explicit preference order rather
than assuming, and tells the user which format they will get.

**There is no in-browser transcoding here.** Shipping ffmpeg.wasm to convert
WebM to MP4 would add tens of megabytes and minutes of CPU. If MP4 is required
on a Chromium browser, converting the downloaded file is the practical path. The
UI says this rather than implying otherwise.

---

## How it works

```
getDisplayMedia ──┐
                  ├─→ MediaStream ──→ MediaRecorder ──→ Blob
getUserMedia ─────┘   (audio only)

getDisplayMedia ──┐
                  ├─→ canvas.captureStream + audio ──→ MediaRecorder ──→ Blob
getUserMedia ─────┘   only when captions are burnt in
```

**Three, two, one.** The streams are acquired while the presenter is still
looking at the setup dialog, and the file does not begin while they are still
looking at it: the dialog closes, a count runs over the stage — one number a
second, from three — and `MediaRecorder` starts on zero, so the first second
of the film is the presenter and not the click. The count is never in the
file, because nothing is being captured until it ends. Escape or the button
cancels, which releases the streams exactly as an error would, without the
toast (`src/lib/record/countdown.ts`, `recording-countdown.tsx`).

**The recorder does not open a camera.** It takes the display and the
microphone, and nothing else. The presenter's camera is already on the stage —
`PresenterCameraFeed` in `src/components/present/presenter-camera.tsx` — and
the stage is what is being captured, so the camera is in the file because it is
in the tab.

It used to open its own camera and composite an inset, while the on-stage feed
carried on rendering. Both ended up in the recording: the presenter, twice,
overlapping. There is now exactly one `getUserMedia({ video })` in the whole
application, and a test asserts a single video track is opened.

The consequence worth knowing: **where the presenter puts the feed on the stage
is where it is in the file.** Dragging it, resizing it and choosing its
background are the same act as arranging the recording.

The canvas path exists only for burnt-in captions, which have to be drawn into
the pixels. It sizes itself to the capture's own dimensions — never a fixed
1920 — and copies once per captured frame via `requestVideoFrameCallback`,
falling back to a timed `requestAnimationFrame` loop where that is unavailable.

---

## Quality

Three things decide whether a sharp presentation comes back sharp, and all
three were wrong at some point.

**The capture resolution.** `ideal` on a display capture is a _ceiling_ the
browser scales down to, not a target it scales up to. Asking for
`width: { ideal: 1920 }` meant a 2560-wide screen was resampled before it
reached the encoder. The recorder now asks for more than any current display
and takes whatever the browser gives, then sizes everything downstream from
`track.getSettings()`.

**The budget.** A flat 4 Mbit/s is fine for a webcam and wrong for a deck:
screen capture is flat colour and hard-edged text, and text is what a codec
spends its bits on when it has them and smears when it does not. At 1440p that
budget worked out under a tenth of a bit per pixel. `bitrateForFrame` scales
with pixels and frame rate at 0.14 bits per pixel per frame, with a 6 Mbit/s
floor so a small capture is not starved and a 40 Mbit/s ceiling so a 4K screen
does not produce a file nobody can upload.

| capture       | budget             |
| ------------- | ------------------ |
| 1280×720 @30  | 6.0 Mbit/s (floor) |
| 1920×1080 @30 | 8.7 Mbit/s         |
| 2560×1440 @30 | 15.5 Mbit/s        |
| 3840×2160 @30 | 34.8 Mbit/s        |

**The profile.** The candidate list led with `avc1.42E01E` — H.264 _Baseline_,
level 3.0, which has neither CABAC nor B-frames — so every Chrome with H.264
took the weakest profile available for exactly the content that shows the
difference. `pickMimeType` now asks for High profile first at descending
levels, keeps VP9 ahead of Baseline, and keeps Baseline only as a last resort.
`MediaRecorder.isTypeSupported` decides; nothing is assumed.

`tests/e2e/recording-quality.spec.ts` encodes a page of text at 1440p and
1080p in a real browser and decodes the result back, so "no silent downscale"
is measured rather than asserted.

---

## Background removal

MediaPipe's selfie segmenter, in wasm served from this origin, against a model
committed to this repo. **No frame of camera video leaves the machine**, which
is not an optimisation: a presenter's face is the most personal pixel stream
the application touches.

- **Scheduling** is `requestVideoFrameCallback`, so the model runs once per
  decoded camera frame rather than once per display refresh. On a 120 Hz screen
  with a 30 fps camera the old animation-frame loop woke four times per frame
  that existed.
- **Temporal smoothing** carries 55% of the previous frame's confidence
  forward, before thresholding rather than after. The model has no memory, so a
  pixel at the edge of a shoulder flips between frames — each frame defensible,
  the sequence shimmering. That shimmer is what "clunky" background removal
  looks like.
- **Feathering** happens on the composite that applies the mask, drawn a blur
  radius oversized so the edge of frame does not fade. A 256-wide mask on a
  1920-wide frame otherwise decides the whole boundary inside about five source
  pixels, which reads as a cut-out sticker.
- **The delegate** is GPU, falling back to CPU if that fails. A blocked WebGL
  context or a blacklisted driver used to take the feature out entirely.
- **Under load** the segmenter steps 30 → 20 → 12 fps, and past that stops and
  hands back the raw camera. A stuttering presentation is worse than a visible
  room, and a nicety never gets to spend the frame budget the talk needs.

`tests/bench/run.mts` measures the real cost in a real browser against the real
model; `nextRung` in `src/lib/media/segmentation.ts` is the policy, unit-tested
without needing any of it.

---

## Durability

A recording is never lost. In order:

1. Capture stops and the `Blob` exists locally.
2. The download button is offered immediately, before any upload starts.
3. A `recordings` row is created with status `uploading`, so something visible
   exists even if the next step fails.
4. The blob uploads to the private `recordings` bucket.
5. On success the row becomes `ready`. On failure it becomes `local_only` with
   the error recorded, and a toast offers the download with a warning that
   closing the tab loses the file.

The library shows `local_only` recordings, labelled. A user who lost an upload
needs to know it happened, not discover an empty library later.

`MediaRecorder` is started with a one-second timeslice, so a crash costs at most
a second of footage rather than the whole session.

---

## Failure modes

| Situation                                 | Behaviour                                                    |
| ----------------------------------------- | ------------------------------------------------------------ |
| Screen share declined                     | Nothing starts; a message says why                           |
| Microphone declined                       | Nothing starts — a recording with no narration is not useful |
| Camera declined or missing                | Downgrades to screen + microphone, and says so               |
| "Stop sharing" pressed in the browser bar | Finishes cleanly, exactly as if Stop had been pressed        |
| Recorder errors mid-session               | Whatever was captured is still offered                       |
| `MediaRecorder` unavailable               | Recording marked unavailable with a specific reason          |
| Screen capture unavailable (iOS)          | Same, naming the platform limitation                         |
| Upload fails                              | `local_only`, with a download prompt                         |

---

## Scene timeline

Scene changes are recorded as `{ sceneId, sceneIndex, atMs }` while recording,
and stored on the row. Playback turns them into chapter buttons, so a two-hour
lecture is navigable rather than a scrub bar.

---

## Playback and export

Playback streams from a short-lived signed URL, minted only for the owner.
Download is a direct link to the same URL.

The player shows the real container and says what it means: MP4 plays anywhere;
WebM plays in Chrome, Edge, Firefox and VLC, and needs conversion for older
software.

---

## Deliberately not built

Server-side transcoding to MP4 (needs a paid worker), trimming and editing,
automatic captioning, separate audio export, and streaming to a live audience.
Each is a real feature; none is needed to record a lecture and get a file.

There is no separate title card or outro: the recording captures the stage as
shown, so a show that opens wide and ends on its closing image (see
`PRESENTATION_ENGINE.md`) has both in the film already.

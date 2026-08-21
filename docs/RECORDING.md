# Recording

## What browsers can actually do

Being straight about this matters, because the alternative is a feature that
looks finished and produces black video.

**There is no API that records a DOM subtree.** Not `html2canvas`, not
`MediaRecorder` on an element, not anything. The only way to capture what the
audience really sees — including live annotations, video elements, CSS
transitions and web fonts — is `getDisplayMedia`, where the *user* picks what to
share.

So that is what Captivate does, and the UI says so: "Captivate records the stage
by capturing this browser tab." Choosing this tab gives the cleanest result. A
picker appears because the browser insists on one, and no amount of engineering
removes it.

**Container support is not universal.** Chromium produces WebM; Safari produces
MP4. The recorder asks `MediaRecorder.isTypeSupported` rather than assuming, and
tells the user which format they will get.

**There is no in-browser transcoding here.** Shipping ffmpeg.wasm to convert
WebM to MP4 would add tens of megabytes and minutes of CPU. If MP4 is required
on a Chromium browser, converting the downloaded file is the practical path. The
UI says this rather than implying otherwise.

---

## How it works

```
getDisplayMedia ──┐
                  ├─→ (camera off) MediaStream ──→ MediaRecorder ──→ Blob
getUserMedia ─────┘   audio track

getDisplayMedia ──┐
getUserMedia ─────┼─→ canvas.captureStream + audio ──→ MediaRecorder ──→ Blob
 (camera)      ───┘   drawn each animation frame
```

With the camera off, the screen video track and the microphone audio track go
straight into one `MediaStream`.

With the camera on, both video elements are drawn onto an offscreen canvas every
animation frame — screen full-bleed, camera inset into the chosen corner, either
circle-clipped with a centre crop (so faces are not squashed) or rounded, with a
hairline so the inset stays legible against a light slide. The canvas is
captured at 30fps and the microphone track added.

The result is that the camera is genuinely **in** the file, not overlaid at
playback time.

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

| Situation | Behaviour |
| --- | --- |
| Screen share declined | Nothing starts; a message says why |
| Microphone declined | Nothing starts — a recording with no narration is not useful |
| Camera declined or missing | Downgrades to screen + microphone, and says so |
| "Stop sharing" pressed in the browser bar | Finishes cleanly, exactly as if Stop had been pressed |
| Recorder errors mid-session | Whatever was captured is still offered |
| `MediaRecorder` unavailable | Recording marked unavailable with a specific reason |
| Screen capture unavailable (iOS) | Same, naming the platform limitation |
| Upload fails | `local_only`, with a download prompt |

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

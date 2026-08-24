/**
 * The real `PresenterCameraFeed`, on a real stage, with a real camera.
 *
 * The presenter reported that the feed could not be resized. The code for it
 * existed — which is exactly why a unit test asserting the handler recomputes
 * a number would have passed. What did not exist was any way to *find* the
 * handle: it was transparent until the pointer was already inside a 20px
 * target hanging outside the corner, and the drag it then performed ignored
 * vertical movement entirely.
 *
 * Seeing that needs a browser: a live `getUserMedia` track, real pointer
 * capture, real hit-testing against `opacity`, and a stage element with a
 * genuine `getBoundingClientRect`. Chromium's fake capture device supplies the
 * camera, so this needs no hardware, no server and no account.
 *
 * It imports the component itself, never a copy, and is imported by nothing
 * under `src/`.
 */

import "@/app/globals.css";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DEFAULT_CAMERA_FEED,
  PresenterCameraFeed,
  type CameraFeedSettings,
} from "@/components/present/presenter-camera";

const STAGE = { width: 960, height: 540 };

declare global {
  interface Window {
    cameraSettings: () => CameraFeedSettings;
    /** Every video track this page has ever opened, so duplicates are visible. */
    videoTracksOpened: number;
    setBackground: (background: CameraFeedSettings["background"]) => void;
  }
}

// Count camera opens at the source. A second pipeline anywhere in the tree
// would show up here as a second track, which is how the presenter ended up
// twice in one recording.
const realGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
window.videoTracksOpened = 0;
navigator.mediaDevices.getUserMedia = async (constraints) => {
  const stream = await realGetUserMedia(constraints);
  window.videoTracksOpened += stream.getVideoTracks().length;
  return stream;
};

function Harness() {
  const [settings, setSettings] = useState<CameraFeedSettings>({
    ...DEFAULT_CAMERA_FEED,
    enabled: true,
    background: "none",
    x: 0.5,
    y: 0.5,
    size: 0.2,
  });
  // Installed from an effect, and reading through a ref, because writing to
  // `window` during render is exactly the thing the React Compiler rules in
  // this repo treat as an error — fixtures included.
  const latest = useRef(settings);
  useEffect(() => {
    latest.current = settings;
  }, [settings]);
  useEffect(() => {
    window.cameraSettings = () => latest.current;
    window.setBackground = (background) => setSettings((s) => ({ ...s, background }));
  }, []);

  return (
    <div
      id="stage"
      style={{ position: "relative", width: STAGE.width, height: STAGE.height, background: "#111" }}
    >
      <PresenterCameraFeed settings={settings} onChange={setSettings} interactive />
    </div>
  );
}

const host = document.createElement("div");
document.body.append(host);
createRoot(host).render(<Harness />);

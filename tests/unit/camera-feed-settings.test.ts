// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_CAMERA_FEED,
  loadCameraFeedSettings,
  saveCameraFeedSettings,
} from "@/components/present/presenter-camera";

describe("camera feed settings", () => {
  afterEach(() => localStorage.clear());

  it("round-trips placement and background", () => {
    saveCameraFeedSettings("p1", {
      enabled: true,
      background: "blur",
      x: 0.25,
      y: 0.5,
      size: 0.3,
      shape: "rounded",
    });
    const loaded = loadCameraFeedSettings("p1");
    expect(loaded.x).toBe(0.25);
    expect(loaded.y).toBe(0.5);
    expect(loaded.size).toBe(0.3);
    expect(loaded.background).toBe("blur");
    expect(loaded.shape).toBe("rounded");
  });

  it("never re-enables the camera from storage", () => {
    // Opening a camera is a live decision. A page load must not turn a lens
    // on because it was on last week.
    saveCameraFeedSettings("p1", { ...DEFAULT_CAMERA_FEED, enabled: true });
    expect(loadCameraFeedSettings("p1").enabled).toBe(false);
  });

  it("survives corrupt storage", () => {
    localStorage.setItem("captivate:camera-feed:p1", "{not json");
    expect(loadCameraFeedSettings("p1")).toEqual(DEFAULT_CAMERA_FEED);
  });

  it("is scoped per presentation", () => {
    saveCameraFeedSettings("p1", { ...DEFAULT_CAMERA_FEED, x: 0.1 });
    expect(loadCameraFeedSettings("p2").x).toBe(DEFAULT_CAMERA_FEED.x);
  });
});

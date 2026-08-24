import { describe, expect, it } from "vitest";
import { isPublicPath } from "@/lib/auth/public-paths";

/**
 * The app's front door.
 *
 * A share link is the one URL in Captivate meant for people who do not have an
 * account, and the proxy sent every one of them to a sign-in page. Three
 * migrations, a SECURITY DEFINER resolver and two RLS policies exist to make
 * `/v/<token>` and the images on it resolve for a stranger; none of it was
 * reachable. The unit suite passed, the RLS suite passed — both test layers
 * below the one that was wrong.
 */

const TOKEN = "d0f6ef8b-3f56-4b3d-b601-9b3c7b043802";
const ASSET = "c364c88e-9940-4ad9-bc80-7af603aaec74";

describe("what a visitor with no account may reach", () => {
  it("opens a share link", () => {
    expect(isPublicPath(`/v/${TOKEN}`)).toBe(true);
  });

  it("loads the images on a shared deck", () => {
    // Without this the deck renders and every picture on it is a redirect to
    // a sign-in page.
    expect(isPublicPath(`/api/assets/${ASSET}/content`)).toBe(true);
  });

  it("opens the marketing page and the auth pages", () => {
    for (const path of ["/", "/sign-in", "/sign-up", "/reset-password", "/update-password"]) {
      expect(isPublicPath(path), path).toBe(true);
    }
    expect(isPublicPath("/auth/callback")).toBe(true);
  });
});

describe("what it may not", () => {
  it("keeps the asset listing private", () => {
    // This returns the caller's own library. The content route is public
    // because it authorises per file; the listing has nothing to authorise on.
    expect(isPublicPath("/api/assets")).toBe(false);
    expect(isPublicPath("/api/assets?kind=image")).toBe(false);
  });

  it("does not open the asset route to anything but a real content URL", () => {
    expect(isPublicPath("/api/assets/not-a-uuid/content")).toBe(false);
    expect(isPublicPath(`/api/assets/${ASSET}`)).toBe(false);
    expect(isPublicPath(`/api/assets/${ASSET}/content/extra`)).toBe(false);
    expect(isPublicPath(`/api/assets/${ASSET}/../../ai/generate/content`)).toBe(false);
  });

  it("keeps the presenter's own surfaces behind the gate", () => {
    // The stage carries no speaker material, but it is still the owner's deck;
    // the handout and console carry material that must never be public.
    for (const path of [
      "/home",
      "/presentations",
      "/edit/abc",
      "/present/abc",
      "/present/abc/console",
      "/handout/abc",
      "/recordings",
      "/notes",
      "/settings",
      "/api/ai/outline",
    ]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it("is not fooled by a path that merely starts with a public one", () => {
    expect(isPublicPath("/verify")).toBe(false);
    expect(isPublicPath("/vault/secrets")).toBe(false);
    expect(isPublicPath("/sign-in-as-someone-else")).toBe(false);
    expect(isPublicPath("/authenticated-only")).toBe(false);
  });
});

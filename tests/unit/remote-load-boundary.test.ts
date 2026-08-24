import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The remote route's load boundary.
 *
 * A phone is the device most likely to be handed to someone, propped on a
 * lectern, or left face-up on a table — so the rule that keeps speaker notes
 * off the projector applies here at least as strongly. It is a *load*
 * boundary, not a rendering one: every prop a `"use client"` component
 * receives is serialised into the payload the browser downloads, so a note
 * that is fetched and passed down is in the phone's source whether or not
 * anything draws it.
 *
 * This reads the route and the component rather than rendering them, because
 * the claim is about what the module imports at all — which is precisely what
 * a render test cannot see.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const ROUTE = "src/app/present/[id]/remote/page.tsx";
const COMPONENT = "src/components/present/phone-remote.tsx";

/** The loaders that read presenter-only material. None may appear here. */
const FORBIDDEN = [
  "getPresentationDocument",
  "listNotes",
  "@/lib/data/notes",
  "speakerNotes",
  "speaker_notes",
  "lectureNotes",
  "PresenterConsole",
  "SceneNavigator",
];

describe("the phone remote's load boundary", () => {
  it("loads a title and a session, and no presenter material", () => {
    const source = read(ROUTE);
    for (const forbidden of FORBIDDEN) {
      expect(source, `${ROUTE} must not reference ${forbidden}`).not.toContain(forbidden);
    }
    // What it may load: the deck's header, and the session it was sent to.
    expect(source).toContain("getPresentationMeta");
    expect(source).toContain("getRemoteSession");
  });

  it("does not let the component reach for notes either", () => {
    const source = read(COMPONENT);
    for (const forbidden of FORBIDDEN) {
      expect(source, `${COMPONENT} must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("requires a signed-in owner before rendering anything", () => {
    const source = read(ROUTE);
    // The QR link carries no authority of its own, so this redirect is what
    // stands between a photographed code and a working remote.
    expect(source).toContain("getCurrentUser");
    expect(source).toContain("/sign-in?next=");
  });

  it("refuses a session that belongs to a different presentation", () => {
    // Otherwise a live session on any deck you own would drive any other one.
    expect(read(ROUTE)).toContain("session.presentationId === id");
  });
});

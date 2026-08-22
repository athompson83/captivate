import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { Scene } from "@/lib/schema/presentation";
import { forAudience } from "@/lib/present/audience";

/**
 * The stage window's load boundary.
 *
 * `PresentRoot` states that it has no access to speaker notes "because it was
 * never loaded here", and the rule in AGENTS.md is explicit that this is a load
 * boundary rather than a rendering one. It was not true: the route passed
 * `getPresentationDocument`'s scenes straight into a `"use client"` component,
 * and every prop such a component receives is serialised into the payload the
 * browser downloads. The notes were in the projector window's source the whole
 * time.
 *
 * The test that existed asserted the notes were not *rendered*, which is the
 * weaker claim, and it passed throughout. These assert the payload.
 */

const NOTES = "Do not read this bit out. The second figure is disputed.";

function scene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    presentationId: "22222222-2222-4222-8222-222222222222",
    sectionId: null,
    position: 0,
    title: "Opening",
    content: { layout: "title", elements: [] } as unknown as Scene["content"],
    placement: { x: 0, y: 0, scale: 1, rotation: 0 },
    momentId: null,
    speakerNotes: NOTES,
    durationSeconds: 90,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("forAudience", () => {
  it("empties the speaker notes", () => {
    const [out] = forAudience([scene()]);
    expect(out.speakerNotes).toBe("");
  });

  it("keeps everything the audience surface actually renders", () => {
    const input = scene();
    const [out] = forAudience([input]);

    // Everything but the notes, field by field: a strip that quietly dropped
    // the placement would empty the world canvas and still pass a test that
    // only asked about notes.
    expect({ ...out, speakerNotes: NOTES }).toEqual(input);
  });

  it("leaves no note anywhere in the serialised payload", () => {
    // The actual property: what reaches the wire. A structural assertion on
    // one field cannot see a note that survived somewhere else in the object.
    const payload = JSON.stringify(forAudience([scene(), scene({ position: 1 })]));
    expect(payload).not.toContain(NOTES);
    expect(payload).not.toContain("disputed");
  });
});

describe("the stage route", () => {
  it("hands the audience window no speaker notes", async () => {
    vi.resetModules();

    const scenes = [scene(), scene({ position: 1, speakerNotes: "Second note." })];

    vi.doMock("next/navigation", () => ({
      notFound: () => {
        throw new Error("notFound");
      },
      redirect: () => {
        throw new Error("redirect");
      },
    }));
    vi.doMock("@/lib/supabase/config", () => ({ isSupabaseConfigured: true }));
    vi.doMock("@/lib/supabase/server", () => ({
      getCurrentUser: async () => ({ id: "33333333-3333-4333-8333-333333333333" }),
    }));
    vi.doMock("@/lib/data/presentations", () => ({
      getPresentationDocument: async () => ({
        presentation: { id: "22222222-2222-4222-8222-222222222222", title: "Deck" },
        scenes,
        sections: [],
      }),
    }));
    // Stubbed so this stays a test about the payload rather than about the
    // whole presentation surface, which pulls in WebGL and the camera.
    vi.doMock("@/components/present/present-root", () => ({ PresentRoot: () => null }));

    const { default: PresentPage } = await import("@/app/present/[id]/page");

    const element = (await PresentPage({
      params: Promise.resolve({ id: "22222222-2222-4222-8222-222222222222" }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ scenes: Scene[] }>;

    // The props are the payload: this is exactly what gets serialised into the
    // window running on the projector.
    for (const passed of element.props.scenes) {
      expect(passed.speakerNotes).toBe("");
    }
    expect(JSON.stringify(element.props)).not.toContain("Do not read this bit out");
    expect(JSON.stringify(element.props)).not.toContain("Second note.");

    // And the scenes themselves are untouched — stripping a copy, not the
    // document the console route reads from the same loader.
    expect(scenes[0].speakerNotes).toBe(NOTES);

    vi.doUnmock("next/navigation");
    vi.doUnmock("@/lib/supabase/config");
    vi.doUnmock("@/lib/supabase/server");
    vi.doUnmock("@/lib/data/presentations");
    vi.doUnmock("@/components/present/present-root");
  });
});

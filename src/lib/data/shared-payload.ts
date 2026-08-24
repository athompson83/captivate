import { z } from "zod";
import {
  AspectRatio,
  JourneyConfig,
  ScenePlacement,
  parseSceneContent,
  type JourneyConfig as Journey,
  type Scene,
  type Section,
} from "@/lib/schema/presentation";

/**
 * The shape a share link resolves to, and the validation that guards it.
 *
 * Pure on purpose: the loader that talks to the database is `server-only`,
 * but what makes a shared payload *safe to render* is this parser, and a
 * parser that cannot be unit-tested is a boundary nobody is watching. The
 * payload is validated like any other content that has been through the
 * database — scenes salvaged with `parseSceneContent`, journey and placements
 * falling back rather than throwing — because a corrupt row must read as a
 * dead link or a partial deck, never a crash in front of an audience.
 */

/** What a share link resolves to. Audience-safe by construction. */
export interface SharedDeck {
  id: string;
  title: string;
  description: string;
  themeId: string;
  aspectRatio: AspectRatio;
  journey: Journey;
  scenes: Scene[];
  sections: Section[];
}

const SharedPayload = z.object({
  presentation: z.object({
    id: z.string().uuid(),
    title: z.string(),
    description: z.string(),
    themeId: z.string(),
    aspectRatio: AspectRatio,
    journey: z.unknown(),
  }),
  sections: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      label: z.string(),
      position: z.number(),
    }),
  ),
  scenes: z.array(
    z.object({
      id: z.string().uuid(),
      sectionId: z.string().uuid().nullable(),
      position: z.number(),
      title: z.string(),
      content: z.unknown(),
      placement: z.unknown(),
      // Absent from a deck shared before detail scenes existed; "main" is the
      // right reading of that silence — every scene in an older deck is part
      // of its running order by definition.
      flowRole: z.unknown().optional(),
    }),
  ),
});

/** Parses the RPC payload into a viewable deck; null means "not shareable". */
export function parseSharedPayload(raw: unknown): SharedDeck | null {
  const parsed = SharedPayload.safeParse(raw);
  if (!parsed.success) return null;
  const { presentation, sections, scenes } = parsed.data;

  const journeyParsed = JourneyConfig.safeParse(presentation.journey ?? {});
  const journey = journeyParsed.success ? journeyParsed.data : JourneyConfig.parse({});

  return {
    id: presentation.id,
    title: presentation.title,
    description: presentation.description,
    themeId: presentation.themeId,
    aspectRatio: presentation.aspectRatio,
    journey,
    sections: sections.map(
      (s): Section => ({
        id: s.id,
        presentationId: presentation.id,
        title: s.title,
        label: s.label,
        purpose: "",
        position: s.position,
        createdAt: "",
        updatedAt: "",
      }),
    ),
    scenes: scenes.map((row): Scene => {
      const placement = ScenePlacement.safeParse(row.placement);
      return {
        id: row.id,
        presentationId: presentation.id,
        sectionId: row.sectionId,
        position: row.position,
        title: row.title,
        content: parseSceneContent(row.content).content,
        placement: placement.success ? placement.data : null,
        flowRole: row.flowRole === "detail" ? "detail" : "main",
        momentId: null,
        // Never present in the payload; the empty string keeps the shared
        // shape identical to the audience window's.
        speakerNotes: "",
        durationSeconds: null,
        createdAt: "",
        updatedAt: "",
      };
    }),
  };
}

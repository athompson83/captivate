import "@/app/globals.css";

import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app-shell";
import { NotesWorkspace } from "@/components/notes/notes-workspace";
import type { LectureNote } from "@/lib/data/notes";
/**
 * The notes workspace, on its own.
 *
 * `/notes` is behind sign-in like the rest of the app, so the workspace had
 * only ever been rendered in jsdom. This mounts it in the shell with two
 * notes attached to a deck, the way the page does after its queries; every
 * action is the stubbed kind that resolves to nothing.
 */
declare global {
  interface Window {
    notesFixture: { mount: () => void };
  }
}
const P = "00000000-0000-4000-8000-000000000001";
/** A deck with a long title: the picker shows it, and must not be as wide as it. */
const LONG =
  "Sepsis in the first hour: a walk through the guideline for second-year paramedic students";
const note = (n: number, title: string, body: string): LectureNote => ({
  id: `00000000-0000-4000-8000-00000000c00${n}`,
  presentationId: P,
  sectionId: null,
  sceneId: null,
  title,
  body,
  position: n,
  createdAt: "2026-09-01T09:00:00Z",
  updatedAt: "2026-09-1" + n + "T09:00:00Z",
});
window.notesFixture = {
  mount() {
    window.navigationShim.pathname = "/notes";
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;overflow:auto";
    document.body.appendChild(host);
    createRoot(host).render(
      <AppShell
        user={{ email: "presenter@example.com", displayName: "Sam Presenter", avatarUrl: null }}
      >
        <NotesWorkspace
          initialNotes={[
            note(
              0,
              "Why attention drains",
              "The curve every lecturer recognises: ninety-five at the start, thirty by minute forty. The talk's job is to reset it, and the shape of the talk is the tool.\n\nThree things reset it: a change of place, a question the room has to answer, and a case.",
            ),
            note(
              1,
              "Compensated shock: the signs before hypotension",
              "Tachycardia, narrowed pulse pressure, delayed capillary refill, anxiety. The blood pressure is the last thing to go.",
            ),
          ]}
          presentations={[{ id: P, title: LONG }]}
          filterPresentationId={null}
          initialNoteId={null}
        />
      </AppShell>,
    );
  },
};

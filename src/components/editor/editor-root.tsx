"use client";

import { useEffect, useMemo, useState } from "react";
import type { PresentationDocument } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { useEditor } from "@/lib/editor/store";
import { useAutosave } from "@/lib/editor/autosave";
import { useEditorShortcuts } from "@/lib/editor/shortcuts";
import { useIsNarrow } from "@/lib/utils/use-viewport";
import { EditorTopBar } from "./top-bar";
import { SceneNavigator } from "./scene-navigator";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { NotesDock } from "./notes-dock";
import { AiDock } from "./ai-dock";
import { JourneyMap } from "./journey-map";
import { JourneyPanel } from "./journey-panel";
import { PacingStrip } from "./pacing-strip";
import { NarrativeMapView } from "@/components/narrative/narrative-map-view";
import { useSceneGeneration } from "@/components/narrative/use-scene-generation";
import type { EvidenceRef } from "@/lib/schema/narrative";
import type { EditorView } from "./top-bar";
import { RecoveryNotice } from "./recovery-notice";

/**
 * Editor shell.
 *
 * Layout follows the brief's hierarchy: the canvas dominates, the navigator is
 * a narrow collapsible rail, the inspector only exists when something is
 * selected, and AI lives in a dock that is summoned rather than always present.
 */
export function EditorRoot({
  document: initial,
}: {
  document: PresentationDocument & { recoveredScenes: string[] };
}) {
  const init = useEditor((s) => s.init);
  const themeId = useEditor((s) => s.document.presentation.themeId);
  const presentationId = initial.presentation.id;

  // `null` means "nobody has said", and the viewport answers: open beside the
  // canvas on a desktop, closed over it on a phone. A plain `true` opened a
  // 212px panel across 54% of a 390px screen on every load.
  const [navOpen, setNavOpen] = useState<boolean | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [view, setView] = useState<EditorView>("scene");
  const [evidenceOptions, setEvidenceOptions] = useState<EvidenceRef[]>([]);

  const narrow = useIsNarrow();
  const navVisible = navOpen ?? !narrow;
  const { generate, generating } = useSceneGeneration(presentationId, initial.presentation.title);

  // What a claim can be grounded in. Loaded once when the map is first opened,
  // because it is the workspace's material rather than this deck's, and it
  // changes far less often than anything else on screen.
  useEffect(() => {
    if (view !== "narrative" || evidenceOptions.length > 0) return;
    let cancelled = false;
    void fetch("/api/ai/evidence")
      .then((response) => (response.ok ? response.json() : { evidence: [] }))
      .then((body) => {
        if (!cancelled) setEvidenceOptions(body.evidence ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [view, evidenceOptions.length]);

  // The store is the source of truth for readiness: it holds this document once
  // `init` has run, which is also what every child selector depends on.
  const ready = useEditor((s) => s.document.presentation.id === presentationId);

  useEffect(() => {
    init(initial);
  }, [init, initial]);

  const { flush } = useAutosave(presentationId);
  useEditorShortcuts({
    onToggleNotes: () => setNotesOpen((v) => !v),
    onToggleAi: () => setAiOpen((v) => !v),
    onSave: flush,
  });

  const theme = useMemo(() => getTheme(themeId), [themeId]);

  if (!ready) return <EditorSkeleton />;

  return (
    <div className="bg-sunken flex h-screen flex-col overflow-hidden">
      <EditorTopBar
        presentationId={presentationId}
        navOpen={navVisible}
        onToggleNav={() => setNavOpen(!navVisible)}
        notesOpen={notesOpen}
        onToggleNotes={() => setNotesOpen((v) => !v)}
        aiOpen={aiOpen}
        onToggleAi={() => setAiOpen((v) => !v)}
        onSave={flush}
        view={view}
        onViewChange={setView}
      />

      <RecoveryNotice />

      {/* `relative`, because on a narrow screen the panels are positioned
          against this row rather than taking width out of it. */}
      <div className="relative flex min-h-0 flex-1">
        <SceneNavigator
          open={navVisible}
          overlay={narrow}
          onClose={() => setNavOpen(false)}
          presentationId={presentationId}
          theme={theme}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          {view === "scene" ? (
            <Canvas theme={theme} />
          ) : view === "narrative" ? (
            <NarrativeMapView
              presentationId={presentationId}
              evidenceOptions={evidenceOptions}
              onGenerate={(depth) => void generate(depth)}
              generating={generating}
            />
          ) : (
            <>
              <JourneyMap className="min-h-0 flex-1" />
              <PacingStrip />
            </>
          )}
          {/* Under the canvas, not beside it: on a narrow screen a 272px
              column left the scene 96px wide, and a sheet floating over the
              canvas hid the element being styled. */}
          {narrow && view === "scene" && <Inspector theme={theme} sheet />}
          {notesOpen && (
            <NotesDock presentationId={presentationId} onClose={() => setNotesOpen(false)} />
          )}
        </div>

        {!narrow && view === "scene" ? (
          <Inspector theme={theme} />
        ) : view === "journey" ? (
          <JourneyPanel presentationId={presentationId} />
        ) : null}
        {aiOpen && <AiDock presentationId={presentationId} onClose={() => setAiOpen(false)} />}
      </div>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="bg-sunken flex h-screen flex-col">
      <div className="border-line-subtle bg-base h-14 shrink-0 border-b" />
      <div className="flex min-h-0 flex-1">
        <div className="border-line-subtle hidden w-[212px] shrink-0 border-r md:block" />
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="skeleton aspect-video w-full max-w-4xl rounded-[var(--radius-lg)]" />
        </div>
      </div>
    </div>
  );
}

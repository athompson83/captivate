"use client";

import { useEffect, useMemo, useState } from "react";
import type { PresentationDocument } from "@/lib/schema/presentation";
import { getTheme } from "@/lib/schema/theme";
import { useEditor } from "@/lib/editor/store";
import { useAutosave } from "@/lib/editor/autosave";
import { useEditorShortcuts } from "@/lib/editor/shortcuts";
import { EditorTopBar } from "./top-bar";
import { SceneNavigator } from "./scene-navigator";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { NotesDock } from "./notes-dock";
import { AiDock } from "./ai-dock";
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

  const [navOpen, setNavOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

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
        navOpen={navOpen}
        onToggleNav={() => setNavOpen((v) => !v)}
        notesOpen={notesOpen}
        onToggleNotes={() => setNotesOpen((v) => !v)}
        aiOpen={aiOpen}
        onToggleAi={() => setAiOpen((v) => !v)}
        onSave={flush}
      />

      <RecoveryNotice />

      <div className="flex min-h-0 flex-1">
        <SceneNavigator open={navOpen} presentationId={presentationId} theme={theme} />

        <div className="flex min-w-0 flex-1 flex-col">
          <Canvas theme={theme} />
          {notesOpen && (
            <NotesDock presentationId={presentationId} onClose={() => setNotesOpen(false)} />
          )}
        </div>

        <Inspector theme={theme} />
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

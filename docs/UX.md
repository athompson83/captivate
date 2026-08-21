# UX Specification

## Core journeys

### 1. Create with AI

User selects **New presentation**, describes the goal, optionally adds source material, and receives a proposed narrative/scene outline first. The user can edit the outline before full scene generation. This reduces wasted generation and keeps the author in control.

### 2. Build manually

User starts blank or from a template, inserts scenes anywhere, adds blocks, applies layouts/themes, and sequences motion. The editor should reward direct manipulation but keep advanced controls discoverable.

### 3. Present

User chooses **Present**, selects an audience display/window, then enters a presenter console. Audience and presenter surfaces synchronize scene state but remain visually isolated. Presenter notes/timers/tools remain private.

### 4. Record

User performs a preflight for microphone, camera, audience capture, and output layout. Recording begins only after devices/permissions are clear. During capture, state is obvious and pause/resume is safe. Export/upload status is durable and recoverable.

## Interaction rules

- Insert scene affordances must exist between scenes, not only at the end.
- Selection should be obvious without permanently covering content in handles.
- Double-click/Enter edits text; Escape moves outward through editing contexts predictably.
- Destructive actions support undo and/or recovery from trash.
- Autosave status should be quiet when healthy and conspicuous when unhealthy.
- Context menus and keyboard shortcuts complement visible controls; they cannot be the only path for essential actions.
- Presentation navigation must remain reliable even if optional AI/network features fail.

## Presenter pointer modes

Pointer behavior should be modeled explicitly:

- `cursor`: normal presenter interaction.
- `laser`: transient luminous point/trail on audience output.
- `spotlight`: visually emphasizes the region under the pointer.
- `highlight`: click/drag to create a temporary translucent region.
- `draw`: freehand persistent annotation for the current session.

The audience sees only the intended annotation/pointer layer, never private presenter controls.

## Notes behavior

Speaker notes follow the active scene and optionally the active beat/reveal. A presenter can scroll notes independently without changing the audience. If the active scene changes, notes should move to the corresponding anchor without creating disorienting jumps.

Lecture notes are edited in Studio/Library and are not automatically shown during presentation unless a user deliberately maps content into speaker notes.

## Empty states

Empty states should teach the next action. For a new user, prioritize three obvious paths: generate with AI, start from a template, or start blank.

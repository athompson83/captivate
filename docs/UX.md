# UX

The decisions worth explaining, and why they went the way they did.

---

## Presenter privacy is structural

The stage and the console are **different routes**. The stage does not import
notes, timers or the navigator — it does not hide them, it does not load them.

A `hidden` class is a bug away from being visible. A route that never renders
the component cannot leak it, no matter what happens to the state.

---

## The map gate

The AI path stops at a narrative map you can read, edit, delete from and
regenerate before anything is created.

Reviewing an argument takes a minute. Discovering a bad argument after forty
scenes exist costs far more — in tokens, and in the feeling that the tool wasted
your time. This is the difference between AI that saves work and AI that creates
cleanup.

What you review is not a list of slide titles. Every moment says why it exists
and what the room leaves with, because that is the decision worth reviewing —
"Slide 4: The data" tells you nothing about whether the talk works.

The map is not consumed by generation. It stays as a view of the editor, it is
what regeneration reads, and locking a moment excludes it from every future
generation rather than generating it and throwing the result away.

## Warn, never block

A map that runs longer than the time you planned for says so, in a sentence,
and changes nothing. "Generate scenes" stays enabled. Running long is a fact
about the argument, and what comes out is the author's decision — the tool has
no basis for making it.

"Rescale to 15 min" is offered beside the warning. It changes durations only,
never wording, and a locked moment keeps exactly the time you gave it.

---

## Layouts own geometry

Fourteen designed compositions. Neither a person nor a model invents coordinates.

The alternative — a free canvas with alignment guides — produces decks where
every slide is subtly different for no reason. Manual nudging is still available
and flips the scene to free-form, which is the right escape hatch.

---

## Text shrinks rather than spilling

A heading longer than expected shrinks to fit its box. It does not overflow onto
the element below, and it does not get clipped.

There is a floor at 45% of the authored size. Below that the honest answer is
"this is too much text", and the user should see that rather than have it hidden
at 8pt.

---

## Save state is a sentence

Not a spinner. "All changes saved", "Saving…", "Couldn't save" — with the last
save time in a tooltip, and `aria-live` so it is announced.

A presenter about to close a laptop needs to know, without interpretation,
whether their work is safe.

---

## Nothing is lost on close

Pending writes flush on tab hide, on page unload and on unmount. The browser
warns before navigating away with genuinely unsaved changes.

Recordings go further: the download is offered the instant capture stops, before
any upload begins, and a failed upload is labelled `local_only` rather than
appearing as a library entry that plays nothing.

---

## The presenter bar hides itself

It appears on movement and disappears after 2.6 seconds. Every action on it has
a keyboard shortcut, so it never needs to appear at all.

The audience should be looking at content. In audience-only mode the bar does
not exist.

---

## The console works alone

With no stage window connected, the console drives itself — so you can rehearse
notes, timing and pacing without a second display, which is what most rehearsal
actually looks like.

It yields to the stage the moment one appears, so the two can never disagree
about what the audience is seeing.

---

## Annotations never touch the document

Laser, highlight and ink are session overlays. Nothing you do while presenting
can modify the saved presentation.

This is what makes them usable. A presenter mid-lecture will not risk a tool
that might permanently alter their slides.

---

## Insertion is where you are looking

A `+` affordance appears in the gap between scenes on hover, not only at the end
of the list. Adding a scene after scene 4 is a click in the gap after scene 4.

New scenes inherit the section of the scene they follow, so inserting inside a
section keeps it there.

---

## Empty states do work

An empty scene offers three concrete next steps. An empty library explains what
belongs there and offers both creation paths. An empty notes workspace explains
the difference between lecture notes and speaker notes.

A blank rectangle with "No items" teaches nothing.

---

## Destructive actions are recoverable

Deleting a presentation is a soft delete with 30 days in "Recently deleted".
Permanent deletion is a separate, confirmed action, and the confirmation dialog
never auto-focuses the destructive button.

Deleting a folder keeps its presentations. Deleting a section keeps its scenes.
The container goes; the content does not.

---

## Filters live in the URL

A filtered library view is shareable, survives a refresh, and works with the
back button — because it is a URL, not component state.

---

## AI offers, never applies

Text tools return proposals. You pick one, and undo reverses it like any other
edit. There is an explicit "restore the original" after an AI change.

Generated scenes are inserted as ordinary scenes. Nothing existing is replaced.

---

## Honest about limits

Recording says it captures the tab, because that is what browsers can do. The
format says WebM or MP4 depending on what the browser supports. When fullscreen
is refused, a message says so and the stage fills the window instead.

When no model is configured, the app says "structural draft" rather than passing
templated text off as AI output.

Every one of these could have been papered over. Papering over is how a user
discovers the truth mid-lecture.

---

## Moving through a presentation

The camera is the main interaction, so it is worth saying what it is for.

**Movement carries meaning.** A short hop reads as "and also"; a long flight out
and back in reads as "now somewhere else entirely"; a dive into a scene reads as
"and inside that". None of that has to be explained to an audience, because it
is how looking at things works. It is also why travel is a property of the
presentation rather than of each scene — varying it per scene would make the
grammar meaningless.

**Pulling back is a move, not a menu.** `O` frames the whole world and draws the
route. The presentation is still live and the current scene is still current, so
a presenter can say "here is where we have got to" without stopping. Clicking a
scene flies there.

**Establishing a section** pulls back to frame it, holds for about a second, and
dives to its first scene. One beat, at the one moment where showing the shape of
the thing is worth more than showing its content.

**Nothing moves that the room did not ask for.** The camera only moves on an
advance, a jump, or an explicit pull-back — never on a timer, and never to
decorate. `prefers-reduced-motion` turns every flight into a cut.

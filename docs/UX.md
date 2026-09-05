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

**The show opens and closes on the whole of itself.** On load the camera holds
over the whole argument with the route drawn, then dives to the first scene;
the first press ends the hold early. Past the last scene the camera pulls back
to the same place and the title is set over it — the closing image, named. A
presentation that begins and ends with its own shape is easier to hold in the
mind than one that begins on a title card and ends on a black screen.

**Nothing moves that the room did not ask for.** The camera only moves on an
advance, a jump, or an explicit pull-back — never on a timer, and never to
decorate. The two timed beats, opening and establishing, are the second half
of a move the room did ask for. `prefers-reduced-motion` turns every flight
into a cut, and the opening hold with it.

**A phone is a hand, not a keyboard.** A share link is opened on a phone more
often than anywhere else, so the viewer moves on a swipe — left for on, right
for back, the same two moves as the click zones, which stay — and the
invitation says so to a coarse pointer. The recogniser is strict: a short,
mostly horizontal journey; a scroll or a hesitation does nothing. A tap on a
hotspot is the hotspot's alone (it used to dive and step straight back out),
pinches stay the browser's, and a pull at the top of a deck is never a page
refresh. The stage takes the same gesture from a presenter on a tablet. Full
screen is a button in the corner as well as the F key, because a hand has no
F; it appears only where the browser can do it (an iPhone cannot), asks by the
prefixed name Safari on iPad still uses, and says so when refused rather than
doing nothing.
<<<<<<< HEAD

**A share link looks like something before it is opened.** A link pasted into
a chat is unfurled by the chat, and every deck used to unfurl as the site's
own card — the product's name where the presentation's should be. Now the
viewer route serves the deck's card: its title in its own theme, the shape of
the thing beneath (scenes and movements), resolved through the same function
the viewer uses, so a revoked link unfurls as the generic card and a card can
never show what a link-holder would not see.
=======

> > > > > > > origin/claude/presentation-experience-redesign-r10l4q

**A mouse is a hand too.** On the shared viewer and the landing page's demo,
moving the pointer over the world leans what is behind the scene — the
backdrop, the air — a little toward it, and the scene stays exactly where it
is. This is not the camera moving and it is not decoration: nothing happens
until the visitor moves, it follows their hand, and it is level again the
moment the hand leaves. The projector never does it — whoever's pointer
crosses a stage window, it is not the room's.

**The frame before the stage is black.** Both audience routes await the deck
on the server; until it arrives they show a black frame rather than the site's
light body, so a projector never flashes white before the first scene.

## The landing page runs the product

The hero shows the idea: scenes in one space, a camera flying between them.
Below it, "See it move" mounts the real engine on the worked example — the
first deck a new account opens — and hands the visitor the keys. Nothing
advances on its own: a page that moves while it is being read is not being
read. Keys work while the stage has focus, so scrolling with Space is never
hijacked; Back, Whole map and Next beside the stage do the same for anyone
who would rather click, and a line between them says where the reader is.
The engine is fetched only as the section nears view, into a box already the
right shape, so nothing below it moves when it arrives.

Above it, the hero's camera answers the scroll as well as the clock: as the
visitor scrolls the hero away, it pulls back to the whole world, so the last
thing seen of it is the wide shot the flight was circling all along. A number
read in the frame loop, like the pointer; never state, never a re-render.

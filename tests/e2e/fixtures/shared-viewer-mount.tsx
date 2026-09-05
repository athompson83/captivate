import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SharedViewer } from "@/components/present/shared-viewer";
import type { SharedDeck } from "@/lib/data/shared-payload";
import type { Scene } from "@/lib/schema/presentation";
import { exampleDeck, exampleId } from "@/lib/marketing/example-deck";

/**
 * Mounts the share-link viewer on the worked-example deck.
 *
 * Two things are under test at once, both of which only a browser can see:
 * that a link-holder can actually walk the deck — keys, builds, the closing
 * pull-back — and that the shipped example renders without a single console
 * error. The deck is built through the same template machinery creation uses,
 * so a template edit that breaks rendering fails here, not in front of the
 * first new user.
 *
 * `mountWithAside` builds the same deck with one detail scene hung off a
 * hotspot, because two of the rules that matter about asides are only
 * observable in a browser: the linear walk must step over the detail scene,
 * and activating the hotspot from the keyboard must dive without the same
 * keystroke advancing straight back out of it.
 */

/**
 * The same deck with an aside: one detail scene, reached by a hotspot on the
 * heading of the first scene and reachable no other way.
 */
function deckWithAside(): SharedDeck {
  const deck = exampleDeck();
  const detailId = exampleId(900);
  const [first, ...rest] = deck.scenes;

  const detail: Scene = {
    ...first,
    id: detailId,
    position: deck.scenes.length,
    title: "The aside",
    flowRole: "detail",
  };

  const withHotspot: Scene = {
    ...first,
    content: {
      ...first.content,
      elements: first.content.elements.map((element, i) =>
        i === 0 ? { ...element, hotspot: { targetSceneId: detailId, label: "" } } : element,
      ),
    },
  };

  return { ...deck, scenes: [withHotspot, ...rest, detail] };
}

/**
 * What the stage showed first, recorded in-page from the moment of mounting.
 *
 * The opening beat lasts under two seconds and a round trip from the test
 * runner can take most of one, so a spec that read the view after mounting
 * sometimes saw the dive already landed. Watching from inside the page is
 * timing-independent: "opening" while the beat holds, else the view.
 */
let firstView: Promise<string | null> = Promise.resolve(null);

function watchFirstView() {
  firstView = new Promise((resolve) => {
    let tries = 0;
    const look = () => {
      const el = document.querySelector("[data-view]");
      if (el) {
        resolve(el.hasAttribute("data-opening") ? "opening" : el.getAttribute("data-view"));
        return;
      }
      if ((tries += 1) > 600) {
        resolve(null);
        return;
      }
      requestAnimationFrame(look);
    };
    look();
  });
}

function mount(deck: SharedDeck): number {
  watchFirstView();
  const host = document.createElement("div");
  document.body.appendChild(host);
  createRoot(host).render(
    <StrictMode>
      <SharedViewer deck={deck} />
    </StrictMode>,
  );
  return deck.scenes.filter((scene) => scene.flowRole !== "detail").length;
}

declare global {
  interface Window {
    sharedViewerFixture: {
      mount: () => number;
      mountWithAside: () => number;
      /** Resolves with what the stage showed first: "opening", or a view. */
      firstView: () => Promise<string | null>;
      /**
       * Walks the deck with the same keydown the browser delivers, in-page.
       *
       * Every CDP round-trip costs the better part of a second against this
       * page, so a forty-press walk driven one call at a time took longer than
       * the whole suite's timeout. The listener under test is a plain
       * `window` keydown handler, so dispatching here exercises exactly the
       * same path; the specs still send real keys either side of this to prove
       * trusted input reaches it.
       *
       * Returns how many presses it took to reach the pulled-back view, or
       * null if `cap` presses never got there.
       */
      walk: (key: string, cap: number) => Promise<number | null>;
      /**
       * A touch swipe across the stage, dispatched in-page as pointer events.
       * Playwright's touchscreen can tap but not travel, and the recogniser
       * under test listens to pointer events, so this is the same path.
       */
      swipe: (dx: number) => Promise<void>;
    };
  }
}

window.sharedViewerFixture = {
  /** Renders the viewer; returns the number of scenes in the running order. */
  mount: () => mount(exampleDeck()),
  mountWithAside: () => mount(deckWithAside()),
  firstView: () => firstView,

  async swipe(dx: number) {
    const el = document.querySelector("[data-view]");
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const at = (type: string, cx: number) =>
      el.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          clientX: cx,
          clientY: y,
          pointerId: 7,
          pointerType: "touch",
          isPrimary: true,
        }),
      );
    at("pointerdown", x);
    await new Promise((resolve) => setTimeout(resolve, 120));
    at("pointerup", x + dx);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
  },

  async walk(key: string, cap: number) {
    for (let i = 0; i < cap; i += 1) {
      window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      if (document.querySelector("[data-view]")?.getAttribute("data-view") === "world") {
        return i + 1;
      }
    }
    return null;
  },
};

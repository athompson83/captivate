import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { act, render } from "@testing-library/react";
import { CAPTION_POLL_MS, tailOf, useLiveCaptions } from "@/lib/present/captions";
import { PresentMessage } from "@/lib/present/protocol";
import { createSession } from "@/lib/present/session";
import { CaptionBand } from "@/components/present/caption-band";
import { PRESENTER_KEYS } from "@/lib/present/keys";

/**
 * Captions for the room: the browser's speech engine listening to the
 * presenter, the last stretch of it on the stage, sent over the channel from
 * whichever window has the microphone.
 */

/** A speech engine that does what it is told and reports what was asked. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  started = 0;
  stopped = 0;
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started += 1;
  }
  stop() {
    this.stopped += 1;
  }
  abort() {}
  /** What the engine has heard so far: one interim result, or one final. */
  hear(transcript: string, isFinal = false) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript } }] });
  }
}

function Captioned({ enabled, onText }: { enabled: boolean; onText: (t: string) => void }) {
  useLiveCaptions(enabled, onText);
  return null;
}

describe("the tail of what has been said", () => {
  it("is the whole of a short phrase, whitespace collapsed", () => {
    expect(tailOf("  and   so  ")).toBe("and so");
    expect(tailOf("")).toBe("");
  });

  it("keeps the last words that fit, never cutting one in half", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    const tail = tailOf(words, 30);
    expect(tail.length).toBeLessThanOrEqual(30);
    expect(tail.endsWith("word39")).toBe(true);
    expect(tail.startsWith("word")).toBe(true);
    expect(words.endsWith(tail)).toBe(true);
  });
});

describe("the captions engine", () => {
  const w = window as unknown as { webkitSpeechRecognition?: unknown };

  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecognition.instances = [];
    w.webkitSpeechRecognition = FakeRecognition;
  });
  afterEach(() => {
    delete w.webkitSpeechRecognition;
    vi.useRealTimers();
  });

  it("listens while on, hands over each change, and goes quiet when turned off", () => {
    const onText = vi.fn();
    const view = render(<Captioned enabled onText={onText} />);
    expect(FakeRecognition.instances).toHaveLength(1);
    const engine = FakeRecognition.instances[0];
    expect(engine.started).toBe(1);
    expect(engine.interimResults).toBe(true);

    act(() => {
      engine.hear("hold the room");
      vi.advanceTimersByTime(CAPTION_POLL_MS);
    });
    expect(onText).toHaveBeenLastCalledWith("hold the room");

    // The same words again cost nothing; the next word is a new caption.
    act(() => vi.advanceTimersByTime(CAPTION_POLL_MS));
    expect(onText).toHaveBeenCalledTimes(1);
    act(() => {
      engine.hear("hold the room for");
      vi.advanceTimersByTime(CAPTION_POLL_MS);
    });
    expect(onText).toHaveBeenLastCalledWith("hold the room for");

    view.rerender(<Captioned enabled={false} onText={onText} />);
    expect(engine.stopped).toBe(1);
    // The stage is told to take the last words down.
    expect(onText).toHaveBeenLastCalledWith("");
    act(() => {
      engine.hear("after the fact");
      vi.advanceTimersByTime(CAPTION_POLL_MS * 3);
    });
    expect(onText).toHaveBeenLastCalledWith("");
  });

  it("does nothing, and throws nothing, where the browser has no engine", () => {
    delete w.webkitSpeechRecognition;
    const onText = vi.fn();
    render(<Captioned enabled onText={onText} />);
    act(() => vi.advanceTimersByTime(CAPTION_POLL_MS * 5));
    expect(onText).not.toHaveBeenCalled();
  });

  it("does not restart the engine because the handler changed", () => {
    const view = render(<Captioned enabled onText={() => {}} />);
    view.rerender(<Captioned enabled onText={() => {}} />);
    view.rerender(<Captioned enabled onText={() => {}} />);
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(FakeRecognition.instances[0].started).toBe(1);
  });
});

describe("captions over the channel", () => {
  it("are a message the protocol knows, bounded", () => {
    expect(PresentMessage.safeParse({ type: "captions", text: "hello" }).success).toBe(true);
    expect(PresentMessage.safeParse({ type: "captions", text: null }).success).toBe(true);
    expect(PresentMessage.safeParse({ type: "captions", text: "x".repeat(601) }).success).toBe(
      false,
    );
    expect(PresentMessage.safeParse({ type: "captions" }).success).toBe(false);
  });

  it("are held by the window that sends them, and shown by a stage that receives them", () => {
    const stage = createSession({ presentationId: "cap-stage", scenes: [], role: "stage" });
    const console_ = createSession({ presentationId: "cap-console", scenes: [], role: "console" });
    expect(stage.store.getState().captions).toBeNull();

    console_.broadcastCaptions("as I was saying");
    expect(console_.store.getState().captions).toBe("as I was saying");

    // Delivered to a stage: shown. Delivered to a console: not its business.
    const deliver = (api: typeof stage, text: string | null) => {
      const handlers = (api.channel as unknown as { handlers: Set<(m: unknown) => void> }).handlers;
      for (const handler of handlers) handler({ type: "captions", text });
    };
    stage.attach();
    deliver(stage, "as I was saying");
    expect(stage.store.getState().captions).toBe("as I was saying");
    deliver(stage, null);
    expect(stage.store.getState().captions).toBeNull();

    const other = createSession({ presentationId: "cap-console-2", scenes: [], role: "console" });
    other.attach();
    other.broadcastCaptions("mine");
    deliver(other, "someone else's");
    expect(other.store.getState().captions).toBe("mine");
  });
});

describe("the caption band", () => {
  it("paints nothing when there is nothing to say", () => {
    const { container, rerender } = render(<CaptionBand text={null} />);
    expect(container.querySelector("[data-captions]")).toBeNull();
    rerender(<CaptionBand text="" />);
    expect(container.querySelector("[data-captions]")).toBeNull();
  });

  it("puts the words on two lines at most, as a live region", () => {
    const long =
      "a caption long enough to need a second line on the stage where subtitles live for the room";
    const { getByRole } = render(<CaptionBand text={long} />);
    const band = getByRole("status");
    expect(band).toHaveAttribute("data-captions");
    const lines = (band.textContent ?? "").split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.join(" ")).toBe(long);
  });
});

describe("where the engine runs", () => {
  it("is never the audience-only stage, and is listed under T", () => {
    const stage = readFileSync("src/components/present/present-root.tsx", "utf8");
    // The hook is gated on the presenter's window; a projector never listens.
    expect(stage).toMatch(/useLiveCaptions\(captionsOn && !audienceOnly/);
    expect(PRESENTER_KEYS.some((k) => k.keys === "T")).toBe(true);
    // The band is inside the capture surface: a recording holds what the room saw.
    const surface = stage.slice(
      stage.indexOf("ref={setCaptureSurface}"),
      stage.indexOf("Blank: takes the room's attention"),
    );
    expect(surface).toContain("<CaptionBand");
  });
});

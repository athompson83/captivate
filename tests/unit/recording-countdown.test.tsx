import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { RecordingCountdown } from "@/components/record/recording-countdown";

describe("the recording countdown", () => {
  it("announces the number and can be cancelled by the button or Escape", () => {
    const onCancel = vi.fn();
    render(<RecordingCountdown count={3} onCancel={onCancel} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Recording starts in\s*3/);
    fireEvent.click(screen.getByRole("button", { name: /Cancel/ }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("is counted before the recorder starts, and the dialog is gone by then", () => {
    // Read from the source, because the claim is about order: the streams are
    // acquired, the dialog closes, the count runs, and only then does
    // `MediaRecorder` start — so the count is never in the file.
    const source = readFileSync("src/components/record/recording-controller.tsx", "utf8");
    const begin = source.slice(source.indexOf("const begin = async"));
    const prepared = begin.indexOf("await recorder.prepare(");
    const closed = begin.indexOf("setSetupOpen(false)");
    const counted = begin.indexOf("await countdown(");
    const started = begin.indexOf("await recorder.start()");
    expect(prepared).toBeGreaterThan(-1);
    expect(closed).toBeGreaterThan(prepared);
    expect(counted).toBeGreaterThan(closed);
    expect(started).toBeGreaterThan(counted);
  });
});

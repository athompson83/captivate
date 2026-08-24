import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MovementSignpost, type Movement } from "@/components/present/movement-rail";

const MOVEMENT: Movement = { id: "m1", label: "The core idea", start: 2, end: 5 };

describe("MovementSignpost kind variants", () => {
  it("defaults to the existing 'next movement' copy", () => {
    render(<MovementSignpost movement={MOVEMENT} index={1} sceneTitle="" />);
    expect(screen.getByText(/Next movement/i)).toBeInTheDocument();
  });

  it("shows entering copy when kind is 'entering'", () => {
    render(<MovementSignpost movement={MOVEMENT} index={1} sceneTitle="" kind="entering" />);
    expect(screen.queryByText(/Next movement/i)).not.toBeInTheDocument();
    expect(screen.getByText(MOVEMENT.label)).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillingSection } from "@/components/dashboard/billing-section";

vi.mock("@/lib/data/billing", () => ({
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
}));

const usage = { decksUsed: 6, deckAllowance: 10 };

const proSummary = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    plan: "pro",
    status: "active",
    billingInterval: "month",
    currentPeriodEnd: "2026-10-01T00:00:00Z",
    cancelAtPeriodEnd: false,
    ...over,
  }) as never;

describe("the billing section", () => {
  it("offers an upgrade on free, and describes the window honestly", () => {
    render(<BillingSection configured testMode={false} summary={null} usage={usage} />);
    expect(screen.getByText(/free/i)).toBeInTheDocument();
    expect(screen.getByText(/6 of 10/)).toBeInTheDocument();
    expect(screen.getByText(/last 30 days/i)).toBeInTheDocument();
    expect(screen.queryByText(/this month/i)).toBeNull();
    expect(screen.getByRole("button", { name: /upgrade/i })).toBeInTheDocument();
  });

  it("promises that nothing authored is ever locked", () => {
    render(<BillingSection configured testMode={false} summary={null} usage={usage} />);
    expect(screen.getByText(/stays yours/i)).toBeInTheDocument();
  });

  it("offers billing management on pro instead of an upgrade", () => {
    render(<BillingSection configured testMode={false} summary={proSummary()} usage={usage} />);
    expect(screen.getByRole("button", { name: /manage billing/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upgrade/i })).toBeNull();
    expect(screen.getByText(/renews/i)).toBeInTheDocument();
  });

  it("says a cancelling subscription still runs to the period end", () => {
    render(
      <BillingSection
        configured
        testMode={false}
        summary={proSummary({ cancelAtPeriodEnd: true })}
        usage={usage}
      />,
    );
    expect(screen.getByText(/ends/i)).toBeInTheDocument();
    expect(screen.queryByText(/renews/i)).toBeNull();
  });

  it("explains a failing card without taking Pro away", () => {
    render(
      <BillingSection
        configured
        testMode={false}
        summary={proSummary({ status: "past_due" })}
        usage={usage}
      />,
    );
    expect(screen.getByText(/didn't go through|didn’t go through/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage billing/i })).toBeInTheDocument();
  });

  it("shows no dead controls when billing is not configured", () => {
    // An unbuilt path is absent, not disabled with a tooltip.
    render(<BillingSection configured={false} testMode={false} summary={null} usage={usage} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/isn't configured|isn’t configured/i)).toBeInTheDocument();
  });

  it("says when the deployment is pointed at test mode", () => {
    render(<BillingSection configured testMode summary={null} usage={usage} />);
    expect(screen.getByText(/test mode/i)).toBeInTheDocument();
  });
});

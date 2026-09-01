import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BillingSection } from "@/components/dashboard/billing-section";

vi.mock("@/lib/data/billing", () => ({
  startCheckout: vi.fn(),
  openBillingPortal: vi.fn(),
}));

const usage = {
  plan: "free" as const,
  groups: [
    {
      group: "deck" as const,
      label: "Presentations generated",
      used: 6,
      allowance: 10,
      windowMinutes: 43_200,
    },
    {
      group: "light" as const,
      label: "Rewrites, notes and suggestions",
      used: 12,
      allowance: 100,
      windowMinutes: 43_200,
    },
  ],
};

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
    render(
      <BillingSection configured testMode={false} summary={null} grant={null} usage={usage} />,
    );
    expect(screen.getByText(/free/i)).toBeInTheDocument();
    expect(screen.getByText(/6 of 10/)).toBeInTheDocument();
    expect(screen.getByText(/any 30 days/i)).toBeInTheDocument();
    expect(screen.queryByText(/this month/i)).toBeNull();
    expect(screen.getByRole("button", { name: /upgrade/i })).toBeInTheDocument();
  });

  it("shows every allowance, not just presentations", () => {
    // An author refused a rewrite while this showed only a deck count has no
    // way to find out why — the same complaint the deck counter answered, one
    // group along.
    render(
      <BillingSection configured testMode={false} summary={null} grant={null} usage={usage} />,
    );

    expect(screen.getByText(/rewrites, notes and suggestions/i)).toBeInTheDocument();
    expect(screen.getByText(/12 of 100/)).toBeInTheDocument();
  });

  it("shows the allowance on a paid plan too, not only on free", () => {
    // "How much have I got left" is not a question only free accounts ask, and
    // it is the question a top-up exists to answer.
    render(
      <BillingSection
        configured
        testMode={false}
        summary={proSummary()}
        grant={null}
        usage={{ ...usage, plan: "pro" }}
      />,
    );
    expect(screen.getByText(/6 of 10/)).toBeInTheDocument();
  });

  it("states what is left to a screen reader, not only as a bar", () => {
    // The bar is a div with a width. Without a label the only people who can
    // read the allowance are the ones who can see it.
    render(
      <BillingSection configured testMode={false} summary={null} grant={null} usage={usage} />,
    );

    const bar = screen.getByRole("progressbar", { name: /presentations generated/i });
    expect(bar).toHaveAttribute("aria-valuenow", "6");
    expect(bar).toHaveAttribute("aria-valuemax", "10");
    expect(bar.getAttribute("aria-label")).toContain("4 left");
  });

  it("lets a free account choose which tier to buy", () => {
    render(
      <BillingSection configured testMode={false} summary={null} grant={null} usage={usage} />,
    );

    // Both tiers are offered, and the button names the one selected — an
    // upgrade control that does not say what it buys is a control that sells
    // the wrong thing.
    expect(screen.getByRole("radio", { name: /basic/i })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /pro/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upgrade to pro/i })).toBeInTheDocument();
  });

  it("names the tier a subscriber is actually on", () => {
    render(
      <BillingSection
        configured
        testMode={false}
        summary={proSummary({ plan: "basic" })}
        grant={null}
        usage={{ ...usage, plan: "basic" }}
      />,
    );
    expect(screen.getByText(/captivate basic/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage billing/i })).toBeInTheDocument();
  });

  it("promises that nothing authored is ever locked", () => {
    render(
      <BillingSection configured testMode={false} summary={null} grant={null} usage={usage} />,
    );
    expect(screen.getByText(/stays yours/i)).toBeInTheDocument();
  });

  it("offers billing management on pro instead of an upgrade", () => {
    render(
      <BillingSection
        configured
        testMode={false}
        summary={proSummary()}
        grant={null}
        usage={usage}
      />,
    );
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
        grant={null}
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
        grant={null}
        usage={usage}
      />,
    );
    expect(screen.getByText(/didn't go through|didn’t go through/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /manage billing/i })).toBeInTheDocument();
  });

  it("shows no dead controls when billing is not configured", () => {
    // An unbuilt path is absent, not disabled with a tooltip.
    render(
      <BillingSection
        configured={false}
        testMode={false}
        summary={null}
        grant={null}
        usage={usage}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/isn't configured|isn’t configured/i)).toBeInTheDocument();
  });

  it("says when the deployment is pointed at test mode", () => {
    render(<BillingSection configured testMode summary={null} grant={null} usage={usage} />);
    expect(screen.getByText(/test mode/i)).toBeInTheDocument();
  });
});

describe("a granted plan", () => {
  const grant = { plan: "unlimited", note: "Owner account.", expiresAt: null } as never;

  it("is named as granted rather than dressed up as a subscription", () => {
    // Somebody comped must not be shown a renewal date they do not have, nor
    // an upgrade button for a plan they already exceed.
    render(
      <BillingSection configured testMode={false} summary={null} grant={grant} usage={usage} />,
    );
    expect(screen.getByText(/unlimited/i)).toBeInTheDocument();
    expect(screen.getByText(/granted, not billed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /upgrade/i })).toBeNull();
    expect(screen.queryByText(/renews/i)).toBeNull();
  });

  it("outranks a subscription rather than competing with it", () => {
    render(
      <BillingSection
        configured
        testMode={false}
        summary={proSummary()}
        grant={grant}
        usage={usage}
      />,
    );
    expect(screen.getByText(/granted, not billed/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /manage billing/i })).toBeNull();
  });

  it("says when it runs out", () => {
    render(
      <BillingSection
        configured
        testMode={false}
        summary={null}
        grant={{ plan: "pro", note: "Pilot.", expiresAt: "2026-12-01T00:00:00Z" } as never}
        usage={usage}
      />,
    );
    expect(screen.getByText(/until/i)).toBeInTheDocument();
  });
});

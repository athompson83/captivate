import { expect, test } from "@playwright/test";

/**
 * Smoke tests that hold regardless of whether the deployment has database
 * credentials. These are the checks that catch a broken build, a missing
 * security header, or a page that only renders on the server.
 */

test.describe("public surface", () => {
  test("landing page renders and offers both entry points", async ({ page }) => {
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: /Presentations that hold a room/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Create your first deck/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in", exact: true }).first()).toBeVisible();

    // The feature grid must actually describe the product, not be empty chrome.
    await expect(page.getByRole("heading", { name: "Presenter console" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Laser pointer" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Record it" })).toBeVisible();
  });

  test("sign-in page has a labelled, usable form", async ({ page }) => {
    await page.goto("/sign-in");

    const email = page.getByLabel("Email");
    const password = page.getByLabel("Password");
    await expect(email).toBeVisible();
    await expect(password).toBeVisible();
    await expect(password).toHaveAttribute("type", "password");
    await expect(page.getByRole("button", { name: /Sign in/i })).toBeEnabled();
    await expect(page.getByRole("link", { name: /Forgot your password/i })).toBeVisible();
  });

  test("sign-up page collects a name, email and password", async ({ page }) => {
    await page.goto("/sign-up");
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toHaveAttribute("minlength", "8");
  });

  test("the app area either works or explains what is missing", async ({ page }) => {
    // On a configured deployment this redirects to sign-in; on one without
    // database credentials it must say so plainly rather than throwing a 500.
    const response = await page.goto("/templates");
    expect(response?.status()).toBeLessThan(400);

    const configured = page.getByRole("heading", { name: "Templates" });
    const setup = page.getByRole("heading", { name: /isn't connected to a database/i });
    const signIn = page.getByRole("heading", { name: /Welcome back/i });

    await expect(configured.or(setup).or(signIn)).toBeVisible();
  });

  test("serves the expected security headers", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["permissions-policy"]).toContain("camera=(self)");
    // Never advertise the framework version.
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("keyboard focus is visible on interactive controls", async ({ page }) => {
    await page.goto("/sign-in");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");

    const outline = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const style = getComputedStyle(el);
      return { boxShadow: style.boxShadow, outline: style.outlineStyle };
    });

    expect(outline).not.toBeNull();
    expect(outline!.boxShadow === "none" && outline!.outline === "none").toBe(false);
  });

  test("has no console errors on the public pages", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("pageerror", (error) => errors.push(error.message));

    for (const path of ["/", "/sign-in", "/sign-up", "/templates"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("adapts to a narrow viewport without horizontal overflow", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("a fresh session defaults to dark regardless of OS scheme", async ({ page }) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      // No stored preference: first visit always resolves dark, per the
      // "spotlight stage" default — the OS preference only applies once the
      // user has explicitly chosen "System" in Settings.
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

      const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(background).not.toBe("rgba(0, 0, 0, 0)");
    }
  });

  test("an explicit System preference still follows the OS scheme", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("captivate-theme", "system"));
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto("/");
      await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
    }
  });

  test("respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");

    const duration = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.transition = "opacity 500ms";
      document.body.appendChild(probe);
      const value = getComputedStyle(probe).transitionDuration;
      probe.remove();
      return value;
    });

    // The reduced-motion rule collapses transitions to 0.01ms, which computes
    // to "1e-05s". Anything under a millisecond is imperceptible.
    const seconds = Number.parseFloat(duration);
    expect(Number.isNaN(seconds)).toBe(false);
    expect(seconds).toBeLessThan(0.001);
  });
});

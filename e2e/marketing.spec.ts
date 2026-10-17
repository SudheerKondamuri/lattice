import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("marketing page", () => {
  test("loads cleanly, stays accessible, and keeps the header state honest", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto("/");
    expect(response?.ok()).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Support that shows its work." }),
    ).toBeVisible();
    await expect(page).toHaveTitle("Lattice — Support that shows its work.");
    await expect(page.locator(".site-header")).not.toHaveClass(/is-scrolled/);

    await page.locator(".hero .quiet-link").click();
    await expect(page).toHaveURL(/#workflow$/);
    await expect(
      page.getByRole("heading", {
        name: "From first document to published answer.",
      }),
    ).toBeVisible();
    await expect(page.locator(".site-header")).toHaveClass(/is-scrolled/);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator(".site-header")).not.toHaveClass(/is-scrolled/);

    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations, JSON.stringify(axe.violations, null, 2)).toEqual([]);
    expect(
      consoleErrors.filter((message) => /hydration|didn't match/i.test(message)),
      consoleErrors.join("\n"),
    ).toEqual([]);
    expect(pageErrors, pageErrors.join("\n")).toEqual([]);
  });

  test("supports the proof, install, and FAQ interactions", async ({
    page,
    isMobile,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.context().grantPermissions(["clipboard-write"]);
    await page.goto("/");

    const pause = page.getByRole("button", { name: "Pause capabilities" });
    await pause.click();
    await expect(
      page.getByRole("button", { name: "Play capabilities" }),
    ).toHaveAttribute("aria-pressed", "true");

    const testStep = page.getByRole("button", { name: /^Test/ });
    await testStep.click();
    await expect(testStep).toHaveAttribute("aria-current", "step");
    await expect(page.locator("#workflow-panel-test")).toBeVisible();

    await page
      .getByRole("button", { name: "Candidate better", exact: true })
      .click();
    await expect(page.getByText("Selected: Candidate better.")).toBeVisible();

    await page
      .getByRole("button", { name: "Copy embed snippet" })
      .click();
    await expect(
      page.getByRole("button", { name: "Embed snippet copied" }),
    ).toBeVisible();

    const widgetQuestion = page.getByRole("textbox", { name: "Ask a question" });
    await widgetQuestion.fill("How do I get human help?");
    await page.getByRole("button", { name: "Ask widget" }).click();
    await expect(
      page.getByText("I’m not confident enough to answer that.", { exact: false }),
    ).toBeVisible();

    const improve = page.getByRole("button", {
      name: "Improve this answer",
      exact: true,
    });
    await improve.first().click();
    await expect(page.getByText("Release 05 created")).toBeVisible();

    const faqButton = page.getByRole("button", {
      name: "Do I need to replace my helpdesk?",
      exact: true,
    });
    await faqButton.click();
    await expect(faqButton).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByText("Unanswered questions can hand off the transcript", {
        exact: false,
      }),
    ).toBeVisible();

    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await expect(
        page.getByRole("navigation", { name: "Main navigation" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Close navigation" }),
      ).toBeVisible();
    }
  });

  test("keeps hero cards inside intermediate desktop viewports", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-desktop", "desktop width matrix only");

    for (const width of [561, 850, 1051, 1200, 1366]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      const result = await page.evaluate(() => {
        const root = document.documentElement;
        const cards = [...document.querySelectorAll<HTMLElement>(".hero-card")];
        return {
          documentFits: root.scrollWidth <= root.clientWidth,
          cardsFit: cards.every((card) => card.getBoundingClientRect().right <= root.clientWidth),
        };
      });
      expect(result, `hero should fit at ${width}px`).toEqual({
        documentFits: true,
        cardsFit: true,
      });
    }
  });
});

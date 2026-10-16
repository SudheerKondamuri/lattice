import { expect, test, type Locator, type Page } from "@playwright/test";

async function openPage(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.ok(), `${path} should load successfully`).toBe(true);
  await expect(page.getByRole("main")).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

async function bounds(locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, "a visible control should have layout bounds").not.toBeNull();
  return box!;
}

async function expectNoDocumentOverflow(page: Page) {
  await expect.poll(
    () => page.evaluate(() =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
      - document.documentElement.clientWidth),
    { message: "content should fit the document, with scrolling confined to its own containers" },
  ).toBeLessThanOrEqual(1);
}

async function expectFitsViewport(page: Page, locator: Locator) {
  const box = await bounds(locator);
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
}

async function expectPrimaryButton(button: Locator) {
  // A flex item blockifies inline-flex to flex in computed styles.
  await expect(button).toHaveCSS("display", /^(inline-)?flex$/);
  await expect(button).toHaveCSS("align-items", "center");
  const style = await button.evaluate(element => {
    const css = getComputedStyle(element);
    const channels = (color: string) => color.match(/[\d.]+/g)!.map(Number);
    const luminance = (color: number[]) => {
      const linear = color.slice(0, 3).map(channel => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const background = channels(css.backgroundColor);
    const foreground = channels(css.color);
    const light = luminance(foreground);
    const dark = luminance(background);
    return {
      backgroundAlpha: background[3] ?? 1,
      contrast: (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05),
      horizontalPadding: parseFloat(css.paddingLeft),
      verticalPadding: parseFloat(css.paddingTop),
    };
  });
  expect(style.backgroundAlpha, "primary action should have an opaque fill").toBe(1);
  expect(style.contrast, "primary action text should remain legible").toBeGreaterThanOrEqual(4.5);
  expect(style.horizontalPadding).toBeGreaterThanOrEqual(12);
  expect(style.verticalPadding).toBeGreaterThanOrEqual(8);
  expect((await bounds(button)).height).toBeGreaterThanOrEqual(40);
}

async function expectBoundedEvidence(page: Page) {
  const grid = await bounds(page.locator(".drawing-grid"));
  const svg = page.locator("svg.drawing-lines");
  await expect(svg).toHaveCSS("position", "absolute");
  const drawing = await bounds(svg);
  expect(drawing.width).toBeGreaterThan(200);
  expect(drawing.height).toBeGreaterThan(120);
  expect(drawing.x).toBeGreaterThanOrEqual(grid.x - 1);
  expect(drawing.y).toBeGreaterThanOrEqual(grid.y - 1);
  expect(drawing.x + drawing.width).toBeLessThanOrEqual(grid.x + grid.width + 1);
  expect(drawing.y + drawing.height).toBeLessThanOrEqual(grid.y + grid.height + 1);
  await expectFitsViewport(page, page.locator(".evidence-drawing"));
}

async function expectWorkspaceLayout(page: Page, isMobile: boolean, activePage: string) {
  const sidebar = page.locator(".sidebar");
  const body = await bounds(page.locator(".workspace-body"));
  const content = await bounds(page.getByRole("main"));
  const navigation = page.getByRole("navigation", { name: "Workspace navigation" });
  const activeLink = navigation.getByRole("link", { name: activePage, exact: true });
  await expect(activeLink).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".app-topbar")).toHaveCSS("display", "flex");
  await expectFitsViewport(page, page.getByRole("main"));

  if (isMobile) {
    expect(body.x).toBeGreaterThanOrEqual(-1);
    expect(body.x).toBeLessThanOrEqual(1);
    await expect(sidebar).not.toBeInViewport();
    const open = page.getByRole("button", { name: "Open navigation", exact: true });
    // The playground scrolls its empty chat into view on mount. Its non-sticky
    // topbar remains usable after returning to the top of the page.
    await open.scrollIntoViewIfNeeded();
    await expect(open).toBeInViewport();
    await open.click();
    await expect(sidebar).toBeInViewport({ ratio: 0.95 });
    await expect(activeLink).toBeInViewport();
    await expectFitsViewport(page, sidebar);
    await page.getByRole("button", { name: "Close menu", exact: true }).click();
    await expect(sidebar).not.toBeInViewport();
  } else {
    const rail = await bounds(sidebar);
    expect(rail.x).toBeCloseTo(0, 0);
    expect(rail.width).toBeGreaterThanOrEqual(180);
    expect(rail.width).toBeLessThanOrEqual(360);
    expect(rail.height).toBeGreaterThanOrEqual(page.viewportSize()!.height - 1);
    expect(body.x).toBeGreaterThanOrEqual(rail.x + rail.width - 1);
    expect(content.x).toBeGreaterThan(rail.x + rail.width);
    expect(content.width).toBeGreaterThan(page.viewportSize()!.width / 2);
    await expect(activeLink).toBeInViewport();
    await expect(page.getByRole("button", { name: "Open navigation", exact: true })).toBeHidden();
  }
  await expectNoDocumentOverflow(page);
}

test.beforeEach(async ({ context, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  // Fonts and assets are bundled locally. Do not contact demo source URLs or
  // third-party services, even if a future component accidentally requests one.
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === origin ? route.continue() : route.abort("blockedbyclient");
  });
});

test.afterEach(async ({ page }, testInfo) => {
  if (process.env.PLAYWRIGHT_SCREENSHOTS === "1"
    && testInfo.status === "passed"
    && testInfo.title.includes("layout")) {
    await testInfo.attach("seeded-demo-layout", {
      body: await page.screenshot({ fullPage: true, animations: "disabled" }),
      contentType: "image/png",
    });
  }
});

test("landing layout has styled navigation, hero, evidence and primary action", async ({ page, isMobile }) => {
  await openPage(page, "/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Good answershave good roots.");
  await expect(page.locator("body")).toHaveCSS("font-family", /Manrope/);
  await expect(page.locator(".site-header")).toHaveCSS("display", "flex");
  await expectPrimaryButton(page.getByRole("link", { name: "Explore the workspace", exact: true }));
  await expectBoundedEvidence(page);

  const copy = await bounds(page.locator(".hero-copy"));
  const drawing = await bounds(page.locator(".evidence-drawing"));
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const menu = page.getByRole("button", { name: "Toggle menu", exact: true });

  if (isMobile) {
    expect(drawing.y).toBeGreaterThanOrEqual(copy.y + copy.height - 1);
    await expectFitsViewport(page, page.locator(".hero-copy"));
    await expect(nav).toBeHidden();
    await expect(menu).toBeInViewport();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(nav).toBeVisible();
    await expectFitsViewport(page, nav);
    for (const link of await nav.getByRole("link").all()) {
      await expect(link).toBeInViewport();
      expect((await bounds(link)).height).toBeGreaterThanOrEqual(40);
    }
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();
    await menu.click();
    await nav.getByRole("link", { name: "The approach", exact: true }).click();
    await expect(page).toHaveURL(/#approach$/);
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(nav).toBeHidden();
    await expect(page.locator("#approach")).toBeInViewport();
  } else {
    expect(copy.x + copy.width).toBeLessThanOrEqual(drawing.x - 16);
    expect(Math.min(copy.y + copy.height, drawing.y + drawing.height)
      - Math.max(copy.y, drawing.y)).toBeGreaterThan(100);
    await expect(menu).toBeHidden();
    await expect(nav).toBeVisible();
    const links = await nav.getByRole("link").all();
    expect(links).toHaveLength(3);
    const first = await bounds(links[0]);
    let previous = first;
    for (const link of links) {
      await expect(link).toBeInViewport();
      const box = await bounds(link);
      expect(Math.abs(box.y - first.y)).toBeLessThanOrEqual(2);
      if (link !== links[0]) expect(box.x).toBeGreaterThan(previous.x + previous.width);
      previous = box;
    }
    const header = await bounds(page.locator(".site-header"));
    const navBox = await bounds(nav);
    expect(navBox.y).toBeGreaterThanOrEqual(header.y);
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(header.y + header.height);
  }
  await expectNoDocumentOverflow(page);
});

test("evidence source switches the visible answer and citation", async ({ page }) => {
  await openPage(page, "/");
  const helpCenter = page.getByRole("button", { name: /Your help center/ });
  const documents = page.getByRole("button", { name: /Your documents/ });
  const answer = page.locator(".specimen-answer");
  const citation = answer.locator(".specimen-citation");
  await expect(helpCenter).toHaveClass(/\bchosen\b/);
  await expect(answer).toContainText("Your plan includes up to 1,000 rows.");
  await expect(citation).toHaveText("[01]Exporting your workspace");
  await documents.click();
  await expect(documents).toHaveClass(/\bchosen\b/);
  await expect(helpCenter).not.toHaveClass(/\bchosen\b/);
  await expect(answer).toContainText("create a project and invite your team");
  await expect(citation).toHaveText("[02]The getting-started guide");
  await helpCenter.click();
  await expect(helpCenter).toHaveClass(/\bchosen\b/);
  await expect(documents).not.toHaveClass(/\bchosen\b/);
  await expect(answer).toContainText("Your plan includes up to 1,000 rows.");
  await expect(citation).toHaveText("[01]Exporting your workspace");
  await expectNoDocumentOverflow(page);
});

test("FAQ answers expand, collapse and keep only the selected answer open", async ({ page }) => {
  await openPage(page, "/");
  const first = page.getByRole("button", { name: "How is Lattice different?", exact: true });
  const second = page.getByRole("button", { name: "Can I bring my knowledge from Chatbase?", exact: true });
  const firstAnswer = page.locator(`#${await first.getAttribute("aria-controls")}`);
  const secondAnswer = page.locator(`#${await second.getAttribute("aria-controls")}`);
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(firstAnswer).toBeVisible();
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(firstAnswer).toBeHidden();
  await first.click();
  await expect(firstAnswer).toBeVisible();
  await second.click();
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await expect(secondAnswer).toBeVisible();
  await expect(secondAnswer).toContainText("text and Q&A imports");
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(firstAnswer).toBeHidden();
  await second.click();
  await expect(second).toHaveAttribute("aria-expanded", "false");
  await expect(secondAnswer).toBeHidden();
});

test("overview layout keeps the sidebar separate and metrics responsive", async ({ page, isMobile }) => {
  await openPage(page, "/app");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A little more clarity.");
  await expectWorkspaceLayout(page, isMobile, "Overview");
  const metrics = page.locator(".overview-metrics .metric");
  await expect(metrics).toHaveCount(4);
  const first = await bounds(metrics.nth(0));
  const second = await bounds(metrics.nth(1));
  const third = await bounds(metrics.nth(2));
  expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(2);
  expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
  if (isMobile) {
    expect(third.y).toBeGreaterThanOrEqual(first.y + first.height);
  } else {
    expect(Math.abs(first.y - third.y)).toBeLessThanOrEqual(2);
    expect(third.x).toBeGreaterThanOrEqual(second.x + second.width);
  }
});

test("knowledge layout confines a wide source table to its scroll container", async ({ page, isMobile }) => {
  await openPage(page, "/app/knowledge");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What your business knows.");
  await expectWorkspaceLayout(page, isMobile, "Knowledge");
  const wrapper = page.locator(".source-table-wrap");
  await expect(wrapper).toHaveCSS("overflow-x", /auto|scroll/);
  await expectFitsViewport(page, wrapper);
  await expect(page.getByRole("textbox", { name: "Find a source", exact: true })).toBeVisible();
  await expect(page.locator(".source-table tbody tr").first()).toBeVisible();
  if (isMobile) {
    const widths = await wrapper.evaluate(element => ({
      content: element.scrollWidth,
      container: element.clientWidth,
    }));
    expect(widths.content).toBeGreaterThan(widths.container);
  }
  await expectNoDocumentOverflow(page);
});

test("playground layout keeps chat and evidence usable at both sizes", async ({ page, isMobile }) => {
  await openPage(page, "/app/playground");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ask a good question.");
  await expectWorkspaceLayout(page, isMobile, "Playground");
  const chat = await bounds(page.locator(".chat-panel"));
  const evidence = await bounds(page.locator(".evidence-panel"));
  await expectFitsViewport(page, page.locator(".chat-panel"));
  await expectFitsViewport(page, page.locator(".evidence-panel"));
  if (isMobile) {
    expect(evidence.y).toBeGreaterThanOrEqual(chat.y + chat.height - 1);
  } else {
    expect(evidence.x).toBeGreaterThanOrEqual(chat.x + chat.width + 8);
    expect(Math.abs(evidence.y - chat.y)).toBeLessThanOrEqual(2);
  }
  const composer = page.getByRole("textbox", { name: "Your question", exact: true });
  await expect(composer).toBeEditable();
  expect((await bounds(composer)).height).toBeGreaterThanOrEqual(40);
  await expectFitsViewport(page, composer);
  await expectNoDocumentOverflow(page);
});

import { expect, test, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

async function login(page: Page, prefix = "owner") {
  await page.goto("/auth/sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`${prefix}-${randomUUID()}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("isolated-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(prefix === "new" ? /onboarding/ : /\/app/);
  if (prefix !== "new")
    await expect(
      page.getByRole("heading", { name: "A little more clarity." }),
    ).toBeVisible();
  return page
    .locator(".desktop-sidebar select[aria-label=Workspace]")
    .inputValue();
}
async function go(page: Page, route: string, workspace: string) {
  await page.goto(
    `${route}${route.includes("?") ? "&" : "?"}workspace=${workspace}`,
  );
}
async function openNavigation(page: Page, isMobile: boolean) {
  if (isMobile)
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
}
async function ask(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Ask your agent" }).fill(text);
  await page.getByRole("button", { name: "Send", exact: true }).click();
}
async function snapshot(page: Page, workspace: string, label: string) {
  await go(page, "/app/releases", workspace);
  await page.getByLabel("Release label").fill(label);
  await page.getByRole("button", { name: "Create draft snapshot" }).click();
  await expect(
    page.getByRole("heading", { name: label, exact: true }),
  ).toBeVisible();
  return new URL(page.url()).searchParams.get("release")!;
}
async function publish(page: Page, label: string) {
  await expect(
    page.getByRole("heading", { name: label, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review publication", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Confirm publication",
    exact: true,
  });
  const acknowledge = dialog.getByRole("checkbox");
  if (await acknowledge.count()) await acknowledge.check();
  await dialog
    .getByRole("button", { name: "Confirm publication", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(/Backend confirmed publication/)).toBeVisible();
}

test("anonymous dashboard is protected and auth screens are reachable", async ({
  page,
}) => {
  await page.goto("/app/knowledge");
  await expect(page).toHaveURL(/auth\/sign-in/);
  for (const route of ["sign-up", "recover", "verify", "update-password"]) {
    const response = await page.goto(`/auth/${route}`);
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  }
});

test("sign-up confirmation, callback, recovery and sign-out have real service boundaries", async ({
  page,
  isMobile,
}) => {
  await page.goto("/auth/sign-up");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`new-${randomUUID()}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("isolated-password");
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByText(/Sign-up request accepted/)).toBeVisible();
  await page.goto(
    "/auth/callback?token_hash=fixture-verify:verified@example.test&type=email",
  );
  await expect(page).toHaveURL(/onboarding/);
  await go(page, "/app", "");
  await openNavigation(page, isMobile);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/auth\/sign-in/);
  await page.goto("/auth/recover");
  await page.getByLabel("Email", { exact: true }).fill("recovery@example.test");
  await page.getByRole("button", { name: "Send recovery link" }).click();
  await expect(page.getByText(/Recovery request accepted/)).toBeVisible();
});

test("onboarding creates API-issued workspace and agent without seed data", async ({
  page,
}) => {
  await page.goto("/auth/sign-in");
  await page
    .getByLabel("Email", { exact: true })
    .fill(`new-${randomUUID()}@example.test`);
  await page.getByLabel("Password", { exact: true }).fill("isolated-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/onboarding/);
  await page.getByLabel("Business name").fill("Fresh studio");
  await page.getByLabel("Agent name").fill("Fresh support");
  await page.getByRole("button", { name: "Create workspace & agent" }).click();
  await expect(
    page.getByText(/Workspace and draft agent created by the API/),
  ).toBeVisible();
  await page.getByRole("link", { name: "Add your first source" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByText("No matching sources.")).toBeVisible();
});

test("every visible workspace navigation route works on desktop and mobile", async ({
  page,
  isMobile,
}) => {
  await login(page);
  const pages = [
    ["Knowledge", "What your business knows."],
    ["Playground", "Ask a good question."],
    ["Conversations", "The conversations behind the answers."],
    ["Compare & Check", "Compare. Check. Decide."],
    ["Releases", "Make the next answer better."],
    ["Settings", "A considered setup."],
    ["Overview", "A little more clarity."],
  ];
  for (const [label, heading] of pages) {
    await openNavigation(page, isMobile);
    await page
      .getByRole("navigation", { name: "Workspace navigation" })
      .getByRole("link", { name: label, exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/Lattice/);
    await expect(page.locator(".page-enter")).toHaveCSS("opacity", "1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${label} should not overflow the viewport`).toBeLessThanOrEqual(1);
    expect((await new AxeBuilder({ page }).analyze()).violations, `${label} should have no automated axe violations`).toEqual([]);
  }
});

test("workspace selection isolates knowledge and enforces member controls", async ({
  page,
  isMobile,
}) => {
  const owner = await login(page);
  await go(page, "/app/knowledge", owner);
  await expect(
    page.getByRole("button", { name: /Owner export policy/ }),
  ).toBeVisible();
  await openNavigation(page, isMobile);
  await page
    .getByRole("combobox", { name: "Workspace", exact: true })
    .selectOption({ label: "Member studio · member" });
  await expect(
    page.getByRole("heading", { name: "A little more clarity." }),
  ).toBeVisible();
  const member = new URL(page.url()).searchParams.get("workspace")!;
  await go(page, "/app/knowledge", member);
  await expect(
    page.getByRole("button", { name: /Member export policy/ }),
  ).toBeVisible();
  await expect(
    page.getByText("Owner export policy", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add source", exact: true }),
  ).toHaveCount(0);
});

test("query-only source/import navigation updates dialogs and preserves archived state", async ({
  page,
}) => {
  const workspace = await login(page);
  await go(page, "/app/knowledge", workspace);
  await page.getByRole("button", { name: /Owner export policy/ }).click();
  const inspector = page.getByRole("dialog", { name: "Source inspection" });
  await expect(inspector).toBeVisible();
  await inspector
    .getByRole("button", { name: "Archive source", exact: true })
    .click();
  await expect(inspector.getByText("archived", { exact: true })).toBeVisible();
  await inspector
    .getByRole("button", { name: "Edit / inspect correction" })
    .click();
  await inspector
    .getByRole("textbox", { name: "Source content", exact: true })
    .fill("  \n  ");
  await inspector.getByRole("button", { name: "Validate correction" }).click();
  await expect(inspector.getByRole("alert")).toContainText(/Whitespace alone/);
  await expect(inspector.getByText("archived", { exact: true })).toBeVisible();
  await inspector
    .getByRole("button", { name: "Restore source", exact: true })
    .click();
  await expect(inspector.getByText("active", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Add source", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Give your agent some knowledge." }),
  ).toBeVisible();
});

test("imports show backend failure and partial extraction, not fake ready states", async ({
  page,
}) => {
  const workspace = await login(page);
  await go(page, "/app/knowledge?import=1", workspace);
  const dialog = page.getByRole("dialog", {
    name: "Give your agent some knowledge.",
  });
  await dialog.getByLabel("Source title").fill("Failure site");
  await dialog.getByLabel("Website URL").fill("https://fail.example.test");
  await dialog.getByRole("button", { name: "Submit for processing" }).click();
  await expect(dialog.getByRole("alert")).toContainText(/Extraction failed/);
  await dialog
    .getByRole("button", { name: "Upload file", exact: true })
    .click();
  await dialog.getByLabel("Source title").fill("Partial handbook");
  await dialog.getByLabel("Source file").setInputFiles({
    name: "handbook.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("Synthetic PDF fixture; not a real parser assertion"),
  });
  await dialog.getByRole("button", { name: "Submit for processing" }).click();
  await expect(dialog.getByText(/Processing finished: partial/)).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.getByText("partial", { exact: true })).toBeVisible();
  await expect(page.getByText("failed", { exact: true })).toBeVisible();
});

test("published evidence remains historical and current-turn evidence clears on unsupported questions", async ({
  page,
}) => {
  const workspace = await login(page);
  await go(page, "/app/playground", workspace);
  await page.getByLabel("Knowledge version").selectOption("published");
  await ask(page, "What is the export policy?");
  await expect(page.locator(".evidence-panel")).toContainText(
    "Old published export policy: 100 rows.",
  );
  await expect(page.locator(".evidence-panel")).not.toContainText(
    "New draft export policy",
  );
  await ask(page, "unsupported question");
  await expect(
    page.getByText(/Answer completed against release/),
  ).toBeVisible();
  await expect(page.locator(".evidence-panel")).toContainText(
    "No supporting source returned for this turn.",
  );
  await expect(page.locator(".evidence-panel")).not.toContainText(
    "Old published export policy",
  );
  await page.getByLabel("Knowledge version").selectOption("draft");
  await ask(page, "What is the export policy?");
  await expect(page.locator(".evidence-panel")).toContainText(
    "New draft export policy: 200 rows.",
  );
});

test("pending source revocation, quota exhaustion and network errors are visible", async ({
  page,
}) => {
  const workspace = await login(page);
  await go(page, "/app/playground", workspace);
  await ask(page, "source revoked");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Source revoked during generation",
  );
  await expect(page.locator(".evidence-panel")).toContainText(
    "No supporting source",
  );
  await ask(page, "quota exhaustion");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    /Allowance/,
  );
  await page.route("**/api/v1/workspaces/*/preview", (route) =>
    route.abort("failed"),
  );
  await ask(page, "network question");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    /connection failed/,
  );
});

test("conversation → explicit correction → saved check → human review → publication", async ({
  page,
}) => {
  const workspace = await login(page);
  await go(page, "/app/playground", workspace);
  await ask(page, "What is the export policy?");
  await expect(page.locator(".evidence-panel")).toContainText("200 rows");
  await go(page, "/app/conversations", workspace);
  await page
    .locator(".split-panels > section:first-child button.data-row")
    .first()
    .click();
  await page.getByRole("button", { name: "Improve / save check" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Fix the cause. Check the effect.",
  });
  await dialog
    .getByLabel("Explicit approved correction (optional)")
    .fill("Approved correction: exports allow 200 rows.");
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Stage new approved-answer correction" })
    .click();
  await expect(dialog.getByText(/Correction extracted: ready/)).toBeVisible();
  await dialog
    .getByLabel("Owner-approved expected facts (one per line)")
    .fill("200 rows");
  await dialog.getByRole("button", { name: "Save regression check" }).click();
  await expect(
    dialog.getByText(/Regression check saved with backend ID/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  const releaseId = await snapshot(page, workspace, "Reviewed correction");
  await go(page, `/app/compare?release=${releaseId}`, workspace);
  await page.getByRole("button", { name: /Run all saved checks/ }).click();
  await expect(
    page.getByRole("heading", { name: /Run review · succeeded/ }),
  ).toBeVisible();
  await page.getByLabel("Human verdict").selectOption("candidate_better");
  await expect(page.getByText("1 wins", { exact: true })).toBeVisible();
  await go(page, `/app/releases?release=${releaseId}`, workspace);
  await publish(page, "Reviewed correction");
});

test("rollback never resurrects a deleted source", async ({ page }) => {
  const workspace = await login(page);
  await snapshot(page, workspace, "Second publication");
  await publish(page, "Second publication");
  await go(page, "/app/knowledge", workspace);
  await page.getByRole("button", { name: /Owner export policy/ }).click();
  const source = page.getByRole("dialog", { name: "Source inspection" });
  await source
    .getByRole("button", { name: "Delete source", exact: true })
    .click();
  await source
    .getByRole("button", { name: "Confirm permanent deletion" })
    .click();
  await expect(source.getByText("deleted", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await go(page, "/app/releases", workspace);
  await page.getByRole("button", { name: /Initial publication/ }).click();
  await page.getByRole("button", { name: "Review rollback" }).click();
  const confirmation = page.getByRole("dialog", { name: "Confirm rollback" });
  await expect(confirmation).toContainText(
    "Rollback cannot restore deleted or revoked knowledge",
  );
  await confirmation.getByRole("checkbox").check();
  await confirmation
    .getByRole("button", { name: "Confirm rollback", exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  await go(page, "/app/playground", workspace);
  await page.getByLabel("Knowledge version").selectOption("published");
  await ask(page, "What is the export policy?");
  await expect(page.locator(".evidence-panel")).toContainText(
    "No supporting source",
  );
  await expect(page.locator(".transcript")).toContainText(
    "no supporting source was found",
  );
});

test("CSV/JSON comparison imports disclose partial runs, failures and ungraded results", async ({
  page,
}) => {
  const workspace = await login(page);
  await go(page, "/app/compare", workspace);
  await page.getByLabel("Import CSV / JSON cases").setInputFiles({
    name: "cases.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify([
        {
          question: "What is the export policy?",
          expectedFacts: ["100 rows"],
          previousAnswer: "Historical baseline policy",
          baselineTimestamp: "2026-01-01T00:00:00Z",
          importance: "critical",
          split: "holdout",
        },
        {
          question: "quota case",
          expectedFacts: ["manual handoff"],
          importance: "normal",
          split: "development",
        },
      ]),
    ),
  });
  await expect(
    page.getByText("2 cases imported by the backend."),
  ).toBeVisible();
  const release = await page
    .getByLabel("Candidate release")
    .locator("option")
    .nth(1)
    .getAttribute("value");
  await page.getByLabel("Candidate release").selectOption(release!);
  await page.getByRole("button", { name: /Run all saved checks/ }).click();
  await expect(
    page.getByRole("heading", { name: /Run review · failed/ }),
  ).toBeVisible();
  await expect(page.getByText("1 failures", { exact: true })).toBeVisible();
  await expect(page.getByText("1 ungraded", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/partial or interrupted; missing cases have not passed/),
  ).toBeVisible();
  await expect(page.getByText("Historical baseline policy")).toBeVisible();
  await expect(
    page.getByText(/Preliminary automated grade/).first(),
  ).toBeVisible();
});

test("conflicts, expired sessions and exhausted check allowances are not successful saves", async ({
  page,
}) => {
  const workspace = await login(page);
  await go(page, "/app/compare", workspace);
  await page.getByRole("button", { name: "Add saved check" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Question", { exact: true }).fill("Reviewed policy?");
  await dialog.getByLabel("Expected facts (one per line)").fill("100 rows");
  await dialog
    .getByRole("button", { name: "Save explicit check revision" })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "Inspect / edit expected facts" })
    .click();
  dialog = page.getByRole("dialog");
  await page.route("**/api/v1/workspaces/*/evaluation/cases/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({
          status: 409,
          json: {
            error: {
              code: "REVISION_CONFLICT",
              message: "Check has a newer revision",
            },
            requestId: "conflict-receipt",
          },
        })
      : route.continue(),
  );
  await dialog.getByLabel("Expected facts (one per line)").fill("200 rows");
  await dialog
    .getByRole("button", { name: "Save explicit check revision" })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("This data changed");
  await expect(dialog.getByLabel("Expected facts (one per line)")).toHaveValue(
    "200 rows",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.route("**/api/v1/workspaces/*/usage", (route) =>
    route.fulfill({
      status: 429,
      json: {
        error: {
          code: "QUOTA_EXHAUSTED",
          message: "Check allowance exhausted",
        },
        requestId: "quota-receipt",
      },
    }),
  );
  await go(page, "/app/compare", workspace);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    /Allowance/,
  );
  await expect(
    page.getByRole("button", { name: /Run all saved checks/ }),
  ).toBeDisabled();
  await page.route("**/api/v1/workspaces/*/sources?*", (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: { code: "SESSION_EXPIRED", message: "Expired" },
        requestId: "expired-receipt",
      },
    }),
  );
  await go(page, "/app/knowledge", workspace);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Session expired",
  );
  await expect(page.getByRole("link", { name: "Sign in again" })).toBeVisible();
});

test("billing is unavailable without provider configuration and legacy browser data is preserved", async ({
  page,
}) => {
  const workspace = await login(page);
  await page.evaluate(() =>
    localStorage.setItem(
      "lattice-workspace-v1",
      '{"company":"Legacy preview","sources":[]}',
    ),
  );
  await go(page, "/app/settings", workspace);
  await expect(
    page.getByRole("button", { name: "Export previous preview" }),
  ).toBeVisible();
  await expect(
    page.getByText(/has not been uploaded or deleted/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open secure checkout" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    /Payments are deliberately disabled/,
  );
  expect(
    await page.evaluate(() => localStorage.getItem("lattice-workspace-v1")),
  ).toContain("Legacy preview");
});

test("widget embed continuity, citations, feedback, handoff and quota fallback", async ({
  page,
}) => {
  const workspace = await login(page);
  await go(page, "/app/settings", workspace);
  await expect(page.getByLabel("Embed snippet")).toHaveValue(/data-agent="/);
  const snippet = await page.getByLabel("Embed snippet").inputValue();
  const agent = snippet.match(/data-agent="([^"]+)"/)![1];
  await page.goto(`http://127.0.0.1:4410/staging?agent=${agent}`);
  await page.getByRole("button", { name: "Open website support" }).click();
  const frame = page.frameLocator('iframe[title="Website support chat"]');
  await frame
    .getByRole("button", { name: "Start conversation", exact: true })
    .click();
  await frame
    .getByRole("textbox", { name: "Ask support" })
    .fill("What is the export policy?");
  await frame.getByRole("button", { name: "Send", exact: true }).click();
  await expect(frame.locator(".transcript")).toContainText(
    "Old published export policy: 100 rows.",
  );
  await expect(frame.locator(".transcript")).not.toContainText(
    "New draft export policy",
  );
  await frame.getByRole("button", { name: "Helpful", exact: true }).click();
  await expect(frame.getByText("Feedback recorded. Thank you.")).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Open website support" }).click();
  await expect(frame.locator(".transcript")).toContainText(
    "Old published export policy: 100 rows.",
  );
  await frame
    .getByText("Ask the team to reply by email", { exact: true })
    .click();
  await frame
    .getByLabel("Your email", { exact: true })
    .fill("visitor@example.test");
  await frame.getByRole("button", { name: "Request email handoff" }).click();
  await expect(
    frame.getByText(
      "Email handoff sent. The support team will reply by email.",
    ),
  ).toBeVisible();
  await frame
    .getByRole("textbox", { name: "Ask support" })
    .fill("quota request");
  await frame.getByRole("button", { name: "Send", exact: true }).click();
  await expect(frame.getByRole("main").getByRole("alert")).toContainText(
    "Allowance",
  );
  await expect(
    frame.getByRole("link", { name: "Email support" }),
  ).toBeVisible();
  const requests = await (
    await page.request.get("http://127.0.0.1:4410/test/requests")
  ).json();
  const widget = requests.filter((r: { path: string }) =>
    r.path.startsWith("/api/v1/public"),
  );
  expect(
    widget.some((r: { tokenKind: string }) => r.tokenKind === "dashboard"),
  ).toBe(false);
  expect(
    widget.every((r: { cookieForwarded: boolean }) => !r.cookieForwarded),
  ).toBe(true);
});

test("widget pending job resumes after reload without another chargeable message", async ({ page }) => {
  const workspace = await login(page); await go(page, "/app/settings", workspace);
  await expect(page.getByLabel("Embed snippet")).toHaveValue(/data-agent="/);
  const agent = (await page.getByLabel("Embed snippet").inputValue()).match(/data-agent="([^"]+)"/)![1];
  await page.goto(`http://127.0.0.1:4410/staging?agent=${agent}`);
  await page.getByRole("button", { name: "Open website support" }).click();
  const frame = page.frameLocator('iframe[title="Website support chat"]');
  await frame.getByRole("button", { name: "Start conversation", exact: true }).click();
  let messageRequests = 0;
  page.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/v1/public/messages") messageRequests++; });
  await page.route("**/api/v1/public/jobs/*", route => route.abort("failed"));
  await frame.getByRole("textbox", { name: "Ask support" }).fill("Export policy?");
  await frame.getByRole("button", { name: "Send", exact: true }).click();
  await expect(frame.getByRole("button", { name: "Resume accepted operation" })).toBeVisible();
  await page.unroute("**/api/v1/public/jobs/*");
  await page.reload(); await page.getByRole("button", { name: "Open website support" }).click();
  await frame.getByRole("button", { name: "Resume accepted operation" }).click();
  await expect(frame.locator(".transcript")).toContainText("Old published export policy: 100 rows.");
  await expect(frame.getByRole("button", { name: "Resume accepted operation" })).toHaveCount(0);
  expect(messageRequests).toBe(1);
});

test("keyboard focus, mobile navigation and dialogs are accessible", async ({
  page,
  isMobile,
}) => {
  const workspace = await login(page);
  await go(page, "/app/knowledge", workspace);
  if (isMobile) {
    await expect(page.locator(".desktop-sidebar")).toBeHidden();
    await page.getByRole("button", { name: "Open navigation" }).focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Workspace navigation" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open navigation" }),
    ).toBeFocused();
  }
  await page.getByRole("button", { name: "Add source", exact: true }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", {
    name: "Give your agent some knowledge.",
  });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Tab");
  const focusInDialog = await dialog.evaluate((el) =>
    el.contains(document.activeElement),
  );
  expect(focusInDialog).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add source", exact: true }),
  ).toBeFocused();
  // Query navigation can stream metadata after content; audit the settled document.
  await expect(page).toHaveTitle(/Lattice/);
  const result = await new AxeBuilder({ page }).analyze();
  expect(result.violations).toEqual([]);
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test.afterEach(async ({ page }, info: TestInfo) => {
  if (
    info.status === "passed" &&
    /navigation route|keyboard|widget embed/.test(info.title)
  )
    await info.attach("verified-isolated-browser-layout", {
      body: await page.screenshot({ fullPage: true, animations: "disabled" }),
      contentType: "image/png",
    });
});

import { expect, test } from "@playwright/test";
import { H, card, clock, createTask, explodeAndPostMortem, openCard, parseCountdown, rebuildWithKeyboard, signUp, travel } from "./helpers";

test.beforeEach(async ({ page }) => {
  await clock(page, { reset: true });
  await signUp(page);
});
test.afterAll(async ({ request }) => {
  await request.post("/api/dev/clock", { data: { reset: true } });
});

test("1 · create task → appears on board", async ({ page }) => {
  await expect(page.getByText("Your board is quiet.")).toBeVisible();
  await createTask(page, "Send proposal");
  await expect(card(page, "Send proposal")).toHaveAttribute("data-state", "safe");
  await page.reload();
  await expect(card(page, "Send proposal")).toBeVisible();
});

test("2 · complete task → leaves the board → shows in history", async ({ page }) => {
  await createTask(page, "Buy a gift", "1 week");
  const dialog = await openCard(page, "Buy a gift");
  await dialog.getByRole("button", { name: "MARK AS DONE" }).click();
  await expect(page.getByTestId("complete-stamp")).toBeVisible();
  await expect(card(page, "Buy a gift")).toHaveCount(0);
  await page.getByRole("link", { name: "History" }).click();
  const item = page.getByTestId("history-item").filter({ hasText: "Buy a gift" }).first();
  await expect(item).toContainText("Completed without explosions");
});

test("3 · cut the wire → reason required → deadline extended → event recorded", async ({ page }) => {
  await createTask(page, "Pay the bill");
  await travel(page, 1.7 * H); // 85%: past the edit threshold

  // Late deadline edits are routed to Cut the Wire.
  let dialog = await openCard(page, "Pay the bill");
  const before = parseCountdown(await dialog.getByTestId("details-remaining").innerText());
  await dialog.getByRole("button", { name: "CUT THE WIRE" }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByText("You're changing a commitment you made to yourself.")).toBeVisible();
  await dialog.getByRole("button", { name: "CUT THE WIRE" }).click();
  await expect(dialog.getByText("Pick what happened.")).toBeVisible();
  await expect(dialog.getByText("A few honest words are enough.")).toBeVisible();

  await dialog.getByText("Something unexpected happened").click();
  await dialog.getByLabel("Tell yourself why").fill("The bank was down all morning.");
  await dialog.getByText("2 hours", { exact: true }).click();
  await dialog.getByRole("button", { name: "CUT THE WIRE" }).click();
  await expect(dialog).toBeHidden();

  dialog = await openCard(page, "Pay the bill");
  const after = parseCountdown(await dialog.getByTestId("details-remaining").innerText());
  expect(after - before).toBeGreaterThan(2 * 3600 - 30);
  await expect(dialog.getByText("Wire cut")).toBeVisible();
  await expect(card(page, "Pay the bill")).not.toHaveAttribute("data-state", "warning");
});

test("4 · emergency pause → timers freeze → resume correctly", async ({ page }) => {
  await createTask(page, "Write report");
  await page.getByRole("button", { name: "Emergency pause" }).click();
  const pause = page.getByRole("dialog");
  await pause.getByText("2 hours", { exact: true }).click();
  await pause.getByLabel("What's going on?").fill("Kid is sick.");
  await pause.getByRole("button", { name: "PAUSE THE BOARD" }).click();
  await expect(page.getByText("BOARD PAUSED")).toBeVisible();

  let dialog = await openCard(page, "Write report");
  const frozen = parseCountdown(await dialog.getByTestId("details-remaining").innerText());
  await page.keyboard.press("Escape");

  await travel(page, 1.5 * H);
  await expect(page.getByText("BOARD PAUSED")).toBeVisible();
  dialog = await openCard(page, "Write report");
  expect(Math.abs(parseCountdown(await dialog.getByTestId("details-remaining").innerText()) - frozen)).toBeLessThan(5);
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Resume now" }).click();
  await expect(page.getByText("BOARD PAUSED")).toBeHidden();
  await travel(page, 10 * 60_000);
  dialog = await openCard(page, "Write report");
  const resumed = parseCountdown(await dialog.getByTestId("details-remaining").innerText());
  expect(frozen - resumed).toBeGreaterThan(600 - 10);
  expect(frozen - resumed).toBeLessThan(600 + 15);
});

test("5 · expired task → explosion → destroyed → post-mortem → rebuild → restored", async ({ page }) => {
  await createTask(page, "Send proposal");
  await createTask(page, "Plan trip", "1 month");
  await travel(page, 2 * H + 60_000);

  // Refresh cannot escape the destroyed state.
  await page.reload();
  await expect(page.getByTestId("explosion-overlay")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("explosion-overlay")).toBeVisible();
  await expect(page.getByText("“Send proposal” ran out of time.")).toBeVisible();

  await explodeAndPostMortem(page, "RESCHEDULE");
  await expect(page.getByText("REBUILD YOUR BOARD")).toBeVisible();
  await page.reload();
  await expect(page.getByText("REBUILD YOUR BOARD")).toBeVisible();
  await expect(page.getByRole("button", { name: /restore all/i })).toHaveCount(0);

  // One card by mouse drag into the board, one by keyboard.
  await expect(page.getByTestId("rebuild-progress")).toHaveText("0 / 2 restored");
  const zone = await page.getByTestId("rebuild-dropzone").boundingBox();
  const first = page.locator('[data-testid="task-card"]:not([aria-disabled="true"])').first();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(zone!.x + zone!.width / 2, zone!.y + zone!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("rebuild-progress")).toHaveText("1 / 2 restored");

  await rebuildWithKeyboard(page, 2, 1);
  await expect(card(page, "Send proposal")).toBeVisible();
  await expect(card(page, "Plan trip")).toBeVisible();
});

test("6 · explosion → scar persists after refresh", async ({ page }) => {
  await createTask(page, "Renew passport");
  await travel(page, 2 * H + 1000);
  await explodeAndPostMortem(page, "RESCHEDULE");
  await rebuildWithKeyboard(page, 1);
  await expect(card(page, "Renew passport")).toHaveAttribute("data-scar", "1");
  await page.reload();
  await expect(card(page, "Renew passport")).toHaveAttribute("data-scar", "1");
  const dialog = await openCard(page, "Renew passport");
  await expect(dialog.getByTestId("details-explosions")).toHaveText("1");
});

test("7 · multiple explosions → count increments → scar severity increases", async ({ page }) => {
  await createTask(page, "Call the accountant");
  for (let n = 1; n <= 2; n++) {
    await travel(page, (n === 1 ? 2 * H : 72 * H) + 1000);
    await expect(page.getByTestId("overlay-explosions")).toHaveText(String(n));
    await explodeAndPostMortem(page, "RESCHEDULE");
    await rebuildWithKeyboard(page, 1);
    await expect(card(page, "Call the accountant")).toHaveAttribute("data-scar", String(n));
  }
  await page.getByRole("link", { name: "History" }).click();
  await page.getByRole("link", { name: "Exploded" }).click();
  await expect(page.getByTestId("history-item")).toHaveCount(2);
});

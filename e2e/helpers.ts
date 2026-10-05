import { expect, type Page } from "@playwright/test";

export const H = 3_600_000;

export async function clock(page: Page, body: { advanceMs?: number; reset?: true }) {
  const res = await page.request.post("/api/dev/clock", { data: body });
  expect(res.ok()).toBeTruthy();
}

/** Moves server time forward and lets the board re-sync, like coming back to the tab. */
export async function travel(page: Page, ms: number) {
  await clock(page, { advanceMs: ms });
  await page.reload();
}

export async function signUp(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@fuse.test`;
  await page.goto("/login");
  const tab = page.getByRole("tab", { name: "Create account" });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", { timeout: 500 });
  }).toPass();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("button", { name: "NEXT", exact: true }).click();
  await page.getByRole("button", { name: "BUILD MY BOARD" }).click();
  await expect(page).toHaveURL(/\/board/);
  return email;
}

export async function createTask(page: Page, title: string, fuse = "2 hours") {
  await page.getByTestId("new-task").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("What needs to be done?").fill(title);
  await dialog.getByText(fuse, { exact: true }).click();
  await dialog.getByRole("button", { name: "LIGHT THE FUSE" }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, title)).toBeVisible();
}

export const card = (page: Page, title: string) => page.getByTestId("task-card").filter({ hasText: title });

export async function openCard(page: Page, title: string) {
  await card(page, title).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  return page.getByRole("dialog");
}

/** "01:59:42" or "1d 02:00:00" → seconds */
export function parseCountdown(text: string) {
  const m = text.trim().match(/(?:(\d+)d )?(\d+):(\d+):(\d+)/);
  if (!m) throw new Error(`Not a countdown: ${text}`);
  return Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

export async function explodeAndPostMortem(page: Page, resolution: "RESCHEDULE" | "COMPLETE TASK", fuse = "3 days") {
  const overlay = page.getByTestId("explosion-overlay");
  await expect(overlay.getByText("YOUR BOARD EXPLODED")).toBeVisible();
  await overlay.getByRole("button", { name: "CONTINUE" }).click();
  await overlay.getByText("I procrastinated").click();
  await overlay.getByLabel("Explain").fill("I kept pushing it to later.");
  await overlay.getByRole("button", { name: resolution }).click();
  if (resolution === "RESCHEDULE") await overlay.getByText(fuse, { exact: true }).click();
  await overlay.getByRole("button", { name: "SUBMIT POST-MORTEM" }).click();
  await expect(overlay).toBeHidden();
}

/** Keyboard rebuild: focus each staged card and press Enter. */
export async function rebuildWithKeyboard(page: Page, total: number, alreadyRestored = 0) {
  for (let i = alreadyRestored; i < total; i++) {
    await expect(page.getByTestId("rebuild-progress")).toHaveText(`${i} / ${total} restored`);
    const staged = page.locator('[data-testid="task-card"]:not([aria-disabled="true"])').first();
    await staged.focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByText("BOARD RESTORED")).toBeVisible();
}

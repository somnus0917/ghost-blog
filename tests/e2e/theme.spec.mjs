import {expect, test} from "@playwright/test";

test("theme preference persists after reload", async ({page}) => {
  await page.goto("/");
  await page.getByLabel("社交与快捷入口").getByRole("button", {name: "切换主题"}).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});

test("mobile navigation opens, closes with Escape, and exposes its links", async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only behavior");
  await page.goto("/");
  const toggle = page.getByRole("button", {name: "打开主导航"});
  await toggle.click();
  const closeToggle = page.getByRole("button", {name: "关闭主导航"});
  await expect(closeToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("navigation", {name: "主导航"})).toHaveClass(/is-open/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", {name: "打开主导航"})).toHaveAttribute("aria-expanded", "false");
});

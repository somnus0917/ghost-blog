import {expect, test} from "@playwright/test";

test("search loads only after user intent", async ({page}) => {
  const searchRequests = [];
  page.on("request", (request) => {
    if (request.url().includes("sodo-search")) searchRequests.push(request.url());
  });
  await page.goto("/");
  expect(searchRequests).toEqual([]);
  await page.getByLabel("社交与快捷入口").getByRole("button", {name: "搜索"}).focus();
  await expect.poll(() => searchRequests.length).toBeGreaterThan(0);
});

test("comments stay deferred until the reader approaches the section", async ({page}) => {
  await page.goto("/p/designing-yohaku/");
  const shell = page.locator(".comments-shell");
  await expect(shell).not.toHaveAttribute("data-comments-state", "loaded");
  await shell.scrollIntoViewIfNeeded();
  await expect(shell).toHaveAttribute("data-comments-state", /loading|loaded/, {timeout: 10_000});
});

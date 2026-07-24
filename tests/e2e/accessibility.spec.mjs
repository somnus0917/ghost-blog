import {expect, test} from "@playwright/test";

test("homepage has a single primary heading and labelled controls", async ({page}) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.getByRole("navigation", {name: "主导航"})).toBeAttached();
  await expect(page.getByRole("button", {name: "搜索"}).first()).toBeAttached();
  await expect(page.getByRole("button", {name: "切换主题"}).first()).toBeAttached();
});

test("signup validates email before contacting the server", async ({page}) => {
  let magicLinkRequests = 0;
  await page.route("**/members/api/send-magic-link/", async (route) => {
    magicLinkRequests += 1;
    await route.fulfill({status: 200, contentType: "application/json", body: "{}"});
  });
  await page.goto("/signup/");
  await page.getByLabel("邮箱地址").fill("not-an-email");
  await page.getByRole("button", {name: "发送注册邮件"}).click();
  expect(magicLinkRequests).toBe(0);
});

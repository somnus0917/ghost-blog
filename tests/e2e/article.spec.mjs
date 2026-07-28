import {expect, test} from "@playwright/test";

test("article builds a table of contents and preserves image proportions", async ({page, isMobile}) => {
  await page.goto("/p/designing-yohaku/");
  const toc = page.locator("[data-article-toc]");
  if (isMobile) {
    await expect(toc).toBeHidden();
  } else {
    await expect(toc).toBeVisible();
  }
  await expect(toc.locator("a")).toHaveCount(3);
  await expect(page.locator(".article-content")).toBeVisible();
});

test("article without enough headings uses the full content width", async ({page}) => {
  await page.goto("/p/e2e-no-headings/");
  await expect(page.locator("[data-article-toc]")).toBeHidden();
  await expect(page.locator(".article-layout")).toHaveClass(/article-layout--no-toc/);
});

test("rich content loads MathJax and Mermaid only where needed", async ({page}) => {
  await page.goto("/p/e2e-rich-content/");
  await expect(page.locator("mjx-container")).toHaveCount(3, {timeout: 10_000});
  await expect(page.locator(".gh-content")).not.toContainText("\\color{red}");
  await expect(page.locator(".gh-content em", {hasText: "{KL}"})).toHaveCount(0);
  await expect(page.locator(".mermaid svg")).toBeVisible({timeout: 10_000});
  await expect(page.locator(".copy-code")).toBeVisible();
});

test("ordinary article does not request rich-content bundles", async ({page}) => {
  const richRequests = [];
  page.on("request", (request) => {
    if (/mathjax|mermaid/.test(request.url())) richRequests.push(request.url());
  });
  await page.goto("/p/small-systems-slowly-tended/");
  await page.waitForLoadState("networkidle");
  expect(richRequests).toEqual([]);
});

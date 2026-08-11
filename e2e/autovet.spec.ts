import {expect, test} from "@playwright/test";

test("adds staff only from the add button and edits existing names inline", async ({page}) => {
  await page.goto("/");
  const rows = page.locator(".staff-row");
  await expect(rows).toHaveCount(4);

  await page.locator("#staff-name").fill("王小明");
  await page.locator("#staff-hours").fill("24");
  await page.locator("#staff-name").press("Enter");
  await expect(rows).toHaveCount(4);

  await page.getByRole("button", {name: "新增員工"}).click();
  await expect(rows).toHaveCount(5);

  const addedRow = rows.last();
  await addedRow.locator(".staff-name-input").fill("王大明");
  await addedRow.locator(".staff-hours-input input").fill("30");
  await expect(rows).toHaveCount(5);
  await expect(addedRow.locator(".staff-name-input")).toHaveValue("王大明");
  await expect(addedRow.locator(".staff-hours-input input")).toHaveValue("30");

  await addedRow.locator(".staff-role-select").selectOption("BACKUP_DOCTOR");
  const backupHours = addedRow.locator(".staff-hours-input input");
  await expect(backupHours).toBeEnabled();
  await expect(backupHours).toHaveValue("0");
  await backupHours.fill("");
  await expect(backupHours).toHaveValue("");
  await backupHours.fill("6");
  await backupHours.blur();
  await expect(backupHours).toHaveValue("6");
});

test("creates, compares, edits, and exports a monthly schedule", async ({page}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", {name: "讓每個班次，都安排得剛剛好。"})).toBeVisible();
  await expect(page.getByText("張嘉欣")).toBeVisible();

  await page.getByRole("button", {name: /下一步/}).click();
  await expect(page.getByRole("heading", {name: "設定診所需要的人力"})).toBeVisible();
  await page.getByRole("button", {name: /下一步/}).click();

  await page.getByRole("button", {name: "產生 3 組班表"}).click();
  await expect(page.getByText("方案 1")).toBeVisible({timeout: 15_000});
  await page.getByRole("button", {name: "選擇此方案"}).first().click();
  await page.getByRole("button", {name: /下一步/}).click();

  await expect(page.getByRole("heading", {name: "班表已準備好"})).toBeVisible();
  await expect(page.getByRole("button", {name: "下載 PDF"})).toBeVisible();
  const firstAssignment = page.locator(".schedule .assignment").first();
  const before = await firstAssignment.textContent();
  await firstAssignment.click();
  await expect(firstAssignment).not.toHaveText(before ?? "");
  await expect(page.getByRole("button", {name: "下載 PNG"})).toBeVisible();
  await expect(page.getByRole("button", {name: "下載 JPG"})).toBeVisible();
});

test("switches between Traditional Chinese and English", async ({page}) => {
  await page.goto("/");
  await page.getByRole("button", {name: "English"}).click();
  await expect(page).toHaveURL(/\/en/);
  await expect(page.getByRole("heading", {name: "Every shift, thoughtfully covered."})).toBeVisible();
});

test("employee cards and empty history are available", async ({page}) => {
  await page.goto("/");
  await page.getByRole("link", {name: /員工/}).click();
  await expect(page.getByText("張嘉欣")).toBeVisible();
  await page.getByRole("link", {name: /歷史班表/}).click();
  await expect(page.getByPlaceholder("搜尋月份或員工")).toBeVisible();
});

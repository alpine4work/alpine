import {expect, test} from "@playwright/test";
import {createTestServer} from "~/app/tests/helpers/create_test_server";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {generateId} from "~/shared/id/id";

const context = createTestContext();
createTestServer(context);

test("can request access", async ({page}) => {
    const accountId = generateId();

    await page.goto("/");

    await expect(page.getByRole("button", {name: "Request"})).toBeDisabled();

    await page.getByLabel("Name").type("Test");
    await page.getByLabel("Email address").type(`test.${accountId}@test.cyberworlds.dev`);

    await expect(page.getByRole("button", {name: "Request"})).toBeEnabled();
    await expect(page.getByText("Requested access")).not.toBeVisible();
    await page.getByRole("button", {name: "Request"}).click();
    await expect(page.getByText("Requested access")).toBeVisible();
});

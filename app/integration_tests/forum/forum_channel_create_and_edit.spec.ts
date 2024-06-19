import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const modifier = process.platform === "darwin" ? "Meta" : "Control";

const {context, services} = createTestServices();

test("can create a channel and edit the name/description", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const space = await TestSpace.create(context);

    const session = await space.createSession();

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}`);

    await page.getByLabel("Create").click();
    await page.getByText("More").click();

    const newChannelNameLocator = !isMobile
        ? page.getByPlaceholder("New channel")
        : page.getByLabel("Name");

    await expect(newChannelNameLocator).toBeHidden();
    await expect(page.getByText("FooBar")).toBeHidden();
    await expect(page.getByText("BarFoo")).toBeHidden();
    await expect(page.getByText("The quick brown fox")).toBeHidden();

    await page.getByText("Channel", {exact: true}).click();

    await newChannelNameLocator.fill("FooBar");

    if (!isMobile) {
        await newChannelNameLocator.press("Enter");
    } else {
        await page.getByText("Save").click();
    }

    await expect(newChannelNameLocator).toBeHidden();
    await expect(page.getByText("FooBar")).toBeVisible();
    await expect(page.getByText("BarFoo")).toBeHidden();
    await expect(page.getByText("The quick brown fox")).toBeHidden();

    await page.reload();

    await expect(page.getByText("FooBar")).toBeVisible();
    await expect(page.getByText("BarFoo")).toBeHidden();
    await expect(page.getByText("The quick brown fox")).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();

    const existingChannelNameLocator = !isMobile
        ? page.getByPlaceholder("FooBar")
        : page.getByLabel("Name");

    await expect(existingChannelNameLocator).toBeHidden();

    await page.getByText("Edit name").click();

    await existingChannelNameLocator.fill("BarFoo");

    if (!isMobile) {
        await existingChannelNameLocator.press("Enter");
    } else {
        await page.getByText("Save").click();
    }

    await expect(existingChannelNameLocator).toBeHidden();

    await expect(page.getByText("BarFoo")).toBeVisible();
    await expect(page.getByText("FooBar")).toBeHidden();
    await expect(page.getByText("The quick brown fox")).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();

    const existingChannelDescriptionLocator = page.getByLabel("Description");

    await expect(existingChannelDescriptionLocator).toBeHidden();

    await page.getByText("Edit description").click();

    await existingChannelDescriptionLocator.fill("The quick brown fox jumps over the lazy dog.");

    if (!isMobile) {
        await existingChannelDescriptionLocator.press(`${modifier}+Enter`);
    } else {
        await page.getByText("Save").click();
    }

    await expect(existingChannelDescriptionLocator).toBeHidden();

    await expect(page.getByText("The quick brown fox")).toBeVisible();
    await expect(page.getByText("BarFoo")).toBeVisible();
    await expect(page.getByText("FooBar")).toBeHidden();
});

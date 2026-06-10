import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();

test("can create a task collection and edit the name", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const space = await TestSpace.create(context);

    const session = await space.createSession();

    await services.signIn(browserContext, session);
    await page.goto(`/dev/empty/${space.id}`);

    await page.getByLabel("Create").click();
    if (isMobile) await page.getByText("More").click();

    const newTaskCollectionNameLocator = !isMobile
        ? page.getByPlaceholder("New collection")
        : page.getByLabel("Name");

    await expect(newTaskCollectionNameLocator).toBeHidden();
    await expect(page.getByText("FooBar")).toBeHidden();
    await expect(page.getByText("BarFoo")).toBeHidden();

    await page.getByText(/^(Create )?Task collection$/i).click();

    await newTaskCollectionNameLocator.fill("FooBar");

    if (!isMobile) {
        await newTaskCollectionNameLocator.press("Enter");
    } else {
        await page.getByText("Save").click();
    }

    await expect(newTaskCollectionNameLocator).toBeHidden();
    await expect(page.getByText("FooBar")).toBeVisible();
    await expect(page.getByText("BarFoo")).toBeHidden();

    await page.reload();

    await expect(page.getByText("FooBar")).toBeVisible();
    await expect(page.getByText("BarFoo")).toBeHidden();

    await page.getByRole("button", {name: "More"}).click();

    const existingTaskCollectionNameLocator = !isMobile
        ? page.getByPlaceholder("FooBar")
        : page.getByLabel("Name");

    await expect(existingTaskCollectionNameLocator).toBeHidden();

    await page.getByText("Edit name").click();

    await existingTaskCollectionNameLocator.fill("BarFoo");

    if (!isMobile) {
        await existingTaskCollectionNameLocator.press("Enter");
    } else {
        await page.getByText("Save").click();
    }

    await expect(existingTaskCollectionNameLocator).toBeHidden();

    await expect(page.getByText("BarFoo")).toBeVisible();
    await expect(page.getByText("FooBar")).toBeHidden();
});

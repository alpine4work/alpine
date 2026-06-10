import {type Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {pageKeyboardShortcut} from "~/app/integration_tests/helpers/page_keyboard_shortcut.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();

async function clickCreateChannelMenuItem(page: Page, isMobile: boolean) {
    const moreButton = page.getByText("More", {exact: true});
    if (isMobile) await moreButton.click();

    await page.getByRole("menuitem", {name: /^(Create )?channel\b/i}).click();
}

test("can create a channel and edit the name/description", async ({
    page,
    context: browserContext,
    isMobile,
}) => {
    const space = await TestSpace.create(context);

    const session = await space.createSession();

    await services.signIn(browserContext, session);
    await page.goto(`/dev/empty/${space.id}`);

    await page.getByLabel("Create").click();

    await expect(page.getByLabel("Name")).toBeHidden();
    await expect(page.getByText("FooBar")).toBeHidden();
    await expect(page.getByText("BarFoo")).toBeHidden();
    await expect(page.getByText("The quick brown fox")).toBeHidden();

    await clickCreateChannelMenuItem(page, isMobile);

    await page.getByLabel("Name").fill("FooBar");

    if (!isMobile) {
        await page.getByLabel("Name").press("Enter");
    } else {
        await page.getByText("Create").click();
    }

    await expect(page.getByLabel("Name")).toBeHidden();
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
        await existingChannelDescriptionLocator.press(
            await pageKeyboardShortcut(page, "mod", "enter"),
        );
    } else {
        await page.getByText("Save").click();
    }

    await expect(existingChannelDescriptionLocator).toBeHidden();

    await expect(page.getByText("The quick brown fox")).toBeVisible();
    await expect(page.getByText("BarFoo")).toBeVisible();
    await expect(page.getByText("FooBar")).toBeHidden();
});

test("can create a private channel", async ({
    browser,
    page: page1,
    context: browserContext1,
    isMobile,
}) => {
    const space = await TestSpace.create(context);

    const [session1, session2] = await space.createSessions(2);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/dev/empty/${space.id}`);

    await page1.getByLabel("Create").click();

    await expect(page1.getByLabel("Name")).toBeHidden();
    await expect(page1.getByText("FooBar")).toBeHidden();

    await clickCreateChannelMenuItem(page1, isMobile);

    await page1.getByLabel("Name").fill("FooBar");

    await page1.getByText("Private").click();

    if (!isMobile) {
        await page1.getByLabel("Name").press("Enter");
    } else {
        await page1.getByText("Create").click();
    }

    await expect(page1.getByLabel("Name")).toBeHidden();
    await expect(page1.getByText("FooBar")).toBeVisible();

    if (!isMobile) {
        await expect(page1.getByTestId("PeekStackOverlay")).toBeVisible();
        await page1.getByLabel("Expand").click();
        await expect(page1.getByTestId("PeekStackOverlay")).toBeHidden();
    }

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(page1.url());

    await expect(page2.getByText("Couldn\u2019t open channel")).toBeVisible();
    await expect(page2.getByTestId("NavigationBar").getByText("FooBar")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await browserContext2.close();
});

test("can create a public channel", async ({
    browser,
    page: page1,
    context: browserContext1,
    isMobile,
}) => {
    const space = await TestSpace.create(context);

    const [session1, session2] = await space.createSessions(2);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/dev/empty/${space.id}`);

    await page1.getByLabel("Create").click();

    await expect(page1.getByLabel("Name")).toBeHidden();
    await expect(page1.getByText("FooBar")).toBeHidden();

    await clickCreateChannelMenuItem(page1, isMobile);

    await page1.getByLabel("Name").fill("FooBar");

    await page1.getByText("Public").click();

    if (!isMobile) {
        await page1.getByLabel("Name").press("Enter");
    } else {
        await page1.getByText("Create").click();
    }

    await expect(page1.getByLabel("Name")).toBeHidden();
    await expect(page1.getByText("FooBar")).toBeVisible();

    if (!isMobile) {
        await expect(page1.getByTestId("PeekStackOverlay")).toBeVisible();
        await page1.getByLabel("Expand").click();
        await expect(page1.getByTestId("PeekStackOverlay")).toBeHidden();
    }

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(page1.url());

    await expect(page2.getByTestId("NavigationBar").getByText("FooBar")).toBeVisible();
    await expect(page2.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await browserContext2.close();
});

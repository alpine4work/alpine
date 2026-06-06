import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";

const {context, services} = createTestServices();

test("can implicitly archive single channel posts inbox entry", async ({
    browser,
    page: page1,
    context: browserContext1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {name: "Test Channel"});
    await channel.subscribe(session1);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/inbox/${space.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/channel/${channel.id}`);

    await page2.getByRole("button", {name: "Post"}).click();
    await (await page2.getByLabel("New post").elementHandle())!.waitForElementState("stable");
    await page2.getByLabel("New post").fill("The quick brown fox jumps over the lazy dog.");

    await expect(
        page1.getByTestId("InboxViewEntries").getByText("New post in Test Channel"),
    ).toBeHidden();
    await page2.getByTestId("PeekStackOverlay").getByRole("button", {name: "Post"}).click();
    await expect(
        page1.getByTestId("InboxViewEntries").getByText("New post in Test Channel"),
    ).toBeVisible();

    await browserContext2.close();

    await expect(
        page1
            .getByTestId(/^PostContentView:/)
            .getByText("The quick brown fox jumps over the lazy dog."),
    ).toBeHidden();

    await expect(page1.getByTestId(/^InboxBannerOutletContainerDoneButton:/)).toBeHidden();

    await page1.getByTestId("InboxViewEntries").getByText("New post in Test Channel").click();

    await expect(
        page1
            .getByTestId(/^PostContentView:/)
            .getByText("The quick brown fox jumps over the lazy dog."),
    ).toBeVisible();

    await expect(page1.getByTestId(/^InboxBannerOutletContainerDoneButton:/)).toBeVisible();
    await expect(page1.getByTestId(/^InboxBannerOutletContainerDoneButton:/)).toHaveAttribute(
        "data-testid",
        "InboxBannerOutletContainerDoneButton:NotArchived",
    );

    await page1.getByLabel("New comment").click();
    await page1.getByLabel("New comment").fill("Hello, world!");
    await page1.getByLabel("Send comment").click();

    await expect(page1.getByTestId(/^InboxBannerOutletContainerDoneButton:/)).toHaveAttribute(
        "data-testid",
        "InboxBannerOutletContainerDoneButton:Archived",
    );
    await expect(page1.getByTestId(/^InboxBannerOutletContainerDoneButton:/)).toBeVisible();

    await expect(
        page1
            .getByTestId(/^PostContentView:/)
            .getByText("The quick brown fox jumps over the lazy dog."),
    ).toBeVisible();

    await expect(
        page1.getByTestId("InboxViewEntries").getByText("New post in Test Channel"),
    ).toBeHidden();
    await expect(
        page1.getByTestId("InboxViewEntries").getByText("post in Test Channel has new comments"),
    ).toBeHidden();

    await page1.getByTestId(/^InboxBannerOutletContainerDoneButton:/).click();

    await expect(
        page1.getByTestId("InboxViewEntries").getByText("post in Test Channel has new comments"),
    ).toBeVisible();
    await expect(
        page1.getByTestId("InboxViewEntries").getByText("New post in Test Channel"),
    ).toBeHidden();

    await expect(page1.getByTestId(/^InboxBannerOutletContainerDoneButton:/)).toHaveAttribute(
        "data-testid",
        "InboxBannerOutletContainerDoneButton:NotArchived",
    );

    await expect(
        page1
            .getByTestId(/^PostContentView:/)
            .getByText("The quick brown fox jumps over the lazy dog."),
    ).toBeVisible();

    await page1.getByTestId(/^InboxBannerOutletContainerDoneButton:/).click();

    await expect(
        page1.getByTestId("InboxViewEntries").getByText("post in Test Channel has new comments"),
    ).toBeHidden();
    await expect(
        page1.getByTestId("InboxViewEntries").getByText("New post in Test Channel"),
    ).toBeHidden();

    await expect(page1.getByTestId(/^InboxBannerOutletContainerDoneButton:/)).toHaveAttribute(
        "data-testid",
        "InboxBannerOutletContainerDoneButton:Archived",
    );

    await expect(
        page1
            .getByTestId(/^PostContentView:/)
            .getByText("The quick brown fox jumps over the lazy dog."),
    ).toBeVisible();
});

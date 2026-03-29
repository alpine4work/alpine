import {Page, expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {FilePostAuthorizer} from "~/server/forum/data/file_post_authorizer.js";
import {getChannelPreview} from "~/server/forum/data/get_channel_preview.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {allAccessLevels, hasAccessLevel} from "~/shared/access/access_policy.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {MessageContentProsemirrorSchema} from "~/shared/content/message_content_schema.js";
import {PostContentProsemirrorSchema} from "~/shared/forum/post_content_schema.js";
import {cast} from "~/shared/helpers/control/cast.js";

const {context, services} = createTestServices();

test("can toggle channel sharing on/off with switch", async ({
    browser,
    context: browserContext2,
    page: page2,
    isMobile,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        name: "Test Channel",
        access: "Private",
    });

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/channels/${channel.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page1.getByText("Test Channel")).toBeVisible();
    await expect(page1.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn\u2019t open channel")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Channel"})).toBeHidden();
    await expect(page2.getByText("Test Channel")).toBeHidden();

    await page1.getByTestId("NavigationBar").getByLabel("More").click();

    if (isMobile) {
        await page1.getByRole("menuitem", {name: "Share"}).click();
        await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();
    }

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the channel is private");

    await page1.getByRole("button", {name: "Toggle sharing"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the channel is shared with everyone in Test Space",
    );

    // Doesn't update in realtime so keep reloading until we can see the channel.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByText("Test Channel")).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await page2.getByTestId("NavigationBar").getByLabel("More").click();

    if (isMobile) {
        await page2.getByRole("menuitem", {name: "Share"}).click();
        await expect(page2.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();
    }

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the channel is shared with everyone in Test Space",
    );

    if (isMobile) {
        await page2.getByRole("button", {name: "Close"}).click();
        await expect(page2.getByTestId("ShareOverlayDefaultGrant")).toBeHidden();
    }

    await expect(page1.getByRole("heading", {name: "Make this channel private"})).toBeHidden();

    await page1.getByRole("button", {name: "Toggle sharing"}).click();

    await expect(page1.getByRole("heading", {name: "Make this channel private"})).toBeVisible();

    await page1.getByRole("button", {name: "Confirm"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the channel is private");

    await expect(page2.getByText("Couldn\u2019t open channel")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Channel"})).toBeHidden();

    await browserContext1.close();
});

test("can toggle channel sharing on/off with share dialog default grant", async ({
    browser,
    context: browserContext2,
    page: page2,
    isMobile,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        name: "Test Channel",
        access: "Private",
    });

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/channels/${channel.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page1.getByText("Test Channel")).toBeVisible();
    await expect(page1.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn\u2019t open channel")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByText("Test Channel")).toBeHidden();

    await page1.getByTestId("NavigationBar").getByLabel("More").click();

    if (isMobile) {
        await page1.getByRole("menuitem", {name: "Share"}).click();
        await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();
    }

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the channel is private");

    if (!isMobile) {
        await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeHidden();
        await expect(page1.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

        await page1.getByRole("menuitem", {name: "Share"}).click();
    }

    await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();

    await expect(page1.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page1
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can\u2019t access"})
        .click();

    await expect(page1.getByRole("menuitem", {name: "can post"})).toBeVisible();
    await page1.getByRole("menuitem", {name: "can post"}).click();
    await expect(page1.getByRole("menuitem", {name: "can post"})).toBeHidden();

    if (!isMobile) {
        await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();
        await page1.keyboard.press("Escape");
        await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeHidden();

        await page1.getByTestId("NavigationBar").getByLabel("More").click();
    }

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the channel is shared with everyone in Test Space",
    );

    // Doesn't update in realtime so keep reloading until we can see the channel.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByText("Test Channel")).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await page2.getByTestId("NavigationBar").getByLabel("More").click();

    if (isMobile) {
        await page2.getByRole("menuitem", {name: "Share"}).click();
        await expect(page2.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();
    }

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the channel is shared with everyone in Test Space",
    );

    if (!isMobile) {
        await page1.getByRole("menuitem", {name: "Share"}).click();
    }

    await page1
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can post"})
        .click();

    await expect(page1.getByRole("menuitem", {name: "can\u2019t access"})).toBeVisible();
    await page1.getByRole("menuitem", {name: "can\u2019t access"}).click();
    await expect(page1.getByRole("menuitem", {name: "can\u2019t access"})).toBeHidden();

    if (!isMobile) {
        await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();
        await page1.keyboard.press("Escape");
        await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeHidden();

        await page1.getByTestId("NavigationBar").getByLabel("More").click();
    }

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the channel is private");

    await expect(page2.getByText("Couldn\u2019t open channel")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByText("Test Channel")).toBeHidden();

    await browserContext1.close();
});

test("can toggle channel sharing on/off with share dialog account grant", async ({
    browser,
    context: browserContext2,
    page: page2,
    isMobile,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        name: "Test Channel",
        access: "Private",
    });

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/channels/${channel.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page1.getByText("Test Channel")).toBeVisible();
    await expect(page1.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn\u2019t open channel")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByText("Test Channel")).toBeHidden();

    await page1.getByTestId("NavigationBar").getByLabel("More").click();

    if (isMobile) {
        await page1.getByRole("menuitem", {name: "Share"}).click();
        await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();
    }

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the channel is private");

    if (!isMobile) {
        await expect(page1.getByPlaceholder("Add people")).toBeHidden();

        await page1.getByRole("menuitem", {name: "Share"}).click();
    }

    await expect(page1.getByPlaceholder("Add people")).toBeVisible();

    await expect(page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeHidden();

    await page1.getByPlaceholder("Add people").click();
    await page1.getByText(session2.account.initialName).click();
    await page1.getByRole("button", {name: "Share", exact: true}).click();

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`),
    ).toBeVisible();

    if (!isMobile) {
        await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();
        await page1.keyboard.press("Escape");
        await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeHidden();

        await page1.getByTestId("NavigationBar").getByLabel("More").click();
    }

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the channel is private");

    // Doesn't update in realtime so keep reloading until we can see the channel.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByText("Test Channel")).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await page2.getByTestId("NavigationBar").getByLabel("More").click();

    if (isMobile) {
        await page2.getByRole("menuitem", {name: "Share"}).click();
        await expect(page2.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();
    }

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the channel is private");

    if (isMobile) {
        await page2.getByRole("button", {name: "Close"}).click();
        await expect(page2.getByTestId("ShareOverlayDefaultGrant")).toBeHidden();
    }

    if (!isMobile) {
        await page1.getByRole("menuitem", {name: "Share"}).click();
    }

    await page1
        .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
        .getByRole("button", {name: "can post"})
        .click();

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`),
    ).toBeVisible();

    await page1.getByRole("menuitem", {name: "remove access"}).click();

    await expect(page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeHidden();

    await expect(page2.getByText("Couldn\u2019t open channel")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByText("Test Channel")).toBeHidden();

    await browserContext1.close();
});

for (const accessLevel of [...allAccessLevels].reverse()) {
    async function tapSendComment(page: Page) {
        await expect(page.getByRole("button", {name: "Send comment"})).toBeEnabled();

        // Make sure the keyboard toolbar isn't animating when we tap.
        await (await page
            .getByRole("button", {name: "Send comment"})
            .elementHandle())!.waitForElementState("stable");

        await page.getByRole("button", {name: "Send comment"}).tap();
        await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();
    }

    test(`can interact with private channel with access level \`${accessLevel}\``, async ({
        context: browserContext,
        page,
        isMobile,
    }) => {
        {
            const space = await TestSpace.create(context, {name: "Test Space"});
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1, {
                name: "Test Channel 1",
                access: "Private",
            });
            await channel.access.grant(session1, session2, accessLevel);

            const post = await channel.createPost(session1, "foo");

            await post.createComment(session1, "bar");

            await services.signIn(browserContext, session2);
            await page.goto(`/s/${space.id}/channels/${channel.id}`);

            await expect(page.getByText("Test Channel 1")).toBeVisible();
            await expect(page.getByText("foo")).toBeVisible();
            await expect(page.getByText("bar")).toBeHidden();

            if (!hasAccessLevel(accessLevel, "Edit")) {
                await expect(page.getByRole("button", {name: "Post"})).toBeHidden();
                await expect(page.getByText("qux")).toBeHidden();
            } else {
                await page.getByRole("button", {name: "Post"}).click();

                await page.getByLabel("New post").fill("qux");

                if (isMobile) {
                    await page.getByRole("button", {name: "Post"}).click();
                } else {
                    await page
                        .getByTestId("PeekStackOverlay")
                        .getByRole("button", {name: "Post"})
                        .click();
                }

                await expect(page.getByLabel("New post")).toBeHidden();

                await expect(page.getByText("qux")).toBeVisible();

                if (isMobile) {
                    await expect(page.getByText("About")).toBeHidden();
                    await page.getByRole("button", {name: "Go back"}).click();
                    await expect(page.getByText("About")).toBeVisible();
                }
            }

            await expect(page.getByText("bar")).toBeHidden();
            await page.getByRole("button", {name: "1 comment"}).click();
            await expect(page.getByText("bar")).toBeVisible();

            if (!hasAccessLevel(accessLevel, "Comment")) {
                await expect(page.getByText("Can\u2019t comment on posts")).toBeVisible();
                await expect(page.getByLabel("New comment")).toBeHidden();
            } else {
                await expect(page.getByLabel("New comment")).toBeVisible();
                await expect(page.getByText("Can\u2019t comment on posts")).toBeHidden();

                await expect(page.getByLabel("New comment")).toHaveText("");
                await page.getByLabel("New comment").fill("baz");
                await expect(page.getByLabel("New comment")).toHaveText("baz");
                if (!isMobile) {
                    await page.getByLabel("Send comment").click();
                } else {
                    await tapSendComment(page);
                }
                await expect(page.getByLabel("New comment")).toHaveText("");

                await expect(page.getByText("baz")).toBeVisible();
            }

            if (isMobile) {
                await expect(page.getByText("About")).toBeHidden();
                await page.getByRole("button", {name: "Go back"}).click();
                await expect(page.getByText("About")).toBeVisible();
            }

            if (!hasAccessLevel(accessLevel, "Manage")) {
                await expect(page.getByLabel("Invite")).toBeHidden();
            } else {
                await expect(page.getByPlaceholder("Add people…")).toBeHidden();
                await expect(
                    page.getByTestId("ShareOverlayAccountInput").locator("button"),
                ).toBeHidden();
                await page.getByLabel("Invite").click();
                await expect(page.getByPlaceholder("Add people…")).toBeVisible();
                await expect(
                    page.getByTestId("ShareOverlayAccountInput").locator("button"),
                ).toBeVisible();
                await expect(
                    page.getByTestId("ShareOverlayAccountInput").locator("button"),
                ).toHaveText("can post");

                if (!isMobile) {
                    await page.keyboard.press("Escape");
                    await expect(page.getByPlaceholder("Add people…")).toBeVisible();
                    await expect(
                        page.getByTestId("ShareOverlayAccountInput").locator("button"),
                    ).toBeVisible();
                    await expect(
                        page.getByTestId("ShareOverlayAccountInput").locator("button"),
                    ).toHaveText("can post");
                    await page.keyboard.press("Escape");
                } else {
                    await page.getByRole("button", {name: "Close"}).click();
                }

                await expect(page.getByPlaceholder("Add people…")).toBeHidden();
                await expect(
                    page.getByTestId("ShareOverlayAccountInput").locator("button"),
                ).toBeHidden();
            }

            await page.getByTestId("NavigationBar").getByRole("button", {name: "More"}).click();
            await page.getByRole("menuitem", {name: "Share"}).click();

            await expect(
                page
                    .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
                    .getByText("can post", {exact: true}),
            ).toBeVisible();
            await expect(
                page.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`).getByText(
                    {
                        Manage: "can post",
                        Edit: "can post (can\u2019t share)",
                        Comment: "can comment",
                        View: "can view",
                    }[accessLevel],
                    {exact: true},
                ),
            ).toBeVisible();
            await expect(
                page
                    .getByTestId("ShareOverlayDefaultGrant")
                    .getByText("can\u2019t access", {exact: true}),
            ).toBeVisible();

            if (hasAccessLevel(accessLevel, "Manage")) {
                await expect(
                    page
                        .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
                        .getByRole("button", {name: "can post"}),
                ).toBeVisible();
                await expect(
                    page
                        .getByTestId("ShareOverlayDefaultGrant")
                        .getByRole("button", {name: "can\u2019t access"}),
                ).toBeVisible();

                await expect(page.getByPlaceholder("Add people")).toBeVisible();
            } else {
                await expect(
                    page
                        .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
                        .getByRole("button", {name: "can post"}),
                ).toBeHidden();
                await expect(
                    page
                        .getByTestId("ShareOverlayDefaultGrant")
                        .getByRole("button", {name: "can\u2019t access"}),
                ).toBeHidden();

                await expect(page.getByPlaceholder("Add people")).toBeHidden();
            }
        }

        {
            const space = await TestSpace.create(context, {name: "Test Space"});
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1, {
                name: "Test Channel 2",
                access: "Private",
            });
            await channel.access.grantDefault(session1, "View");
            await channel.access.grant(session1, session2, accessLevel);

            const post = await channel.createPost(session1, "foo");

            await post.createComment(session1, "bar");

            await services.signIn(browserContext, session2);
            await page.goto(`/s/${space.id}/channels/${channel.id}`);

            await expect(page.getByText("Test Channel 2")).toBeVisible();
            await expect(page.getByText("foo")).toBeVisible();
            await expect(page.getByText("bar")).toBeHidden();

            await expect(page.getByPlaceholder("Add people…")).toBeHidden();
            await expect(
                page.getByTestId("ShareOverlayAccountInput").locator("button"),
            ).toBeHidden();

            await page.getByLabel("Invite").click();

            await expect(page.getByPlaceholder("Add people…")).toBeVisible();

            if (!hasAccessLevel(accessLevel, "Manage")) {
                await expect(
                    page.getByTestId("ShareOverlayAccountInput").locator("button"),
                ).toBeHidden();
            } else {
                await expect(
                    page.getByTestId("ShareOverlayAccountInput").locator("button"),
                ).toHaveText("can view");

                await page.getByTestId("ShareOverlayAccountInput").locator("button").click();

                await expect(
                    page.getByRole("menuitem", {name: "can post", exact: true}),
                ).toBeVisible();
                await expect(page.getByRole("menuitem", {name: "can comment"})).toBeVisible();
                await expect(page.getByRole("menuitem", {name: "can view"})).toBeVisible();
                await expect(
                    page.getByRole("menuitem", {name: "can post (can\u2019t share)"}),
                ).toBeHidden();
            }
        }

        {
            const space = await TestSpace.create(context, {name: "Test Space"});
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1, {
                name: "Test Channel 3",
                access: "Private",
            });
            await channel.access.grantDefault(session1, "Comment");
            await channel.access.grant(session1, session2, accessLevel);

            const post = await channel.createPost(session1, "foo");

            await post.createComment(session1, "bar");

            await services.signIn(browserContext, session2);
            await page.goto(`/s/${space.id}/channels/${channel.id}`);

            await expect(page.getByText("Test Channel 3")).toBeVisible();
            await expect(page.getByText("foo")).toBeVisible();
            await expect(page.getByText("bar")).toBeHidden();

            await expect(page.getByPlaceholder("Add people…")).toBeHidden();
            await expect(
                page.getByTestId("ShareOverlayAccountInput").locator("button"),
            ).toBeHidden();

            await page.getByLabel("Invite").click();

            await expect(page.getByPlaceholder("Add people…")).toBeVisible();

            if (!hasAccessLevel(accessLevel, "Manage")) {
                await expect(
                    page.getByTestId("ShareOverlayAccountInput").locator("button"),
                ).toBeHidden();
            } else {
                await expect(
                    page.getByTestId("ShareOverlayAccountInput").locator("button"),
                ).toHaveText("can comment");

                await page.getByTestId("ShareOverlayAccountInput").locator("button").click();

                await expect(
                    page.getByRole("menuitem", {name: "can post", exact: true}),
                ).toBeVisible();
                await expect(page.getByRole("menuitem", {name: "can comment"})).toBeVisible();
                await expect(page.getByRole("menuitem", {name: "can view"})).toBeHidden();
                await expect(
                    page.getByRole("menuitem", {name: "can post (can\u2019t share)"}),
                ).toBeHidden();
            }
        }

        {
            const space = await TestSpace.create(context, {name: "Test Space"});
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1, {
                name: "Test Channel 4",
                access: "Private",
            });
            await channel.access.grantDefault(session1, "Edit");
            await channel.access.grant(session1, session2, accessLevel);

            const post = await channel.createPost(session1, "foo");

            await post.createComment(session1, "bar");

            await services.signIn(browserContext, session2);
            await page.goto(`/s/${space.id}/channels/${channel.id}`);

            await expect(page.getByText("Test Channel 4")).toBeVisible();
            await expect(page.getByText("foo")).toBeVisible();
            await expect(page.getByText("bar")).toBeHidden();

            await expect(page.getByPlaceholder("Add people…")).toBeHidden();
            await expect(
                page.getByTestId("ShareOverlayAccountInput").locator("button"),
            ).toBeHidden();

            await page.getByLabel("Invite").click();

            await expect(page.getByPlaceholder("Add people…")).toBeVisible();

            if (!hasAccessLevel(accessLevel, "Manage")) {
                await expect(
                    page.getByTestId("ShareOverlayAccountInput").locator("button"),
                ).toBeHidden();
            } else {
                await expect(
                    page.getByTestId("ShareOverlayAccountInput").locator("button"),
                ).toHaveText("can post (can\u2019t share)");

                await page.getByTestId("ShareOverlayAccountInput").locator("button").click();

                await expect(
                    page.getByRole("menuitem", {name: "can post", exact: true}),
                ).toBeVisible();
                await expect(
                    page.getByRole("menuitem", {name: "can post (can\u2019t share)"}),
                ).toBeVisible();
                await expect(page.getByRole("menuitem", {name: "can comment"})).toBeHidden();
                await expect(page.getByRole("menuitem", {name: "can view"})).toBeHidden();
            }
        }

        {
            const space = await TestSpace.create(context, {name: "Test Space"});
            const [session1, session2] = await space.createSessions(2);

            const channel = await TestChannel.create(session1, {
                name: "Test Channel 5",
                access: "Private",
            });
            await channel.access.grantDefault(session1, "Manage");
            await channel.access.grant(session1, session2, accessLevel);

            const post = await channel.createPost(session1, "foo");

            await post.createComment(session1, "bar");

            await services.signIn(browserContext, session2);
            await page.goto(`/s/${space.id}/channels/${channel.id}`);

            await expect(page.getByText("Test Channel 5")).toBeVisible();
            await expect(page.getByText("foo")).toBeVisible();
            await expect(page.getByText("bar")).toBeHidden();

            await expect(page.getByPlaceholder("Add people…")).toBeHidden();
            await expect(
                page.getByTestId("ShareOverlayAccountInput").locator("button"),
            ).toBeHidden();

            await page.getByLabel("Invite").click();

            await expect(page.getByPlaceholder("Add people…")).toBeVisible();

            await expect(
                page.getByTestId("ShareOverlayAccountInput").locator("button"),
            ).toBeHidden();
        }
    });
}

test("can switch other account access level between comment and view in realtime", async ({
    browser,
    context: browserContext2,
    page: page2,
    isMobile,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session2, {
        name: "Test Channel",
        access: "Private",
    });
    await channel.access.grant(session2, session1, "Comment");

    await channel.createPost(session2, "Hello, world!");

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/channels/${channel.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page1.getByTestId("NavigationBar").getByText("Test Channel")).toBeVisible();
    await expect(page2.getByTestId("NavigationBar").getByText("Test Channel")).toBeVisible();

    await expect(page1.getByLabel("New comment")).toBeHidden();
    await page1.getByRole("button", {name: "0 comments"}).click();
    await expect(page1.getByLabel("New comment")).toBeVisible();
    await expect(page1.getByText("Can\u2019t comment on posts")).toBeHidden();

    await expect(page2.getByLabel("New comment")).toBeHidden();
    await page2.getByRole("button", {name: "0 comments"}).click();
    await expect(page2.getByLabel("New comment")).toBeVisible();
    await expect(page2.getByText("Can\u2019t comment on posts")).toBeHidden();

    if (isMobile) {
        await expect(page2.getByText("About")).toBeHidden();
        await page2.getByRole("button", {name: "Go back"}).click();
        await expect(page2.getByText("About")).toBeVisible();
    }

    await page2.getByTestId("NavigationBar").getByRole("button", {name: "More"}).click();
    await page2.getByRole("menuitem", {name: "Share"}).click();

    await page2
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can comment"})
        .click();

    await expect(page1.getByTestId("NavigationBar").getByText("Test Channel")).toBeVisible();

    await expect(page1.getByLabel("New comment")).toBeVisible();
    await expect(page1.getByText("Can\u2019t comment on posts")).toBeHidden();

    await page2.getByRole("menuitem", {name: "can view"}).click();

    // Channels aren't updated in realtime on mobile in a single post view.
    if (isMobile) {
        await expect(async () => {
            await page1.reload();
            await expect(page1.getByText("Can\u2019t comment on posts")).toBeVisible({
                timeout: 250,
            });
        }).toPass({timeout: 5000});
    }

    await expect(page1.getByTestId("NavigationBar").getByText("Test Channel")).toBeVisible();

    await expect(page1.getByText("Can\u2019t comment on posts")).toBeVisible();
    await expect(page1.getByLabel("New comment")).toBeHidden();

    await page2
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can view"})
        .click();

    await expect(page1.getByTestId("NavigationBar").getByText("Test Channel")).toBeVisible();

    await expect(page1.getByText("Can\u2019t comment on posts")).toBeVisible();
    await expect(page1.getByLabel("New comment")).toBeHidden();

    await page2.getByRole("menuitem", {name: "can comment"}).click();

    // Channels aren't updated in realtime on mobile in a single post view.
    if (isMobile) {
        await expect(async () => {
            await page1.reload();
            await expect(page1.getByText("Can\u2019t comment on posts")).toBeHidden({
                timeout: 250,
            });
        }).toPass({timeout: 5000});
    }

    await expect(page1.getByLabel("New comment")).toBeVisible();
    await expect(page1.getByText("Can\u2019t comment on posts")).toBeHidden();

    if (isMobile) {
        await page2.getByRole("button", {name: "Close"}).click();
        await page2.getByRole("button", {name: "0 comments"}).click();
    }

    await expect(page2.getByTestId("NavigationBar").getByText("Test Channel")).toBeVisible();

    await expect(page2.getByLabel("New comment")).toBeVisible();
    await expect(page2.getByText("Can\u2019t comment on posts")).toBeHidden();

    await browserContext1.close();
});

test("can switch own account access level between manage and view in realtime", async ({
    context: browserContext,
    page,
    isMobile,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session2, {
        name: "Test Channel",
        access: "Private",
    });
    await channel.access.grant(session2, session1, "Manage");

    await channel.createPost(session2, "Hello, world!");

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page.getByTestId("NavigationBar").getByText("Test Channel")).toBeVisible();
    await page.getByRole("button", {name: "0 comments"}).click();
    await expect(page.getByLabel("New comment")).toBeVisible();
    await expect(page.getByText("Can\u2019t comment on posts")).toBeHidden();

    if (isMobile) {
        await expect(page.getByText("About")).toBeHidden();
        await page.getByRole("button", {name: "Go back"}).click();
        await expect(page.getByText("About")).toBeVisible();
    }

    await page.getByTestId("NavigationBar").getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
        .getByRole("button", {name: "can post"})
        .click();

    await page.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeVisible();

    await expect(page.getByPlaceholder("Add people")).toBeVisible();
    await expect(page.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeVisible();

    await page.getByRole("button", {name: "I understand, make this change"}).click();

    await expect(page.getByPlaceholder("Add people")).toBeHidden();
    await expect(page.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeVisible();

    if (isMobile) {
        await page.getByRole("button", {name: "Close"}).click();
        await expect(page.getByTestId("NavigationBar").getByText("Test Channel")).toBeVisible();
        await page.getByRole("button", {name: "0 comments"}).click();
    }

    await expect(page.getByTestId("NavigationBar").getByText("Test Channel")).toBeVisible();
    await expect(page.getByText("Can\u2019t comment on posts")).toBeVisible();
    await expect(page.getByLabel("New comment")).toBeHidden();
});

test("can\u2019t change permission level of account who invited you", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {access: "Private"});
    await channel.access.grant(session1, session2);

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await page.getByTestId("NavigationBar").getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can post"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "remove access"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can post"}),
    ).toBeVisible();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can post"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "can comment"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can post"}),
    ).toBeVisible();
});

test("can\u2019t change permission level of account who invited the account who invited you", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2, session3] = await space.createSessions(3);

    const channel = await TestChannel.create(session1, {access: "Private"});
    await channel.access.grant(session1, session2);
    await channel.access.grant(session2, session3);

    await services.signIn(browserContext, session3);
    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await page.getByTestId("NavigationBar").getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can post"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "remove access"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can post"}),
    ).toBeVisible();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can post"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "can comment"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can\u2019t change Test\u2019s permissions"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can post"}),
    ).toBeVisible();
});

test("will be warned before lowering your own permission level", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        name: "Test Channel",
        access: "Private",
    });
    await channel.access.grant(session1, session2);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await page.getByTestId("NavigationBar").getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can post"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "can comment"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Cancel"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can post"}),
    ).toBeVisible();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can post"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "remove access"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "I understand, make this change"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeHidden();

    await expect(page.getByTestId("NavigationBar").getByText("Test Channel")).toBeHidden();
    await expect(page.getByText("Couldn\u2019t open channel")).toBeVisible();
    await expect(page.getByRole("img", {name: "Error icon"})).toBeHidden();
});

test("will be prevented from lowering your own permission level if you\u2019re the last manager", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {access: "Private"});
    await channel.access.grant(session1, session2, "Edit");

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await page.getByTestId("NavigationBar").getByRole("button", {name: "More"}).click();
    await page.getByRole("menuitem", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can post"})
        .click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can\u2019t remove everyone who can change permissions",
        }),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "remove access"}).click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can\u2019t remove everyone who can change permissions",
        }),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can\u2019t remove everyone who can change permissions",
        }),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can post"}),
    ).toBeVisible();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can post"})
        .click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can\u2019t remove everyone who can change permissions",
        }),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "can comment"}).click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can\u2019t remove everyone who can change permissions",
        }),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can\u2019t remove everyone who can change permissions",
        }),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can post"}),
    ).toBeVisible();
});

test("will send a notification when sharing with account", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        name: "Test Channel",
        access: "Private",
    });

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/inbox`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page1.getByText("Test Channel")).toBeVisible();
    await expect(page1.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("No new notifications")).toBeVisible();

    await page1.getByTestId("NavigationBar").getByLabel("More").click();
    await page1.getByRole("menuitem", {name: "Share"}).click();

    await expect(page1.getByPlaceholder("Add people")).toBeVisible();
    await expect(page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeHidden();

    await page1.getByPlaceholder("Add people").click();
    await page1.getByText(session2.account.initialName).click();
    await page1.getByRole("button", {name: "Share", exact: true}).click();

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`),
    ).toBeVisible();

    await expect(page2.getByText("Test shared a channel with you")).toBeVisible();

    await browserContext1.close();
});

test("can share a public channel with any other account in the space", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        name: "Test Channel",
        access: "Public",
    });

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/inbox`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page1.getByText("Test Channel")).toBeVisible();
    await expect(page1.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("No new notifications")).toBeVisible();

    await page1.getByLabel("Invite").click();
    await page1.getByRole("option", {name: session2.account.initialName}).click();
    await page1.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByText("Test shared a channel with you")).toBeVisible();

    await page1.getByTestId("NavigationBar").getByLabel("More").click();
    await page1.getByRole("menuitem", {name: "Share"}).click();

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`),
    ).toBeVisible();
    await expect(page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeHidden();

    await browserContext1.close();
});

test("can share a public channel with any other account in the space and upgrade their access level", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        name: "Test Channel",
        access: "Private",
    });
    await channel.access.grantDefault(session1, "View");

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/inbox`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page1.getByText("Test Channel")).toBeVisible();
    await expect(page1.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("No new notifications")).toBeVisible();

    await page1.getByLabel("Invite").click();
    await page1.getByRole("option", {name: session2.account.initialName}).click();
    await page1.getByRole("button", {name: "can view"}).click();
    await page1.getByRole("menuitem", {name: "can post"}).click();
    await page1.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByText("Test shared a channel with you")).toBeVisible();

    await page1.getByTestId("NavigationBar").getByLabel("More").click();
    await page1.getByRole("menuitem", {name: "Share"}).click();

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`),
    ).toBeVisible();
    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`),
    ).toBeVisible();

    await browserContext1.close();
});

test("can share a private channel with any other account in the space", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const channel = await TestChannel.create(session1, {
        name: "Test Channel",
        access: "Private",
    });

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/inbox`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page1.getByText("Test Channel")).toBeVisible();
    await expect(page1.getByText("Couldn\u2019t open channel")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("No new notifications")).toBeVisible();

    await page1.getByLabel("Invite").click();
    await page1.getByRole("option", {name: session2.account.initialName}).click();
    await page1.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByText("Test shared a channel with you")).toBeVisible();

    await page1.getByTestId("NavigationBar").getByLabel("More").click();
    await page1.getByRole("menuitem", {name: "Share"}).click();

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`),
    ).toBeVisible();
    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`),
    ).toBeVisible();

    await browserContext1.close();
});

test("anonymous users can view channel shared with url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {
        name: "Test Channel",
        access: "Private",
    });

    const post = await channel.createPost(session, "Test post content");
    await post.createComment(session, "Test post comment content");

    await services.signIn(browserContext2, session);
    await page2.goto(`/s/${space.id}/channels/${channel.id}`);

    const browserContext1 = await browser.newContext();
    const page1 = await browserContext1.newPage();

    await page1.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page1.getByText("Couldn\u2019t open channel")).toBeVisible();
    await expect(page1.getByText("Test Channel")).toBeHidden();

    await page2.getByTestId("NavigationBar").getByLabel("More").click();
    await page2.getByRole("menuitem", {name: "Share"}).click();

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page2
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can\u2019t access"})
        .click();
    await page2.getByRole("menuitem", {name: "can view"}).click();

    await expect(async () => {
        const preview = await getChannelPreview(space.systemAction(), channel.id);
        expect(
            preview.accessPolicy.data.type === "Local" && preview.accessPolicy.data.urlGrant?.level,
        ).toBe("View");
    }).toPass({timeout: 5000});

    // Doesn't update in realtime so keep reloading until we can see the channel.
    await expect(async () => {
        await page1.goto(`/s/${space.id}/channels/${channel.id}`);
        await expect(page1.getByText("Test Channel")).toBeVisible({timeout: 250});
    }).toPass({timeout: 5000});

    await expect(page1.getByText("Test post content")).toBeVisible();

    await page1.getByRole("button", {name: "1 comment"}).click();
    await expect(page1.getByText("Test post comment content")).toBeVisible();

    await browserContext1.close();
});

test("anonymous users can view mentions in shared channel posts and comments", async ({page}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession();

    const postMentionAccount = await space.createSession({name: "Post Mention"});
    const commentMentionAccount = await space.createSession({name: "Comment Mention"});

    const publicPostDocument = await TestDocument.create(session, {
        title: "Public post document",
    });
    await publicPostDocument.access.grantUrl(session, "View");

    const privatePostDocument = await TestDocument.create(session, {
        title: "Private post document",
    });

    const publicCommentDocument = await TestDocument.create(session, {
        title: "Public comment document",
    });
    await publicCommentDocument.access.grantUrl(session, "View");

    const privateCommentDocument = await TestDocument.create(session, {
        title: "Private comment document",
    });

    const channel = await TestChannel.create(session, {
        name: "Test Channel",
        access: "Private",
    });

    const post = await channel.createPost(
        session,
        PostContentProsemirrorSchema.node("doc", {}, [
            PostContentProsemirrorSchema.node("paragraph", {}, [
                PostContentProsemirrorSchema.text("Post mentions: "),
                PostContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: postMentionAccount.account.id,
                        isShort: false,
                    }),
                }),
                PostContentProsemirrorSchema.text(", "),
                PostContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${publicPostDocument.id}`,
                    }),
                }),
                PostContentProsemirrorSchema.text(", "),
                PostContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${privatePostDocument.id}`,
                    }),
                }),
                PostContentProsemirrorSchema.text("."),
            ]),
        ]),
    );

    await post.createComment(
        session,
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Comment mentions: "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: commentMentionAccount.account.id,
                        isShort: false,
                    }),
                }),
                MessageContentProsemirrorSchema.text(", "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${publicCommentDocument.id}`,
                    }),
                }),
                MessageContentProsemirrorSchema.text(", "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "SearchEntity",
                        entityId: `Document:${privateCommentDocument.id}`,
                    }),
                }),
                MessageContentProsemirrorSchema.text("."),
            ]),
        ]),
    );

    await channel.access.grantUrl(session, "View");

    await expect(async () => {
        const preview = await getChannelPreview(space.systemAction(), channel.id);
        expect(
            preview.accessPolicy.data.type === "Local" && preview.accessPolicy.data.urlGrant?.level,
        ).toBe("View");
    }).toPass({timeout: 5000});

    await page.goto(`/s/${space.id}/channels/${channel.id}`);

    await expect(page.getByText("Test Channel")).toBeVisible();
    await expect(page.getByText("Post mentions:")).toBeVisible();

    const mentions = page.getByTestId("ContentMentionText");

    await expect(mentions.filter({hasText: "Post Mention"})).toBeVisible();
    await expect(mentions.filter({hasText: "Public post document"})).toBeVisible();

    await page.getByRole("button", {name: "1 comment"}).click();

    await expect(page.getByText("Comment mentions:")).toBeVisible();
    await expect(mentions.filter({hasText: "Comment Mention"})).toBeVisible();
    await expect(mentions.filter({hasText: "Public comment document"})).toBeVisible();
    await expect(mentions.filter({hasText: "Private document"})).toHaveCount(2);
});

test("anonymous users can open channel files page with post and comment files", async ({page}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession();

    const channel = await TestChannel.create(session, {
        name: "Test Channel",
        access: "Private",
    });

    const postFile = await TestFile.create(session);
    const commentFile = await TestFile.create(session);

    const post = await channel.createPost(session, {
        files: [postFile],
    });

    await commentFile.attach(
        session,
        FilePostAuthorizer.bind({type: "PostComments", postId: post.id}),
    );

    await post.createComment(session, "Comment with file", {
        files: [commentFile],
    });

    await channel.access.grantUrl(session, "View");

    await page.goto(`/s/${space.id}/channels/${channel.id}/files`);

    await expect(page.getByTestId("ContentFilePreview:image/png")).toHaveCount(1);
});

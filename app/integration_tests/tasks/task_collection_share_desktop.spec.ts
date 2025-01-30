import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {removeSpaceAccountAsAdmin} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTask} from "~/server/tasks/test_helpers/test_task.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {allAccessLevels, hasAccessLevel} from "~/shared/access/access_policy.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TaskNotesContentProsemirrorSchema} from "~/shared/tasks/task_notes_content_schema.js";

const {context, services} = createTestServices();

test("can toggle task collection sharing on/off with switch", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection = await TestTaskCollection.create(session1, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session1, {title: "Test Task 1"});
    const task2 = await TestTask.create(session1, {title: "Test Task 2"});
    const task3 = await TestTask.create(session1, {title: "Test Task 3"});

    await task1.addCollection(session1, collection);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session1, collection);

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expect(page1.getByRole("heading", {name: "Test Collection"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page1.getByText("Couldn’t open tasks")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn’t open tasks")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await page1.getByRole("button", {name: "Toggle sharing"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with everyone in Test Space",
    );

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open tasks")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with everyone in Test Space",
    );

    await page1.getByRole("button", {name: "Toggle sharing"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page2.getByText("Couldn’t open tasks")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await browserContext1.close();
});

test("can toggle task collection sharing on/off with share dialog default grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection = await TestTaskCollection.create(session1, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session1, {title: "Test Task 1"});
    const task2 = await TestTask.create(session1, {title: "Test Task 2"});
    const task3 = await TestTask.create(session1, {title: "Test Task 3"});

    await task1.addCollection(session1, collection);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session1, collection);

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expect(page1.getByRole("heading", {name: "Test Collection"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page1.getByText("Couldn’t open tasks")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn’t open tasks")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeHidden();

    await page1.getByRole("button", {name: "Share"}).click();

    await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();

    await page1
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await page1.getByRole("menuitem", {name: "can edit"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with everyone in Test Space",
    );

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open tasks")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with everyone in Test Space",
    );

    await page1
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with everyone in Test Space",
    );

    await page1.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page2.getByText("Couldn’t open tasks")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await browserContext1.close();
});

test("can toggle task collection sharing on/off with share dialog url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection = await TestTaskCollection.create(session1, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session1, {title: "Test Task 1"});
    const task2 = await TestTask.create(session1, {title: "Test Task 2"});
    const task3 = await TestTask.create(session1, {title: "Test Task 3"});

    await task1.addCollection(session1, collection);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session1, collection);

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expect(page1.getByRole("heading", {name: "Test Collection"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page1.getByText("Couldn’t open tasks")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn’t open tasks")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page1.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

    await page1.getByRole("button", {name: "Share"}).click();

    await expect(page1.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page1
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await page1.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with anyone with the link",
    );

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open tasks")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with anyone with the link",
    );

    await page1.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with anyone with the link",
    );

    await page1.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page2.getByText("Couldn’t open tasks")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await browserContext1.close();
});

test("can toggle task collection sharing on/off with share dialog account grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection = await TestTaskCollection.create(session1, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session1, {title: "Test Task 1"});
    const task2 = await TestTask.create(session1, {title: "Test Task 2"});
    const task3 = await TestTask.create(session1, {title: "Test Task 3"});

    await task1.addCollection(session1, collection);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session1, collection);

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expect(page1.getByRole("heading", {name: "Test Collection"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page1.getByText("Couldn’t open tasks")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn’t open tasks")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page1.getByPlaceholder("Add people")).toBeHidden();

    await page1.getByRole("button", {name: "Share"}).click();

    await expect(page1.getByPlaceholder("Add people")).toBeVisible();

    await expect(page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeHidden();

    await page1.getByPlaceholder("Add people").click();
    await page1.getByText(session2.account.initialName).click();
    await page1.getByRole("button", {name: "Add", exact: true}).click();

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`),
    ).toBeVisible();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open tasks")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await page1
        .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`),
    ).toBeVisible();

    await page1.getByRole("menuitem", {name: "remove access"}).click();

    await expect(page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeHidden();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page2.getByText("Couldn’t open tasks")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await browserContext1.close();
});

for (const accessLevel of [...allAccessLevels].reverse()) {
    test(`can interact with task collection with access level "${accessLevel}"`, async ({
        context: browserContext,
        page,
        viewport,
    }) => {
        assert(viewport);

        const space = await TestSpace.create(context, {name: "Test Space"});
        const [session1, session2] = await space.createSessions(2);

        const collection = await TestTaskCollection.create(session1, {
            name: "Test Collection",
        });

        const task1 = await TestTask.create(session1, {title: "Test Task 1"});
        const task2 = await TestTask.create(session1, {title: "Test Task 2"});
        const task3 = await TestTask.create(session1, {title: "Test Task 3"});

        await task1.addCollection(session1, collection);
        await task2.addCollection(session1, collection);
        await task3.addCollection(session1, collection);

        await task1.createComment(session1, "Test task comment");

        await collection.access.grant(session1, session2, accessLevel);

        await services.signIn(browserContext, session2);
        await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

        await expect(page.getByRole("heading", {name: "Test Collection"})).toBeVisible();
        await expect(
            page
                .getByTestId(/^TaskRowView:/)
                .last()
                .getByRole("textbox", {name: "Title"}),
        ).toBeVisible();

        await page
            .getByTestId(/^TaskRowView:/)
            .last()
            .getByRole("textbox", {name: "Title"})
            .click();

        await expect(
            page
                .getByTestId(/^TaskRowView:/)
                .getByRole("textbox", {name: "Title"})
                .getByText("abc"),
        ).toBeHidden();
        await page
            .getByTestId(/^TaskRowView:/)
            .last()
            .getByRole("textbox", {name: "Title"})
            .pressSequentially("abc");
        if (hasAccessLevel(accessLevel, "Edit")) {
            await expect(
                page
                    .getByTestId(/^TaskRowView:/)
                    .getByRole("textbox", {name: "Title"})
                    .getByText("abc"),
            ).toBeVisible();
        } else {
            await expect(
                page
                    .getByTestId(/^TaskRowView:/)
                    .getByRole("textbox", {name: "Title"})
                    .getByText("abc"),
            ).toBeHidden();
        }

        await page.getByRole("button", {name: "Share"}).click();

        await expect(
            page
                .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
                .getByText("can edit", {exact: true}),
        ).toBeVisible();
        await expect(
            page.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`).getByText(
                {
                    Manage: "can edit",
                    Edit: "can edit (can’t share)",
                    Comment: "can comment",
                    View: "can view",
                }[accessLevel],
                {exact: true},
            ),
        ).toBeVisible();
        await expect(
            page.getByTestId("ShareOverlayDefaultGrant").getByText("can’t access", {exact: true}),
        ).toBeVisible();
        await expect(
            page.getByTestId("ShareOverlayUrlGrant").getByText("can’t access", {exact: true}),
        ).toBeVisible();

        if (hasAccessLevel(accessLevel, "Manage")) {
            await expect(
                page
                    .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
                    .getByRole("button", {name: "can edit"}),
            ).toBeVisible();
            await expect(
                page
                    .getByTestId("ShareOverlayDefaultGrant")
                    .getByRole("button", {name: "can’t access"}),
            ).toBeVisible();
            await expect(
                page
                    .getByTestId("ShareOverlayUrlGrant")
                    .getByRole("button", {name: "can’t access"}),
            ).toBeVisible();

            await expect(page.getByPlaceholder("Add people")).toBeVisible();
        } else {
            await expect(
                page
                    .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
                    .getByRole("button", {name: "can edit"}),
            ).toBeHidden();
            await expect(
                page
                    .getByTestId("ShareOverlayDefaultGrant")
                    .getByRole("button", {name: "can’t access"}),
            ).toBeHidden();
            await expect(
                page
                    .getByTestId("ShareOverlayUrlGrant")
                    .getByRole("button", {name: "can’t access"}),
            ).toBeHidden();

            await expect(page.getByPlaceholder("Add people")).toBeHidden();
        }

        await page.keyboard.press("Escape");

        await expect(page.getByTestId("PeekStack")).toBeHidden();

        await page
            .getByTestId(/^TaskRowView:/)
            .first()
            .getByRole("button", {name: "Open"})
            .first()
            .click();

        await expect(page.getByTestId("PeekStack")).toBeVisible();

        if (hasAccessLevel(accessLevel, "Edit")) {
            await expect(page.getByTestId("PeekStack").getByLabel("Collections")).toBeVisible();
        } else {
            await expect(page.getByTestId("PeekStack").getByLabel("Collections")).toBeHidden();
        }

        await page.getByTestId("PeekStackOverlay").getByLabel("More").click();

        if (hasAccessLevel(accessLevel, "Comment")) {
            await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeVisible();

            if (hasAccessLevel(accessLevel, "Edit")) {
                await expect(page.getByRole("menuitem", {name: "Mark closed"})).toBeVisible();
            } else {
                await expect(page.getByRole("menuitem", {name: "Mark closed"})).toBeHidden();
            }

            await expect(page.getByRole("textbox", {name: "New comment"})).toBeHidden();
            await expect(page.getByText("Test task comment")).toBeHidden();

            await page.getByRole("menuitem", {name: "Comments"}).click();

            await expect(page.getByRole("textbox", {name: "New comment"})).toBeVisible();
            await expect(page.getByText("Test task comment")).toBeVisible();
        } else {
            await expect(page.getByRole("menuitem", {name: "Copy link"})).toBeVisible();
            await expect(page.getByRole("menuitem", {name: "Mark closed"})).toBeHidden();
            await expect(page.getByRole("menuitem", {name: "Comments"})).toBeHidden();

            await page.keyboard.press("Escape");
        }

        await page.getByRole("button", {name: "Close"}).click();

        if (hasAccessLevel(accessLevel, "Edit")) {
            await expect(
                page
                    .getByTestId(/^TaskRowView:/)
                    .getByRole("textbox", {name: "Title"})
                    .getByText("abc"),
            ).toBeVisible();
        } else {
            await expect(
                page
                    .getByTestId(/^TaskRowView:/)
                    .getByRole("textbox", {name: "Title"})
                    .getByText("abc"),
            ).toBeHidden();
        }
    });
}

test("can comment on task with comment only access", async ({
    context: browserContext,
    page,
    viewport,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection = await TestTaskCollection.create(session1, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session1, {title: "Test Task 1"});
    const task2 = await TestTask.create(session1, {title: "Test Task 2"});
    const task3 = await TestTask.create(session1, {title: "Test Task 3"});

    await task1.addCollection(session1, collection);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session1, collection);

    await collection.access.grant(session1, session2, "Comment");

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expect(page.getByRole("heading", {name: "Test Collection"})).toBeVisible();

    await page
        .getByTestId(/^TaskRowView:/)
        .first()
        .getByRole("button", {name: "Open"})
        .first()
        .click();

    await page.getByTestId("PeekStackOverlay").getByLabel("More").click();

    await page.getByRole("menuitem", {name: "Comment"}).click();

    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await page.getByRole("textbox", {name: "New comment"}).fill("Test task comment");

    await expect(page.getByRole("button", {name: "Send comment"})).toBeEnabled();
    await page.getByRole("button", {name: "Send comment"}).click();
    await expect(page.getByRole("button", {name: "Send comment"})).toBeDisabled();

    await expect(page.getByTestId(/^MessageView:/).getByText("Test task comment")).toBeVisible();
});

test("can switch other account access level between comment and view in realtime", async ({
    browser,
    context: browserContext2a,
    page: page2a,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection = await TestTaskCollection.create(session2, {
        name: "Test Collection",
    });

    const task = await TestTask.create(session2, {title: "Test Task 1"});
    await task.addCollection(session2, collection);
    await task.createComment(session2, "Test task comment");

    await collection.access.grant(session2, session1, "Comment");

    await services.signIn(browserContext2a, session2);
    await page2a.goto(`/s/${space.id}/tasks/${task.id}?comments=show`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/tasks/${task.id}?comments=show`);

    const browserContext2b = await browser.newContext();
    await services.signIn(browserContext2b, session2);
    const page2b = await browserContext2b.newPage();
    await page2b.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible();
    await expect(page2a.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible();
    await expect(page1.getByText("Test task comment")).toBeVisible();
    await expect(page2a.getByText("Test task comment")).toBeVisible();

    await page2b.getByRole("button", {name: "Share"}).click();

    await page2b
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can comment"})
        .click();

    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible();
    await expect(page2a.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible();
    await expect(page1.getByText("Test task comment")).toBeVisible();
    await expect(page2a.getByText("Test task comment")).toBeVisible();

    await page2b.getByRole("menuitem", {name: "can view"}).click();

    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible();
    await expect(page2a.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible();
    await expect(page1.getByText("Test task comment")).toBeHidden();
    await expect(page2a.getByText("Test task comment")).toBeVisible();

    await page1.getByRole("button", {name: "More"}).click();
    await expect(page1.getByRole("menuitem", {name: "Copy link"})).toBeVisible();
    await expect(page1.getByRole("menuitem", {name: "Comments"})).toBeHidden();
    await page1.keyboard.press("Escape");

    // TODO(calebmer, 2025-01-29): If we don't reload then React doesn't re-render
    // the component when switching back from view access level to comment access
    // level even though the store is updating. I think this is a React bug.
    await page1.reload();

    await page1.getByRole("button", {name: "More"}).click();
    await expect(page1.getByRole("menuitem", {name: "Copy link"})).toBeVisible();
    await expect(page1.getByRole("menuitem", {name: "Comments"})).toBeHidden();
    await page1.keyboard.press("Escape");

    await page2b
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can view"})
        .click();

    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible();
    await expect(page2a.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible();
    await expect(page1.getByText("Test task comment")).toBeHidden();
    await expect(page2a.getByText("Test task comment")).toBeVisible();

    await page2b.getByRole("menuitem", {name: "can comment"}).click();

    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible();
    await expect(page2a.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible();
    await expect(page1.getByText("Test task comment")).toBeHidden();
    await expect(page2a.getByText("Test task comment")).toBeVisible();

    await page1.getByRole("button", {name: "More"}).click();
    await expect(page1.getByRole("menuitem", {name: "Copy link"})).toBeVisible();
    await expect(page1.getByRole("menuitem", {name: "Comments"})).toBeVisible();
    await page1.getByRole("menuitem", {name: "Comments"}).click();

    await expect(page1.getByText("Test task comment")).toBeVisible();
    await expect(page2a.getByText("Test task comment")).toBeVisible();

    await browserContext1.close();
    await browserContext2b.close();
});

test("anonymous accounts can see task collection shared with url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
    viewport,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession();
    const mentionSession = await space.createSession({name: "Sara Smith"});

    const collection = await TestTaskCollection.create(session, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session, {title: "Test Task 1"});
    const task2 = await TestTask.create(session, {title: "Test Task 2"});
    const task3 = await TestTask.create(session, {title: "Test Task 3"});

    await task1.addCollection(session, collection);
    await task2.addCollection(session, collection);
    await task3.addCollection(session, collection);

    await task1.typeNotes(session, "Hello, ");
    await task1.typeNotes(session, "world");
    await task1.typeNotes(session, "!");

    await task1.typeNotes(session, " Hello, ");
    await task1.typeNotes(
        session,
        TaskNotesContentProsemirrorSchema.node("mention", {
            mention: {accountId: mentionSession.account.id, isShort: true},
        }),
    );
    await task1.typeNotes(session, "!");

    await task1.createComment(session, "Test task comment");

    const file = await TestFile.create(session);
    await task1.attachFile(session, file);

    await services.signIn(browserContext2, session);
    await page2.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    const browserContext1 = await browser.newContext();
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/tasks/${task1.id}`);

    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open task")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await page2
        .getByTestId(/^TaskRowView:/)
        .getByRole("button", {name: "Open"})
        .first()
        .click();

    await expect(page2.getByLabel("Notes")).toHaveText("Hello, world! Hello, @Sara!");
    await expect(
        page2.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await page2.getByTestId("PeekStackOverlay").getByRole("button", {name: "Close"}).click();

    await expect(page1.getByText("Couldn’t open task")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You aren’t signed in")).toBeVisible();
    await expect(page1.getByText("You don’t have access to this space")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this task")).toBeHidden();
    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toBeHidden();
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(page1.getByLabel("Notes").locator("[data-comment]")).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

    await page2.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page2
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await page2.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with anyone with the link",
    );

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();
    await expect(page1.getByText("Couldn’t open task")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toHaveText("Hello, world! Hello, @Sara!");
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await page2.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();

    await page2.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByText("Couldn’t open task")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You aren’t signed in")).toBeVisible();
    await expect(page1.getByText("You don’t have access to this space")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this task")).toBeHidden();
    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toBeHidden();
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(page1.getByLabel("Notes").locator("[data-comment]")).toBeHidden();

    await browserContext1.close();
});

test("accounts from another space can see task collection shared with url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession();
    const mentionSession = await space.createSession({name: "Sara Smith"});
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const collection = await TestTaskCollection.create(session, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session, {title: "Test Task 1"});
    const task2 = await TestTask.create(session, {title: "Test Task 2"});
    const task3 = await TestTask.create(session, {title: "Test Task 3"});

    await task1.addCollection(session, collection);
    await task2.addCollection(session, collection);
    await task3.addCollection(session, collection);

    await task1.typeNotes(session, "Hello, ");
    await task1.typeNotes(session, "world");
    await task1.typeNotes(session, "!");

    await task1.typeNotes(session, " Hello, ");
    await task1.typeNotes(
        session,
        TaskNotesContentProsemirrorSchema.node("mention", {
            mention: {accountId: mentionSession.account.id, isShort: true},
        }),
    );
    await task1.typeNotes(session, "!");

    await task1.createComment(session, "Test task comment");

    const file = await TestFile.create(session);
    await task1.attachFile(session, file);

    await services.signIn(browserContext2, session);
    await page2.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    const browserContext1 = await browser.newContext();
    const page1 = await browserContext1.newPage();
    await services.signIn(browserContext1, otherSession);
    await page1.goto(`/s/${space.id}/tasks/${task1.id}`);

    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open task")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await page2
        .getByTestId(/^TaskRowView:/)
        .getByRole("button", {name: "Open"})
        .first()
        .click();

    await expect(page2.getByLabel("Notes")).toHaveText("Hello, world! Hello, @Sara!");
    await expect(
        page2.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await page2.getByTestId("PeekStackOverlay").getByRole("button", {name: "Close"}).click();

    await expect(page1.getByText("Couldn’t open task")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this task")).toBeHidden();
    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toBeHidden();
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(page1.getByLabel("Notes").locator("[data-comment]")).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

    await page2.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page2
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await page2.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with anyone with the link",
    );

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();
    await expect(page1.getByText("Couldn’t open task")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toHaveText("Hello, world! Hello, @Sara!");
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await page2.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();

    await page2.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByText("Couldn’t open task")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this task")).toBeHidden();
    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toBeHidden();
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(page1.getByLabel("Notes").locator("[data-comment]")).toBeHidden();

    await browserContext1.close();
});

test("accounts from same space can see task collection shared with url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session, otherSession] = await space.createSessions(2);
    const mentionSession = await space.createSession({name: "Sara Smith"});

    const collection = await TestTaskCollection.create(session, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session, {title: "Test Task 1"});
    const task2 = await TestTask.create(session, {title: "Test Task 2"});
    const task3 = await TestTask.create(session, {title: "Test Task 3"});

    await task1.addCollection(session, collection);
    await task2.addCollection(session, collection);
    await task3.addCollection(session, collection);

    await task1.typeNotes(session, "Hello, ");
    await task1.typeNotes(session, "world");
    await task1.typeNotes(session, "!");

    await task1.typeNotes(session, " Hello, ");
    await task1.typeNotes(
        session,
        TaskNotesContentProsemirrorSchema.node("mention", {
            mention: {accountId: mentionSession.account.id, isShort: true},
        }),
    );
    await task1.typeNotes(session, "!");

    await task1.createComment(session, "Test task comment");

    const file = await TestFile.create(session);
    await task1.attachFile(session, file);

    await services.signIn(browserContext2, session);
    await page2.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    const browserContext1 = await browser.newContext();
    const page1 = await browserContext1.newPage();
    await services.signIn(browserContext1, otherSession);
    await page1.goto(`/s/${space.id}/tasks/${task1.id}`);

    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open task")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await page2
        .getByTestId(/^TaskRowView:/)
        .getByRole("button", {name: "Open"})
        .first()
        .click();

    await expect(page2.getByLabel("Notes")).toHaveText("Hello, world! Hello, @Sara!");
    await expect(
        page2.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await page2.getByTestId("PeekStackOverlay").getByRole("button", {name: "Close"}).click();

    await expect(page1.getByText("Couldn’t open task")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this task")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeHidden();
    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toBeHidden();
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(page1.getByLabel("Notes").locator("[data-comment]")).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

    await page2.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page2
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await page2.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with anyone with the link",
    );

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByText("Couldn’t open task")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toHaveText("Hello, world! Hello, @Sara!");
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await page2.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();

    await page2.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByText("Couldn’t open task")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this task")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeHidden();
    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toBeHidden();
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(page1.getByLabel("Notes").locator("[data-comment]")).toBeHidden();

    await browserContext1.close();
});

test("account that used to be a member of space but was removed can see task collection shared with url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession({hasInternalAccess: true});
    const mentionSession = await space.createSession({name: "Sara Smith"});
    const otherSession = await space.createSession();

    await removeSpaceAccountAsAdmin(session.action(), {
        spaceId: space.id,
        accountId: otherSession.account.id,
    });

    const collection = await TestTaskCollection.create(session, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session, {title: "Test Task 1"});
    const task2 = await TestTask.create(session, {title: "Test Task 2"});
    const task3 = await TestTask.create(session, {title: "Test Task 3"});

    await task1.addCollection(session, collection);
    await task2.addCollection(session, collection);
    await task3.addCollection(session, collection);

    await task1.typeNotes(session, "Hello, ");
    await task1.typeNotes(session, "world");
    await task1.typeNotes(session, "!");

    await task1.typeNotes(session, " Hello, ");
    await task1.typeNotes(
        session,
        TaskNotesContentProsemirrorSchema.node("mention", {
            mention: {accountId: mentionSession.account.id, isShort: true},
        }),
    );
    await task1.typeNotes(session, "!");

    await task1.createComment(session, "Test task comment");

    const file = await TestFile.create(session);
    await task1.attachFile(session, file);

    await services.signIn(browserContext2, session);
    await page2.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    const browserContext1 = await browser.newContext();
    const page1 = await browserContext1.newPage();
    await services.signIn(browserContext1, otherSession);
    await page1.goto(`/s/${space.id}/tasks/${task1.id}`);

    await expect(page2.getByRole("heading", {name: "Test Collection"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open task")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await page2
        .getByTestId(/^TaskRowView:/)
        .getByRole("button", {name: "Open"})
        .first()
        .click();

    await expect(page2.getByLabel("Notes")).toHaveText("Hello, world! Hello, @Sara!");
    await expect(
        page2.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await page2.getByTestId("PeekStackOverlay").getByRole("button", {name: "Close"}).click();

    await expect(page1.getByText("Couldn’t open task")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this task")).toBeHidden();
    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toBeHidden();
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(page1.getByLabel("Notes").locator("[data-comment]")).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

    await page2.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page2
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    await page2.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the task collection is shared with anyone with the link",
    );

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();
    await expect(page1.getByText("Couldn’t open task")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toHaveText("Hello, world! Hello, @Sara!");
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();

    await page2.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();

    await page2.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the task collection is private");

    // Doesn't update in realtime so keep reloading until we can see the collection.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByText("Couldn’t open task")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this task")).toBeHidden();
    await expect(page1.getByTestId("TaskDetailViewMain").getByLabel("Title")).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByLabel("Notes")).toBeHidden();
    await expect(
        page1.getByLabel("Notes").getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(page1.getByLabel("Notes").locator("[data-comment]")).toBeHidden();

    await browserContext1.close();
});

test("can't change permission level of account who invited you", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection = await TestTaskCollection.create(session1, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session1, {title: "Test Task 1"});
    const task2 = await TestTask.create(session1, {title: "Test Task 2"});
    const task3 = await TestTask.create(session1, {title: "Test Task 3"});

    await task1.addCollection(session1, collection);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session1, collection);

    await collection.access.grant(session1, session2);

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await page.getByRole("button", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "remove access"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can edit"}),
    ).toBeVisible();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "can comment"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can edit"}),
    ).toBeVisible();
});

test("can't change permission level of account who invited the account who invited you", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2, session3] = await space.createSessions(3);

    const collection = await TestTaskCollection.create(session1, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session1, {title: "Test Task 1"});
    const task2 = await TestTask.create(session1, {title: "Test Task 2"});
    const task3 = await TestTask.create(session1, {title: "Test Task 3"});

    await task1.addCollection(session1, collection);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session1, collection);

    await collection.access.grant(session1, session2);
    await collection.access.grant(session2, session3);

    await services.signIn(browserContext, session3);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await page.getByRole("button", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "remove access"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can edit"}),
    ).toBeVisible();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "can comment"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t change Test’s permissions"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can edit"}),
    ).toBeVisible();
});

test("will be warned before lowering your own permission level", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection = await TestTaskCollection.create(session1, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session1, {title: "Test Task 1"});
    const task2 = await TestTask.create(session1, {title: "Test Task 2"});
    const task3 = await TestTask.create(session1, {title: "Test Task 3"});

    await task1.addCollection(session1, collection);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session1, collection);

    await collection.access.grant(session1, session2);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await page.getByRole("button", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can edit"})
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
            .getByRole("button", {name: "can edit"}),
    ).toBeVisible();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "remove access"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeVisible();

    await expect(page.getByRole("heading", {name: "Test Collection"})).toBeVisible();
    await expect(page.getByText("Couldn’t open tasks")).toBeHidden();
    await expect(page.getByRole("img", {name: "Error icon"})).toBeHidden();

    await page.getByRole("button", {name: "I understand, make this change"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeHidden();

    await expect(page.getByRole("heading", {name: "Test Collection"})).toBeHidden();
    await expect(page.getByText("Couldn’t open tasks")).toBeVisible();
    await expect(page.getByRole("img", {name: "Error icon"})).toBeHidden();
});

test("will be prevented from lowering your own permission level if you're the last manager", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const collection = await TestTaskCollection.create(session1, {
        name: "Test Collection",
    });

    const task1 = await TestTask.create(session1, {title: "Test Task 1"});
    const task2 = await TestTask.create(session1, {title: "Test Task 2"});
    const task3 = await TestTask.create(session1, {title: "Test Task 3"});

    await task1.addCollection(session1, collection);
    await task2.addCollection(session1, collection);
    await task3.addCollection(session1, collection);

    await collection.access.grant(session1, session2, "Edit");

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/tasks/collections/${collection.id}`);

    await page.getByRole("button", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t remove everyone who can change permissions"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "remove access"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t remove everyone who can change permissions"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t remove everyone who can change permissions"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can edit"}),
    ).toBeVisible();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t remove everyone who can change permissions"}),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "can comment"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t remove everyone who can change permissions"}),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Can’t remove everyone who can change permissions"}),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can edit"}),
    ).toBeVisible();
});

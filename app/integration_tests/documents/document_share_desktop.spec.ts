import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {removeSpaceAccount} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {allAccessLevels, hasAccessLevel} from "~/shared/access/access_policy.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {DocumentContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";

const {context, services} = createTestServices();

const mentionText = "SS\u00A0\u00A0\u202FSara";

test("can toggle document sharing on/off with switch", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {title: "Test Document"});

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page1.getByText("Couldn’t open document")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn’t open document")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await page1.getByRole("button", {name: "Toggle sharing"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with everyone in Test Space",
    );

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open document")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with everyone in Test Space",
    );

    await expect(page1.getByRole("heading", {name: "Make this document private"})).toBeHidden();

    await page1.getByRole("button", {name: "Toggle sharing"}).click();

    await expect(page1.getByRole("heading", {name: "Make this document private"})).toBeVisible();

    await page1.getByRole("button", {name: "Confirm"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(page2.getByText("Couldn’t open document")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await browserContext1.close();
});

test("can toggle document sharing on/off with share dialog default grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {title: "Test Document"});

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page1.getByText("Couldn’t open document")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn’t open document")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeHidden();

    await page1.getByRole("button", {name: "Share"}).click();

    await expect(page1.getByTestId("ShareOverlayDefaultGrant")).toBeVisible();

    await page1
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await page1.getByRole("menuitem", {name: "can edit"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with everyone in Test Space",
    );

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open document")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with everyone in Test Space",
    );

    await page1
        .getByTestId("ShareOverlayDefaultGrant")
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with everyone in Test Space",
    );

    await page1.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(page2.getByText("Couldn’t open document")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await browserContext1.close();
});

test("can toggle document sharing on/off with share dialog url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {title: "Test Document"});

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page1.getByText("Couldn’t open document")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn’t open document")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(page1.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

    await page1.getByRole("button", {name: "Share"}).click();

    await expect(page1.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page1
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await page1.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with anyone with the link",
    );

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open document")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with anyone with the link",
    );

    await page1.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with anyone with the link",
    );

    await page1.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(page2.getByText("Couldn’t open document")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await browserContext1.close();
});

test("can toggle document sharing on/off with share dialog account grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {title: "Test Document"});

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page1.getByText("Couldn’t open document")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("Couldn’t open document")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(page1.getByPlaceholder("Add people")).toBeHidden();

    await page1.getByRole("button", {name: "Share"}).click();

    await expect(page1.getByPlaceholder("Add people")).toBeVisible();

    await expect(page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeHidden();

    await page1.getByPlaceholder("Add people").click();
    await page1.getByText(session2.account.initialName).click();
    await page1.getByRole("button", {name: "Share", exact: true}).click();

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`),
    ).toBeVisible();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page2.reload();
        await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open document")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

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
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(page2.getByText("Couldn’t open document")).toBeVisible();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeHidden();

    await browserContext1.close();
});

for (const accessLevel of [...allAccessLevels].reverse()) {
    test(`can interact with document with access level \`${accessLevel}\``, async ({
        context: browserContext,
        page,
        viewport,
    }) => {
        assert(viewport);

        const space = await TestSpace.create(context, {name: "Test Space"});
        const [session1, session2] = await space.createSessions(2);

        const document = await TestDocument.create(session1, {title: "Test Document"});
        await document.access.grant(session1, session2, accessLevel);

        await document.type(session1, "Lorem ipsum ");
        const {range} = await document.type(session1, "dolor");
        await document.type(session1, " sit amet.");

        await document.createCommentThread(session1, range, "Test document comment");

        await services.signIn(browserContext, session2);
        await page.goto(`/s/${space.id}/documents/${document.id}`);

        await expect(page.getByRole("heading", {name: "Test Document"})).toBeVisible();
        await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

        await page.waitForFunction("dev.contentEditor");

        await page
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});

        await expect(page.getByRole("textbox", {name: "Document"}).getByText("abc")).toBeHidden();
        await page.getByRole("textbox", {name: "Document"}).pressSequentially("abc");
        if (hasAccessLevel(accessLevel, "Edit")) {
            await expect(
                page.getByRole("textbox", {name: "Document"}).getByText("abc"),
            ).toBeVisible();
        } else {
            await expect(
                page.getByRole("textbox", {name: "Document"}).getByText("abc"),
            ).toBeHidden();
        }

        await page.evaluate("dev.contentEditor.setTextSelection(22, 27)");

        // Moving the mouse should open the styling toolbar.
        await page.mouse.move(0, 0);

        if (hasAccessLevel(accessLevel, "Edit")) {
            await expect(page.getByLabel("Comment")).toBeVisible();
            await expect(page.getByLabel("Bold")).toBeVisible();
            await expect(page.getByLabel("Bullet list")).toBeVisible();
        } else if (hasAccessLevel(accessLevel, "Comment")) {
            await expect(page.getByLabel("Comment")).toBeVisible();
            await expect(page.getByLabel("Bold")).toBeHidden();
            await expect(page.getByLabel("Bullet list")).toBeHidden();
        } else {
            await expect(page.getByLabel("Comment")).toBeHidden();
            await expect(page.getByLabel("Bold")).toBeHidden();
            await expect(page.getByLabel("Bullet list")).toBeHidden();
        }

        if (!hasAccessLevel(accessLevel, "Comment")) {
            await expect(
                page.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
            ).toBeHidden();
        } else {
            await expect(
                page.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
            ).toBeVisible();

            await expect(page.getByRole("button", {name: "Close"})).toBeHidden();
            await expect(page.getByText("Test document comment")).toBeHidden();

            await page.getByRole("textbox", {name: "Document"}).locator("[data-comment]").click();

            await expect(page.getByRole("button", {name: "Close"})).toBeVisible();
            await expect(page.getByText("Test document comment")).toBeVisible();

            await page.getByRole("button", {name: "Close"}).click();
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

        if (hasAccessLevel(accessLevel, "Edit")) {
            await expect(
                page.getByRole("textbox", {name: "Document"}).getByText("abc"),
            ).toBeVisible();
        } else {
            await expect(
                page.getByRole("textbox", {name: "Document"}).getByText("abc"),
            ).toBeHidden();
        }
    });
}

test("can comment on document with comment only access", async ({
    context: browserContext,
    page,
    viewport,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {title: "Test Document"});
    await document.access.grant(session1, session2, "Comment");

    await document.type(session1, "Lorem ipsum dolor sit amet.");

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    await page.waitForFunction("dev.contentEditor");

    await page
        .getByRole("textbox", {name: "Document"})
        .click({position: {x: viewport.width / 2, y: viewport.height - 100}});

    await page.evaluate("dev.contentEditor.setTextSelection(22, 27)");

    // Moving the mouse should open the styling toolbar.
    await page.mouse.move(0, 0);

    await expect(page.getByLabel("Comment")).toBeVisible();
    await expect(page.getByLabel("Bold")).toBeHidden();
    await expect(page.getByLabel("Bullet list")).toBeHidden();

    await page.getByLabel("Comment").click();

    await page
        .getByTestId("ContentEditorCommentInputFloater")
        .getByRole("textbox", {name: "New comment"})
        .fill("Test document comment");

    await expect(
        page.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await page.getByRole("button", {name: "Save comment"}).click();

    await expect(
        page.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await page.getByRole("textbox", {name: "Document"}).locator("[data-comment]").click();

    await expect(page.getByRole("button", {name: "Close"})).toBeVisible();
    await expect(page.getByText("Test document comment")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();
});

test("can switch other account access level between comment and view in realtime", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session2, {title: "Test Document"});
    await document.access.grant(session2, session1, "Comment");

    await document.type(session2, "Hello, ");
    const {range} = await document.type(session2, "world");
    await document.type(session2, "!");

    await document.createCommentThread(session2, range);

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();
    await expect(
        page2.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await page2.getByRole("button", {name: "Share"}).click();

    await page2
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can comment"})
        .click();

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();
    await expect(
        page2.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await page2.getByRole("menuitem", {name: "can view"}).click();

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();
    await expect(
        page2.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await page2
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can view"})
        .click();

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();
    await expect(
        page2.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await page2.getByRole("menuitem", {name: "can comment"}).click();

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();
    await expect(
        page2.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await browserContext1.close();
});

test("can switch own account access level between manage and view in realtime", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {title: "Test Document"});
    await document.access.grant(session1, session2, "Manage");

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    await document.createCommentThread(session1, range);

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(
        page.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await page.getByRole("button", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(page.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(
        page.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await page.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeVisible();

    await expect(page.getByPlaceholder("Add people")).toBeVisible();
    await expect(page.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeVisible();

    await expect(page.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(
        page.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await page.getByRole("button", {name: "I understand, make this change"}).click();

    await expect(page.getByPlaceholder("Add people")).toBeHidden();
    await expect(page.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeVisible();

    await expect(page.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(
        page.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();
});

test("anonymous accounts can see document shared with url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
    viewport,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession();
    const mentionSession = await space.createSession({name: "Sara Smith"});

    const document = await TestDocument.create(session, {title: "Test Document"});

    await document.type(session, "Hello, ");
    const {range} = await document.type(session, "world");
    await document.type(session, "!");

    await document.createCommentThread(session, range);

    await document.type(session, " Hello, ");
    await document.type(
        session,
        DocumentContentProsemirrorSchema.node("mention", {
            mention: cast<ContentMention>({
                type: "Account",
                accountId: mentionSession.account.id,
                isShort: true,
            }),
        }),
    );
    await document.type(session, "!");

    const file = await TestFile.create(session);
    await document.attachFile(session, file);

    await services.signIn(browserContext2, session);
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext1 = await browser.newContext();
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open document")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        `Test DocumentHello, world! Hello, ${mentionText}!`,
    );
    await expect(
        page2.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page2.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await expect(page1.getByText("Couldn’t open document")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You aren’t signed in")).toBeVisible();
    await expect(page1.getByText("You don’t have access to this space")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this document")).toBeHidden();
    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

    await page2.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page2
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await page2.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with anyone with the link",
    );

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();
    await expect(page1.getByText("Couldn’t open document")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        `Test DocumentHello, world! Hello, ${mentionText}!`,
    );
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await page2.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();

    await page2.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByText("Couldn’t open document")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You aren’t signed in")).toBeVisible();
    await expect(page1.getByText("You don’t have access to this space")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this document")).toBeHidden();
    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await browserContext1.close();
});

test("accounts from another space can see document shared with url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession();
    const mentionSession = await space.createSession({name: "Sara Smith"});
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const document = await TestDocument.create(session, {title: "Test Document"});

    await document.type(session, "Hello, ");
    const {range} = await document.type(session, "world");
    await document.type(session, "!");

    await document.createCommentThread(session, range);

    await document.type(session, " Hello, ");
    await document.type(
        session,
        DocumentContentProsemirrorSchema.node("mention", {
            mention: cast<ContentMention>({
                type: "Account",
                accountId: mentionSession.account.id,
                isShort: true,
            }),
        }),
    );
    await document.type(session, "!");

    const file = await TestFile.create(session);
    await document.attachFile(session, file);

    await services.signIn(browserContext2, session);
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext1 = await browser.newContext();
    const page1 = await browserContext1.newPage();
    await services.signIn(browserContext1, otherSession);
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open document")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        `Test DocumentHello, world! Hello, ${mentionText}!`,
    );
    await expect(
        page2.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page2.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await expect(page1.getByText("Couldn’t open document")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this document")).toBeHidden();
    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

    await page2.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page2
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await page2.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with anyone with the link",
    );

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();
    await expect(page1.getByText("Couldn’t open document")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        `Test DocumentHello, world! Hello, ${mentionText}!`,
    );
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await page2.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();

    await page2.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByText("Couldn’t open document")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this document")).toBeHidden();
    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await browserContext1.close();
});

test("accounts from same space can see document shared with url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session, otherSession] = await space.createSessions(2);
    const mentionSession = await space.createSession({name: "Sara Smith"});

    const document = await TestDocument.create(session, {title: "Test Document"});

    await document.type(session, "Hello, ");
    const {range} = await document.type(session, "world");
    await document.type(session, "!");

    await document.createCommentThread(session, range);

    await document.type(session, " Hello, ");
    await document.type(
        session,
        DocumentContentProsemirrorSchema.node("mention", {
            mention: cast<ContentMention>({
                type: "Account",
                accountId: mentionSession.account.id,
                isShort: true,
            }),
        }),
    );
    await document.type(session, "!");

    const file = await TestFile.create(session);
    await document.attachFile(session, file);

    await services.signIn(browserContext2, session);
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext1 = await browser.newContext();
    const page1 = await browserContext1.newPage();
    await services.signIn(browserContext1, otherSession);
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open document")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        `Test DocumentHello, world! Hello, ${mentionText}!`,
    );
    await expect(
        page2.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page2.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await expect(page1.getByText("Couldn’t open document")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this document")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeHidden();
    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeVisible();

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

    await page2.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page2
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    await page2.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with anyone with the link",
    );

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page1.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page1.getByText("Couldn’t open document")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        `Test DocumentHello, world! Hello, ${mentionText}!`,
    );
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await expect(
        page1.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with anyone with the link",
    );

    await page2.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();

    await page2.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute("aria-label", "Icon indicating the document is private");

    // Will update in realtime. Unlike for anonymous users which don't connect to
    // realtime.
    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden();

    await expect(page1.getByText("Couldn’t open document")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this document")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeHidden();
    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeVisible();

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await browserContext1.close();
});

test("account that used to be a member of space but was removed can see document shared with url grant", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const session = await space.createSession({role: "Admin"});
    const mentionSession = await space.createSession({name: "Sara Smith"});
    const otherSession = await space.createSession();

    await removeSpaceAccount(session.action(), {
        spaceId: space.id,
        accountId: otherSession.account.id,
    });

    const document = await TestDocument.create(session, {title: "Test Document"});
    await document.access.grantDefault(session);

    await document.type(session, "Hello, ");
    const {range} = await document.type(session, "world");
    await document.type(session, "!");

    await document.createCommentThread(session, range);

    await document.type(session, " Hello, ");
    await document.type(
        session,
        DocumentContentProsemirrorSchema.node("mention", {
            mention: cast<ContentMention>({
                type: "Account",
                accountId: mentionSession.account.id,
                isShort: true,
            }),
        }),
    );
    await document.type(session, "!");

    const file = await TestFile.create(session);
    await document.attachFile(session, file);

    await services.signIn(browserContext2, session);
    await page2.goto(`/s/${space.id}/documents/${document.id}`);

    const browserContext1 = await browser.newContext();
    const page1 = await browserContext1.newPage();
    await services.signIn(browserContext1, otherSession);
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page2.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Toggle sharing"})).toBeVisible();
    await expect(page2.getByRole("button", {name: "Search"})).toBeVisible();
    await expect(page2.getByText("Couldn’t open document")).toBeHidden();
    await expect(page2.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByRole("textbox", {name: "Document"})).toHaveText(
        `Test DocumentHello, world! Hello, ${mentionText}!`,
    );
    await expect(
        page2.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page2.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeVisible();

    await expect(page1.getByText("Couldn’t open document")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this document")).toBeHidden();
    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with everyone in Test Space",
    );

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeHidden();

    await page2.getByRole("button", {name: "Share"}).click();

    await expect(page2.getByTestId("ShareOverlayUrlGrant")).toBeVisible();

    await page2
        .getByTestId("ShareOverlayUrlGrant")
        .getByRole("button", {name: "can’t access"})
        .click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with everyone in Test Space",
    );

    await page2.getByRole("menuitem", {name: "can view"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with anyone with the link",
    );

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();
    await expect(page1.getByText("Couldn’t open document")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "Document"})).toHaveText(
        `Test DocumentHello, world! Hello, ${mentionText}!`,
    );
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeVisible();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await page2.getByTestId("ShareOverlayUrlGrant").getByRole("button", {name: "can view"}).click();

    await page2.getByRole("menuitem", {name: "can’t access"}).click();

    await expect(
        page2.getByRole("button", {name: "Toggle sharing"}).getByRole("img"),
    ).toHaveAttribute(
        "aria-label",
        "Icon indicating the document is shared with everyone in Test Space",
    );

    // Doesn't update in realtime so keep reloading until we can see the document.
    await expect(async () => {
        await page1.reload();
        await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden({
            timeout: 250,
        });
    }).toPass({timeout: 5000});

    await expect(page1.getByText("Couldn’t open document")).toBeVisible();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();
    await expect(page1.getByText("You don’t have access to this space")).toBeVisible();
    await expect(page1.getByText("You aren’t signed in")).toBeHidden();
    await expect(page1.getByText("You aren’t allowed to access this document")).toBeHidden();
    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Toggle sharing"})).toBeHidden();
    await expect(page1.getByRole("button", {name: "Search"})).toBeHidden();

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).getByTestId("ContentFilePreview:image/png"),
    ).toBeHidden();
    await expect(
        page1.getByRole("textbox", {name: "Document"}).locator("[data-comment]"),
    ).toBeHidden();

    await browserContext1.close();
});

test("can’t change permission level of account who invited you", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2);

    await services.signIn(browserContext, session2);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

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

test("can’t change permission level of account who invited the account who invited you", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2);
    await document.access.grant(session2, session3);

    await services.signIn(browserContext, session3);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

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

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

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

    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();
    await expect(page.getByText("Couldn’t open document")).toBeHidden();
    await expect(page.getByRole("img", {name: "Error icon"})).toBeHidden();

    await page.getByRole("button", {name: "I understand, make this change"}).click();

    await expect(
        page.getByRole("alertdialog", {name: "Remove permissions from yourself?"}),
    ).toBeHidden();

    await expect(page.getByRole("textbox", {name: "Document"})).toBeHidden();
    await expect(page.getByText("Couldn’t open document")).toBeVisible();
    await expect(page.getByRole("img", {name: "Error icon"})).toBeHidden();
});

test("will be prevented from lowering your own permission level if you’re the last manager", async ({
    context: browserContext,
    page,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);
    await document.access.grant(session1, session2, "Edit");

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await page.getByRole("button", {name: "Share"}).click();

    await page
        .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
        .getByRole("button", {name: "can edit"})
        .click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can’t remove everyone who can change permissions",
        }),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "remove access"}).click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can’t remove everyone who can change permissions",
        }),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can’t remove everyone who can change permissions",
        }),
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
        page.getByRole("alertdialog", {
            name: "Can’t remove everyone who can change permissions",
        }),
    ).toBeHidden();

    await page.getByRole("menuitem", {name: "can comment"}).click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can’t remove everyone who can change permissions",
        }),
    ).toBeVisible();

    await page.getByRole("button", {name: "Ok"}).click();

    await expect(
        page.getByRole("alertdialog", {
            name: "Can’t remove everyone who can change permissions",
        }),
    ).toBeHidden();

    await expect(
        page
            .getByTestId(`ShareOverlayAccountGrant:${session1.account.id}`)
            .getByRole("button", {name: "can edit"}),
    ).toBeVisible();
});

test("will send a notification when sharing with account", async ({
    browser,
    context: browserContext2,
    page: page2,
}) => {
    const space = await TestSpace.create(context, {name: "Test Space"});
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {title: "Test Document"});

    await services.signIn(browserContext2, session2);
    await page2.goto(`/s/${space.id}/inbox`);

    const browserContext1 = await browser.newContext();
    await services.signIn(browserContext1, session1);
    const page1 = await browserContext1.newPage();
    await page1.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page1.getByRole("heading", {name: "Test Document"})).toBeVisible();
    await expect(page1.getByText("Couldn’t open document")).toBeHidden();
    await expect(page1.getByRole("img", {name: "Error icon"})).toBeHidden();

    await expect(page2.getByText("No new notifications")).toBeVisible();

    await page1.getByRole("button", {name: "Share"}).click();

    await expect(page1.getByPlaceholder("Add people")).toBeVisible();
    await expect(page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`)).toBeHidden();

    await page1.getByPlaceholder("Add people").click();
    await page1.getByText(session2.account.initialName).click();
    await page1.getByRole("button", {name: "Share", exact: true}).click();

    await expect(
        page1.getByTestId(`ShareOverlayAccountGrant:${session2.account.id}`),
    ).toBeVisible();

    await expect(page2.getByText("Test shared a document with you")).toBeVisible();

    await browserContext1.close();
});

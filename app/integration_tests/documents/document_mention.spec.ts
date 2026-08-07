import {expect, test} from "@playwright/test";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

const {context, services} = createTestServices();

test("can search for an account in mention menu", async ({
    page,
    context: browserContext,
    viewport,
    isMobile,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const [session1] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
    ]);

    const document = await TestDocument.create(session1);
    await document.access.grantDefault(session1);

    const canPrimaryInputHover = await page.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

    await services.signIn(browserContext, session1);
    await page.goto(`/doc/${document.id}`);

    await page.getByRole("textbox", {name: "Document"}).focus();

    if (canPrimaryInputHover) {
        await page
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await page.getByRole("textbox", {name: "Document"}).type("@");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeVisible();
    await page.getByRole("textbox", {name: "Document"}).type("Siobahn");
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await page.getByTestId("ContentEditorMentionFloater").getByText("Siobahn").click();
    await expect(page.getByTestId("ContentEditorMentionFloater")).toBeHidden();

    // We only default to short names on desktop when the user can press cmd-z to
    // quickly get the full name.
    if (!isMobile) {
        await expect(page.getByText("Siobahn", {exact: true})).toBeVisible();
        await expect(page.getByText("Siobahn Roy", {exact: true})).toBeHidden();
        await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    } else {
        await expect(page.getByText("Siobahn Roy", {exact: true})).toBeVisible();
        await expect(page.getByText("Siobahn", {exact: true})).toBeHidden();
        await expect(page.getByText("Kendall Roy", {exact: true})).toBeHidden();
    }
});

test("can see a mention added by another user", async ({
    page: page1,
    context: browserContext1,
    browser,
    viewport,
    isMobile,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
        space.createSession({name: "Kendall Roy"}),
    ]);

    const document = await TestDocument.create(session1);
    await document.access.grantDefault(session1);
    const canPrimaryInputHover = await page1.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

    await services.signIn(browserContext1, session1);
    await page1.goto(`/doc/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/doc/${document.id}`);

    await page1.getByRole("textbox", {name: "Document"}).focus();

    if (canPrimaryInputHover) {
        await page1
            .getByRole("textbox", {name: "Document"})
            .click({position: {x: viewport.width / 2, y: viewport.height - 100}});
    } else {
        await page1
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    // Focusing the document in the second browser will wait for the document to be
    // interactive.
    await page2.getByRole("textbox", {name: "Document"}).focus();

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page1.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page1.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page1.getByText("Siobahn", {exact: true})).toBeHidden();
    await expect(page2.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page2.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Siobahn", {exact: true})).toBeHidden();

    await page1.getByRole("textbox", {name: "Document"}).type("@");

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page1.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page1.getByText("Kendall Roy", {exact: true})).toBeVisible();
    await expect(page1.getByText("Siobahn", {exact: true})).toBeHidden();
    await expect(page2.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page2.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Siobahn", {exact: true})).toBeHidden();

    await page1.getByRole("textbox", {name: "Document"}).type("Siobahn");

    await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeVisible();
    await expect(page1.getByText("Siobahn Roy", {exact: true})).toBeVisible();
    await expect(page1.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page1.getByText("Siobahn", {exact: true})).toBeHidden();
    await expect(page2.getByTestId("ContentEditorMentionFloater")).toBeHidden();
    await expect(page2.getByText("Siobahn Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Kendall Roy", {exact: true})).toBeHidden();
    await expect(page2.getByText("Siobahn", {exact: true})).toBeHidden();

    await page1.getByRole("textbox", {name: "Document"}).press("ArrowDown");
    await page1.getByRole("textbox", {name: "Document"}).press("Enter");

    // We only default to short names on desktop when the user can press cmd-z to
    // quickly get the full name.
    if (!isMobile) {
        await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeHidden();
        await expect(page1.getByText("Siobahn", {exact: true})).toBeVisible();
        await expect(page1.getByText("Siobahn Roy", {exact: true})).toBeHidden();
        await expect(page1.getByText("Kendall Roy", {exact: true})).toBeHidden();
        await expect(page2.getByTestId("ContentEditorMentionFloater")).toBeHidden();
        await expect(page2.getByText("Siobahn", {exact: true})).toBeVisible();
        await expect(page2.getByText("Siobahn Roy", {exact: true})).toBeHidden();
        await expect(page2.getByText("Kendall Roy", {exact: true})).toBeHidden();
    } else {
        await expect(page1.getByTestId("ContentEditorMentionFloater")).toBeHidden();
        await expect(page1.getByText("Siobahn Roy", {exact: true})).toBeVisible();
        await expect(page1.getByText("Siobahn", {exact: true})).toBeHidden();
        await expect(page1.getByText("Kendall Roy", {exact: true})).toBeHidden();
        await expect(page2.getByTestId("ContentEditorMentionFloater")).toBeHidden();
        await expect(page2.getByText("Siobahn Roy", {exact: true})).toBeVisible();
        await expect(page2.getByText("Siobahn", {exact: true})).toBeHidden();
        await expect(page2.getByText("Kendall Roy", {exact: true})).toBeHidden();
    }

    await browserContext2.close();
});

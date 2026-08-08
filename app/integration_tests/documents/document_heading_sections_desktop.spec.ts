import {expect, test} from "@playwright/test";
import {createHeadingSectionsDocumentContent} from "~/app/integration_tests/helpers/create_heading_sections_document_content.js";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {findDocumentTextRange} from "~/app/integration_tests/helpers/find_document_text_range.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

const {context, services} = createTestServices();

test("can collapse and expand a heading section", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const document = await TestDocument.create(session, {
        content: createHeadingSectionsDocumentContent(session.account.id),
    });
    await document.access.grantDefault(session);

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    // Wait for the ProseMirror editor to mount (replacing the server rendered
    // read-only view) before interacting with headings.
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    const roadmapHeading = page.getByRole("heading", {name: "Roadmap"});
    await expect(page.getByText("Roadmap body text.")).toBeVisible();

    // Collapse the "Roadmap" section from the right click context menu.
    await roadmapHeading.dispatchEvent("contextmenu");

    // The heading actions render below undo/redo and above insert.
    const contextMenuText = await page.getByTestId("ContextMenu").innerText();
    expect(contextMenuText.indexOf("Undo")).toBeLessThan(
        contextMenuText.indexOf("Collapse heading"),
    );
    expect(contextMenuText.indexOf("Collapse heading")).toBeLessThan(
        contextMenuText.indexOf("Insert"),
    );

    await page.getByTestId("ContextMenu").getByText("Collapse heading").click();

    // The whole section is hidden, including the lower-level "Q3 Goals" subsection,
    // but the next same-level section is not.
    await expect(page.getByText("Roadmap body text.")).toBeHidden();
    await expect(page.getByRole("heading", {name: "Q3 Goals"})).toBeHidden();
    await expect(page.getByText("Appendix body text.")).toBeVisible();
    await expect(roadmapHeading).toHaveAttribute("data-collapsed", "true");

    // Expand it again from the chevron next to the collapsed heading (every heading
    // renders one inside its node view but only the collapsed heading's is shown, so
    // scope the locator).
    await roadmapHeading.getByLabel("Expand heading").click();

    await expect(page.getByText("Roadmap body text.")).toBeVisible();
    await expect(page.getByRole("heading", {name: "Q3 Goals"})).toBeVisible();
});

test("expands a collapsed section when the selection moves into it", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const document = await TestDocument.create(session, {
        content: createHeadingSectionsDocumentContent(session.account.id),
    });
    await document.access.grantDefault(session);

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    // Wait for the ProseMirror editor to mount (replacing the server rendered
    // read-only view) before interacting with headings.
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    const roadmapHeading = page.getByRole("heading", {name: "Roadmap"});
    await roadmapHeading.dispatchEvent("contextmenu");
    await page.getByTestId("ContextMenu").getByText("Collapse heading").click();
    await expect(page.getByText("Roadmap body text.")).toBeHidden();

    // Move the selection into the hidden section. The section expands so the user
    // never types into invisible content.
    const hiddenTextRange = await findDocumentTextRange(page, "Roadmap body text.");
    assert(hiddenTextRange !== null);
    await page.evaluate(`dev.contentEditor.setTextSelection(${hiddenTextRange.from + 2})`);

    await expect(page.getByText("Roadmap body text.")).toBeVisible();
});

test("keeps a section collapsed when the selection merely spans it", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const document = await TestDocument.create(session, {
        content: createHeadingSectionsDocumentContent(session.account.id),
    });
    await document.access.grantDefault(session);

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    // Wait for the ProseMirror editor to mount (replacing the server rendered
    // read-only view) before interacting with headings.
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    const roadmapHeading = page.getByRole("heading", {name: "Roadmap"});
    await roadmapHeading.dispatchEvent("contextmenu");
    await page.getByTestId("ContextMenu").getByText("Collapse heading").click();
    await expect(page.getByText("Roadmap body text.")).toBeHidden();

    // Select from a visible paragraph before the collapsed section to a visible
    // paragraph after it. Only a selection fully inside the hidden content expands the
    // section (so select all and shift clicking across it don't blow away collapse
    // state); a spanning selection leaves it collapsed.
    const beforeRange = await findDocumentTextRange(page, "Filler paragraph 20.");
    const afterRange = await findDocumentTextRange(page, "Appendix body text.");
    assert(beforeRange !== null && afterRange !== null);
    await page.evaluate(
        `dev.contentEditor.setTextSelection(${beforeRange.from + 2}, ${afterRange.to - 2})`,
    );

    await expect(page.getByText("Roadmap body text.")).toBeHidden();
    await expect(roadmapHeading).toHaveAttribute("data-collapsed", "true");
});

test("moves the selection out of a section that is collapsed around it", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const document = await TestDocument.create(session, {
        content: createHeadingSectionsDocumentContent(session.account.id),
    });
    await document.access.grantDefault(session);

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    // Wait for the ProseMirror editor to mount (replacing the server rendered
    // read-only view) before interacting with headings.
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    // Put the cursor inside the section body before collapsing it.
    const bodyTextRange = await findDocumentTextRange(page, "Roadmap body text.");
    assert(bodyTextRange !== null);
    await page.evaluate(`dev.contentEditor.setTextSelection(${bodyTextRange.from + 2})`);

    const roadmapHeading = page.getByRole("heading", {name: "Roadmap"});
    await roadmapHeading.dispatchEvent("contextmenu");
    await page.getByTestId("ContextMenu").getByText("Collapse heading").click();
    await expect(page.getByText("Roadmap body text.")).toBeHidden();

    // The selection moved to the end of the heading text instead of staying in the now
    // invisible paragraph (which would immediately expand it again).
    const headingEndPos = await page.evaluate(() => {
        const view = (window as any).dev.contentEditor.view;
        let endPos: number | null = null;
        view.state.doc.forEach((node: any, offset: number) => {
            if (endPos === null && node.type.name === "heading" && node.textContent === "Roadmap") {
                endPos = offset + node.nodeSize - 1;
            }
        });
        return endPos as number | null;
    });
    assert(headingEndPos !== null);
    await expect
        .poll(() => page.evaluate("dev.contentEditor.view.state.selection.from"))
        .toBe(headingEndPos);
});

test("scrolls to the heading section when opening a heading link", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const document = await TestDocument.create(session, {
        content: createHeadingSectionsDocumentContent(session.account.id),
    });
    await document.access.grantDefault(session);

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}#roadmap`);

    await expect(page.getByRole("heading", {name: "Roadmap"})).toBeInViewport();
});

test("stays at the top of the doc when the heading link slug does not exist", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const document = await TestDocument.create(session, {
        content: createHeadingSectionsDocumentContent(session.account.id),
    });
    await document.access.grantDefault(session);

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}#does-not-exist`);

    // The doc rendered with the target heading in it, but we didn't scroll.
    await expect(page.getByRole("heading", {name: "Roadmap"})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Roadmap"})).not.toBeInViewport();
});

test("can copy a heading link from the context menu and follow it", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const document = await TestDocument.create(session, {
        content: createHeadingSectionsDocumentContent(session.account.id),
    });
    await document.access.grantDefault(session);

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    // Wait for the ProseMirror editor to mount (replacing the server rendered
    // read-only view) before interacting with headings.
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    await page.getByRole("heading", {name: "Roadmap"}).dispatchEvent("contextmenu");
    await page.getByTestId("ContextMenu").getByText("Copy heading link").click();

    // Heading links use the URL hash, the standard anchor convention.
    await expect(async () => {
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toBe(new URL(`/doc/${document.id}#roadmap`, page.url()).toString());
    }).toPass();

    // Follow the copied link and land on the heading. `page.goto` with only a hash
    // change is a same-document navigation that keeps the route mounted, so reload to
    // open the link fresh the way a pasted link would be.
    await page.goto(new URL(`/doc/${document.id}#roadmap`, page.url()).toString());
    await page.reload();
    await expect(page.getByRole("heading", {name: "Roadmap"})).toBeInViewport();
});

test("can copy a link to a lower-level heading", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const document = await TestDocument.create(session, {
        content: createHeadingSectionsDocumentContent(session.account.id),
    });
    await document.access.grantDefault(session);

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    // Wait for the ProseMirror editor to mount (replacing the server rendered
    // read-only view) before interacting with headings.
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    await page.getByRole("heading", {name: "Q3 Goals"}).dispatchEvent("contextmenu");
    await page.getByTestId("ContextMenu").getByText("Copy heading link").click();

    await expect(async () => {
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toBe(new URL(`/doc/${document.id}#q3-goals`, page.url()).toString());
    }).toPass();
});

test("copies content hidden inside a collapsed section when the selection spans it", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const document = await TestDocument.create(session, {
        content: createHeadingSectionsDocumentContent(session.account.id),
    });
    await document.access.grantDefault(session);

    await browserContext.grantPermissions(["clipboard-read", "clipboard-write"]);
    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    // Wait for the ProseMirror editor to mount (replacing the server rendered
    // read-only view) before interacting with headings.
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    const roadmapHeading = page.getByRole("heading", {name: "Roadmap"});
    await roadmapHeading.dispatchEvent("contextmenu");
    await page.getByTestId("ContextMenu").getByText("Collapse heading").click();
    await expect(page.getByText("Roadmap body text.")).toBeHidden();

    // Focus the editor, then select from a visible paragraph before the collapsed
    // section to a visible paragraph after it.
    await page.getByText("Filler paragraph 20.").click();
    const beforeRange = await findDocumentTextRange(page, "Filler paragraph 20.");
    const afterRange = await findDocumentTextRange(page, "Appendix body text.");
    assert(beforeRange !== null && afterRange !== null);
    await page.evaluate(
        `dev.contentEditor.setTextSelection(${beforeRange.from}, ${afterRange.to})`,
    );

    await page.keyboard.press("ControlOrMeta+c");

    // ProseMirror serializes the selected slice of the doc, not the visible DOM, so
    // the copy includes the hidden blocks and the section stays collapsed.
    await expect(async () => {
        const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
        expect(clipboardText).toContain("Roadmap body text.");
        expect(clipboardText).toContain("Q3 goals body text.");
        expect(clipboardText).toContain("Appendix body text.");
    }).toPass();
    await expect(page.getByText("Roadmap body text.")).toBeHidden();
    await expect(roadmapHeading).toHaveAttribute("data-collapsed", "true");
});

test("hides comment previews inside a collapsed section and expands it when pressing the thread preview", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const content = createHeadingSectionsDocumentContent(session.account.id);

    // Comment on a visible paragraph near the top and on the "Roadmap body text."
    // paragraph that will be hidden when the "Roadmap" section is collapsed.
    let visibleCommentRange: {from: number; to: number} | null = null;
    let hiddenCommentRange: {from: number; to: number} | null = null;
    content.descendants((node, pos) => {
        if (!node.isText) return;
        if (visibleCommentRange === null && node.text!.includes("Filler paragraph 1.")) {
            visibleCommentRange = {from: pos, to: pos + node.nodeSize};
        }
        if (hiddenCommentRange === null && node.text!.includes("Roadmap body text")) {
            hiddenCommentRange = {from: pos, to: pos + node.nodeSize};
        }
    });
    assert(visibleCommentRange !== null && hiddenCommentRange !== null);

    const document = await TestDocument.create(session, {content});
    await document.access.grantDefault(session);
    const visibleCommentThread = await document.createCommentThread(session, visibleCommentRange);
    const hiddenCommentThread = await document.createCommentThread(session, hiddenCommentRange);

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    // Wait for the ProseMirror editor to mount (replacing the server rendered
    // read-only view) before interacting with headings.
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    const hiddenCommentPreview = page.getByTestId(
        `DocumentContentEditorCommentThreadSideDecoration:${hiddenCommentThread.id}`,
    );
    await expect(hiddenCommentPreview).toBeVisible();

    // Collapse the "Roadmap" section. The hidden thread's margin preview disappears.
    await page.getByRole("heading", {name: "Roadmap"}).dispatchEvent("contextmenu");
    await page.getByTestId("ContextMenu").getByText("Collapse heading").click();
    await expect(page.getByText("Roadmap body text.")).toBeHidden();
    await expect(hiddenCommentPreview).toBeHidden();

    // The hidden thread is still reachable through the sidebar's thread navigation:
    // open the visible thread, then go to the next thread. Navigating alone doesn't
    // expand the section; the sidebar's thread preview already shows the comment's
    // content.
    await page
        .getByTestId(`DocumentContentEditorCommentThreadSideDecoration:${visibleCommentThread.id}`)
        .click();
    await page.getByLabel("Next thread").click();
    await expect(
        page.getByTestId("DocumentCommentThreadPreview").getByText("Roadmap body text."),
    ).toBeVisible();
    await expect(
        page.getByTestId("DocumentContentEditorMain").getByText("Roadmap body text."),
    ).toBeHidden();

    // Pressing the thread preview expands the section and scrolls to the mark.
    await page.getByTestId("DocumentCommentThreadPreview").click();
    await expect(
        page.getByTestId("DocumentContentEditorMain").getByText("Roadmap body text."),
    ).toBeVisible();
    await expect(
        page
            .getByTestId("DocumentContentEditorMain")
            .locator(`[data-comment="${hiddenCommentThread.id}"]`),
    ).toBeInViewport();

    // Margin previews don't render while the sidebar is open; close it to see the
    // thread's preview again now that its section is expanded.
    await page.getByLabel("Close").click();
    await expect(hiddenCommentPreview).toBeVisible();
});

test("navigates to a comment on a collapsed heading before the comments hidden inside its section", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const content = createHeadingSectionsDocumentContent(session.account.id);

    // Comment 1 on a paragraph in the first section, comment 2 on the "Roadmap"
    // heading itself, comment 3 inside the "Roadmap" section.
    let firstCommentRange: {from: number; to: number} | null = null;
    let headingCommentRange: {from: number; to: number} | null = null;
    let hiddenCommentRange: {from: number; to: number} | null = null;
    content.descendants((node, pos) => {
        if (!node.isText) return;
        if (firstCommentRange === null && node.text!.includes("Filler paragraph 1.")) {
            firstCommentRange = {from: pos, to: pos + node.nodeSize};
        }
        if (headingCommentRange === null && node.text === "Roadmap") {
            headingCommentRange = {from: pos, to: pos + node.nodeSize};
        }
        if (hiddenCommentRange === null && node.text!.includes("Roadmap body text")) {
            hiddenCommentRange = {from: pos, to: pos + node.nodeSize};
        }
    });
    assert(firstCommentRange !== null && headingCommentRange !== null);
    assert(hiddenCommentRange !== null);

    const document = await TestDocument.create(session, {content});
    await document.access.grantDefault(session);
    const firstCommentThread = await document.createCommentThread(
        session,
        firstCommentRange,
        "Comment in the first section",
    );
    await document.createCommentThread(session, headingCommentRange, "Comment on the heading");
    await document.createCommentThread(session, hiddenCommentRange, "Comment inside the section");

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    // Wait for the ProseMirror editor to mount (replacing the server rendered
    // read-only view) before interacting with headings.
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    // Scope to the editor: the sidebar renders the open thread's snippet, which
    // includes the heading once the heading's thread is open.
    const roadmapHeading = page
        .getByTestId("DocumentContentEditorMain")
        .getByRole("heading", {name: "Roadmap"});
    await roadmapHeading.dispatchEvent("contextmenu");
    await page.getByTestId("ContextMenu").getByText("Collapse heading").click();
    await expect(page.getByText("Roadmap body text.")).toBeHidden();

    await page
        .getByTestId(`DocumentContentEditorCommentThreadSideDecoration:${firstCommentThread.id}`)
        .click();
    await expect(page.getByText("Comment in the first section")).toBeVisible();

    // Next goes to the comment on the collapsed heading (document order), not to the
    // hidden comment inside its section. The heading is visible, so the section stays
    // collapsed.
    await page.getByLabel("Next thread").click();
    await expect(page.getByText("Comment on the heading")).toBeVisible();
    await expect(roadmapHeading).toBeInViewport();
    await expect(roadmapHeading).toHaveAttribute("data-collapsed", "true");

    // The next one after that is the hidden comment. Navigating alone doesn't expand
    // the section (pressing the thread preview does).
    await page.getByLabel("Next thread").click();
    await expect(page.getByText("Comment inside the section")).toBeVisible();
    await expect(
        page.getByTestId("DocumentContentEditorMain").getByText("Roadmap body text."),
    ).toBeHidden();
    await expect(roadmapHeading).toHaveAttribute("data-collapsed", "true");
});

test("hides the preview of a comment on a collapsed heading", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const content = createHeadingSectionsDocumentContent(session.account.id);

    // Comment on the "Roadmap" heading itself, whose line the expand chevron shares
    // once the section is collapsed.
    let headingCommentRange: {from: number; to: number} | null = null;
    content.descendants((node, pos) => {
        if (headingCommentRange === null && node.isText && node.text === "Roadmap") {
            headingCommentRange = {from: pos, to: pos + node.nodeSize};
        }
    });
    assert(headingCommentRange !== null);

    const document = await TestDocument.create(session, {content});
    await document.access.grantDefault(session);
    const headingCommentThread = await document.createCommentThread(session, headingCommentRange);

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${document.id}`);

    // Wait for the ProseMirror editor to mount (replacing the server rendered
    // read-only view) before interacting with headings.
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    const headingCommentPreview = page.getByTestId(
        `DocumentContentEditorCommentThreadSideDecoration:${headingCommentThread.id}`,
    );
    await expect(headingCommentPreview).toBeVisible();

    // While the section is collapsed the expand chevron takes the heading's margin
    // slot, so the comment preview doesn't render.
    const roadmapHeading = page.getByRole("heading", {name: "Roadmap"});
    await roadmapHeading.dispatchEvent("contextmenu");
    await page.getByTestId("ContextMenu").getByText("Collapse heading").click();
    await expect(page.getByText("Roadmap body text.")).toBeHidden();
    await expect(headingCommentPreview).toBeHidden();
    const expandChevron = roadmapHeading.getByLabel("Expand heading");
    await expect(expandChevron).toBeVisible();

    // Expanding brings the preview back.
    await expandChevron.click();
    await expect(headingCommentPreview).toBeVisible();
});

// Collapsed state is per client and identified by remapped positions, so the
// interesting cases are all "User A has a section collapsed while User B edits the
// doc". These tests drive User B's edits through the ProseMirror debug tools so
// they're deterministic; the steps still flow through the normal collaboration
// pipeline to User A.

test("keeps a collapsed section collapsed while another account edits the doc", async ({
    browser,
    page: page1,
    context: browserContext1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
    ]);

    const document = await TestDocument.create(session1, {
        content: createHeadingSectionsDocumentContent(session1.account.id),
    });
    await document.access.grantDefault(session1);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/doc/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/doc/${document.id}`);

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeVisible();
    await expect(page2.getByRole("textbox", {name: "Document"})).toBeVisible();

    // Logan collapses the "Roadmap" section.
    await page1.getByRole("heading", {name: "Roadmap"}).dispatchEvent("contextmenu");
    await page1.getByTestId("ContextMenu").getByText("Collapse heading").click();
    await expect(page1.getByText("Roadmap body text.")).toBeHidden();

    // Collapsed state is per client: the section is still expanded for Siobahn.
    await expect(page2.getByText("Roadmap body text.")).toBeVisible();

    // 1. Siobahn edits content inside the collapsed section. The edit syncs to Logan
    //    but stays hidden inside his collapsed section.
    const bodyTextRange = await findDocumentTextRange(page2, "Roadmap body text.");
    assert(bodyTextRange !== null);
    await page2.evaluate(insertPos => {
        const view = (window as any).dev.contentEditor.view;
        view.dispatch(view.state.tr.insertText(" More detail.", insertPos));
    }, bodyTextRange.to);

    await expect(page1.getByText("Roadmap body text. More detail.")).toBeAttached();
    await expect(page1.getByText("Roadmap body text. More detail.")).toBeHidden();

    // 2. Siobahn edits content before the collapsed section. Positions shift but the
    //    section stays collapsed.
    const fillerTextRange = await findDocumentTextRange(page2, "Filler paragraph 1.");
    assert(fillerTextRange !== null);
    await page2.evaluate(insertPos => {
        const view = (window as any).dev.contentEditor.view;
        view.dispatch(view.state.tr.insertText(" Extra.", insertPos));
    }, fillerTextRange.to);

    await expect(page1.getByText("Filler paragraph 1. Extra.")).toBeVisible();
    await expect(page1.getByText("Roadmap body text. More detail.")).toBeHidden();

    // 3. Siobahn adds a new heading before the collapsed section. The new section is
    //    expanded and the collapsed one stays collapsed.
    await page2.evaluate(() => {
        const view = (window as any).dev.contentEditor.view;
        let headingPos: number | null = null;
        view.state.doc.forEach((node: any, offset: number) => {
            if (
                headingPos === null &&
                node.type.name === "heading" &&
                node.textContent === "Roadmap"
            ) {
                headingPos = offset;
            }
        });
        if (headingPos === null) return;
        const {schema} = view.state;
        view.dispatch(
            view.state.tr.insert(
                headingPos,
                schema.nodes.heading.create({level: 1}, schema.text("Interlude")),
            ),
        );
    });

    await expect(page1.getByRole("heading", {name: "Interlude"})).toBeVisible();
    await expect(page1.getByText("Roadmap body text. More detail.")).toBeHidden();

    // 4. Siobahn renames the collapsed heading. Collapse is identified by position,
    //    not by the heading's text, so it stays collapsed. (The renamed heading
    //    derives a new slug, so previously copied links to it now fall back to the top
    //    of the doc — see TODO(heading-ids).)
    const headingTextRange = await findDocumentTextRange(page2, "Roadmap");
    assert(headingTextRange !== null);
    await page2.evaluate(insertPos => {
        const view = (window as any).dev.contentEditor.view;
        view.dispatch(view.state.tr.insertText(" 2027", insertPos));
    }, headingTextRange.to);

    await expect(page1.getByRole("heading", {name: "Roadmap 2027"})).toHaveAttribute(
        "data-collapsed",
        "true",
    );
    await expect(page1.getByText("Roadmap body text. More detail.")).toBeHidden();
});

test("reveals a collapsed section when another account deletes its heading", async ({
    browser,
    page: page1,
    context: browserContext1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
    ]);

    const document = await TestDocument.create(session1, {
        content: createHeadingSectionsDocumentContent(session1.account.id),
    });
    await document.access.grantDefault(session1);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/doc/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/doc/${document.id}`);

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeVisible();
    await expect(page2.getByRole("textbox", {name: "Document"})).toBeVisible();

    await page1.getByRole("heading", {name: "Roadmap"}).dispatchEvent("contextmenu");
    await page1.getByTestId("ContextMenu").getByText("Collapse heading").click();
    await expect(page1.getByText("Roadmap body text.")).toBeHidden();

    // Siobahn deletes the whole collapsed heading node. Without a heading there is no
    // section anymore, so the hidden content is revealed for Logan.
    await page2.evaluate(() => {
        const view = (window as any).dev.contentEditor.view;
        let headingRange: {from: number; to: number} | null = null;
        view.state.doc.forEach((node: any, offset: number) => {
            if (
                headingRange === null &&
                node.type.name === "heading" &&
                node.textContent === "Roadmap"
            ) {
                headingRange = {from: offset, to: offset + node.nodeSize};
            }
        });
        // TypeScript doesn't count assignments inside the `forEach` callback when
        // narrowing, so widen the type back with a cast.
        const foundHeadingRange = headingRange as {from: number; to: number} | null;
        if (foundHeadingRange === null) return;
        view.dispatch(view.state.tr.delete(foundHeadingRange.from, foundHeadingRange.to));
    });

    await expect(page1.getByText("Roadmap body text.")).toBeVisible();
});

test("shrinks a collapsed section when another account inserts a same-level heading inside it", async ({
    browser,
    page: page1,
    context: browserContext1,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await runAllPromises([
        space.createSession({name: "Logan Roy"}),
        space.createSession({name: "Siobahn Roy"}),
    ]);

    const document = await TestDocument.create(session1, {
        content: createHeadingSectionsDocumentContent(session1.account.id),
    });
    await document.access.grantDefault(session1);

    await services.signIn(browserContext1, session1);
    await page1.goto(`/doc/${document.id}`);

    const browserContext2 = await browser.newContext();
    await services.signIn(browserContext2, session2);
    const page2 = await browserContext2.newPage();
    await page2.goto(`/doc/${document.id}`);

    await expect(page1.getByRole("textbox", {name: "Document"})).toBeVisible();
    await expect(page2.getByRole("textbox", {name: "Document"})).toBeVisible();

    await page1.getByRole("heading", {name: "Roadmap"}).dispatchEvent("contextmenu");
    await page1.getByTestId("ContextMenu").getByText("Collapse heading").click();
    await expect(page1.getByText("Roadmap body text.")).toBeHidden();
    await expect(page1.getByRole("heading", {name: "Q3 Goals"})).toBeHidden();

    // Siobahn inserts a same-level heading between the Roadmap body and the "Q3 Goals"
    // subsection. A section ends at the next same-level heading, so the collapsed
    // "Roadmap" section now legitimately ends there: everything from the new heading
    // on becomes visible for Logan while the remaining Roadmap body stays hidden.
    const bodyTextRange = await findDocumentTextRange(page2, "Roadmap body text.");
    assert(bodyTextRange !== null);
    await page2.evaluate(insertPos => {
        const view = (window as any).dev.contentEditor.view;
        const {schema} = view.state;
        view.dispatch(
            view.state.tr.insert(
                insertPos,
                schema.nodes.heading.create({level: 1}, schema.text("Break")),
            ),
        );
    }, bodyTextRange.to + 1);

    await expect(page1.getByRole("heading", {name: "Break"})).toBeVisible();
    await expect(page1.getByRole("heading", {name: "Q3 Goals"})).toBeVisible();
    await expect(page1.getByText("Roadmap body text.")).toBeHidden();
});

test("centers the expand chevron on the first line of every heading level at every spacing scale", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({name: "Logan Roy"});

    const node = DocumentContentProsemirrorSchema.node.bind(DocumentContentProsemirrorSchema);
    const text = DocumentContentProsemirrorSchema.text.bind(DocumentContentProsemirrorSchema);
    const accessPolicy: AccessPolicy = {
        type: "Local",
        accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    // Lower levels first so no section nests inside another: every heading stays
    // visible while all three are collapsed.
    const content = assertDocumentContent(
        node("doc", {accessPolicy}, [
            node("title", {}, [text("Chevron alignment")]),
            node("heading", {level: 3}, [text("Gamma Heading")]),
            node("paragraph", {}, [text("Gamma body.")]),
            node("heading", {level: 2}, [text("Beta Heading")]),
            node("paragraph", {}, [text("Beta body.")]),
            node("heading", {level: 1}, [text("Alpha Heading")]),
            node("paragraph", {}, [text("Alpha body.")]),
        ]),
    );

    // Not named `document` like the other tests: the browser `document` global is used
    // inside the `page.evaluate()` callback below.
    const alignmentDocument = await TestDocument.create(session, {content});
    await alignmentDocument.access.grantDefault(session);

    await services.signIn(browserContext, session);
    await page.goto(`/doc/${alignmentDocument.id}`);
    await expect(page.getByRole("textbox", {name: "Document"})).toBeVisible();

    for (const name of ["Gamma Heading", "Beta Heading", "Alpha Heading"]) {
        await page.getByRole("heading", {name}).dispatchEvent("contextmenu");
        await page.getByTestId("ContextMenu").getByText("Collapse heading").click();
    }
    await expect(page.getByText("Alpha body.")).toBeHidden();
    await expect(page.getByText("Beta body.")).toBeHidden();
    await expect(page.getByText("Gamma body.")).toBeHidden();

    for (const spacingScale of ["small", "medium", "large"]) {
        // For every collapsed heading, compare the chevron's center against the center of
        // a capital letter on the heading's first line ("the middle of an H"), derived
        // from the font's canvas metrics.
        const deltas = await page.evaluate(spacingScaleInner => {
            document.documentElement.setAttribute("data-spacing", spacingScaleInner);

            const results: Array<{heading: string; deltaPx: number}> = [];
            for (const heading of document.querySelectorAll("h2, h3, h4")) {
                const chevron = heading.querySelector('[aria-label="Expand heading"]');
                if (!chevron || !(heading.textContent ?? "").includes("Heading")) continue;

                const style = getComputedStyle(heading);
                const canvasContext = document.createElement("canvas").getContext("2d")!;
                canvasContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
                const metrics = canvasContext.measureText("H");

                // The first line box spans one `line-height` from the heading's top. Within it the
                // baseline sits at `halfLeading + fontAscent`, and the cap center is half the cap
                // height above the baseline.
                const lineHeight = parseFloat(style.lineHeight);
                const halfLeading =
                    (lineHeight -
                        (metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent)) /
                    2;
                const capCenterY =
                    heading.getBoundingClientRect().top +
                    halfLeading +
                    metrics.fontBoundingBoxAscent -
                    metrics.actualBoundingBoxAscent / 2;

                const chevronRect = chevron.getBoundingClientRect();
                const chevronCenterY = chevronRect.top + chevronRect.height / 2;

                results.push({
                    heading: heading.textContent ?? "",
                    deltaPx: chevronCenterY - capCenterY,
                });
            }
            return results;
        }, spacingScale);

        expect(deltas).toHaveLength(3);
        for (const {heading, deltaPx} of deltas) {
            // Canvas font bounding metrics are rounded to whole pixels, so the expected cap
            // center itself carries up to ~half a pixel of noise. A real regression in the
            // chevron's baseline anchoring shifts it by several pixels.
            expect(Math.abs(deltaPx), `${heading} at ${spacingScale}`).toBeLessThanOrEqual(1);
        }
    }
});

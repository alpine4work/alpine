import {expect, test} from "@playwright/test";
import {createTestServer} from "~/app/integration_tests/helpers/create_test_server";
import {createDocument} from "~/server/dynamo/documents_table";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
    createSimpleDocumentContent,
} from "~/shared/content/document_content_schema";

const context = createTestContext();
const server = createTestServer(context);
const space = createTestSpace(context);
const session = createTestSession(context, space);

test("clicking a link will open a peek", async ({context: browserContext, page, isMobile}) => {
    const document2 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 2"),
    });

    const document1 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 1"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 2", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document2.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    await server.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 2"}).click();

    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();
});

test("clicking close will close a peek", async ({context: browserContext, page}) => {
    const document2 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 2"),
    });

    const document1 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 1"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 2", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document2.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    await server.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 2"}).click();

    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();
});

test("clicking expand will expand a peek", async ({context: browserContext, page}) => {
    const document2 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 2"),
    });

    const document1 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 1"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 2", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document2.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    await server.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 2"}).click();

    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Expand"}).click();

    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeHidden();
});

test("can navigate within peek", async ({context: browserContext, page}) => {
    const document4 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 4"),
    });

    const document3 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 3"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 4", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document4.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    const document2 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 2"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 3", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document3.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    const document1 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 1"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 2", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document2.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    await server.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 2"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 3"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeVisible();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 4"}).click();

    await expect(page.getByText("Test document content 4")).toBeVisible();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Back"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeVisible();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Forwards"}).click();

    await expect(page.getByText("Test document content 4")).toBeVisible();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();
});

test("can open multiple peeks", async ({context: browserContext, page}) => {
    const document4 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 4"),
    });

    const document3 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 3"),
    });

    const document2 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 2"),
    });

    const document1 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 1"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 2", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document2.id}`,
                        }),
                    ]),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 3", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document3.id}`,
                        }),
                    ]),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 4", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document4.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    await server.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 2"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 3"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeVisible();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 4"}).click();

    await expect(page.getByText("Test document content 4")).toBeVisible();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeVisible();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();
});

test("can close all peeks with a shift click", async ({context: browserContext, page}) => {
    const document4 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 4"),
    });

    const document3 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 3"),
    });

    const document2 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 2"),
    });

    const document1 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 1"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 2", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document2.id}`,
                        }),
                    ]),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 3", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document3.id}`,
                        }),
                    ]),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 4", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document4.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    await server.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 2"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 3"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeVisible();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 4"}).click();

    await expect(page.getByText("Test document content 4")).toBeVisible();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click({modifiers: ["Shift"]});

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();
});

test("remembers peek state across page reloads", async ({context: browserContext, page}, {
    project,
}) => {
    const document5 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 5"),
    });

    const document4 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 4"),
    });

    const document3 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 3"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 4", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document4.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    const document2 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 2"),
    });

    const document1 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 1"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 2", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document2.id}`,
                        }),
                    ]),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 3", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document3.id}`,
                        }),
                    ]),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 5", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document5.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    await server.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    await expect(page.getByText("Test document content 5")).toBeHidden();
    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 2"}).click();

    await expect(page.getByText("Test document content 5")).toBeHidden();
    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 3"}).click();

    await expect(page.getByText("Test document content 5")).toBeHidden();
    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeVisible();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 4"}).click();

    await expect(page.getByText("Test document content 5")).toBeHidden();
    await expect(page.getByText("Test document content 4")).toBeVisible();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 5"}).click();

    await expect(page.getByText("Test document content 5")).toBeVisible();
    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.reload();

    // Firefox appears to not remember `sessionStorage` across page reloads. This
    // is fine.
    if (project.name === "firefox") {
        await expect(page.getByText("Test document content 1")).toBeVisible();
        await expect(page.getByText("Test document content 2")).toBeHidden();
        await expect(page.getByText("Test document content 3")).toBeHidden();
        await expect(page.getByText("Test document content 4")).toBeHidden();
        await expect(page.getByText("Test document content 5")).toBeHidden();
        return;
    }

    await expect(page.getByText("Test document content 5")).toBeVisible();
    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 5")).toBeHidden();
    await expect(page.getByText("Test document content 4")).toBeVisible();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Back"}).click();

    await expect(page.getByText("Test document content 5")).toBeHidden();
    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeVisible();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 5")).toBeHidden();
    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 5")).toBeHidden();
    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();
});

test("expand remembers peeks on the previous page except for the expanded peek", async ({
    context: browserContext,
    page,
}) => {
    const document4 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 4"),
    });

    const document3 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 3"),
    });

    const document2 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: createSimpleDocumentContent("Test document content 2"),
    });

    const document1 = await createDocument(context.action(session), {
        spaceId: space.id,
        content: assertDocumentContent(
            DocumentContentProsemirrorSchema.node("doc", {}, [
                DocumentContentProsemirrorSchema.node("title", {}, []),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Test document content 1"),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 2", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document2.id}`,
                        }),
                    ]),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 3", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document3.id}`,
                        }),
                    ]),
                ]),
                DocumentContentProsemirrorSchema.node("paragraph", {}, [
                    DocumentContentProsemirrorSchema.text("Link to 4", [
                        DocumentContentProsemirrorSchema.mark("link", {
                            url: `${server.getBaseUrl()}/s/${space.id}/documents/${document4.id}`,
                        }),
                    ]),
                ]),
            ]),
        ),
    });

    await server.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 2"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 3"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeVisible();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("link", {name: "Link to 4"}).click();

    await expect(page.getByText("Test document content 4")).toBeVisible();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Expand"}).click();

    await expect(page.getByText("Test document content 4")).toBeVisible();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeHidden();

    await page.goBack();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeVisible();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeVisible();
    await expect(page.getByText("Test document content 1")).toBeVisible();

    await page.getByRole("button", {name: "Close"}).click();

    await expect(page.getByText("Test document content 4")).toBeHidden();
    await expect(page.getByText("Test document content 3")).toBeHidden();
    await expect(page.getByText("Test document content 2")).toBeHidden();
    await expect(page.getByText("Test document content 1")).toBeVisible();
});

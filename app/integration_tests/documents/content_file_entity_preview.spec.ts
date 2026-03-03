import {Page, expect, test} from "@playwright/test";
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {sendChatMessage} from "~/server/chat/data/chat_messaging.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {getDocumentContent} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";

const {context, services} = createTestServices();

async function tapNewMessage(page: Page) {
    await expect(page.getByRole("button", {name: "Send message"})).toBeEnabled();

    // Make sure the keyboard toolbar isn't animating when we tap.
    await (await page
        .getByRole("button", {name: "Send message"})
        .elementHandle())!.waitForElementState("stable");

    await page.getByRole("button", {name: "Send message"}).tap();
    await expect(page.getByRole("button", {name: "Send message"})).toBeDisabled();
}

test("document file entity that doesn\u2019t exist", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {title: "foobar"});

    await document.update(session, [
        new ReplaceStep(
            8,
            10,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Document:${generateId()}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "foobar"})).toBeVisible();
    await expect(page.getByText("Couldn\u2019t find document")).toBeVisible();
    await expect(page.getByText("Private document")).toBeHidden();
});

test("document file entity we don\u2019t have access to", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document1 = await TestDocument.create(session1, {title: "foobar"});
    const document2 = await TestDocument.create(session2, {title: "quxbuz"});

    await document1.update(session1, [
        new ReplaceStep(
            8,
            10,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Document:${document2.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    await expect(page.getByRole("heading", {name: "foobar"})).toBeVisible();
    await expect(page.getByText("Private document")).toBeVisible();
    await expect(page.getByText("Couldn\u2019t find document")).toBeHidden();
    await expect(page.getByText("quxbuz")).toBeHidden();
});

test("document file entity", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document1 = await TestDocument.create(session, {title: "foobar"});
    const document2 = await TestDocument.create(session, {title: "quxbuz"});

    await document1.update(session, [
        new ReplaceStep(
            8,
            10,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Document:${document2.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    await expect(page.getByRole("heading", {name: "foobar"})).toBeVisible();
    await expect(page.getByText("quxbuz")).toBeVisible();
    await expect(page.getByText("Couldn\u2019t find document")).toBeHidden();
    await expect(page.getByText("Private document")).toBeHidden();
});

test("task collection file entity that doesn\u2019t exist", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {title: "foobar"});

    await document.update(session, [
        new ReplaceStep(
            8,
            10,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `TaskCollection:${generateId()}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "foobar"})).toBeVisible();
    await expect(page.getByText("Couldn\u2019t find task collection")).toBeVisible();
    await expect(page.getByText("Private task collection")).toBeHidden();
});

test("task collection file entity we don\u2019t have access to", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {title: "foobar"});
    const collection = await TestTaskCollection.create(session2, {name: "quxbuz"});

    await document.update(session1, [
        new ReplaceStep(
            8,
            10,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `TaskCollection:${collection.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "foobar"})).toBeVisible();
    await expect(page.getByText("Private task collection")).toBeVisible();
    await expect(page.getByText("Couldn\u2019t find task collection")).toBeHidden();
    await expect(page.getByText("quxbuz")).toBeHidden();
});

test("task collection file entity", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {title: "foobar"});
    const collection = await TestTaskCollection.create(session, {name: "quxbuz"});

    await document.update(session, [
        new ReplaceStep(
            8,
            10,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `TaskCollection:${collection.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "foobar"})).toBeVisible();
    await expect(page.getByText("quxbuz")).toBeVisible();
    await expect(page.getByText("Couldn\u2019t find task collection")).toBeHidden();
    await expect(page.getByText("Private task collection")).toBeHidden();
});

test("channel file entity that doesn\u2019t exist", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {title: "foobar"});

    await document.update(session, [
        new ReplaceStep(
            8,
            10,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Channel:${generateId()}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "foobar"})).toBeVisible();
    await expect(page.getByText("Couldn\u2019t find channel")).toBeVisible();
    await expect(page.getByText("Private channel")).toBeHidden();
});

test("channel file entity we don\u2019t have access to", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {title: "foobar"});

    const channel = await TestChannel.create(session2, {name: "quxbuz"});
    await channel.access.revokeDefault(session2);

    await document.update(session1, [
        new ReplaceStep(
            8,
            10,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Channel:${channel.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "foobar"})).toBeVisible();
    await expect(page.getByText("Private channel")).toBeVisible();
    await expect(page.getByText("Couldn\u2019t find channel")).toBeHidden();
    await expect(page.getByText("quxbuz")).toBeHidden();
});

test("channel file entity", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {title: "foobar"});
    const channel = await TestChannel.create(session, {name: "quxbuz"});

    await document.update(session, [
        new ReplaceStep(
            8,
            10,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Channel:${channel.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "foobar"})).toBeVisible();
    await expect(page.getByText("quxbuz")).toBeVisible();
    await expect(page.getByText("Couldn\u2019t find channel")).toBeHidden();
    await expect(page.getByText("Private channel")).toBeHidden();
});

test("chat file entity can load initial messages", async ({page, context: browserContext}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.createRoom(session1, {
        name: "Chat Preview Room",
        access: "Public",
    });

    for (let index = 0; index < 14; index++) {
        await chat.sendMessage(
            session1,
            `chat preview message ${index.toString().padStart(2, "0")}`,
        );
    }

    await chat.roomAccess.grant(session1, session2, "View");

    const documentTitle = "chat host";
    const document = await TestDocument.create(session1, {title: documentTitle});
    const replaceStart = documentTitle.length + 2;
    const replaceEnd = replaceStart + 2;
    await document.update(session1, [
        new ReplaceStep(
            replaceStart,
            replaceEnd,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Chat:${chat.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: documentTitle})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Chat Preview Room"})).toHaveCount(1);
    await expect(page.getByText("chat preview message 00")).toHaveCount(0);
    await expect(page.getByText("chat preview message 01")).toHaveCount(0);
    await expect(page.getByText("chat preview message 02")).toHaveCount(0);
    await expect(page.getByText("chat preview message 03")).toHaveCount(1);
    await expect(page.getByText("chat preview message 10")).toHaveCount(1);
    await expect(page.getByText("chat preview message 13")).toHaveCount(1);
});

test("can render recursive room chat file entity with a single self-referencing message", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const chat = await TestChat.createRoom(session, {
        name: "Recursive Chat Room",
        access: "Public",
    });

    const recursiveChatFileEntityId: FileEntityId = `Chat:${chat.id}`;
    await sendChatMessage(session.action(), {
        chatId: chat.id,
        parent: null,
        content: createSimpleMessageContent(""),
        fileIds: [recursiveChatFileEntityId],
        createdTimeZone: defaultTimeZone,
    });

    const documentTitle = "recursive chat host";
    const document = await TestDocument.create(session, {title: documentTitle});
    const replaceStart = documentTitle.length + 2;
    const replaceEnd = replaceStart + 2;
    await document.update(session, [
        new ReplaceStep(
            replaceStart,
            replaceEnd,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Chat:${chat.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: documentTitle})).toBeVisible();
    await expect(page.getByRole("heading", {name: "Recursive Chat Room"})).toHaveCount(3);
    await expect(page.getByText("Couldn\u2019t preview chat")).toHaveCount(0);
    await expect(page.getByText("Couldn\u2019t find chat")).toHaveCount(0);
    await expect(page.getByText("Private chat")).toHaveCount(0);
});

test("can render recursive file entity with 1 entity in row", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {title: "Doc 1"});

    await document.update(session, [
        new ReplaceStep(
            7,
            9,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Document:${document.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    const {updateContentPreview} = await getDocumentContent(session.action(), document.id);
    await updateContentPreview(session.action());

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "Doc 1"})).toHaveCount(4);
    await expect(page.getByText("Couldn\u2019t preview document")).toHaveCount(0);
    await expect(page.getByText("Couldn\u2019t find document")).toHaveCount(0);
});

test("can render recursive file entity with 2 entities in row", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {title: "Doc 2"});

    await document.update(session, [
        new ReplaceStep(
            7,
            9,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Document:${document.id}`}),
                        schema.node("file", {fileId: `Document:${document.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    const {updateContentPreview} = await getDocumentContent(session.action(), document.id);
    await updateContentPreview(session.action());

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "Doc 2"})).toHaveCount(15);
    await expect(page.getByText("Couldn\u2019t preview document")).toHaveCount(0);
    await expect(page.getByText("Couldn\u2019t find document")).toHaveCount(0);
});

test("can render recursive file entity with 3 entities in row", async ({
    page,
    context: browserContext,
}) => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session, {title: "Doc 3"});

    await document.update(session, [
        new ReplaceStep(
            7,
            9,
            new Slice(
                Fragment.from(
                    schema.node("fileRow", null, [
                        schema.node("file", {fileId: `Document:${document.id}`}),
                        schema.node("file", {fileId: `Document:${document.id}`}),
                        schema.node("file", {fileId: `Document:${document.id}`}),
                    ]),
                ),
                0,
                0,
            ),
        ),
    ]);

    const {updateContentPreview} = await getDocumentContent(session.action(), document.id);
    await updateContentPreview(session.action());

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document.id}`);

    await expect(page.getByRole("heading", {name: "Doc 3"})).toHaveCount(40);
    await expect(page.getByText("Couldn\u2019t preview document")).toHaveCount(0);
    await expect(page.getByText("Couldn\u2019t find document")).toHaveCount(0);
});

test("can paste URL to add file entity to document", async ({
    context: browserContext,
    page,
    viewport,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document1 = await TestDocument.create(session);
    await document1.access.grantDefault(session);

    const document2 = await TestDocument.create(session, {title: "foobar"});
    await document2.access.grantDefault(session);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    const url = new URL(`/s/${space.id}/documents/${document2.id}`, services.getBaseUrl());

    const canPrimaryInputHover = await page.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

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

    await expect(page.getByText("foobar")).toBeHidden();
    await expect(page.getByText("quxbuz")).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).evaluate((documentElement, url) => {
        const pasteEvent = new Event("paste", {bubbles: true, cancelable: true});

        Object.assign(pasteEvent, {
            clipboardData: {
                types: ["text/plain"],
                getData: (type: string) => {
                    if (type !== "text/plain") return null;
                    return url;
                },
            },
        });

        documentElement.dispatchEvent(pasteEvent);
    }, url.toString());

    await expect(page.getByText("foobar")).toBeVisible();
    await expect(page.getByText("quxbuz")).toBeHidden();
});

test("can paste URL to add file entity to document with blobs cover", async ({
    context: browserContext,
    page,
    viewport,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const session = await space.createSession();
    await services.signIn(browserContext, session);

    const document0 = await TestDocument.create(session);
    await document0.access.grantDefault(session);

    const document1 = await TestDocument.create(session, {
        title: "foo",
        cover: {
            type: "Blobs",
            seed: "a",
            themeColor: "blue",
            hueSpread: 10,
        },
    });
    await document1.access.grantDefault(session);
    const document1Content = await getDocumentContent(session.action(), document1.id);
    await document1Content.updateContentPreview(session.action());

    const document2 = await TestDocument.create(session, {
        title: "bar",
        cover: {
            type: "Blobs",
            seed: "b",
            themeColor: "red",
            hueSpread: 15,
        },
    });
    await document2.access.grantDefault(session);
    const document2Content = await getDocumentContent(session.action(), document2.id);
    await document2Content.updateContentPreview(session.action());

    await page.goto(`/s/${space.id}/documents/${document0.id}`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    const canPrimaryInputHover = await page.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

    const contentEditor = page.getByRole("textbox", {name: "Document"});
    await contentEditor.focus();

    if (canPrimaryInputHover) {
        await contentEditor.click({
            position: {x: viewport.width / 2, y: viewport.height - 100},
        });
    } else {
        await page
            .getByRole("textbox", {name: "Document"})
            .tap({position: {x: viewport.width / 2, y: viewport.height - 150}});
    }

    // This validates we can render different blobs As well as the same blobs multiple
    // times
    const documentPasteOrder = [document1, document2, document1];
    const expectedCoverBlobsData = [
        document1Content.content.attrs.cover,
        document2Content.content.attrs.cover,
        document1Content.content.attrs.cover,
    ];

    for (const document of documentPasteOrder) {
        await page.keyboard.press("Enter");
        await page.keyboard.type("1");
        await page.keyboard.press("Enter");
        await new Promise(resolve => setTimeout(resolve, 1000));
        const url = new URL(`/s/${space.id}/documents/${document.id}`, services.getBaseUrl());

        await contentEditor.evaluate((documentElement, url) => {
            const pasteEvent = new Event("paste", {bubbles: true, cancelable: true});

            Object.assign(pasteEvent, {
                clipboardData: {
                    types: ["text/plain"],
                    getData: (type: string) => {
                        if (type !== "text/plain") return null;
                        return url;
                    },
                },
            });

            documentElement.dispatchEvent(pasteEvent);
        }, url.toString());
    }

    // Check all the covers, make sure they are the correct blob data
    const covers = page.getByTestId("BlobsArtCanvas");
    await expect(covers).toHaveCount(3);

    const coverElements = await covers.elementHandles();
    const coverBlobsData = await Promise.all(
        coverElements.map(coverElement =>
            coverElement?.evaluate(e => ({
                type: "Blobs",
                seed: (e as any)._blobsDrawn.seed as string,
                themeColor: (e as any)._blobsDrawn.themeColor as ThemeColor,
                hueSpread: (e as any)._blobsDrawn.hueSpread as number,
            })),
        ),
    );

    // our blob data should match the order we pasted the urls
    expect(coverBlobsData).toEqual(expectedCoverBlobsData);
});

test("can paste `<iframe>` HTML to add file entity to document", async ({
    context: browserContext,
    page,
    viewport,
}) => {
    assert(viewport);

    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document1 = await TestDocument.create(session);
    await document1.access.grantDefault(session);

    const document2 = await TestDocument.create(session, {title: "foobar"});
    await document2.access.grantDefault(session);

    const document3 = await TestDocument.create(session, {title: "quxbuz"});
    await document3.access.grantDefault(session);

    await services.signIn(browserContext, session);
    await page.goto(`/s/${space.id}/documents/${document1.id}`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    const url1 = new URL(`/s/${space.id}/documents/${document2.id}`, services.getBaseUrl());
    const url2 = new URL(`/s/${space.id}/documents/${document3.id}`, services.getBaseUrl());

    const canPrimaryInputHover = await page.evaluate(
        () => !window.matchMedia("(hover: none)").matches,
    );

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

    await expect(page.getByText("foobar")).toBeHidden();
    await expect(page.getByText("quxbuz")).toBeHidden();

    await page.getByRole("textbox", {name: "Document"}).evaluate(
        (documentElement, [url1, url2]) => {
            const pasteEvent = new Event("paste", {bubbles: true, cancelable: true});

            Object.assign(pasteEvent, {
                clipboardData: {
                    types: ["text/html"],
                    getData: (type: string) => {
                        if (type !== "text/html") return null;
                        // eslint-disable-next-line cyberworlds/string-quotes
                        return `<iframe src="${url1}"></iframe><iframe src="${url2}"></iframe>`;
                    },
                },
            });

            documentElement.dispatchEvent(pasteEvent);
        },
        [url1.toString(), url2.toString()],
    );

    await expect(page.getByText("foobar")).toBeVisible();
    await expect(page.getByText("quxbuz")).toBeVisible();
});

test("can paste URL to add file entity to chat", async ({
    context: browserContext,
    page,
    isMobile,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);

    const document = await TestDocument.create(session1, {title: "foobar"});
    await document.access.grantDefault(session1);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/${chat.id}`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    const url = new URL(`/s/${space.id}/documents/${document.id}`, services.getBaseUrl());

    await expect(page.getByTestId("MessageInput").getByText("foobar")).toBeHidden();
    await expect(page.getByTestId(/^MessageView:/).getByText("foobar")).toBeHidden();
    await expect(page.getByText("foobar")).toBeHidden();
    await expect(page.getByText("quxbuz")).toBeHidden();

    await page.getByLabel("New message").focus();

    await page.getByLabel("New message").evaluate((messageInputElement, url) => {
        const pasteEvent = new Event("paste", {bubbles: true, cancelable: true});

        Object.assign(pasteEvent, {
            clipboardData: {
                types: ["text/plain"],
                getData: (type: string) => {
                    if (type !== "text/plain") return null;
                    return url;
                },
            },
        });

        messageInputElement.dispatchEvent(pasteEvent);
    }, url.toString());

    await expect(page.getByTestId("MessageInput").getByText("foobar")).toBeVisible();
    await expect(page.getByTestId(/^MessageView:/).getByText("foobar")).toBeHidden();
    await expect(page.getByText("foobar")).toBeVisible();
    await expect(page.getByText("quxbuz")).toBeHidden();

    if (!isMobile) {
        await page.getByLabel("New message").press("Enter");
    } else {
        await tapNewMessage(page);
    }

    await expect(page.getByTestId("MessageInput").getByText("foobar")).toBeHidden();
    await expect(page.getByTestId(/^MessageView:/).getByText("foobar")).toBeVisible();
    await expect(page.getByText("foobar")).toBeVisible();
    await expect(page.getByText("quxbuz")).toBeHidden();
});

test("can paste `<iframe>` HTML to add file entity to chat", async ({
    context: browserContext,
    page,
    isMobile,
}) => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const chat = await TestChat.get(session1, session2);

    const document1 = await TestDocument.create(session1, {title: "foobar"});
    await document1.access.grantDefault(session1);

    const document2 = await TestDocument.create(session1, {title: "quxbuz"});
    await document2.access.grantDefault(session1);

    await services.signIn(browserContext, session1);
    await page.goto(`/s/${space.id}/chat/${chat.id}`);

    // Wait for React to mount
    await page.waitForFunction("dev.ready");

    const url1 = new URL(`/s/${space.id}/documents/${document1.id}`, services.getBaseUrl());
    const url2 = new URL(`/s/${space.id}/documents/${document2.id}`, services.getBaseUrl());

    await expect(page.getByTestId("MessageInput").getByText("foobar")).toBeHidden();
    await expect(page.getByTestId("MessageInput").getByText("quxbuz")).toBeHidden();
    await expect(page.getByTestId(/^MessageView:/).getByText("foobar")).toBeHidden();
    await expect(page.getByTestId(/^MessageView:/).getByText("quxbuz")).toBeHidden();
    await expect(page.getByText("foobar")).toBeHidden();
    await expect(page.getByText("quxbuz")).toBeHidden();

    await page.getByLabel("New message").focus();

    await page.getByLabel("New message").evaluate(
        (messageInputElement, [url1, url2]) => {
            const pasteEvent = new Event("paste", {bubbles: true, cancelable: true});

            Object.assign(pasteEvent, {
                clipboardData: {
                    types: ["text/html"],
                    getData: (type: string) => {
                        if (type !== "text/html") return null;
                        // eslint-disable-next-line cyberworlds/string-quotes
                        return `<iframe src="${url1}"></iframe><iframe src="${url2}"></iframe>`;
                    },
                },
            });

            messageInputElement.dispatchEvent(pasteEvent);
        },
        [url1.toString(), url2.toString()],
    );

    await expect(page.getByTestId("MessageInput").getByText("foobar")).toBeVisible();
    await expect(page.getByTestId("MessageInput").getByText("quxbuz")).toBeVisible();
    await expect(page.getByTestId(/^MessageView:/).getByText("foobar")).toBeHidden();
    await expect(page.getByTestId(/^MessageView:/).getByText("quxbuz")).toBeHidden();
    await expect(page.getByText("foobar")).toBeVisible();
    await expect(page.getByText("quxbuz")).toBeVisible();

    if (!isMobile) {
        await page.getByLabel("New message").press("Enter");
    } else {
        await tapNewMessage(page);
    }

    await expect(page.getByTestId("MessageInput").getByText("foobar")).toBeHidden();
    await expect(page.getByTestId("MessageInput").getByText("quxbuz")).toBeHidden();
    await expect(page.getByTestId(/^MessageView:/).getByText("foobar")).toBeVisible();
    await expect(page.getByTestId(/^MessageView:/).getByText("quxbuz")).toBeVisible();
    await expect(page.getByText("foobar")).toBeVisible();
    await expect(page.getByText("quxbuz")).toBeVisible();
});

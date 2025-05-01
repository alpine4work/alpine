import {expect, test} from "@playwright/test";
import {Fragment, Slice} from "prosemirror-model";
import {ReplaceStep} from "prosemirror-transform";
import {createTestServices} from "~/app/integration_tests/helpers/create_test_services.js";
import {withDebugPagePause} from "~/app/integration_tests/helpers/with_debug_page_pause.js";
import {getDocumentContent} from "~/server/documents/data/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestTaskCollection} from "~/server/tasks/test_helpers/test_task_collection.js";
import {DocumentContentProsemirrorSchema as schema} from "~/shared/documents/document_content_schema.js";
import {generateId} from "~/shared/id/id.js";

const {context, services} = createTestServices();

test("document file entity that doesn't exist", async ({page, context: browserContext}) => {
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
    await expect(page.getByText("Couldn’t find document")).toBeVisible();
    await expect(page.getByText("Private document")).toBeHidden();
});

test("document file entity we don't have access to", async ({page, context: browserContext}) => {
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
    await expect(page.getByText("Couldn’t find document")).toBeHidden();
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
    await expect(page.getByText("Couldn’t find document")).toBeHidden();
    await expect(page.getByText("Private document")).toBeHidden();
});

test("task collection file entity that doesn't exist", async ({page, context: browserContext}) => {
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
    await expect(page.getByText("Couldn’t find task collection")).toBeVisible();
    await expect(page.getByText("Private task collection")).toBeHidden();
});

test("task collection file entity we don't have access to", async ({
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
    await expect(page.getByText("Couldn’t find task collection")).toBeHidden();
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
    await expect(page.getByText("Couldn’t find task collection")).toBeHidden();
    await expect(page.getByText("Private task collection")).toBeHidden();
});

test("channel file entity that doesn't exist", async ({page, context: browserContext}) => {
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
    await expect(page.getByText("Couldn’t find channel")).toBeVisible();
    await expect(page.getByText("Private channel")).toBeHidden();
});

test("channel file entity we don't have access to", async ({page, context: browserContext}) => {
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
    await expect(page.getByText("Couldn’t find channel")).toBeHidden();
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
    await expect(page.getByText("Couldn’t find channel")).toBeHidden();
    await expect(page.getByText("Private channel")).toBeHidden();
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
    await expect(page.getByText("Couldn’t preview document")).toHaveCount(0);
    await expect(page.getByText("Couldn’t find document")).toHaveCount(0);
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
    await expect(page.getByText("Couldn’t preview document")).toHaveCount(0);
    await expect(page.getByText("Couldn’t find document")).toHaveCount(0);
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
    await expect(page.getByText("Couldn’t preview document")).toHaveCount(0);
    await expect(page.getByText("Couldn’t find document")).toHaveCount(0);
});

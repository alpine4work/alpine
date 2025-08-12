import {Fragment, Mark, Slice} from "prosemirror-model";
import {
    AddMarkStep,
    AddNodeMarkStep,
    AttrStep,
    DocAttrStep,
    RemoveMarkStep,
    RemoveNodeMarkStep,
    ReplaceAroundStep,
    ReplaceStep,
    Step,
} from "prosemirror-transform";
import {
    DocumentContentCacheForUpdate,
    FileDocumentAuthorizer,
    authorizeDocumentAccess,
    authorizeDocumentAccessIfPossible,
    batchGetDocumentCommentThreadReferencesIfExists,
    confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency,
    createDocument,
    createDocumentComment,
    deleteDocumentComment,
    documentContentCacheEvictionTimeoutMs,
    getDocument,
    getDocumentAndCommentThreadsWithInitialComments,
    getDocumentComment,
    getDocumentCommentAuthorId,
    getDocumentCommentThread,
    getDocumentCommentThreadAndInitialComments,
    getDocumentCommentThreadAndInitialCommentsIfExists,
    getDocumentCommentThreadItemAfterFirstGetItemTestCheckpoint,
    getDocumentCommentThreadNotificationSubscribers,
    getDocumentCommentsFromEnd,
    getDocumentCommentsFromStart,
    getDocumentContent,
    getDocumentContentForCollaborationServiceInitialization,
    getDocumentContentPreviewIfExists,
    getDocumentContentPreviewIfPossible,
    getDocumentContentSteps,
    getDocumentContentWithOptionalComments,
    getDocumentPreview,
    getDocumentPreviewIfExists,
    getDocumentTitleIfExists,
    getDocumentWithOptionalComments,
    getDocumentWithOptionalCommentsIfExists,
    getDocumentsTableForTest,
    getInternalDocumentTestCounter,
    getResolvedDocumentCommentThreadRanges,
    updateDocumentCommentContent,
    updateDocumentContent,
    updateDocumentContentBeforeExecuteTransactionTestCheckpoint,
    updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint,
    updateDocumentSnapshotForTest,
} from "~/server/documents/data/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {attachFileAsUploader} from "~/server/files/data/files_table.js";
import {TestFile} from "~/server/files/test_helpers/test_file.js";
import {removeSpaceAccount} from "~/server/spaces/spaces_table.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {AccessLevel, AccessPolicy} from "~/shared/access/access_policy.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {emptyDocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {
    assertDocumentContent,
    assertDocumentWithOptionalTitleContent,
    createEmptyDocumentContent,
    isDocumentContent,
    DocumentContentProsemirrorSchema as schema,
    DocumentWithOptionalTitleContentProsemirrorSchema as schema2,
} from "~/shared/documents/document_content_schema.js";
import {DocumentCommentThreadModel, DocumentModel} from "~/shared/documents/document_model.js";
import {
    DataLossError,
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
    UnauthenticatedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    ContentEditorClientId,
    DocumentCommentThreadId,
    DocumentId,
} from "~/shared/id/types/id_types.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
    createSimpleMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {
    AddMarksAfterRemoveAllStep,
    RemoveAllMarksStep,
} from "~/shared/prosemirror/remove_all_marks_step.js";
import {createTestAccountModel} from "~/shared/spaces/test_helpers/account_model_test_helpers.js";

import.meta.jest.useFakeTimers();

const context = createTestContext();

function textSlice(text: string, marks: ReadonlyArray<Mark> = []) {
    if (text.length === 0) return Slice.empty;
    return new Slice(Fragment.from(schema.text(text, marks)), 0, 0);
}

/**
 * Convert document into a form we can do a deep equality test on.
 */
function massageDocument(document: DocumentModel) {
    return {
        version: document.version,
        content: document.content.doc.toJSON(),
    };
}

const otherCache = new DocumentContentCacheForUpdate();

beforeEach(() => {
    import.meta.jest.useFakeTimers();
});

afterEach(() => {
    const hadNoTimers = import.meta.jest.getTimerCount() === 0;
    import.meta.jest.clearAllTimers();
    import.meta.jest.useRealTimers();
    assert(hadNoTimers, "Expected all timers to be cleaned up by the end of each test");
});

test("creates a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await createDocument(session.action(), {spaceId: space.id});
});

test("can not create a document with the same id twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const id = generateId<DocumentId>();

    const content = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    await createDocument(session.action(), {
        id,
        spaceId: space.id,
    });

    await expect(async () => {
        await createDocument(session.action(), {
            id,
            spaceId: space.id,
            content,
        });
    }).rejects.toThrow(FailedPreconditionError);
});

test("can not create a document with invalid format", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const content = schema.nodes.doc.create({}, [
        schema.nodes.title.create({}, [schema.text("Foo bar")]),
        schema.nodes.unorderedListItem.create({}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    await expect(
        createDocument(session.action(), {
            spaceId: space.id,
            content,
        }),
    ).rejects.toThrow(InvalidArgumentError);
});

test("can not idempotently create a document twice", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const id = generateId<DocumentId>();

    await createDocument(session.action(), {
        id,
        spaceId: space.id,
    });

    await expect(async () => {
        await createDocument(session.action(), {
            id,
            spaceId: space.id,
        });
    }).rejects.toThrow(FailedPreconditionError);
});

test("can not idempotently create a document twice if the content is different", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const id = generateId<DocumentId>();

    await createDocument(session.action(), {
        id,
        spaceId: space.id,
    });

    const otherContent = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(otherContent));

    await expect(async () => {
        await createDocument(session.action(), {
            id,
            spaceId: space.id,
            content: otherContent,
        });
    }).rejects.toThrow(FailedPreconditionError);
});

test("can read a created document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const content = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    const {id: documentId} = await createDocument(session.action(), {
        spaceId: space.id,
        content,
    });

    expect(
        massageDocument(await getDocumentWithOptionalComments(session.action(), documentId)),
    ).toEqual({
        version: 0,
        content: content.toJSON(),
    });
    expect((await getDocumentTitleIfExists(session.action(), documentId))?.title).toEqual(
        "Foo bar",
    );
    expect((await getDocumentContent(session.action(), documentId)).content.toJSON()).toEqual(
        content.toJSON(),
    );
    expect(await getDocumentPreviewIfExists(session.action(), documentId)).toEqual({
        id: documentId,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 0,
        titleWithoutFallback: "Foo bar",
        accessPolicy: content.attrs.accessPolicy,
    });
});

test("can update a document with a single step", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });
});

test("can update a document with multiple steps", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 4,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });
});

test("can not update a document if the version is greater than the current version", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await expect(async () => {
        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 2,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });
});

test("can update a document if the version is one less than the current version", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("c"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });
});

test("can update a document if the version is many steps behind the current version", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 5,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("f"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 6,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    });
});

test("can update a document with many steps if the version is one less than the current version", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [
            new ReplaceStep(4, 4, textSlice("c")),
            new ReplaceStep(5, 5, textSlice("d")),
            new ReplaceStep(6, 6, textSlice("e")),
            new ReplaceStep(7, 7, textSlice("f")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 6,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    });
});

test("can update a document with many steps if the version is many steps behind the current version", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 5,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [
            new ReplaceStep(4, 4, textSlice("f")),
            new ReplaceStep(5, 5, textSlice("g")),
            new ReplaceStep(6, 6, textSlice("h")),
            new ReplaceStep(7, 7, textSlice("i")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 9,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdefghi")]),
            ])
            .toJSON(),
    });
});

test("when two document updates race the loser will rebase", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    const request2ClientId = generateId<ContentEditorClientId>();
    const request2PausePromise =
        updateDocumentContentBeforeExecuteTransactionTestCheckpoint.pauseForTest({
            id: document.id,
            clientId: request2ClientId,
        });
    const request2Promise = updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: request2ClientId,
    });

    const {unpause: unpauseRequest2} = await request2PausePromise;

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("c"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ac")]),
            ])
            .toJSON(),
    });

    unpauseRequest2();

    await request2Promise;

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("acb")]),
            ])
            .toJSON(),
    });
});

test("can not apply an invalid step", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await expect(async () => {
        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(5, 5, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });
});

test("can not apply an invalid step even when rebasing", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    await expect(async () => {
        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(5, 5, textSlice("c"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(FailedPreconditionError);

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });
});

test("a single rebased step may end up as a noop", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobar"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(6, 6, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foar")]),
            ])
            .toJSON(),
    });
});

test("many rebased steps may end up as a noop", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobur"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobur")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("four")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [
            new ReplaceStep(6, 6, textSlice("x")),
            new ReplaceStep(7, 7, textSlice("y")),
            new ReplaceStep(8, 8, textSlice("z")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("four")]),
            ])
            .toJSON(),
    });
});

test("some rebased steps may end up as a noop", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foobur"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobur")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(5, 7, Slice.empty)],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("four")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [
            new ReplaceStep(6, 6, textSlice("x")),
            new ReplaceStep(7, 7, textSlice("y")),
            new ReplaceStep(11, 11, textSlice("z")),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("fourz")]),
            ])
            .toJSON(),
    });
});

test("reads the document on first update but not on subsequent updates", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    const {getCount} = getInternalDocumentTestCounter.recordForTest(document.id);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await document.get())).toEqual({
        version: 4,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);
});

test("can’t update a document that doesn’t exist", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const documentId = generateId<DocumentId>();

    await expect(async () => {
        await updateDocumentContent(session.action(), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);
});

test("won’t cache a document that doesn’t exist when updating", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const documentId = generateId<DocumentId>();

    const {getCount} = getInternalDocumentTestCounter.recordForTest(documentId);
    expect(getCount()).toEqual(0);

    await expect(async () => {
        await updateDocumentContent(session.action(), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);

    expect(getCount()).toEqual(1);

    await expect(async () => {
        await updateDocumentContent(session.action(), {
            id: documentId,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);

    expect(getCount()).toEqual(2);
});

test("can’t read a corrupted document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await getDocumentsTableForTest().deleteItemWithKey(context, {
        partitionType: "Document",
        documentId: document.id,
        sortRangeType: "Snapshot",
    });

    await expect(async () => {
        await document.get();
    }).rejects.toThrow(DataLossError);
});

test("can’t update a corrupted document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await getDocumentsTableForTest().deleteItemWithKey(context, {
        partitionType: "Document",
        documentId: document.id,
        sortRangeType: "Snapshot",
    });

    await expect(async () => {
        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(DataLossError);
});

test("won’t cache a corrupted document while updating", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await getDocumentsTableForTest().deleteItemWithKey(context, {
        partitionType: "Document",
        documentId: document.id,
        sortRangeType: "Snapshot",
    });

    const {getCount} = getInternalDocumentTestCounter.recordForTest(document.id);
    expect(getCount()).toEqual(0);

    await expect(async () => {
        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(DataLossError);

    expect(getCount()).toEqual(1);

    await expect(async () => {
        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(DataLossError);

    expect(getCount()).toEqual(2);
});

test("updates made in parallel will read the document once", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    const {getCount} = getInternalDocumentTestCounter.recordForTest(document.id);
    expect(getCount()).toEqual(0);

    const request1Promise = updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    const request2Promise = updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("b")), new ReplaceStep(4, 4, textSlice("c"))],
        clientId: generateId(),
    });

    const request3Promise = updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("d"))],
        clientId: generateId(),
    });

    const request4Promise = updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("e"))],
        clientId: generateId(),
    });

    const request5Promise = updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("f"))],
        clientId: generateId(),
    });

    await runAllPromises([
        request1Promise,
        request2Promise,
        request3Promise,
        request4Promise,
        request5Promise,
    ]);

    expect(getCount()).toEqual(1);

    {
        const documentResult = await document.get();
        expect(documentResult.version).toEqual(6);
        expect(documentResult.content.doc.child(1).textContent.split("").sort().join("")).toEqual(
            "abcdef",
        );
    }
});

test("if a document was deleted in the database then the cache will pick that up", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    const {getCount} = getInternalDocumentTestCounter.recordForTest(document.id);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    await getDocumentsTableForTest().deleteItemWithKey(context, {
        partitionType: "Document",
        documentId: document.id,
        sortRangeType: "Attributes",
    });

    expect(getCount()).toEqual(1);

    await expect(async () => {
        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            clientId: generateId(),
        });
    }).rejects.toThrow(NotFoundError);

    expect(getCount()).toEqual(1);
});

test("updates may happen with different caches", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    const {getCount} = getInternalDocumentTestCounter.recordForTest(document.id);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await document.get())).toEqual({
        version: 4,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await document.get())).toEqual({
        version: 5,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
        cacheOverrideForTest: otherCache,
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await document.get())).toEqual({
        version: 6,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);
});

test("reads the document again after an expiration timer fires", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    const {getCount} = getInternalDocumentTestCounter.recordForTest(document.id);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    import.meta.jest.runAllTimers();

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await document.get())).toEqual({
        version: 4,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);
});

test("resets the timer eviction timer on every update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    const {getCount} = getInternalDocumentTestCounter.recordForTest(document.id);
    expect(getCount()).toEqual(0);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(1);

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(1);

    import.meta.jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("ab")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    import.meta.jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    expect(getCount()).toEqual(2);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abc")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    import.meta.jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    expect(getCount()).toEqual(2);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await document.get())).toEqual({
        version: 4,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcd")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    import.meta.jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs / 2);

    expect(getCount()).toEqual(2);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(2);

    expect(massageDocument(await document.get())).toEqual({
        version: 5,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcde")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(2);

    import.meta.jest.advanceTimersByTime(documentContentCacheEvictionTimeoutMs);

    expect(getCount()).toEqual(2);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
    });

    expect(getCount()).toEqual(3);

    expect(massageDocument(await document.get())).toEqual({
        version: 6,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("abcdef")]),
            ])
            .toJSON(),
    });

    expect(getCount()).toEqual(3);
});

test("updates the document title whenever it changes", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    expect(massageDocument(await document.get())).toEqual({
        version: 0,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(session.action(), document.id)).toEqual({
        id: document.id,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 0,
        titleWithoutFallback: "",
        accessPolicy: document.initialAccessPolicy,
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("b"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("b")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(session.action(), document.id)).toEqual({
        id: document.id,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 1,
        titleWithoutFallback: "",
        accessPolicy: document.initialAccessPolicy,
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(1, 1, textSlice("f"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, [schema.text("f")]),
                schema.node("paragraph", {}, [schema.text("b")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(session.action(), document.id)).toEqual({
        id: document.id,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 2,
        titleWithoutFallback: "f",
        accessPolicy: document.initialAccessPolicy,
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, [schema.text("f")]),
                schema.node("paragraph", {}, [schema.text("ba")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(session.action(), document.id)).toEqual({
        id: document.id,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 3,
        titleWithoutFallback: "f",
        accessPolicy: document.initialAccessPolicy,
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 3,
        steps: [new ReplaceStep(2, 2, textSlice("o")), new ReplaceStep(3, 3, textSlice("o"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 5,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("ba")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(session.action(), document.id)).toEqual({
        id: document.id,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 5,
        titleWithoutFallback: "foo",
        accessPolicy: document.initialAccessPolicy,
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("r"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 6,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(session.action(), document.id)).toEqual({
        id: document.id,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 6,
        titleWithoutFallback: "foo",
        accessPolicy: document.initialAccessPolicy,
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 6,
        steps: [
            new ReplaceStep(
                9,
                9,
                new Slice(
                    Fragment.from([schema.node("paragraph"), schema.node("paragraph")]),
                    1,
                    1,
                ),
                true,
            ),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 7,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, [schema.text("foo")]),
                schema.node("paragraph", {}, [schema.text("bar")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(session.action(), document.id)).toEqual({
        id: document.id,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 7,
        titleWithoutFallback: "foo",
        accessPolicy: document.initialAccessPolicy,
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 7,
        steps: [new ReplaceStep(4, 6, Slice.empty, true)],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 8,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, [schema.text("foobar")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
    expect(await getDocumentPreviewIfExists(session.action(), document.id)).toEqual({
        id: document.id,
        spaceId: space.id,
        createdTime: expect.any(Date),
        version: 8,
        titleWithoutFallback: "foobar",
        accessPolicy: document.initialAccessPolicy,
    });
});

test("resolves a conflict when typing in deleted content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo")), new ReplaceStep(6, 6, textSlice("bar"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(3, 9, textSlice(""))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(6, 6, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
});

test("resolves a conflict when typing in deleted content and the delete action itself was a conflict", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo")), new ReplaceStep(6, 6, textSlice("bar"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(1, 1, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, [schema.text("x")]),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(3, 9, textSlice(""))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 4,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, [schema.text("x")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(6, 6, textSlice("x"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 4,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, [schema.text("x")]),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
});

test("can read steps in a single transaction with many steps", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
        ],
        clientId: generateId(),
    });

    const massageSteps = (steps: Array<{step: Step}>) => steps.map(({step}) => step.toJSON());

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 0,
                endVersion: 6,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 1,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 2,
                endVersion: 4,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(5, 5, textSlice("c")), new ReplaceStep(6, 6, textSlice("d"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 3,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(6, 6, textSlice("d")), new ReplaceStep(7, 7, textSlice("e"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 2,
                endVersion: 3,
            }),
        ),
    ).toEqual([new ReplaceStep(5, 5, textSlice("c"))].map(step => step.toJSON()));
});

test("can read steps in individual transactions of single steps", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });
    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });
    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c"))],
        clientId: generateId(),
    });
    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 3,
        steps: [new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });
    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e"))],
        clientId: generateId(),
    });
    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 5,
        steps: [new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
    });

    const massageSteps = (steps: Array<{step: Step}>) => steps.map(({step}) => step.toJSON());

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 0,
                endVersion: 6,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 1,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 2,
                endVersion: 4,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(5, 5, textSlice("c")), new ReplaceStep(6, 6, textSlice("d"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 3,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(6, 6, textSlice("d")), new ReplaceStep(7, 7, textSlice("e"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 2,
                endVersion: 3,
            }),
        ),
    ).toEqual([new ReplaceStep(5, 5, textSlice("c"))].map(step => step.toJSON()));
});

test("can read steps in a couple multi-step transactions", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a")), new ReplaceStep(4, 4, textSlice("b"))],
        clientId: generateId(),
    });
    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(5, 5, textSlice("c")), new ReplaceStep(6, 6, textSlice("d"))],
        clientId: generateId(),
    });
    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 4,
        steps: [new ReplaceStep(7, 7, textSlice("e")), new ReplaceStep(8, 8, textSlice("f"))],
        clientId: generateId(),
    });

    const massageSteps = (steps: Array<{step: Step}>) => steps.map(({step}) => step.toJSON());

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 0,
                endVersion: 6,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(3, 3, textSlice("a")),
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
            new ReplaceStep(8, 8, textSlice("f")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 1,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [
            new ReplaceStep(4, 4, textSlice("b")),
            new ReplaceStep(5, 5, textSlice("c")),
            new ReplaceStep(6, 6, textSlice("d")),
            new ReplaceStep(7, 7, textSlice("e")),
        ].map(step => step.toJSON()),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 2,
                endVersion: 4,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(5, 5, textSlice("c")), new ReplaceStep(6, 6, textSlice("d"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 3,
                endVersion: 5,
            }),
        ),
    ).toEqual(
        [new ReplaceStep(6, 6, textSlice("d")), new ReplaceStep(7, 7, textSlice("e"))].map(step =>
            step.toJSON(),
        ),
    );

    expect(
        massageSteps(
            await getDocumentContentSteps(session.action(), {
                id: document.id,
                startVersion: 2,
                endVersion: 3,
            }),
        ),
    ).toEqual([new ReplaceStep(5, 5, textSlice("c"))].map(step => step.toJSON()));
});

test("can not create a document in a different space", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const content = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    await expect(
        createDocument(otherSession.action(), {
            spaceId: space.id,
            content,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can not read a created document in a different space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const content = schema.node("doc", {}, [
        schema.node("title", {}, [schema.text("Foo bar")]),
        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
    ]);
    assert(isDocumentContent(content));

    const {id: documentId} = await createDocument(otherSession.action(), {
        spaceId: otherSpace.id,
        content,
    });

    await expect(getDocumentWithOptionalComments(session.action(), documentId)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(getDocumentTitleIfExists(session.action(), documentId)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(getDocumentContent(session.action(), documentId)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(getDocumentPreviewIfExists(session.action(), documentId)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(getDocumentContentPreviewIfExists(session.action(), documentId)).rejects.toThrow(
        PermissionDeniedError,
    );
    expect(
        (await getDocumentContentPreviewIfPossible(session.action(), documentId))?.error,
    ).toBeInstanceOf(PermissionDeniedError);
});

test("can not update a document in a different space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();
    const document = await TestDocument.create(otherSession);

    await expect(
        updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(massageDocument(await document.get())).toEqual({
        version: 0,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });
});

test("can not update a cached document in a different space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();
    const document = await TestDocument.create(otherSession);

    await updateDocumentContent(otherSession.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(4, 4, textSlice("b"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });
});

test("can update a cached document after rejecting an update in a different space", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();
    const document = await TestDocument.create(otherSession);

    await expect(
        updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("a"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow(PermissionDeniedError);

    expect(massageDocument(await document.get())).toEqual({
        version: 0,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    await updateDocumentContent(otherSession.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("a"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("a")]),
            ])
            .toJSON(),
    });
});

test("can not update a document with an invalid step", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    {
        const document = await TestDocument.create(session);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [
                new ReplaceStep(
                    2,
                    4,
                    new Slice(
                        Fragment.from(
                            schema.node(`unorderedListItem`, {}, [
                                schema.node("paragraph", {}, [schema.text("test")]),
                            ]),
                        ),
                        0,
                        0,
                    ),
                ),
            ],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node(`unorderedListItem`, {}, [
                        schema.node("paragraph", {}, [schema.text("test")]),
                    ]),
                ])
                .toJSON(),
        });
    }

    {
        const document = await TestDocument.create(session);

        await expect(
            updateDocumentContent(session.action(), {
                id: document.id,
                version: 0,
                steps: [
                    new ReplaceStep(
                        2,
                        4,
                        new Slice(
                            Fragment.from(
                                schema.nodes.unorderedListItem.create({}, [schema.text("test")]),
                            ),
                            0,
                            0,
                        ),
                    ),
                ],
                clientId: generateId(),
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "Updated content for `unorderedListItem` node is not valid",
            ),
        );
    }
});

test("can not update a document such that it would have invalid content", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    {
        const document = await TestDocument.create(session);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [
                new ReplaceStep(
                    2,
                    4,
                    new Slice(
                        Fragment.from(
                            schema.node(`unorderedListItem`, {}, [
                                schema.node("paragraph", {}, [schema.text("test")]),
                            ]),
                        ),
                        0,
                        0,
                    ),
                ),
            ],
            clientId: generateId(),
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [
                new ReplaceAroundStep(
                    2,
                    10,
                    3,
                    9,
                    new Slice(Fragment.from([schema.nodes.orderedListItem.create()]), 0, 0),
                    1,
                    true,
                ),
            ],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node(`orderedListItem`, {}, [
                        schema.node("paragraph", {}, [schema.text("test")]),
                    ]),
                ])
                .toJSON(),
        });
    }

    {
        const document = await TestDocument.create(session);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [
                new ReplaceStep(
                    2,
                    4,
                    new Slice(
                        Fragment.from(
                            schema.node("quoteBlock", {}, [
                                schema.node(`unorderedListItem`, {}, [
                                    schema.node("paragraph", {}, [schema.text("test")]),
                                ]),
                            ]),
                        ),
                        0,
                        0,
                    ),
                ),
            ],
            clientId: generateId(),
        });

        await expect(
            updateDocumentContent(session.action(), {
                id: document.id,
                version: 1,
                steps: [
                    new ReplaceAroundStep(
                        2,
                        12,
                        3,
                        11,
                        new Slice(Fragment.from([schema.nodes.orderedListItem.create()]), 0, 0),
                        1,
                        true,
                    ),
                ],
                clientId: generateId(),
            }),
        ).rejects.toThrow(
            new FailedPreconditionError("Updated content for `orderedListItem` node is not valid"),
        );
    }
});

test("can not update a document with an invalid step even when there is a concurrent update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id} = await createDocument(session.action(), {spaceId: space.id});

    await updateDocumentContent(session.action(), {
        id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("test"))],
        clientId: generateId(),
    });

    await expect(
        updateDocumentContent(session.action(), {
            id,
            version: 0,
            steps: [
                new ReplaceStep(
                    2,
                    4,
                    new Slice(
                        Fragment.from(
                            schema.nodes.unorderedListItem.create({}, [schema.text("test")]),
                        ),
                        0,
                        0,
                    ),
                ),
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError("Updated content for `unorderedListItem` node is not valid"),
    );
});

test("can not add a newline character to an existing `codeBlockLine` node in a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from(
                        schema.node("codeBlock", {}, [
                            schema.node("codeBlockLine", {}, [schema.text("foobar")]),
                        ]),
                    ),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("codeBlock", {}, [
                    schema.node("codeBlockLine", {}, [schema.text("foobar")]),
                ]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(7, 7, textSlice("\n"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError("Can’t add `\\n` character to `codeBlockLine` node"),
    );

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("codeBlock", {}, [
                    schema.node("codeBlockLine", {}, [schema.text("foobar")]),
                ]),
            ])
            .toJSON(),
    });
});

test("can not add a newline character with a new `codeBlockLine` node in a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    await expect(
        updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [
                new ReplaceStep(
                    2,
                    4,
                    new Slice(
                        Fragment.from(
                            schema.node("codeBlock", {}, [
                                schema.node("codeBlockLine", {}, [schema.text("foo\nbar")]),
                            ]),
                        ),
                        0,
                        0,
                    ),
                ),
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError("Can’t add `\\n` character to `codeBlockLine` node"),
    );

    expect(massageDocument(await document.get())).toEqual({
        version: 0,
        content: createEmptyDocumentContent(session.account.id).toJSON(),
    });
});

test("can’t add comment mark to `fileRow` node in a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session);

    const file1 = await TestFile.create(session);
    const file2 = await TestFile.create(session);

    await attachFileAsUploader(
        session.action(),
        space.id,
        file1.id,
        FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
    );

    await attachFileAsUploader(
        session.action(),
        space.id,
        file2.id,
        FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
    );

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from(
                        schema.node("fileRow", {}, [
                            schema.node("file", {fileId: file1.id}),
                            schema.node("file", {fileId: file2.id}),
                        ]),
                    ),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    await expect(
        updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new AddNodeMarkStep(2, schema.marks.comment.create({commentThreadId}))],
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test comment"),
                    initialCommentFileIds: [],
                },
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Couldn’t apply step to content: Invalid content for node doc: <title, comment(fileRow(file, file))>",
        ),
    );

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}),
                schema.node("fileRow", {}, [
                    schema.node("file", {fileId: file1.id}),
                    schema.node("file", {fileId: file2.id}),
                ]),
            ])
            .toJSON(),
    });
});

test("can add comment mark to `file` node in a document with `fileRow` as a parent node", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session);

    const file1 = await TestFile.create(session);
    const file2 = await TestFile.create(session);

    await attachFileAsUploader(
        session.action(),
        space.id,
        file1.id,
        FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
    );

    await attachFileAsUploader(
        session.action(),
        space.id,
        file2.id,
        FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
    );

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from(
                        schema.node("fileRow", {}, [
                            schema.node("file", {fileId: file1.id}),
                            schema.node("file", {fileId: file2.id}),
                        ]),
                    ),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new AddNodeMarkStep(3, schema.marks.comment.create({commentThreadId}))],
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test comment"),
                initialCommentFileIds: [],
            },
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}),
                schema.node("fileRow", {}, [
                    schema.node(
                        "file",
                        {fileId: file1.id},
                        [],
                        [schema.mark("comment", {commentThreadId})],
                    ),
                    schema.node("file", {fileId: file2.id}),
                ]),
            ])
            .toJSON(),
    });
});

test("can’t add comment mark to `fileRowTable` node in a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);

    // Create and attach a single file
    const file = await TestFile.create(session);
    await attachFileAsUploader(
        session.action(),
        space.id,
        file.id,
        FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
    );

    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from(
                        schema.node("table", {}, [
                            schema.node("tableRow", {}, [
                                schema.node("tableCell", {}, [
                                    schema.node("fileRowTable", {}, [
                                        schema.node("file", {fileId: file.id}),
                                    ]),
                                ]),
                                // Table requires at least 2 cells per row
                                schema.node("tableCell", {}, [schema.node("paragraph", {})]),
                            ]),
                        ]),
                    ),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    // pos 3 for table
    await expect(
        updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new AddNodeMarkStep(3, schema.marks.comment.create({commentThreadId}))],
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test comment"),
                    initialCommentFileIds: [],
                },
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Couldn’t apply step to content: Invalid content for node table: <comment(tableRow(tableCell(fileRowTable(file)), t",
        ),
    );

    // pos 4 for tableRow
    await expect(
        updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new AddNodeMarkStep(4, schema.marks.comment.create({commentThreadId}))],
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test comment"),
                    initialCommentFileIds: [],
                },
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Couldn’t apply step to content: Invalid content for node tableRow: <comment(tableCell(fileRowTable(file))), tableCell",
        ),
    );

    // pos 5 for tableCell
    await expect(
        updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new AddNodeMarkStep(5, schema.marks.comment.create({commentThreadId}))],
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test comment"),
                    initialCommentFileIds: [],
                },
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Couldn’t apply step to content: Invalid content for node tableCell: <comment(fileRowTable(file))>",
        ),
    );

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}),
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("fileRowTable", {}, [
                                schema.node("file", {fileId: file.id}),
                            ]),
                        ]),
                        schema.node("tableCell", {}, [schema.node("paragraph", {})]),
                    ]),
                ]),
            ])
            .toJSON(),
    });
});

test("can add comment mark to `file` node in a document with `fileRowTable` as a parent node", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session);
    const file = await TestFile.create(session);

    await attachFileAsUploader(
        session.action(),
        space.id,
        file.id,
        FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
    );

    // First update: Create table structure with fileRowTable
    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 0,
        steps: [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from([
                        schema.node("table", {}, [
                            schema.node("tableRow", {}, [
                                schema.node("tableCell", {}, [
                                    schema.node("fileRowTable", {}, [
                                        schema.node("file", {fileId: file.id}),
                                    ]),
                                ]),
                                schema.node("tableCell", {}, [schema.node("paragraph", {})]),
                            ]),
                        ]),
                    ]),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    // Second update: Add comment mark
    await updateDocumentContent(session.action(), {
        id: document.id,
        version: 1,
        steps: [new AddNodeMarkStep(6, schema.marks.comment.create({commentThreadId}))],
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test comment"),
                initialCommentFileIds: [],
            },
        ],
        clientId: generateId(),
    });

    // Verify the document structure
    const doc = await document.get();
    expect(massageDocument(doc)).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}),
                schema.node("table", {}, [
                    schema.node("tableRow", {}, [
                        schema.node("tableCell", {}, [
                            schema.node("fileRowTable", {}, [
                                schema.node(
                                    "file",
                                    {fileId: file.id},
                                    [],
                                    [schema.mark("comment", {commentThreadId})],
                                ),
                            ]),
                        ]),
                        schema.node("tableCell", {}, [schema.node("paragraph", {})]),
                    ]),
                ]),
            ])
            .toJSON(),
    });
});

test("can’t add bold mark to `paragraph` node in a document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id} = await createDocument(session.action(), {spaceId: space.id});

    await expect(
        updateDocumentContent(session.action(), {
            id,
            version: 0,
            steps: [new AddNodeMarkStep(1, schema.marks.bold.create())],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError(
            // eslint-disable-next-line string-quotes
            "Couldn’t apply step to content: No node at mark step's position",
        ),
    );

    await expect(
        updateDocumentContent(session.action(), {
            id,
            version: 0,
            steps: [new AddNodeMarkStep(2, schema.marks.bold.create())],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Couldn’t apply step to content: Invalid content for node doc: <title, bold(paragraph)>",
        ),
    );

    await expect(
        updateDocumentContent(session.action(), {
            id,
            version: 0,
            steps: [new AddNodeMarkStep(3, schema.marks.bold.create())],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError(
            // eslint-disable-next-line string-quotes
            "Couldn’t apply step to content: No node at mark step's position",
        ),
    );
});

test("can not update a document such that it would have invalid content even when there is a concurrent update", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const {id} = await createDocument(session.action(), {spaceId: space.id});

    await updateDocumentContent(session.action(), {
        id,
        version: 0,
        steps: [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from(
                        schema.node("quoteBlock", {}, [
                            schema.node(`unorderedListItem`, {}, [
                                schema.node("paragraph", {}, [schema.text("test")]),
                            ]),
                        ]),
                    ),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId(),
    });

    await updateDocumentContent(session.action(), {
        id,
        version: 1,
        steps: [new ReplaceStep(7, 7, textSlice("eeeee"))],
        clientId: generateId(),
    });

    await expect(
        updateDocumentContent(session.action(), {
            id,
            version: 1,
            steps: [
                new ReplaceAroundStep(
                    2,
                    12,
                    3,
                    11,
                    new Slice(Fragment.from([schema.nodes.orderedListItem.create()]), 0, 0),
                    1,
                    true,
                ),
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        new FailedPreconditionError("Updated content for `orderedListItem` node is not valid"),
    );
});

test("counts step count contributions for each account", async () => {
    const DocumentsTable = getDocumentsTableForTest();

    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const document = await TestDocument.create(session1, {
        body: "Starts with some content.",
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map());

    await document.type(session1, " Adding another sentence.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map());

    await document.type(session2, " Yet another sentence.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map([[session2.account.id, 1]]));

    await document.type(session3, " A third sentence.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 1],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " I’m going to need to get more creative with test data.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 2],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " How", {secondText: " much wood"});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 4],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session1, " could a wood", {secondText: " chuck chuck"});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 4],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " if a wood chunk could chunk wood?");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 5],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session3, " Nice.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 5],
            [session3.account.id, 2],
        ]),
    );
});

test("counts step count contributions for each account with alternating cache", async () => {
    const DocumentsTable = getDocumentsTableForTest();

    const space = await TestSpace.create(context);
    const session1 = await space.createSession();
    const session2 = await space.createSession();
    const session3 = await space.createSession();

    const document = await TestDocument.create(session1, {
        body: "Starts with some content.",
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map());

    await document.type(session1, " Adding another sentence.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map());

    await document.type(session2, " Yet another sentence.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(new Map([[session2.account.id, 1]]));

    await document.type(session3, " A third sentence.", {cacheOverrideForTest: otherCache});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 1],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " I’m going to need to get more creative with test data.");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 2],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " How", {
        secondText: " much wood",
        cacheOverrideForTest: otherCache,
    });

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 4],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session1, " could a wood", {secondText: " chuck chuck"});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 4],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session2, " if a wood chunk could chunk wood?");

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 5],
            [session3.account.id, 1],
        ]),
    );

    await document.type(session3, " Nice.", {cacheOverrideForTest: otherCache});

    expect(
        await DocumentsTable.getItem(context, {
            partitionType: "Document",
            sortRangeType: "Attributes",
            documentId: document.id,
        }).then(item => item.stepCountByAccountId.get()),
    ).toEqual(
        new Map([
            [session2.account.id, 5],
            [session3.account.id, 2],
        ]),
    );
});

test("authorizing document access as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        title: "Test Document",
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeDocumentAccess(actionContext, document.id, "Manage"),
            authorizeDocumentAccess(actionContext, document.id, "Manage"),
            authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
        ]);

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);
    }
});

test("authorizing document access as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1] = await space.createSessions(1);

    const document = await TestDocument.create(session1, {
        title: "Test Document",
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await runAllPromises([
            authorizeDocumentAccess(actionContext, document.id, "Manage"),
            authorizeDocumentAccess(actionContext, document.id, "Manage"),
            authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
        ]);

        expect(getCount()).toEqual(1);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);
    }
});

test("authorizing document access after getting document as session actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        title: "Test Document",
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const commentThread = await document.createCommentThread(
        session1,
        {from: 1, to: 3},
        "Test Document Comment",
    );

    await ProcessContextModule.waitForTestTasks();

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getDocumentPreview(actionContext, document.id);

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getDocumentWithOptionalComments(actionContext, document.id);

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getDocumentContent(actionContext, document.id);

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getDocumentCommentThreadNotificationSubscribers(actionContext, {
            documentId: document.id,
            commentThreadId: commentThread.id,
            isFirstComment: false,
        });

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getDocumentCommentsFromStart(actionContext, {
            documentId: document.id,
            commentThreadId: commentThread.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(4);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(4);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(4);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(4);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getDocumentCommentsFromEnd(actionContext, {
            documentId: document.id,
            commentThreadId: commentThread.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(4);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(4);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(4);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(4);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = session2.action();

        expect(getCount()).toEqual(0);

        await getDocumentContentPreviewIfExists(actionContext, document.id);

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(2);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(2);
    }
});

test("authorizing document access after getting document as system actor is cached", async () => {
    const space = await TestSpace.create(context);
    const [session1] = await space.createSessions(1);

    const document = await TestDocument.create(session1, {
        title: "Test Document",
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const commentThread = await document.createCommentThread(
        session1,
        {from: 1, to: 3},
        "Test Document Comment",
    );

    const {getCount} = dynamoClientExecuteActionTestCounter.recordAllForTest();
    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getDocumentPreview(actionContext, document.id);

        expect(getCount()).toEqual(1);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getDocumentWithOptionalComments(actionContext, document.id);

        expect(getCount()).toEqual(1);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getDocumentContent(actionContext, document.id);

        expect(getCount()).toEqual(1);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getDocumentCommentThreadNotificationSubscribers(actionContext, {
            documentId: document.id,
            commentThreadId: commentThread.id,
            isFirstComment: false,
        });

        expect(getCount()).toEqual(1);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(1);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(1);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getDocumentCommentsFromStart(actionContext, {
            documentId: document.id,
            commentThreadId: commentThread.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(3);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(3);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }

    dynamoClientExecuteActionTestCounter.resetForTest();

    {
        const actionContext = space.systemAction();

        expect(getCount()).toEqual(0);

        await getDocumentCommentsFromEnd(actionContext, {
            documentId: document.id,
            commentThreadId: commentThread.id,
            limit: 100,
            afterCommentIndex: null,
            beforeCommentIndex: null,
        });

        expect(getCount()).toEqual(3);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(3);

        await authorizeDocumentAccess(actionContext, document.id, "Manage");

        expect(getCount()).toEqual(3);

        for (let i = 0; i < 5; i++) {
            await runAllPromises([
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccess(actionContext, document.id, "Manage"),
                authorizeDocumentAccessIfPossible(actionContext, document.id, "Manage"),
            ]);
        }

        expect(getCount()).toEqual(3);
    }
});

test("can convert `fileRow` to a `fileFloat` and change `fileFloat` direction", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    const document = await TestDocument.create(session);
    const file = await TestFile.create(session);

    await attachFileAsUploader(
        session.action(),
        space.id,
        file.id,
        FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
    );

    {
        const {newInvertedSteps} = await document.update(session, [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from(
                        schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                    ),
                    0,
                    0,
                ),
            ),
        ]);

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}),
                    schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                ])
                .toJSON(),
        });

        expect(newInvertedSteps.map(step => step.toJSON())).toEqual(
            [
                new ReplaceStep(
                    2,
                    5,
                    new Slice(Fragment.from(schema.node("paragraph", {}, [])), 0, 0),
                ),
            ].map(step => step.toJSON()),
        );
    }

    {
        const {newInvertedSteps} = await document.update(session, [
            new ReplaceStep(
                2,
                5,
                new Slice(
                    Fragment.from(
                        schema.node("fileFloat", {direction: "right"}, [
                            schema.node("file", {fileId: file.id}),
                        ]),
                    ),
                    0,
                    0,
                ),
            ),
        ]);

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}),
                    schema.node("fileFloat", {direction: "right"}, [
                        schema.node("file", {fileId: file.id}),
                    ]),
                ])
                .toJSON(),
        });

        expect(newInvertedSteps.map(step => step.toJSON())).toEqual(
            [
                new ReplaceStep(
                    2,
                    5,
                    new Slice(
                        Fragment.from(
                            schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                        ),
                        0,
                        0,
                    ),
                ),
            ].map(step => step.toJSON()),
        );
    }

    await expect(document.update(session, [new AttrStep(3, "direction", "left")])).rejects.toThrow(
        new FailedPreconditionError(
            "Couldn’t apply attr step to node `file` because it doesn’t support attr `direction`",
        ),
    );

    await expect(
        document.update(session, [new AttrStep(3, "direction", "left")], {versionOverride: 1}),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Couldn’t apply attr step to node `file` because it doesn’t support attr `direction`",
        ),
    );

    await expect(
        document.update(session, [new AttrStep(2, "direction", "left")], {versionOverride: 1}),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Couldn’t apply attr step to node `fileRow` because it doesn’t support attr `direction`",
        ),
    );

    await expect(
        document.update(session, [new AttrStep(3, "direction", "left")], {versionOverride: 0}),
    ).rejects.toThrow(
        new FailedPreconditionError(
            // eslint-disable-next-line string-quotes
            "Couldn’t apply step to content: No node at attribute step's position",
        ),
    );

    await expect(
        document.update(session, [new AttrStep(2, "direction", "left")], {versionOverride: 0}),
    ).rejects.toThrow(
        new FailedPreconditionError(
            "Couldn’t apply attr step to node `paragraph` because it doesn’t support attr `direction`",
        ),
    );

    {
        const {newInvertedSteps} = await document.update(session, [
            new AttrStep(2, "direction", "left"),
        ]);

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}),
                    schema.node("fileFloat", {direction: "left"}, [
                        schema.node("file", {fileId: file.id}),
                    ]),
                ])
                .toJSON(),
        });

        expect(newInvertedSteps.map(step => step.toJSON())).toEqual(
            [new AttrStep(2, "direction", "right")].map(step => step.toJSON()),
        );
    }
});

test("authorization fails if session has no access to document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1);

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await expect(authorize(session2, "View")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session2, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session2, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session2, "Manage")).rejects.toThrow(PermissionDeniedError);
});

test("authorization succeeds if session has access to document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await authorize(session2, "View");
    await authorize(session2, "Comment");
    await authorize(session2, "Edit");
    await authorize(session2, "Manage");
});

test("authorization succeeds at view level when session has view access to document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await authorize(session2, "View");
    await expect(authorize(session2, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session2, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session2, "Manage")).rejects.toThrow(PermissionDeniedError);

    await expect(authorize(session3, "View")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Manage")).rejects.toThrow(PermissionDeniedError);
});

test("authorization succeeds at comment level and below when session has comment access to document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Comment"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await authorize(session2, "View");
    await authorize(session2, "Comment");
    await expect(authorize(session2, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session2, "Manage")).rejects.toThrow(PermissionDeniedError);

    await expect(authorize(session3, "View")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Manage")).rejects.toThrow(PermissionDeniedError);
});

test("authorization succeeds at edit level and below when session has edit access to document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await authorize(session2, "View");
    await authorize(session2, "Comment");
    await authorize(session2, "Edit");
    await expect(authorize(session2, "Manage")).rejects.toThrow(PermissionDeniedError);

    await expect(authorize(session3, "View")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Manage")).rejects.toThrow(PermissionDeniedError);
});

test("authorization succeeds at manage level and below when session has manage access to document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await authorize(session2, "View");
    await authorize(session2, "Comment");
    await authorize(session2, "Edit");
    await authorize(session2, "Manage");

    await expect(authorize(session3, "View")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Manage")).rejects.toThrow(PermissionDeniedError);
});

test("authorization succeeds at view level when default grant has view access to document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "View"},
            urlGrant: null,
        },
    });

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await authorize(session2, "View");
    await expect(authorize(session2, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session2, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session2, "Manage")).rejects.toThrow(PermissionDeniedError);

    await authorize(session3, "View");
    await expect(authorize(session3, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Manage")).rejects.toThrow(PermissionDeniedError);
});

test("authorization succeeds at comment level and below when default grant has view access to document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Comment"},
            urlGrant: null,
        },
    });

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await authorize(session2, "View");
    await authorize(session2, "Comment");
    await expect(authorize(session2, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session2, "Manage")).rejects.toThrow(PermissionDeniedError);

    await authorize(session3, "View");
    await authorize(session3, "Comment");
    await expect(authorize(session3, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(session3, "Manage")).rejects.toThrow(PermissionDeniedError);
});

test("authorization succeeds at edit level and below when default grant has view access to document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Edit"},
            urlGrant: null,
        },
    });

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await authorize(session2, "View");
    await authorize(session2, "Comment");
    await authorize(session2, "Edit");
    await expect(authorize(session2, "Manage")).rejects.toThrow(PermissionDeniedError);

    await authorize(session3, "View");
    await authorize(session3, "Comment");
    await authorize(session3, "Edit");
    await expect(authorize(session3, "Manage")).rejects.toThrow(PermissionDeniedError);
});

test("authorization succeeds at manage level and below when default grant has view access to document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await authorize(session2, "View");
    await authorize(session2, "Comment");
    await authorize(session2, "Edit");
    await authorize(session2, "Manage");

    await authorize(session3, "View");
    await authorize(session3, "Comment");
    await authorize(session3, "Edit");
    await authorize(session3, "Manage");
});

test("authorization fails for session in another space", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        },
    });

    const authorize = async (session: TestSpaceSession, expectedAccessLevel: AccessLevel) => {
        const result = await authorizeDocumentAccessIfPossible(
            session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(session.action(), document.id, expectedAccessLevel);
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await authorize(session1, "View");
    await authorize(session1, "Comment");
    await authorize(session1, "Edit");
    await authorize(session1, "Manage");

    await authorize(session2, "View");
    await authorize(session2, "Comment");
    await authorize(session2, "Edit");
    await authorize(session2, "Manage");

    await expect(authorize(otherSession, "View")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(otherSession, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(otherSession, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(authorize(otherSession, "Manage")).rejects.toThrow(PermissionDeniedError);
});

test("authorization succeeds for session actor in the same space", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const document = await TestDocument.create(session1);

    const auth = async (
        session:
            | TestSpaceSession
            | TestSpace
            | "Anonymous"
            | {impersonate: TestSpaceSession | [TestSpace, TestSpaceSession]},
        expectedAccessLevel: AccessLevel,
    ) => {
        const result = await authorizeDocumentAccessIfPossible(
            session === "Anonymous"
                ? context.anonymousAction()
                : session instanceof TestSpace
                ? session.systemAction()
                : "impersonate" in session
                ? Array.isArray(session.impersonate)
                    ? context.impersonatedAccountAction(
                          session.impersonate[0].id,
                          session.impersonate[1].account.id,
                      )
                    : context.impersonatedAccountAction(
                          session.impersonate.space.id,
                          session.impersonate.account.id,
                      )
                : session.action(),
            document.id,
            expectedAccessLevel,
        );

        try {
            await authorizeDocumentAccess(
                session === "Anonymous"
                    ? context.anonymousAction()
                    : session instanceof TestSpace
                    ? session.systemAction()
                    : "impersonate" in session
                    ? Array.isArray(session.impersonate)
                        ? context.impersonatedAccountAction(
                              session.impersonate[0].id,
                              session.impersonate[1].account.id,
                          )
                        : context.impersonatedAccountAction(
                              session.impersonate.space.id,
                              session.impersonate.account.id,
                          )
                    : session.action(),
                document.id,
                expectedAccessLevel,
            );
            expect(result.ok).toEqual(true);
        } catch (error) {
            expect(result.ok).toEqual(false);
            expect(result.error).toEqual(error);
            throw error;
        }
    };

    await auth(session1, "View");
    await auth(session1, "Comment");
    await auth(session1, "Edit");
    await auth(session1, "Manage");

    await expect(auth(session2, "View")).rejects.toThrow(PermissionDeniedError);
    await expect(auth(session2, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(auth(session2, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(auth(session2, "Manage")).rejects.toThrow(PermissionDeniedError);

    await auth(space, "View");
    await auth(space, "Comment");
    await auth(space, "Edit");
    await auth(space, "Manage");

    await expect(auth(otherSession, "View")).rejects.toThrow(PermissionDeniedError);
    await expect(auth(otherSession, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(auth(otherSession, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(auth(otherSession, "Manage")).rejects.toThrow(PermissionDeniedError);

    await expect(auth(otherSpace, "View")).rejects.toThrow(PermissionDeniedError);
    await expect(auth(otherSpace, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(auth(otherSpace, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(auth(otherSpace, "Manage")).rejects.toThrow(PermissionDeniedError);

    await expect(auth("Anonymous", "View")).rejects.toThrow(UnauthenticatedError);
    await expect(auth("Anonymous", "Comment")).rejects.toThrow(UnauthenticatedError);
    await expect(auth("Anonymous", "Edit")).rejects.toThrow(UnauthenticatedError);
    await expect(auth("Anonymous", "Manage")).rejects.toThrow(UnauthenticatedError);

    await auth({impersonate: session1}, "View");
    await auth({impersonate: session1}, "Comment");
    await auth({impersonate: session1}, "Edit");
    await auth({impersonate: session1}, "Manage");

    await expect(auth({impersonate: session2}, "View")).rejects.toThrow(PermissionDeniedError);
    await expect(auth({impersonate: session2}, "Comment")).rejects.toThrow(PermissionDeniedError);
    await expect(auth({impersonate: session2}, "Edit")).rejects.toThrow(PermissionDeniedError);
    await expect(auth({impersonate: session2}, "Manage")).rejects.toThrow(PermissionDeniedError);

    await expect(auth({impersonate: [otherSpace, session1]}, "View")).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(auth({impersonate: [otherSpace, session1]}, "Comment")).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(auth({impersonate: [otherSpace, session1]}, "Edit")).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(auth({impersonate: [otherSpace, session1]}, "Manage")).rejects.toThrow(
        PermissionDeniedError,
    );
});

test("getting document with comments requires comment access level", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Comment"}],
                [session3.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    const commentThread = await document.createCommentThread(session1, range);

    {
        await getDocument(session1.action(), document.id);
        await getDocument(session2.action(), document.id);
        await expect(getDocument(session3.action(), document.id)).rejects.toThrow(
            "Actor doesn’t have `Comment` access level to document",
        );
        await expect(getDocument(session4.action(), document.id)).rejects.toThrow(
            "Actor doesn’t have `View` access level to document",
        );
        await expect(getDocument(otherSession.action(), document.id)).rejects.toThrow(
            "Account doesn’t have access to space",
        );
    }

    {
        await getDocumentContent(session1.action(), document.id);
        await getDocumentContent(session2.action(), document.id);
        await expect(getDocumentContent(session3.action(), document.id)).rejects.toThrow(
            "Actor doesn’t have `Comment` access level to document",
        );
        await expect(getDocumentContent(session4.action(), document.id)).rejects.toThrow(
            "Actor doesn’t have `View` access level to document",
        );
        await expect(getDocumentContent(otherSession.action(), document.id)).rejects.toThrow(
            "Account doesn’t have access to space",
        );
    }

    {
        await getDocumentContentForCollaborationServiceInitialization(
            session1.action(),
            document.id,
        );
        await getDocumentContentForCollaborationServiceInitialization(
            session2.action(),
            document.id,
        );
        await expect(
            getDocumentContentForCollaborationServiceInitialization(session3.action(), document.id),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentContentForCollaborationServiceInitialization(session4.action(), document.id),
        ).rejects.toThrow("Actor doesn’t have `View` access level to document");
        await expect(
            getDocumentContentForCollaborationServiceInitialization(
                otherSession.action(),
                document.id,
            ),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentAndCommentThreadsWithInitialComments(session1.action(), {
            documentId: document.id,
            commentThreadIds: [commentThread.id],
            commentLimit: 100,
            commentThreadCountAgainstLimit: 0,
        });
        await getDocumentAndCommentThreadsWithInitialComments(session2.action(), {
            documentId: document.id,
            commentThreadIds: [commentThread.id],
            commentLimit: 100,
            commentThreadCountAgainstLimit: 0,
        });
        await expect(
            getDocumentAndCommentThreadsWithInitialComments(session3.action(), {
                documentId: document.id,
                commentThreadIds: [commentThread.id],
                commentLimit: 100,
                commentThreadCountAgainstLimit: 0,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentAndCommentThreadsWithInitialComments(session4.action(), {
                documentId: document.id,
                commentThreadIds: [commentThread.id],
                commentLimit: 100,
                commentThreadCountAgainstLimit: 0,
            }),
        ).rejects.toThrow("Actor doesn’t have `View` access level to document");
        await expect(
            getDocumentAndCommentThreadsWithInitialComments(otherSession.action(), {
                documentId: document.id,
                commentThreadIds: [commentThread.id],
                commentLimit: 100,
                commentThreadCountAgainstLimit: 0,
            }),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    // Check that even when `commentThreadIds` is empty we still throw if the actor
    // only has view access to the document.
    {
        await getDocumentAndCommentThreadsWithInitialComments(session1.action(), {
            documentId: document.id,
            commentThreadIds: [],
            commentLimit: 100,
            commentThreadCountAgainstLimit: 0,
        });
        await getDocumentAndCommentThreadsWithInitialComments(session2.action(), {
            documentId: document.id,
            commentThreadIds: [],
            commentLimit: 100,
            commentThreadCountAgainstLimit: 0,
        });
        await expect(
            getDocumentAndCommentThreadsWithInitialComments(session3.action(), {
                documentId: document.id,
                commentThreadIds: [],
                commentLimit: 100,
                commentThreadCountAgainstLimit: 0,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentAndCommentThreadsWithInitialComments(session4.action(), {
                documentId: document.id,
                commentThreadIds: [],
                commentLimit: 100,
                commentThreadCountAgainstLimit: 0,
            }),
        ).rejects.toThrow("Actor doesn’t have `View` access level to document");
        await expect(
            getDocumentAndCommentThreadsWithInitialComments(otherSession.action(), {
                documentId: document.id,
                commentThreadIds: [],
                commentLimit: 100,
                commentThreadCountAgainstLimit: 0,
            }),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
            isFirstComment: true,
        });
        await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
            isFirstComment: true,
        });
        await expect(
            getDocumentCommentThreadNotificationSubscribers(session3.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                isFirstComment: true,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                isFirstComment: true,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentCommentThreadNotificationSubscribers(otherSession.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                isFirstComment: true,
            }),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentCommentThread(session1.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
        });
        await getDocumentCommentThread(session2.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
        });
        await expect(
            getDocumentCommentThread(session3.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentCommentThread(session4.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentCommentThread(otherSession.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentCommentAuthorId(session1.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
            commentIndex: 0,
        });
        await getDocumentCommentAuthorId(session2.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
            commentIndex: 0,
        });
        await expect(
            getDocumentCommentAuthorId(session3.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                commentIndex: 0,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentCommentAuthorId(session4.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                commentIndex: 0,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentCommentAuthorId(otherSession.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                commentIndex: 0,
            }),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await batchGetDocumentCommentThreadReferencesIfExists(session1.action(), {
            documentId: document.id,
            commentThreadIds: [commentThread.id],
        });
        await batchGetDocumentCommentThreadReferencesIfExists(session2.action(), {
            documentId: document.id,
            commentThreadIds: [commentThread.id],
        });
        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(session3.action(), {
                documentId: document.id,
                commentThreadIds: [commentThread.id],
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(session4.action(), {
                documentId: document.id,
                commentThreadIds: [commentThread.id],
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(otherSession.action(), {
                documentId: document.id,
                commentThreadIds: [commentThread.id],
            }),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentCommentThreadAndInitialComments(session1.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
            limit: 100,
        });
        await getDocumentCommentThreadAndInitialComments(session2.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
            limit: 100,
        });
        await expect(
            getDocumentCommentThreadAndInitialComments(session3.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                limit: 100,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentCommentThreadAndInitialComments(session4.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                limit: 100,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentCommentThreadAndInitialComments(otherSession.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                limit: 100,
            }),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentCommentThreadAndInitialCommentsIfExists(session1.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
            limit: 100,
        });
        await getDocumentCommentThreadAndInitialCommentsIfExists(session2.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
            limit: 100,
        });
        await expect(
            getDocumentCommentThreadAndInitialCommentsIfExists(session3.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                limit: 100,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentCommentThreadAndInitialCommentsIfExists(session4.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                limit: 100,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentCommentThreadAndInitialCommentsIfExists(otherSession.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
                limit: 100,
            }),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency(session1.action(), {
            documentId: document.id,
            commentThreadIds: [commentThread.id],
        });
        await confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency(session2.action(), {
            documentId: document.id,
            commentThreadIds: [commentThread.id],
        });
        await expect(
            confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency(session3.action(), {
                documentId: document.id,
                commentThreadIds: [commentThread.id],
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency(session4.action(), {
                documentId: document.id,
                commentThreadIds: [commentThread.id],
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            confirmDocumentResolvedCommentThreadIdsWithStrongReadConsistency(
                otherSession.action(),
                {
                    documentId: document.id,
                    commentThreadIds: [commentThread.id],
                },
            ),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentContentSteps(session1.action(), {
            id: document.id,
            startVersion: 0,
            endVersion: 4,
        });
        await getDocumentContentSteps(session2.action(), {
            id: document.id,
            startVersion: 0,
            endVersion: 4,
        });
        await expect(
            getDocumentContentSteps(session3.action(), {
                id: document.id,
                startVersion: 0,
                endVersion: 4,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentContentSteps(session4.action(), {
                id: document.id,
                startVersion: 0,
                endVersion: 4,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getDocumentContentSteps(otherSession.action(), {
                id: document.id,
                startVersion: 0,
                endVersion: 4,
            }),
        ).rejects.toThrow("Account doesn’t have access to space");
    }
});

test("getting document with resolved comment thread requires comment access level", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Comment"}],
                [session3.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    const commentThread = await document.createCommentThread(session1, range);

    await commentThread.resolve(session1);

    {
        await getResolvedDocumentCommentThreadRanges(session1.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
        });
        await getResolvedDocumentCommentThreadRanges(session2.action(), {
            documentId: document.id,
            commentThreadId: commentThread.id,
        });
        await expect(
            getResolvedDocumentCommentThreadRanges(session3.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getResolvedDocumentCommentThreadRanges(session4.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow("Actor doesn’t have `Comment` access level to document");
        await expect(
            getResolvedDocumentCommentThreadRanges(otherSession.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow("Account doesn’t have access to space");
    }
});

test("getting document without comments requires view access level", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3, session4] = await space.createSessions(4);
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Comment"}],
                [session3.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    await document.createCommentThread(session1, range);

    {
        await getDocumentWithOptionalComments(session1.action(), document.id);
        await getDocumentWithOptionalComments(session2.action(), document.id);
        await getDocumentWithOptionalComments(session3.action(), document.id);
        await expect(
            getDocumentWithOptionalComments(session4.action(), document.id),
        ).rejects.toThrow("Actor doesn’t have `View` access level to document");
        await expect(
            getDocumentWithOptionalComments(otherSession.action(), document.id),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentWithOptionalCommentsIfExists(session1.action(), document.id);
        await getDocumentWithOptionalCommentsIfExists(session2.action(), document.id);
        await getDocumentWithOptionalCommentsIfExists(session3.action(), document.id);
        await expect(
            getDocumentWithOptionalCommentsIfExists(session4.action(), document.id),
        ).rejects.toThrow("Actor doesn’t have `View` access level to document");
        await expect(
            getDocumentWithOptionalCommentsIfExists(otherSession.action(), document.id),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentContentWithOptionalComments(session1.action(), document.id);
        await getDocumentContentWithOptionalComments(session2.action(), document.id);
        await getDocumentContentWithOptionalComments(session3.action(), document.id);
        await expect(
            getDocumentContentWithOptionalComments(session4.action(), document.id),
        ).rejects.toThrow("Actor doesn’t have `View` access level to document");
        await expect(
            getDocumentContentWithOptionalComments(otherSession.action(), document.id),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentContentForCollaborationServiceInitialization(
            context.action(session1, {serviceName: "DocumentCollaborationService"}),
            document.id,
        );
        await getDocumentContentForCollaborationServiceInitialization(
            context.action(session2, {serviceName: "DocumentCollaborationService"}),
            document.id,
        );
        await getDocumentContentForCollaborationServiceInitialization(
            context.action(session3, {serviceName: "DocumentCollaborationService"}),
            document.id,
        );
        await expect(
            getDocumentContentForCollaborationServiceInitialization(
                context.action(session4, {serviceName: "DocumentCollaborationService"}),
                document.id,
            ),
        ).rejects.toThrow("Actor doesn’t have `View` access level to document");
        await expect(
            getDocumentContentForCollaborationServiceInitialization(
                context.action(otherSession, {serviceName: "DocumentCollaborationService"}),
                document.id,
            ),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentPreview(session1.action(), document.id);
        await getDocumentPreview(session2.action(), document.id);
        await getDocumentPreview(session3.action(), document.id);
        await expect(getDocumentPreview(session4.action(), document.id)).rejects.toThrow(
            "Actor doesn’t have `View` access level to document",
        );
        await expect(getDocumentPreview(otherSession.action(), document.id)).rejects.toThrow(
            "Account doesn’t have access to space",
        );
    }

    {
        await getDocumentPreviewIfExists(session1.action(), document.id);
        await getDocumentPreviewIfExists(session2.action(), document.id);
        await getDocumentPreviewIfExists(session3.action(), document.id);
        await expect(getDocumentPreviewIfExists(session4.action(), document.id)).rejects.toThrow(
            "Actor doesn’t have `View` access level to document",
        );
        await expect(
            getDocumentPreviewIfExists(otherSession.action(), document.id),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        await getDocumentTitleIfExists(session1.action(), document.id);
        await getDocumentTitleIfExists(session2.action(), document.id);
        await getDocumentTitleIfExists(session3.action(), document.id);
        await expect(getDocumentTitleIfExists(session4.action(), document.id)).rejects.toThrow(
            "Actor doesn’t have `View` access level to document",
        );
        await expect(getDocumentTitleIfExists(otherSession.action(), document.id)).rejects.toThrow(
            "Account doesn’t have access to space",
        );
    }

    {
        await getDocumentContentPreviewIfExists(session1.action(), document.id);
        await getDocumentContentPreviewIfExists(session2.action(), document.id);
        await getDocumentContentPreviewIfExists(session3.action(), document.id);
        await expect(
            getDocumentContentPreviewIfExists(session4.action(), document.id),
        ).rejects.toThrow("Actor doesn’t have `View` access level to document");
        await expect(
            getDocumentContentPreviewIfExists(otherSession.action(), document.id),
        ).rejects.toThrow("Account doesn’t have access to space");
    }

    {
        expect(
            (await getDocumentContentPreviewIfPossible(session1.action(), document.id))?.ok,
        ).toEqual(true);
        expect(
            (await getDocumentContentPreviewIfPossible(session2.action(), document.id))?.ok,
        ).toEqual(true);
        expect(
            (await getDocumentContentPreviewIfPossible(session3.action(), document.id))?.ok,
        ).toEqual(true);
        expect(
            (await getDocumentContentPreviewIfPossible(session4.action(), document.id))?.ok,
        ).toEqual(false);
        expect(
            (await getDocumentContentPreviewIfPossible(otherSession.action(), document.id))?.ok,
        ).toEqual(false);
    }
});

test("must have the manage access level on documents you create", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    await createDocument(session1.action(), {
        spaceId: space.id,
        content: assertDocumentContent(
            schema.node(
                "doc",
                {
                    accessPolicy: cast<AccessPolicy>({
                        accountGrantById: new Map([
                            [session1.account.id, {level: "Manage", generation: 0}],
                        ]),
                        defaultGrant: null,
                        urlGrant: null,
                    }),
                },
                [schema.node("title"), schema.node("paragraph")],
            ),
        ),
    });

    await expect(
        createDocument(session1.action(), {
            spaceId: space.id,
            content: assertDocumentContent(
                schema.node(
                    "doc",
                    {
                        accessPolicy: cast<AccessPolicy>({
                            accountGrantById: new Map([
                                [session2.account.id, {level: "Manage", generation: 0}],
                            ]),
                            defaultGrant: null,
                            urlGrant: null,
                        }),
                    },
                    [schema.node("title"), schema.node("paragraph")],
                ),
            ),
        }),
    ).rejects.toThrow("Account actor must have `Manage` access level on documents they create");

    await expect(
        createDocument(session1.action(), {
            spaceId: space.id,
            content: assertDocumentContent(
                schema.node(
                    "doc",
                    {
                        accessPolicy: cast<AccessPolicy>({
                            accountGrantById: new Map([[session1.account.id, {level: "Edit"}]]),
                            defaultGrant: null,
                            urlGrant: null,
                        }),
                    },
                    [schema.node("title"), schema.node("paragraph")],
                ),
            ),
        }),
    ).rejects.toThrow("Account actor must have `Manage` access level on documents they create");

    await expect(
        createDocument(session1.action(), {
            spaceId: space.id,
            content: assertDocumentContent(
                schema.node(
                    "doc",
                    {
                        accessPolicy: cast<AccessPolicy>({
                            accountGrantById: emptyMap,
                            defaultGrant: null,
                            urlGrant: null,
                        }),
                    },
                    [schema.node("title"), schema.node("paragraph")],
                ),
            ),
        }),
    ).rejects.toThrow("Account actor must have `Manage` access level on documents they create");

    await expect(
        createDocument(session1.action(), {
            spaceId: space.id,
            content: assertDocumentContent(
                schema.node(
                    "doc",
                    {
                        accessPolicy: cast<AccessPolicy>({
                            accountGrantById: emptyMap,
                            defaultGrant: {level: "Edit"},
                            urlGrant: null,
                        }),
                    },
                    [schema.node("title"), schema.node("paragraph")],
                ),
            ),
        }),
    ).rejects.toThrow("Account actor must have `Manage` access level on documents they create");

    await createDocument(session1.action(), {
        spaceId: space.id,
        content: assertDocumentContent(
            schema.node(
                "doc",
                {
                    accessPolicy: cast<AccessPolicy>({
                        accountGrantById: emptyMap,
                        defaultGrant: {level: "Manage", generation: 0},
                        urlGrant: null,
                    }),
                },
                [schema.node("title"), schema.node("paragraph")],
            ),
        ),
    });
});

test("must have edit access to edit a document and can change the document’s access policy", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Comment"},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    const publicAccessPolicy: AccessPolicy = {
        accountGrantById: emptyMap,
        defaultGrant: {level: "Manage", generation: 1},
        urlGrant: null,
    };

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 1,
        steps: [new DocAttrStep("accessPolicy", publicAccessPolicy)],
        intentionallyUpdateAccessPolicy: {accessPolicy: publicAccessPolicy, notification: null},
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: publicAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session2.action(), {
        id: document.id,
        version: 2,
        steps: [new ReplaceStep(6, 6, textSlice("bar"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: publicAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foobar")]),
            ])
            .toJSON(),
    });
});

test("can’t update access policy unintentionally", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Comment"},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    const publicAccessPolicy: AccessPolicy = {
        accountGrantById: emptyMap,
        defaultGrant: {level: "Manage", generation: 0},
        urlGrant: null,
    };

    await expect(
        updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new DocAttrStep("accessPolicy", publicAccessPolicy)],
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        "Can’t update the document’s access policy unless `intentionallyUpdateAccessPolicy` is provided",
    );

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });
});

test("can’t update access policy with a mismatched intentional access policy", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Comment"},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    const publicAccessPolicy: AccessPolicy = {
        accountGrantById: emptyMap,
        defaultGrant: {level: "Manage", generation: 0},
        urlGrant: null,
    };

    const otherAccessPolicy: AccessPolicy = {
        accountGrantById: new Map([
            [session1.account.id, {level: "Manage", generation: 0}],
            [session2.account.id, {level: "Manage", generation: 0}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    await expect(
        updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new DocAttrStep("accessPolicy", publicAccessPolicy)],
            intentionallyUpdateAccessPolicy: {accessPolicy: otherAccessPolicy, notification: null},
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        "The document’s new access policy doesn’t match `intentionallyUpdateAccessPolicy`",
    );

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });
});

test("can’t update the access policy without the manage access level", async () => {
    {
        const space = await TestSpace.create(context);
        const [session1, session2] = await space.createSessions(2);

        const document = await TestDocument.create(session1, {
            access: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Comment"}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("foo"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session2.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        const publicAccessPolicy: AccessPolicy = {
            accountGrantById: emptyMap,
            defaultGrant: {level: "Manage", generation: 0},
            urlGrant: null,
        };

        await expect(
            updateDocumentContent(session2.action(), {
                id: document.id,
                version: 1,
                steps: [new DocAttrStep("accessPolicy", publicAccessPolicy)],
                intentionallyUpdateAccessPolicy: {
                    accessPolicy: publicAccessPolicy,
                    notification: null,
                },
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session2.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });
    }

    {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const document = await TestDocument.create(session1, {
            access: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Edit"}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("foo"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        const publicAccessPolicy: AccessPolicy = {
            accountGrantById: emptyMap,
            defaultGrant: {level: "Manage", generation: 0},
            urlGrant: null,
        };

        await expect(
            updateDocumentContent(session2.action(), {
                id: document.id,
                version: 1,
                steps: [new DocAttrStep("accessPolicy", publicAccessPolicy)],
                intentionallyUpdateAccessPolicy: {
                    accessPolicy: publicAccessPolicy,
                    notification: null,
                },
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Manage` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });
    }

    {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const document = await TestDocument.create(session2, {
            access: {
                accountGrantById: new Map([
                    [session2.account.id, {level: "Manage", generation: 0}],
                    [session1.account.id, {level: "Manage", generation: 1}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("foo"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        const publicAccessPolicy: AccessPolicy = {
            accountGrantById: emptyMap,
            defaultGrant: {level: "Manage", generation: 1},
            urlGrant: null,
        };

        await updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new DocAttrStep("accessPolicy", publicAccessPolicy)],
            intentionallyUpdateAccessPolicy: {accessPolicy: publicAccessPolicy, notification: null},
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: publicAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session3.action(), {
            id: document.id,
            version: 2,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: publicAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foobar")]),
                ])
                .toJSON(),
        });
    }
});

test("can’t update the access policy without the manage access level even if the update is a noop", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session3.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new DocAttrStep("accessPolicy", document.initialAccessPolicy)],
            intentionallyUpdateAccessPolicy: {
                accessPolicy: document.initialAccessPolicy,
                notification: null,
            },
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Manage` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session3.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });
});

test("can handle conflicting access policy changes", async () => {
    {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const document = await TestDocument.create(session1, {
            access: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 1}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        const accessPolicy = await document.access.get();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("foo"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        const accessPolicyForSession1: AccessPolicy = {
            ...accessPolicy,
            accountGrantById: new Map([
                ...accessPolicy.accountGrantById,
                [session3.account.id, {level: "Edit"}],
            ]),
        };
        const accessPolicyForSession2: AccessPolicy = {
            ...accessPolicy,
            accountGrantById: new Map([
                ...accessPolicy.accountGrantById,
                [session3.account.id, {level: "View"}],
            ]),
        };

        const {conflictingSteps: conflictingSteps1} = await updateDocumentContent(
            session1.action(),
            {
                id: document.id,
                version: 1,
                steps: [new DocAttrStep("accessPolicy", accessPolicyForSession1)],
                intentionallyUpdateAccessPolicy: {
                    accessPolicy: accessPolicyForSession1,
                    notification: null,
                },
                clientId: generateId(),
            },
        );
        expect(conflictingSteps1.length).toEqual(0);

        const {conflictingSteps: conflictingSteps2} = await updateDocumentContent(
            session2.action(),
            {
                id: document.id,
                version: 1,
                steps: [new DocAttrStep("accessPolicy", accessPolicyForSession2)],
                intentionallyUpdateAccessPolicy: {
                    accessPolicy: accessPolicyForSession2,
                    notification: null,
                },
                clientId: generateId(),
            },
        );
        expect(conflictingSteps2.length).toEqual(1);

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: accessPolicyForSession2}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: accessPolicyForSession2}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });
    }

    {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const document = await TestDocument.create(session1, {
            access: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 1}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        const accessPolicy = await document.access.get();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("foo"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        const accessPolicyForSession1: AccessPolicy = {
            ...accessPolicy,
            accountGrantById: new Map([
                ...accessPolicy.accountGrantById,
                [session3.account.id, {level: "View"}],
            ]),
        };
        const accessPolicyForSession2: AccessPolicy = {
            ...accessPolicy,
            accountGrantById: new Map([
                ...accessPolicy.accountGrantById,
                [session3.account.id, {level: "Edit"}],
            ]),
        };

        const {conflictingSteps: conflictingSteps1} = await updateDocumentContent(
            session1.action(),
            {
                id: document.id,
                version: 1,
                steps: [new DocAttrStep("accessPolicy", accessPolicyForSession1)],
                intentionallyUpdateAccessPolicy: {
                    accessPolicy: accessPolicyForSession1,
                    notification: null,
                },
                clientId: generateId(),
            },
        );
        expect(conflictingSteps1.length).toEqual(0);

        const {conflictingSteps: conflictingSteps2} = await updateDocumentContent(
            session2.action(),
            {
                id: document.id,
                version: 1,
                steps: [new DocAttrStep("accessPolicy", accessPolicyForSession2)],
                intentionallyUpdateAccessPolicy: {
                    accessPolicy: accessPolicyForSession2,
                    notification: null,
                },
                clientId: generateId(),
            },
        );
        expect(conflictingSteps2.length).toEqual(1);

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: accessPolicyForSession2}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session3.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 4,
            content: schema
                .node("doc", {accessPolicy: accessPolicyForSession2}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foobar")]),
                ])
                .toJSON(),
        });
    }
});

test("can handle conflicting access policy changes within a single update call", async () => {
    {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const document = await TestDocument.create(session1, {
            access: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 1}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        const accessPolicy = await document.access.get();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("foo"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        const accessPolicy2: AccessPolicy = {
            ...accessPolicy,
            accountGrantById: new Map([
                ...accessPolicy.accountGrantById,
                [session3.account.id, {level: "Edit"}],
            ]),
        };
        const accessPolicy3: AccessPolicy = {
            ...accessPolicy,
            accountGrantById: new Map([
                ...accessPolicy.accountGrantById,
                [session3.account.id, {level: "View"}],
            ]),
        };

        await expect(
            updateDocumentContent(session1.action(), {
                id: document.id,
                version: 1,
                steps: [
                    new DocAttrStep("accessPolicy", accessPolicy2),
                    new DocAttrStep("accessPolicy", accessPolicy3),
                ],
                intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy2, notification: null},
                clientId: generateId(),
            }),
        ).rejects.toThrow(
            "The document’s new access policy doesn’t match `intentionallyUpdateAccessPolicy`",
        );

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });
    }

    {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const document = await TestDocument.create(session1, {
            access: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 1}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        const accessPolicy = await document.access.get();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("foo"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        const accessPolicy2: AccessPolicy = {
            ...accessPolicy,
            accountGrantById: new Map([
                ...accessPolicy.accountGrantById,
                [session3.account.id, {level: "Edit"}],
            ]),
        };
        const accessPolicy3: AccessPolicy = {
            ...accessPolicy,
            accountGrantById: new Map([
                ...accessPolicy.accountGrantById,
                [session3.account.id, {level: "View"}],
            ]),
        };

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [
                new DocAttrStep("accessPolicy", accessPolicy2),
                new DocAttrStep("accessPolicy", accessPolicy3),
            ],
            intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy3, notification: null},
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: accessPolicy3}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: accessPolicy3}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });
    }

    {
        const space = await TestSpace.create(context);
        const [session1, session2, session3] = await space.createSessions(3);

        const document = await TestDocument.create(session1, {
            access: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Manage", generation: 1}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        const accessPolicy = await document.access.get();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("foo"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await expect(
            updateDocumentContent(session3.action(), {
                id: document.id,
                version: 1,
                steps: [new ReplaceStep(6, 6, textSlice("bar"))],
                clientId: generateId(),
            }),
        ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        const accessPolicy2: AccessPolicy = {
            ...accessPolicy,
            accountGrantById: new Map([
                ...accessPolicy.accountGrantById,
                [session3.account.id, {level: "View"}],
            ]),
        };
        const accessPolicy3: AccessPolicy = {
            ...accessPolicy,
            accountGrantById: new Map([
                ...accessPolicy.accountGrantById,
                [session3.account.id, {level: "Edit"}],
            ]),
        };

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [
                new DocAttrStep("accessPolicy", accessPolicy2),
                new DocAttrStep("accessPolicy", accessPolicy3),
            ],
            intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy3, notification: null},
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: accessPolicy3}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foo")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session3.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 4,
            content: schema
                .node("doc", {accessPolicy: accessPolicy3}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("foobar")]),
                ])
                .toJSON(),
        });
    }
});

test("can’t revoke access from account with a lower manage generation", async () => {
    const space = await TestSpace.create(context);
    const [aliceSession, bobSession, carolSession] = await space.createSessions(3);

    const accessPolicy1: AccessPolicy = {
        accountGrantById: new Map([[aliceSession.account.id, {level: "Manage", generation: 0}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    const document = await TestDocument.create(aliceSession, {
        content: assertDocumentContent(
            schema.node("doc", {accessPolicy: accessPolicy1}, [
                schema.node("title"),
                schema.node("paragraph"),
            ]),
        ),
    });

    const invalidAccessPolicy2: AccessPolicy = {
        accountGrantById: new Map([
            [aliceSession.account.id, {level: "Manage", generation: 0}],
            [bobSession.account.id, {level: "Manage", generation: 0}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    const accessPolicy2: AccessPolicy = {
        accountGrantById: new Map([
            [aliceSession.account.id, {level: "Manage", generation: 0}],
            [bobSession.account.id, {level: "Manage", generation: 1}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    expect(massageDocument(await document.get())).toEqual({
        version: 0,
        content: schema
            .node("doc", {accessPolicy: accessPolicy1}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(aliceSession.action(), {
            id: document.id,
            version: 0,
            steps: [new DocAttrStep("accessPolicy", invalidAccessPolicy2)],
            intentionallyUpdateAccessPolicy: {
                accessPolicy: invalidAccessPolicy2,
                notification: null,
            },
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        "Can’t set new account grant manage generation to be less than or equal to our actor’s manage generation",
    );

    expect(massageDocument(await document.get())).toEqual({
        version: 0,
        content: schema
            .node("doc", {accessPolicy: accessPolicy1}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    await updateDocumentContent(aliceSession.action(), {
        id: document.id,
        version: 0,
        steps: [new DocAttrStep("accessPolicy", accessPolicy2)],
        intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy2, notification: null},
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: accessPolicy2}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    const invalidAccessPolicy3: AccessPolicy = {
        accountGrantById: new Map([[bobSession.account.id, {level: "Manage", generation: 1}]]),
        defaultGrant: null,
        urlGrant: null,
    };

    const accessPolicy3: AccessPolicy = {
        accountGrantById: new Map([
            [aliceSession.account.id, {level: "Manage", generation: 0}],
            [bobSession.account.id, {level: "Manage", generation: 1}],
            [carolSession.account.id, {level: "Manage", generation: 2}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    await expect(
        updateDocumentContent(bobSession.action(), {
            id: document.id,
            version: 0,
            steps: [new DocAttrStep("accessPolicy", invalidAccessPolicy3)],
            intentionallyUpdateAccessPolicy: {
                accessPolicy: invalidAccessPolicy3,
                notification: null,
            },
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        "Can’t revoke manage access from an account with a manage generation less than our actor",
    );

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: accessPolicy2}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(bobSession.action(), {
            id: document.id,
            version: 1,
            steps: [new DocAttrStep("accessPolicy", invalidAccessPolicy3)],
            intentionallyUpdateAccessPolicy: {
                accessPolicy: invalidAccessPolicy3,
                notification: null,
            },
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        "Can’t revoke manage access from an account with a manage generation less than our actor",
    );

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: accessPolicy2}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    await updateDocumentContent(bobSession.action(), {
        id: document.id,
        version: 1,
        steps: [new DocAttrStep("accessPolicy", accessPolicy3)],
        intentionallyUpdateAccessPolicy: {accessPolicy: accessPolicy3, notification: null},
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: accessPolicy3}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, []),
            ])
            .toJSON(),
    });

    const invalidAccessPolicy4a: AccessPolicy = {
        accountGrantById: new Map([
            [bobSession.account.id, {level: "Manage", generation: 1}],
            [carolSession.account.id, {level: "Manage", generation: 2}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    const invalidAccessPolicy4b: AccessPolicy = {
        accountGrantById: new Map([
            [aliceSession.account.id, {level: "Manage", generation: 0}],
            [carolSession.account.id, {level: "Manage", generation: 2}],
        ]),
        defaultGrant: null,
        urlGrant: null,
    };

    await expect(
        updateDocumentContent(carolSession.action(), {
            id: document.id,
            version: 2,
            steps: [new DocAttrStep("accessPolicy", invalidAccessPolicy4a)],
            intentionallyUpdateAccessPolicy: {
                accessPolicy: invalidAccessPolicy4a,
                notification: null,
            },
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        "Can’t revoke manage access from an account with a manage generation less than our actor",
    );

    await expect(
        updateDocumentContent(carolSession.action(), {
            id: document.id,
            version: 2,
            steps: [new DocAttrStep("accessPolicy", invalidAccessPolicy4b)],
            intentionallyUpdateAccessPolicy: {
                accessPolicy: invalidAccessPolicy4b,
                notification: null,
            },
            clientId: generateId(),
        }),
    ).rejects.toThrow(
        "Can’t revoke manage access from an account with a manage generation less than our actor",
    );
});

test("getting a document with optional comments strips comments if the actor only has view access", async () => {
    const space = await TestSpace.create(context);
    const [editorSession, commenterSession, viewerSession, otherSession] =
        await space.createSessions(4);

    const document = await TestDocument.create(editorSession, {
        access: {
            accountGrantById: new Map([
                [editorSession.account.id, {level: "Manage", generation: 0}],
                [commenterSession.account.id, {level: "Comment"}],
                [viewerSession.account.id, {level: "View"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await document.type(editorSession, "Hello, ");
    const {range} = await document.type(editorSession, "world");
    await document.type(editorSession, "!");

    const commentThread = await document.createCommentThread(editorSession, range);

    expect(await getDocumentWithOptionalComments(editorSession.action(), document.id)).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 4,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello, "),
                            schema.text("world", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text("!"),
                        ]),
                    ]),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    commentThreadById: new Map([
                        [
                            commentThread.id,
                            {
                                commentCount: 1,
                                commentAuthors: [await editorSession.get()],
                            },
                        ],
                    ]),
                },
            },
        }),
    );

    expect(await getDocumentWithOptionalComments(commenterSession.action(), document.id)).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 4,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello, "),
                            schema.text("world", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text("!"),
                        ]),
                    ]),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    commentThreadById: new Map([
                        [
                            commentThread.id,
                            {
                                commentCount: 1,
                                commentAuthors: [await editorSession.get()],
                            },
                        ],
                    ]),
                },
            },
        }),
    );

    expect(await getDocumentWithOptionalComments(viewerSession.action(), document.id)).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 4,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                    ]),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    commentThreadById: new Map(),
                },
            },
        }),
    );

    await expect(
        getDocumentWithOptionalComments(otherSession.action(), document.id),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        await getDocumentWithOptionalCommentsIfExists(editorSession.action(), document.id),
    ).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 4,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello, "),
                            schema.text("world", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text("!"),
                        ]),
                    ]),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    commentThreadById: new Map([
                        [
                            commentThread.id,
                            {
                                commentCount: 1,
                                commentAuthors: [await editorSession.get()],
                            },
                        ],
                    ]),
                },
            },
        }),
    );

    expect(
        await getDocumentWithOptionalCommentsIfExists(commenterSession.action(), document.id),
    ).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 4,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello, "),
                            schema.text("world", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text("!"),
                        ]),
                    ]),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    commentThreadById: new Map([
                        [
                            commentThread.id,
                            {
                                commentCount: 1,
                                commentAuthors: [await editorSession.get()],
                            },
                        ],
                    ]),
                },
            },
        }),
    );

    expect(
        await getDocumentWithOptionalCommentsIfExists(viewerSession.action(), document.id),
    ).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 4,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                    ]),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    commentThreadById: new Map(),
                },
            },
        }),
    );

    await expect(
        getDocumentWithOptionalCommentsIfExists(otherSession.action(), document.id),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        await getDocumentContentWithOptionalComments(editorSession.action(), document.id),
    ).toEqual({
        spaceId: space.id,
        creatorId: editorSession.account.id,
        createdTime: expect.any(Date),
        version: 4,
        content: assertDocumentContent(
            schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title"),
                schema.node("paragraph", {}, [
                    schema.text("Hello, "),
                    schema.text("world", [
                        schema.mark("comment", {commentThreadId: commentThread.id}),
                    ]),
                    schema.text("!"),
                ]),
            ]),
        ),
    });

    expect(
        await getDocumentContentWithOptionalComments(commenterSession.action(), document.id),
    ).toEqual({
        spaceId: space.id,
        creatorId: editorSession.account.id,
        createdTime: expect.any(Date),
        version: 4,
        content: assertDocumentContent(
            schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title"),
                schema.node("paragraph", {}, [
                    schema.text("Hello, "),
                    schema.text("world", [
                        schema.mark("comment", {commentThreadId: commentThread.id}),
                    ]),
                    schema.text("!"),
                ]),
            ]),
        ),
    });

    expect(
        await getDocumentContentWithOptionalComments(viewerSession.action(), document.id),
    ).toEqual({
        spaceId: space.id,
        creatorId: editorSession.account.id,
        createdTime: expect.any(Date),
        version: 4,
        content: assertDocumentContent(
            schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title"),
                schema.node("paragraph", {}, [schema.text("Hello, world!")]),
            ]),
        ),
    });

    await expect(
        getDocumentContentWithOptionalComments(otherSession.action(), document.id),
    ).rejects.toThrow(PermissionDeniedError);

    expect(
        await getDocumentContentForCollaborationServiceInitialization(
            context.action(editorSession, {serviceName: "DocumentCollaborationService"}),
            document.id,
        ),
    ).toEqual({
        spaceId: space.id,
        creatorId: editorSession.account.id,
        createdTime: expect.any(Date),
        version: 4,
        content: assertDocumentContent(
            schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title"),
                schema.node("paragraph", {}, [
                    schema.text("Hello, "),
                    schema.text("world", [
                        schema.mark("comment", {commentThreadId: commentThread.id}),
                    ]),
                    schema.text("!"),
                ]),
            ]),
        ),
    });

    expect(
        await getDocumentContentForCollaborationServiceInitialization(
            context.action(commenterSession, {serviceName: "DocumentCollaborationService"}),
            document.id,
        ),
    ).toEqual({
        spaceId: space.id,
        creatorId: editorSession.account.id,
        createdTime: expect.any(Date),
        version: 4,
        content: assertDocumentContent(
            schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title"),
                schema.node("paragraph", {}, [
                    schema.text("Hello, "),
                    schema.text("world", [
                        schema.mark("comment", {commentThreadId: commentThread.id}),
                    ]),
                    schema.text("!"),
                ]),
            ]),
        ),
    });

    expect(
        await getDocumentContentForCollaborationServiceInitialization(
            context.action(viewerSession, {serviceName: "DocumentCollaborationService"}),
            document.id,
        ),
    ).toEqual({
        spaceId: space.id,
        creatorId: editorSession.account.id,
        createdTime: expect.any(Date),
        version: 4,
        content: assertDocumentContent(
            schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title"),
                schema.node("paragraph", {}, [
                    schema.text("Hello, "),
                    schema.text("world", [
                        schema.mark("comment", {commentThreadId: commentThread.id}),
                    ]),
                    schema.text("!"),
                ]),
            ]),
        ),
    });

    await expect(
        getDocumentContentForCollaborationServiceInitialization(otherSession.action(), document.id),
    ).rejects.toThrow(PermissionDeniedError);
});

test("can get a document with references as actors that don’t have access to the space", async () => {
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession({role: "Admin"});

    const space = await TestSpace.create(context);
    const [session1, session2, session3] = await space.createSessions(3);
    const adminSession = await space.createSession({role: "Admin"});

    const document = await TestDocument.create(session1);

    await document.type(session1, "Hello, ");
    const {range} = await document.type(session1, "world");
    await document.type(session1, "!");

    await document.type(session1, " Hello, ");
    await document.type(
        session1,
        schema.node("mention", {
            mention: cast<ContentMention>({
                type: "Account",
                accountId: session2.account.id,
                isShort: false,
            }),
        }),
    );
    await document.type(session1, "!");

    await document.type(session1, " Hello, ");
    await document.type(
        session1,
        schema.node("mention", {
            mention: cast<ContentMention>({
                type: "Account",
                accountId: session3.account.id,
                isShort: false,
            }),
        }),
    );
    await document.type(session1, "!");

    await document.type(session1, " Hello, ");
    await document.type(
        session1,
        schema.node("mention", {
            mention: cast<ContentMention>({
                type: "Account",
                accountId: otherSession.account.id,
                isShort: false,
            }),
        }),
    );
    await document.type(session1, "!");

    const file = await TestFile.create(session1);

    await document.attachFile(session1, file);

    const commentThread = await document.createCommentThread(session1, range);

    await removeSpaceAccount(adminSession.action(), {
        spaceId: space.id,
        accountId: session3.account.id,
    });

    expect(await getDocumentWithOptionalComments(session1.action(), document.id)).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 14,
            content: {
                doc: assertDocumentContent(
                    schema.node("doc", {accessPolicy: document.initialAccessPolicy}, [
                        schema.node("title"),
                        schema.node("paragraph", {}, [
                            schema.text("Hello, "),
                            schema.text("world", [
                                schema.mark("comment", {commentThreadId: commentThread.id}),
                            ]),
                            schema.text("! Hello, "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session2.account.id,
                                    isShort: false,
                                }),
                            }),
                            schema.text("! Hello, "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session3.account.id,
                                    isShort: false,
                                }),
                            }),
                            schema.text("! Hello, "),
                            schema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: otherSession.account.id,
                                    isShort: false,
                                }),
                            }),
                            schema.text("!"),
                        ]),
                        schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                    ]),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    accountById: new Map([
                        [
                            session2.account.id,
                            createTestAccountModel({
                                id: session2.account.id,
                                version: 0,
                                name: session2.account.initialName,
                                nameVersion: 0,
                                space: {
                                    version: 1,
                                    addedTime: expect.any(Date),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            }),
                        ],
                        [
                            session3.account.id,
                            createTestAccountModel({
                                id: session3.account.id,
                                version: 0,
                                name: session3.account.initialName,
                                nameVersion: 0,
                                space: {
                                    version: 2,
                                    addedTime: expect.any(Date),
                                    state: {
                                        type: "Removed",
                                        removedTime: expect.any(Date),
                                        oldAccountData: (await session3.account.get()).initialData,
                                        reason: "ActionByAdmin",
                                    },
                                    role: "Member",
                                },
                            }),
                        ],
                    ]),
                    fileById: new Map([
                        [
                            file.id,
                            {
                                type: "File",
                                signedUrlSearch: expect.any(String),
                                file: await file.get(),
                            },
                        ],
                    ]),
                    commentThreadById: new Map([
                        [
                            commentThread.id,
                            {
                                commentCount: 1,
                                commentAuthors: [await session1.get()],
                            },
                        ],
                    ]),
                },
            },
        }),
    );

    await expect(
        getDocumentWithOptionalComments(context.anonymousAction(), document.id),
    ).rejects.toThrow(new UnauthenticatedError("Unauthenticated session"));

    await expect(
        getDocumentWithOptionalComments(otherSession.action(), document.id),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));

    await expect(getDocumentWithOptionalComments(session2.action(), document.id)).rejects.toThrow(
        new PermissionDeniedError("Actor doesn’t have `View` access level to document"),
    );

    await expect(getDocumentWithOptionalComments(session3.action(), document.id)).rejects.toThrow(
        new PermissionDeniedError("Account doesn’t have access to space"),
    );

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(space.id, session1.account.id),
            document.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(space.id, session2.account.id),
            document.id,
        ),
    ).rejects.toThrow(
        new PermissionDeniedError("Actor doesn’t have `View` access level to document"),
    );

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(space.id, session3.account.id),
            document.id,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            document.id,
        ),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Impersonated account actor doesn’t have access to document’s space",
        ),
    );

    await document.access.grantUrl(session1);

    expect(await getDocumentWithOptionalComments(session1.action(), document.id)).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 15,
            content: {
                doc: assertDocumentContent(
                    schema.node(
                        "doc",
                        {
                            accessPolicy: {
                                ...document.initialAccessPolicy,
                                urlGrant: {level: "View"},
                            },
                        },
                        [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello, "),
                                schema.text("world", [
                                    schema.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: session2.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: session3.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: otherSession.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("!"),
                            ]),
                            schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                        ],
                    ),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    accountById: new Map([
                        [
                            session2.account.id,
                            createTestAccountModel({
                                id: session2.account.id,
                                version: 0,
                                name: session2.account.initialName,
                                nameVersion: 0,
                                space: {
                                    version: 1,
                                    addedTime: expect.any(Date),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            }),
                        ],
                        [
                            session3.account.id,
                            createTestAccountModel({
                                id: session3.account.id,
                                version: 0,
                                name: session3.account.initialName,
                                nameVersion: 0,
                                space: {
                                    version: 2,
                                    addedTime: expect.any(Date),
                                    state: {
                                        type: "Removed",
                                        removedTime: expect.any(Date),
                                        oldAccountData: (await session3.account.get()).initialData,
                                        reason: "ActionByAdmin",
                                    },
                                    role: "Member",
                                },
                            }),
                        ],
                    ]),
                    fileById: new Map([
                        [
                            file.id,
                            {
                                type: "File",
                                signedUrlSearch: expect.any(String),
                                file: await file.get(),
                            },
                        ],
                    ]),
                    commentThreadById: new Map([
                        [
                            commentThread.id,
                            {
                                commentCount: 1,
                                commentAuthors: [await session1.get()],
                            },
                        ],
                    ]),
                },
            },
        }),
    );

    expect(await getDocumentWithOptionalComments(context.anonymousAction(), document.id)).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 15,
            content: {
                doc: assertDocumentContent(
                    schema.node(
                        "doc",
                        {
                            accessPolicy: {
                                ...document.initialAccessPolicy,
                                urlGrant: {level: "View"},
                            },
                        },
                        [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello, world! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: session2.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: session3.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: otherSession.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("!"),
                            ]),
                            schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                        ],
                    ),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    accountById: new Map([
                        [
                            session2.account.id,
                            createTestAccountModel({
                                id: session2.account.id,
                                version: -1073741824,
                                name: session2.account.initialName,
                                nameVersion: -1073741824,
                                space: {
                                    version: -1073741823,
                                    addedTime: new Date(0),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            }),
                        ],
                        [
                            session3.account.id,
                            createTestAccountModel({
                                id: session3.account.id,
                                version: -1073741824,
                                name: session3.account.initialName,
                                nameVersion: -1073741824,
                                space: {
                                    version: -1073741822,
                                    addedTime: new Date(0),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            }),
                        ],
                    ]),
                    fileById: new Map([
                        [
                            file.id,
                            {
                                type: "File",
                                signedUrlSearch: expect.any(String),
                                file: await file.get(),
                            },
                        ],
                    ]),
                    commentThreadById: new Map([]),
                },
            },
        }),
    );

    expect(await getDocumentWithOptionalComments(otherSession.action(), document.id)).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 15,
            content: {
                doc: assertDocumentContent(
                    schema.node(
                        "doc",
                        {
                            accessPolicy: {
                                ...document.initialAccessPolicy,
                                urlGrant: {level: "View"},
                            },
                        },
                        [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello, world! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: session2.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: session3.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: otherSession.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("!"),
                            ]),
                            schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                        ],
                    ),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    accountById: new Map([
                        [
                            session2.account.id,
                            createTestAccountModel({
                                id: session2.account.id,
                                version: -1073741824,
                                name: session2.account.initialName,
                                nameVersion: -1073741824,
                                space: {
                                    version: -1073741823,
                                    addedTime: new Date(0),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            }),
                        ],
                        [
                            session3.account.id,
                            createTestAccountModel({
                                id: session3.account.id,
                                version: -1073741824,
                                name: session3.account.initialName,
                                nameVersion: -1073741824,
                                space: {
                                    version: -1073741822,
                                    addedTime: new Date(0),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            }),
                        ],
                    ]),
                    fileById: new Map([
                        [
                            file.id,
                            {
                                type: "File",
                                signedUrlSearch: expect.any(String),
                                file: await file.get(),
                            },
                        ],
                    ]),
                    fileEntityById: undefined,
                    commentThreadById: new Map([]),
                },
            },
        }),
    );

    expect(await getDocumentWithOptionalComments(session2.action(), document.id)).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 15,
            content: {
                doc: assertDocumentContent(
                    schema.node(
                        "doc",
                        {
                            accessPolicy: {
                                ...document.initialAccessPolicy,
                                urlGrant: {level: "View"},
                            },
                        },
                        [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello, world! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: session2.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: session3.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: otherSession.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("!"),
                            ]),
                            schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                        ],
                    ),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    accountById: new Map([
                        [
                            session2.account.id,
                            createTestAccountModel({
                                id: session2.account.id,
                                version: 0,
                                name: session2.account.initialName,
                                nameVersion: 0,
                                space: {
                                    version: 1,
                                    addedTime: expect.any(Date),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            }),
                        ],
                        [
                            session3.account.id,
                            createTestAccountModel({
                                id: session3.account.id,
                                version: 0,
                                name: session3.account.initialName,
                                nameVersion: 0,
                                space: {
                                    version: 2,
                                    addedTime: expect.any(Date),
                                    state: {
                                        type: "Removed",
                                        removedTime: expect.any(Date),
                                        oldAccountData: (await session3.account.get()).initialData,
                                        reason: "ActionByAdmin",
                                    },
                                    role: "Member",
                                },
                            }),
                        ],
                    ]),
                    fileById: new Map([
                        [
                            file.id,
                            {
                                type: "File",
                                signedUrlSearch: expect.any(String),
                                file: await file.get(),
                            },
                        ],
                    ]),
                    commentThreadById: new Map([]),
                },
            },
        }),
    );

    expect(await getDocumentWithOptionalComments(session3.action(), document.id)).toEqual(
        new DocumentModel({
            id: document.id,
            spaceId: space.id,
            createdTime: expect.any(Date),
            version: 15,
            content: {
                doc: assertDocumentContent(
                    schema.node(
                        "doc",
                        {
                            accessPolicy: {
                                ...document.initialAccessPolicy,
                                urlGrant: {level: "View"},
                            },
                        },
                        [
                            schema.node("title"),
                            schema.node("paragraph", {}, [
                                schema.text("Hello, world! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: session2.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: session3.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("! Hello, "),
                                schema.node("mention", {
                                    mention: cast<ContentMention>({
                                        type: "Account",
                                        accountId: otherSession.account.id,
                                        isShort: false,
                                    }),
                                }),
                                schema.text("!"),
                            ]),
                            schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                        ],
                    ),
                ),
                references: {
                    ...emptyDocumentContentReferences,
                    accountById: new Map([
                        [
                            session2.account.id,
                            createTestAccountModel({
                                id: session2.account.id,
                                version: -1073741824,
                                name: session2.account.initialName,
                                nameVersion: -1073741824,
                                space: {
                                    version: -1073741823,
                                    addedTime: new Date(0),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            }),
                        ],
                        [
                            session3.account.id,
                            createTestAccountModel({
                                id: session3.account.id,
                                version: -1073741824,
                                name: session3.account.initialName,
                                nameVersion: -1073741824,
                                space: {
                                    version: -1073741822,
                                    addedTime: new Date(0),
                                    state: {type: "Active"},
                                    role: "Member",
                                },
                            }),
                        ],
                    ]),
                    fileById: new Map([
                        [
                            file.id,
                            {
                                type: "File",
                                signedUrlSearch: expect.any(String),
                                file: await file.get(),
                            },
                        ],
                    ]),
                    fileEntityById: undefined,
                    commentThreadById: new Map([]),
                },
            },
        }),
    );

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(space.id, session1.account.id),
            document.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(space.id, session2.account.id),
            document.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(space.id, session3.account.id),
            document.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            document.id,
        ),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Impersonated account actor doesn’t have access to document’s space",
        ),
    );

    await document.access.revokeUrl(session1);

    await expect(
        getDocumentWithOptionalComments(context.anonymousAction(), document.id),
    ).rejects.toThrow(new UnauthenticatedError("Unauthenticated session"));

    await expect(
        getDocumentWithOptionalComments(otherSession.action(), document.id),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));

    await expect(getDocumentWithOptionalComments(session2.action(), document.id)).rejects.toThrow(
        new PermissionDeniedError("Actor doesn’t have `View` access level to document"),
    );

    await expect(getDocumentWithOptionalComments(session3.action(), document.id)).rejects.toThrow(
        new PermissionDeniedError("Account doesn’t have access to space"),
    );

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(space.id, session1.account.id),
            document.id,
        ),
    ).resolves.toBeTruthy();

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(space.id, session2.account.id),
            document.id,
        ),
    ).rejects.toThrow(
        new PermissionDeniedError("Actor doesn’t have `View` access level to document"),
    );

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(space.id, session3.account.id),
            document.id,
        ),
    ).rejects.toThrow(new PermissionDeniedError("Account doesn’t have access to space"));

    await expect(
        getDocumentWithOptionalComments(
            context.impersonatedAccountAction(otherSpace.id, session1.account.id),
            document.id,
        ),
    ).rejects.toThrow(
        new PermissionDeniedError(
            "Impersonated account actor doesn’t have access to document’s space",
        ),
    );
});

test("can make updates to comment marks with comment access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([[session1.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: {level: "Comment"},
            urlGrant: null,
        },
    });

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [new ReplaceStep(3, 3, textSlice("foo"))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new ReplaceStep(6, 6, textSlice("bar"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [
                new AddMarkStep(4, 6, schema.mark("comment", {commentThreadId})),
                new ReplaceStep(6, 6, textSlice("bar")),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test comment 1"),
                    initialCommentFileIds: [],
                },
            ],
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [
                new ReplaceStep(6, 6, textSlice("bar")),
                new AddMarkStep(4, 6, schema.mark("comment", {commentThreadId})),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test comment 1"),
                    initialCommentFileIds: [],
                },
            ],
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(4, 6, schema.mark("bold", {commentThreadId}))],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session2.action(), {
        id: document.id,
        version: 1,
        steps: [new AddMarkStep(4, 6, schema.mark("comment", {commentThreadId}))],
        clientId: generateId(),
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test comment 1"),
                initialCommentFileIds: [],
            },
        ],
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [
                    schema.text("f"),
                    schema.text("oo", [schema.mark("comment", {commentThreadId})]),
                ]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [
                new RemoveAllMarksStep(schema.mark("comment", {commentThreadId})),
                new ReplaceStep(6, 6, textSlice("bar")),
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [
                new ReplaceStep(6, 6, textSlice("bar")),
                new RemoveAllMarksStep(schema.mark("comment", {commentThreadId})),
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new RemoveAllMarksStep(schema.mark("bold"))],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [
                    schema.text("f"),
                    schema.text("oo", [schema.mark("comment", {commentThreadId})]),
                ]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session2.action(), {
        id: document.id,
        version: 2,
        steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
        clientId: generateId(),
        resolveCommentThreadIds: [commentThreadId],
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 3,
            steps: [
                new AddMarksAfterRemoveAllStep(schema.mark("comment", {commentThreadId}), [
                    {from: 4, to: 6, isNode: false},
                ]),
                new ReplaceStep(6, 6, textSlice("bar")),
            ],
            clientId: generateId(),
            unresolveCommentThreadIds: [commentThreadId],
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 3,
            steps: [
                new ReplaceStep(6, 6, textSlice("bar")),
                new AddMarksAfterRemoveAllStep(schema.mark("comment", {commentThreadId}), [
                    {from: 4, to: 6, isNode: false},
                ]),
            ],
            clientId: generateId(),
            unresolveCommentThreadIds: [commentThreadId],
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 3,
            steps: [
                new AddMarksAfterRemoveAllStep(schema.mark("bold"), [
                    {from: 4, to: 6, isNode: false},
                ]),
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [schema.text("foo")]),
            ])
            .toJSON(),
    });

    await updateDocumentContent(session2.action(), {
        id: document.id,
        version: 3,
        steps: [
            new AddMarksAfterRemoveAllStep(schema.mark("comment", {commentThreadId}), [
                {from: 4, to: 6, isNode: false},
            ]),
        ],
        clientId: generateId(),
        unresolveCommentThreadIds: [commentThreadId],
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 4,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}, []),
                schema.node("paragraph", {}, [
                    schema.text("f"),
                    schema.text("oo", [schema.mark("comment", {commentThreadId})]),
                ]),
            ])
            .toJSON(),
    });
});

test("can add comment mark to `file` node in a document with comment access level", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);

    const document = await TestDocument.create(session1, {
        access: {
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Comment"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    const file = await TestFile.create(session1);

    await attachFileAsUploader(
        session1.action(),
        space.id,
        file.id,
        FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
    );

    await updateDocumentContent(session1.action(), {
        id: document.id,
        version: 0,
        steps: [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from(
                        schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                    ),
                    0,
                    0,
                ),
            ),
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 1,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file.id}, [])]),
            ])
            .toJSON(),
    });

    const commentThreadId = generateId<DocumentCommentThreadId>();

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [
                new AddNodeMarkStep(3, schema.marks.comment.create({commentThreadId})),
                new ReplaceStep(6, 6, textSlice("bar")),
            ],
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test comment"),
                    initialCommentFileIds: [],
                },
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [
                new ReplaceStep(6, 6, textSlice("bar")),
                new AddNodeMarkStep(3, schema.marks.comment.create({commentThreadId})),
            ],
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test comment"),
                    initialCommentFileIds: [],
                },
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 1,
            steps: [new AddNodeMarkStep(3, schema.marks.bold.create())],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await updateDocumentContent(session2.action(), {
        id: document.id,
        version: 1,
        steps: [new AddNodeMarkStep(3, schema.marks.comment.create({commentThreadId}))],
        createCommentThreads: [
            {
                commentThreadId,
                initialCommentContent: createSimpleMessageContent("Test comment"),
                initialCommentFileIds: [],
            },
        ],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 2,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}),
                schema.node("fileRow", {}, [
                    schema.node(
                        "file",
                        {fileId: file.id},
                        [],
                        [schema.mark("comment", {commentThreadId})],
                    ),
                ]),
            ])
            .toJSON(),
    });

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 2,
            steps: [
                new RemoveNodeMarkStep(3, schema.marks.comment.create({commentThreadId})),
                new ReplaceStep(6, 6, textSlice("bar")),
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 2,
            steps: [
                new ReplaceStep(6, 6, textSlice("bar")),
                new RemoveNodeMarkStep(3, schema.marks.comment.create({commentThreadId})),
            ],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await expect(
        updateDocumentContent(session2.action(), {
            id: document.id,
            version: 2,
            steps: [new RemoveNodeMarkStep(3, schema.marks.bold.create())],
            clientId: generateId(),
        }),
    ).rejects.toThrow("Actor doesn’t have `Edit` access level to document");

    await updateDocumentContent(session2.action(), {
        id: document.id,
        version: 2,
        steps: [new RemoveNodeMarkStep(3, schema.marks.comment.create({commentThreadId}))],
        clientId: generateId(),
    });

    expect(massageDocument(await document.get())).toEqual({
        version: 3,
        content: schema
            .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                schema.node("title", {}),
                schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
            ])
            .toJSON(),
    });
});

test("can get and update document content preview", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSpace = await TestSpace.create(context);
    const otherSession = await otherSpace.createSession();
    const document = await TestDocument.create(session, {title: "Hello, world!"});

    await document.type(session, "Lorem ipsum dolor sit amet, consectetur adipiscing elit.");

    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual(null);

    // Can update the content preview:
    {
        const {content, updateContentPreview} = await getDocumentContent(
            session.action(),
            document.id,
        );

        expect(content).toEqual(
            schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text("Lorem ipsum dolor sit amet, consectetur adipiscing elit."),
                ]),
            ]),
        );

        expect(
            (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
        ).toEqual(null);

        await expect(updateContentPreview(otherSession.action())).rejects.toThrow(
            PermissionDeniedError,
        );
        await expect(updateContentPreview(otherSpace.systemAction())).rejects.toThrow(
            PermissionDeniedError,
        );

        expect(
            (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
        ).toEqual(null);

        await updateContentPreview(session.action());
    }

    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 1,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text("Lorem ipsum dolor sit amet, consectetur adipiscing elit."),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });

    await document.type(session, " ");
    const {range} = await document.type(session, "Sed consequat");
    await document.type(
        session,
        ", nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi.",
    );

    const commentThread = await document.createCommentThread(session, range, "Test comment");

    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 1,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text("Lorem ipsum dolor sit amet, consectetur adipiscing elit."),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });

    // The content preview will strip comment marks:
    {
        const {content, updateContentPreview} = await getDocumentContent(
            session.action(),
            document.id,
        );

        expect(content).toEqual(
            schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text("Lorem ipsum dolor sit amet, consectetur adipiscing elit. "),
                    schema.text("Sed consequat", [
                        schema.mark("comment", {commentThreadId: commentThread.id}),
                    ]),
                    schema.text(
                        ", nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi.",
                    ),
                ]),
            ]),
        );

        expect(
            (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
        ).toEqual({
            version: 1,
            content: {
                doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                    schema.node("title", null, [schema.text("Hello, world!")]),
                    schema.node("paragraph", null, [
                        schema.text("Lorem ipsum dolor sit amet, consectetur adipiscing elit."),
                    ]),
                ]),
                references: emptyDocumentContentReferences,
            },
        });

        await updateContentPreview(session.action());
    }

    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 5,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed consequat, nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi.",
                    ),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });

    await document.type(session, " " + "x".repeat(10_000));

    // The content preview truncates the full document content:
    {
        const {content, updateContentPreview} = await getDocumentContent(
            session.action(),
            document.id,
        );

        expect(content).toEqual(
            schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text("Lorem ipsum dolor sit amet, consectetur adipiscing elit. "),
                    schema.text("Sed consequat", [
                        schema.mark("comment", {commentThreadId: commentThread.id}),
                    ]),
                    schema.text(
                        ", nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi. " +
                            "x".repeat(10_000),
                    ),
                ]),
            ]),
        );

        expect(
            (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
        ).toEqual({
            version: 5,
            content: {
                doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                    schema.node("title", null, [schema.text("Hello, world!")]),
                    schema.node("paragraph", null, [
                        schema.text(
                            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed consequat, nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi.",
                        ),
                    ]),
                ]),
                references: emptyDocumentContentReferences,
            },
        });

        await updateContentPreview(session.action());
    }

    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 6,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed consequat, nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi. " +
                            "x".repeat(7_332),
                    ),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });

    await document.type(session, "y");

    // Won't update the content preview if the content preview doesn’t change:
    {
        const {content, updateContentPreview} = await getDocumentContent(
            session.action(),
            document.id,
        );

        expect(content).toEqual(
            schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text("Lorem ipsum dolor sit amet, consectetur adipiscing elit. "),
                    schema.text("Sed consequat", [
                        schema.mark("comment", {commentThreadId: commentThread.id}),
                    ]),
                    schema.text(
                        ", nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi. " +
                            "x".repeat(10_000) +
                            "y",
                    ),
                ]),
            ]),
        );

        expect(
            (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
        ).toEqual({
            version: 6,
            content: {
                doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                    schema.node("title", null, [schema.text("Hello, world!")]),
                    schema.node("paragraph", null, [
                        schema.text(
                            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed consequat, nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi. " +
                                "x".repeat(7_332),
                        ),
                    ]),
                ]),
                references: emptyDocumentContentReferences,
            },
        });

        await updateContentPreview(session.action());
    }

    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 6,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text(
                        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed consequat, nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi. " +
                            "x".repeat(7_332),
                    ),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });

    await document.update(session, [new ReplaceStep(22, 22, textSlice("z"))]);

    // Will update the content preview if the update falls inside the content preview:
    {
        const {content, updateContentPreview} = await getDocumentContent(
            session.action(),
            document.id,
        );

        expect(content).toEqual(
            schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text("Lorem zipsum dolor sit amet, consectetur adipiscing elit. "),
                    schema.text("Sed consequat", [
                        schema.mark("comment", {commentThreadId: commentThread.id}),
                    ]),
                    schema.text(
                        ", nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi. " +
                            "x".repeat(10_000) +
                            "y",
                    ),
                ]),
            ]),
        );

        expect(
            (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
        ).toEqual({
            version: 6,
            content: {
                doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                    schema.node("title", null, [schema.text("Hello, world!")]),
                    schema.node("paragraph", null, [
                        schema.text(
                            "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed consequat, nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi. " +
                                "x".repeat(7_332),
                        ),
                    ]),
                ]),
                references: emptyDocumentContentReferences,
            },
        });

        await updateContentPreview(session.action());
    }

    expect(
        (await getDocumentContentPreviewIfExists(session.action(), document.id))?.preview,
    ).toEqual({
        version: 8,
        content: {
            doc: schema.node("doc", {accessPolicy: expect.any(Object)}, [
                schema.node("title", null, [schema.text("Hello, world!")]),
                schema.node("paragraph", null, [
                    schema.text(
                        "Lorem zipsum dolor sit amet, consectetur adipiscing elit. Sed consequat, nunc convallis sodales porta, ipsum mi auctor turpis, nec sagittis nisi leo a mi. " +
                            "x".repeat(7_330),
                    ),
                ]),
            ]),
            references: emptyDocumentContentReferences,
        },
    });
});

describe("Comments", () => {
    test("can create a comment thread while updating content", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await expect(() =>
            getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();
    });

    test("can not create a comment thread with the same id twice", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await expect(() =>
            getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        await expect(() =>
            updateDocumentContent(session1.action(), {
                id: document.id,
                version: 2,
                steps: [new AddMarkStep(3, 8, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 2"),
                        initialCommentFileIds: [],
                    },
                ],
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, None, ConditionalCheckFailed, None, None]",
            ),
        );
    });

    test("can not create a comment thread if the comment thread id is not in steps", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await expect(() =>
            getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await expect(() =>
            updateDocumentContent(session1.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("bold"))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            }),
        ).rejects.toThrow(InvalidArgumentError);

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await expect(() =>
            getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();
    });

    test("can mark text with a comment style even if there is no related thread", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await expect(() =>
            getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        await expect(() =>
            getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();
    });

    test("comment threads that are no longer referenced will be archived after a snapshot update", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await expect(() =>
            getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(true);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();
    });

    test("can not re-create a comment thread that has been archived", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await expect(() =>
            getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(true);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        await expect(() =>
            updateDocumentContent(session1.action(), {
                id: document.id,
                version: 3,
                steps: [new AddMarkStep(3, 8, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 2"),
                        initialCommentFileIds: [],
                    },
                ],
            }),
        ).rejects.toThrow(
            new FailedPreconditionError(
                "DynamoDB TransactionCanceledException: Transaction cancelled, please refer cancellation reasons for specific reasons [None, None, None, ConditionalCheckFailed, None]",
            ),
        );

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();
    });

    test("comment threads that were unreferenced then re-referenced will be unarchived after a snapshot update", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await expect(() =>
            getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).rejects.toThrow(NotFoundError);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(true);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(false);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 3,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 4,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(true);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        expect(massageDocument(await document.get())).toEqual({
            version: 4,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            (await document.get()).content.references.commentThreadById.has(commentThreadId),
        ).toEqual(true);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();
    });

    test("comment threads correctly archived or unarchived will be left alone after a snapshot update", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId1 = generateId<DocumentCommentThreadId>();
        const commentThreadId2 = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId1,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 2,
            steps: [
                new RemoveMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 3,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId2}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId2,
                    initialCommentContent: createSimpleMessageContent("Test message content 2"),
                    initialCommentFileIds: [],
                },
            ],
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 4,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [
                            schema.mark("comment", {commentThreadId: commentThreadId2}),
                        ]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId: commentThreadId1,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId1,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId1,
            }),
        ).not.toBeNull();

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId: commentThreadId2,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId2,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId2,
            }),
        ).toBeNull();

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId: commentThreadId1,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId1,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId1,
            }),
        ).not.toBeNull();

        expect(
            await getDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId: commentThreadId2,
                commentIndex: 0,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId2,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId: commentThreadId2,
            }),
        ).toBeNull();
    });

    test("can archive a comment thread even when it is actively being updated", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ReferencedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 1,
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        const pausePromise =
            updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint.pauseForTest(document.id);

        const updateSnapshotPromise = updateDocumentSnapshotForTest(session1.action(), document.id);

        const {unpause} = await pausePromise;

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ReferencedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 1,
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test message content 2"),
            fileIds: [],
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ReferencedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 2,
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        unpause();

        await updateSnapshotPromise;

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ArchivedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 2,
        });
    });

    test("can unarchive a comment thread even when it is actively being updated", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 3,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ArchivedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 1,
        });

        const pausePromise =
            updateDocumentSnapshotBeforeMovingCommentThreadTestCheckpoint.pauseForTest(document.id);

        const updateSnapshotPromise = updateDocumentSnapshotForTest(session1.action(), document.id);

        const {unpause} = await pausePromise;

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ArchivedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 1,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 1]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 1,
        });

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: null,
            content: createSimpleMessageContent("Test message content 2"),
            fileIds: [],
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ArchivedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 2,
        });

        unpause();

        await updateSnapshotPromise;

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual({
            partitionType: "Document",
            sortRangeType: "ReferencedCommentThread",
            documentId: document.id,
            commentThreadId,
            createdTime: expect.any(Date),
            fallbackContentSnippet: expect.any(Object),
            commentsSummary: {
                nextCommentIndex: 2,
                lastChangeTime: null,
                commentCountByAuthorId: new Map([[session1.account.id, 2]]),
                mentionCountByAccountId: new Map(),
            },
            resolutionState: {type: "Unresolved"},
            updateLockVersion: 2,
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toEqual(null);
    });

    test("reading a comment thread while unarchiving works", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 3,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        const pausePromise =
            getDocumentCommentThreadItemAfterFirstGetItemTestCheckpoint.pauseForTest(document.id);

        const commentPromise = getDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            commentIndex: 0,
        });

        const {unpause} = await pausePromise;

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).not.toBeNull();

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        unpause();

        expect(await commentPromise).not.toBeNull();
    });

    test("can get many comment threads at once", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId1 = generateId<DocumentCommentThreadId>();
        const commentThreadId2 = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId1,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 2,
            steps: [
                new RemoveMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 3,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId2}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId2,
                    initialCommentContent: createSimpleMessageContent("Test message content 2"),
                    initialCommentFileIds: [],
                },
            ],
        });

        {
            const {commentThreadById: commentThreads} =
                await batchGetDocumentCommentThreadReferencesIfExists(session1.action(), {
                    documentId: document.id,
                    commentThreadIds: [],
                });

            expect(commentThreads.size).toEqual(0);
        }

        {
            const {commentThreadById: commentThreads} =
                await batchGetDocumentCommentThreadReferencesIfExists(session1.action(), {
                    documentId: document.id,
                    commentThreadIds: [commentThreadId1],
                });

            expect(commentThreads.size).toEqual(1);
            expect(commentThreads.has(commentThreadId1)).toBe(true);
        }

        {
            const fakeCommentThreadId = generateId<DocumentCommentThreadId>();

            const {commentThreadById: commentThreads} =
                await batchGetDocumentCommentThreadReferencesIfExists(session1.action(), {
                    documentId: document.id,
                    commentThreadIds: [fakeCommentThreadId],
                });

            expect(commentThreads.size).toEqual(0);
            expect(commentThreads.has(fakeCommentThreadId)).toBe(false);
        }

        {
            const fakeCommentThreadId = generateId<DocumentCommentThreadId>();

            const {commentThreadById: commentThreads} =
                await batchGetDocumentCommentThreadReferencesIfExists(session1.action(), {
                    documentId: document.id,
                    commentThreadIds: [commentThreadId1, commentThreadId2, fakeCommentThreadId],
                });

            expect(commentThreads.size).toEqual(2);
            expect(commentThreads.has(commentThreadId1)).toBe(true);
            expect(commentThreads.has(commentThreadId2)).toBe(true);
            expect(commentThreads.has(fakeCommentThreadId)).toBe(false);
        }

        {
            const fakeCommentThreadId = generateId<DocumentCommentThreadId>();

            const {commentThreadById: commentThreads} =
                await batchGetDocumentCommentThreadReferencesIfExists(session1.action(), {
                    documentId: document.id,
                    commentThreadIds: [commentThreadId1, commentThreadId2, fakeCommentThreadId],
                });

            expect(commentThreads.size).toEqual(2);
            expect(commentThreads.has(commentThreadId1)).toBe(true);
            expect(commentThreads.has(commentThreadId2)).toBe(true);
            expect(commentThreads.has(fakeCommentThreadId)).toBe(false);
        }
    });

    test("can not get comment threads for a document in another space", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession();
        const document = await TestDocument.create(session);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId1 = generateId<DocumentCommentThreadId>();
        const commentThreadId2 = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId1,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 2,
            steps: [
                new RemoveMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(session.action(), document.id);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 3,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId2}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId2,
                    initialCommentContent: createSimpleMessageContent("Test message content 2"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(otherSession.action(), {
                documentId: document.id,
                commentThreadIds: [],
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(otherSession.action(), {
                documentId: document.id,
                commentThreadIds: [commentThreadId1],
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(otherSession.action(), {
                documentId: document.id,
                commentThreadIds: [generateId()],
            }),
        ).rejects.toThrow(PermissionDeniedError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(otherSession.action(), {
                documentId: document.id,
                commentThreadIds: [commentThreadId1, commentThreadId2, generateId()],
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can not get comment threads for a document that doesn’t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession();
        const document = await TestDocument.create(session);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId1 = generateId<DocumentCommentThreadId>();
        const commentThreadId2 = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId1,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 2,
            steps: [
                new RemoveMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId1}),
                ),
            ],
            clientId: generateId(),
        });

        await updateDocumentSnapshotForTest(session.action(), document.id);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 3,
            steps: [
                new AddMarkStep(
                    10,
                    15,
                    schema.mark("comment", {commentThreadId: commentThreadId2}),
                ),
            ],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId: commentThreadId2,
                    initialCommentContent: createSimpleMessageContent("Test message content 2"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(otherSession.action(), {
                documentId: generateId(),
                commentThreadIds: [],
            }),
        ).rejects.toThrow(NotFoundError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(otherSession.action(), {
                documentId: generateId(),
                commentThreadIds: [commentThreadId1],
            }),
        ).rejects.toThrow(NotFoundError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(otherSession.action(), {
                documentId: generateId(),
                commentThreadIds: [generateId()],
            }),
        ).rejects.toThrow(NotFoundError);

        await expect(
            batchGetDocumentCommentThreadReferencesIfExists(otherSession.action(), {
                documentId: generateId(),
                commentThreadIds: [commentThreadId1, commentThreadId2, generateId()],
            }),
        ).rejects.toThrow(NotFoundError);
    });

    test("comment thread update lock version stays the same when moving across referenced and archived items", async () => {
        const DocumentsTable = getDocumentsTableForTest();

        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const document = await TestDocument.create(session1);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(undefined);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: 0,
            content: createSimpleMessageContent("Test message content 2"),
            fileIds: [],
        });

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(1);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: 0,
            content: createSimpleMessageContent("Test message content 3"),
            fileIds: [],
        });

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(2);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 2,
            steps: [new RemoveMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(3);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ArchivedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(3);

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: 0,
            content: createSimpleMessageContent("Test message content 4"),
            fileIds: [],
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ArchivedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(4);

        await updateDocumentContent(session1.action(), {
            id: document.id,
            version: 3,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ReferencedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ArchivedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(4);

        await updateDocumentSnapshotForTest(session1.action(), document.id);

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(4);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();

        await createDocumentComment(session1.action(), {
            documentId: document.id,
            commentThreadId,
            parentCommentIndex: 0,
            content: createSimpleMessageContent("Test message content 5"),
            fileIds: [],
        });

        expect(
            assertExists(
                await DocumentsTable.getItemIfExists(context, {
                    partitionType: "Document",
                    sortRangeType: "ReferencedCommentThread",
                    documentId: document.id,
                    commentThreadId,
                }),
            ).updateLockVersion,
        ).toBe(5);

        expect(
            await DocumentsTable.getItemIfExists(context, {
                partitionType: "Document",
                sortRangeType: "ArchivedCommentThread",
                documentId: document.id,
                commentThreadId,
            }),
        ).toBeNull();
    });

    describe("Notification subscribers", () => {
        test("throws when trying to access a comment thread that doesn’t exist", async () => {
            const space = await TestSpace.create(context);
            const session = await space.createSession();

            await expect(
                getDocumentCommentThreadNotificationSubscribers(session.action(), {
                    documentId: generateId(),
                    commentThreadId: generateId(),
                    isFirstComment: true,
                }),
            ).rejects.toThrow("Document not found (and 1 other error)");

            await expect(
                getDocumentCommentThreadNotificationSubscribers(session.action(), {
                    documentId: generateId(),
                    commentThreadId: generateId(),
                    isFirstComment: false,
                }),
            ).rejects.toThrow("Document not found (and 1 other error)");

            const document = await TestDocument.create(session);

            await expect(
                getDocumentCommentThreadNotificationSubscribers(session.action(), {
                    documentId: document.id,
                    commentThreadId: generateId(),
                    isFirstComment: true,
                }),
            ).rejects.toThrow(NotFoundError);

            await expect(
                getDocumentCommentThreadNotificationSubscribers(session.action(), {
                    documentId: document.id,
                    commentThreadId: generateId(),
                    isFirstComment: false,
                }),
            ).rejects.toThrow(NotFoundError);
        });

        test("throws when trying to access a comment thread in a different space", async () => {
            const space = await TestSpace.create(context);
            const otherSpace = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);
            const otherSession = await otherSpace.createSession();
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session2.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            });

            await expect(
                getDocumentCommentThreadNotificationSubscribers(otherSession.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).rejects.toThrow(PermissionDeniedError);

            await expect(
                getDocumentCommentThreadNotificationSubscribers(otherSession.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).rejects.toThrow(PermissionDeniedError);
        });

        test("the document owner is a subscriber for the first comment on their document", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2] = await space.createSessions(2);
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session2.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});
        });

        test("an account that comments on a comment thread is subscribed to notifications", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session2.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});

            await createDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("Test message content 2"),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});

            await createDocumentComment(session4.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("Test message content 3"),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            await createDocumentComment(session2.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("Test message content 4"),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session2.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });
        });

        test("an account that comments on a comment thread is subscribed to notifications even if the comment is deleted", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session2.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id])});

            await createDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: createSimpleMessageContent("Test message content 2"),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});

            await deleteDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 1,
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session2.account.id,
                    session3.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session2.account.id, session3.account.id])});
        });

        test("an account that is mentioned in a comment thread is subscribed to notifications", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            await createDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session4.account.id,
                                    isShort: false,
                                }),
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session3.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });
        });

        test("an unknown account that is mentioned in a comment thread is not subscribed to notifications", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            const unknownAccountId = generateId<AccountId>();

            await createDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: unknownAccountId,
                                    isShort: false,
                                }),
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([session1.account.id, session3.account.id, unknownAccountId]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([session1.account.id, session3.account.id, unknownAccountId]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session3.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([session1.account.id, session3.account.id, unknownAccountId]),
            });
        });

        test("a mentioned account from another space in a comment thread is not subscribed to notifications", async () => {
            const space = await TestSpace.create(context);
            const otherSpace = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);
            const otherSession = await otherSpace.createSession();
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            await createDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: otherSession.account.id,
                                    isShort: false,
                                }),
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    otherSession.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    otherSession.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session3.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    otherSession.account.id,
                ]),
            });
        });

        test("an account that is mentioned in a comment thread is subscribed to notifications even if the message is updated to remove the mention", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            await createDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session4.account.id,
                                    isShort: false,
                                }),
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session3.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            await updateDocumentCommentContent(session3.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 1,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, world!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session3.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });
        });

        test("an account that is mentioned in a comment thread is subscribed to notifications even if the message is deleted", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            await createDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session4.account.id,
                                    isShort: false,
                                }),
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session3.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            await deleteDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 1,
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session3.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });
        });

        test("an account that is mentioned in a comment thread after it is updated is subscribed to notifications", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4] = await space.createSessions(4);
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("Test message content 1"),
                        initialCommentFileIds: [],
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session4.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id])});

            await createDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, world!"),
                        ]),
                    ]),
                ),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session3.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session3.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session3.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session1.account.id, session3.account.id])});

            await updateDocumentCommentContent(session3.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: 1,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session4.account.id,
                                    isShort: false,
                                }),
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session2.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session3.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session3.account.id,
                    session4.account.id,
                ]),
            });
        });

        test("notification subscribers are not duplicated and can be added from many different sources", async () => {
            const space = await TestSpace.create(context);
            const [session1, session2, session3, session4, session5, session6, session7] =
                await space.createSessions(7);
            const document = await TestDocument.create(session1, {
                access: {
                    accountGrantById: new Map([
                        [session1.account.id, {level: "Manage", generation: 0}],
                    ]),
                    defaultGrant: {level: "Manage", generation: 1},
                    urlGrant: null,
                },
            });

            await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 0,
                steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
                clientId: generateId(),
            });

            const commentThreadId = generateId<DocumentCommentThreadId>();

            await updateDocumentContent(session5.action(), {
                id: document.id,
                version: 1,
                steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
                clientId: generateId(),
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: assertMessageContent(
                            MessageContentProsemirrorSchema.node("doc", {}, [
                                MessageContentProsemirrorSchema.node("paragraph", {}, [
                                    MessageContentProsemirrorSchema.text("Hello, "),
                                    MessageContentProsemirrorSchema.node("mention", {
                                        mention: cast<ContentMention>({
                                            type: "Account",
                                            accountId: session2.account.id,
                                            isShort: false,
                                        }),
                                    }),
                                    MessageContentProsemirrorSchema.text("!"),
                                ]),
                            ]),
                        ),
                        initialCommentFileIds: [],
                    },
                ],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session5.account.id, session2.account.id])});

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session7.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session7.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({accountIds: new Set([session5.account.id, session2.account.id])});

            await createDocumentComment(session1.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, world!"),
                        ]),
                    ]),
                ),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session7.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session7.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session2.account.id,
                ]),
            });

            await createDocumentComment(session3.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session1.account.id,
                                    isShort: false,
                                }),
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session7.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session7.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                ]),
            });

            const comment = await createDocumentComment(session2.action(), {
                documentId: document.id,
                commentThreadId,
                parentCommentIndex: null,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session4.account.id,
                                    isShort: false,
                                }),
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
                fileIds: [],
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session7.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session7.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                ]),
            });

            await updateDocumentCommentContent(session2.action(), {
                documentId: document.id,
                commentThreadId,
                commentIndex: comment.index,
                content: assertMessageContent(
                    MessageContentProsemirrorSchema.node("doc", {}, [
                        MessageContentProsemirrorSchema.node("paragraph", {}, [
                            MessageContentProsemirrorSchema.text("Hello, "),
                            MessageContentProsemirrorSchema.node("mention", {
                                mention: cast<ContentMention>({
                                    type: "Account",
                                    accountId: session6.account.id,
                                    isShort: false,
                                }),
                            }),
                            MessageContentProsemirrorSchema.text("!"),
                        ]),
                    ]),
                ),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                    session6.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session1.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                    session6.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session7.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: true,
                }),
            ).toEqual({
                accountIds: new Set([
                    session1.account.id,
                    session5.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                    session6.account.id,
                ]),
            });

            expect(
                await getDocumentCommentThreadNotificationSubscribers(session7.action(), {
                    documentId: document.id,
                    commentThreadId,
                    isFirstComment: false,
                }),
            ).toEqual({
                accountIds: new Set([
                    session5.account.id,
                    session1.account.id,
                    session3.account.id,
                    session2.account.id,
                    session4.account.id,
                    session6.account.id,
                ]),
            });
        });
    });

    test("can resolve a comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const document = await TestDocument.create(session);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 2,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });
    });

    test("can resolve a comment thread with multiple references", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const document = await TestDocument.create(session);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 2,
            steps: [new AddMarkStep(3, 8, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [schema.mark("comment", {commentThreadId})]),
                        schema.text(", "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 3,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 4,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });
    });

    test("can invert comment thread resolution", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const document = await TestDocument.create(session);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 2,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        const {newInvertedSteps} = await updateDocumentContent(session.action(), {
            id: document.id,
            version: 2,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 3,
            steps: newInvertedSteps,
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 4,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello, "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });
    });

    test("can invert comment thread resolution with multiple references", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const document = await TestDocument.create(session);

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 0,
            steps: [new ReplaceStep(3, 3, textSlice("Hello, world!"))],
            clientId: generateId(),
        });

        const commentThreadId = generateId<DocumentCommentThreadId>();

        expect(massageDocument(await document.get())).toEqual({
            version: 1,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 1,
            steps: [new AddMarkStep(10, 15, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
            createCommentThreads: [
                {
                    commentThreadId,
                    initialCommentContent: createSimpleMessageContent("Test message content 1"),
                    initialCommentFileIds: [],
                },
            ],
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 2,
            steps: [new AddMarkStep(3, 8, schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 3,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [schema.mark("comment", {commentThreadId})]),
                        schema.text(", "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });

        const {newInvertedSteps} = await updateDocumentContent(session.action(), {
            id: document.id,
            version: 3,
            steps: [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId}))],
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 4,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [schema.text("Hello, world!")]),
                ])
                .toJSON(),
        });

        await updateDocumentContent(session.action(), {
            id: document.id,
            version: 4,
            steps: newInvertedSteps,
            clientId: generateId(),
        });

        expect(massageDocument(await document.get())).toEqual({
            version: 5,
            content: schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title", {}, []),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [schema.mark("comment", {commentThreadId})]),
                        schema.text(", "),
                        schema.text("world", [schema.mark("comment", {commentThreadId})]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        });
    });

    test("creating a comment thread does not return an updated comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThreadId = generateId<DocumentCommentThreadId>();

        const {updatedCommentThreads} = await document.update(
            session,
            [new AddMarkStep(range.from, range.to, schema.marks.comment.create({commentThreadId}))],
            {
                createCommentThreads: [
                    {
                        commentThreadId,
                        initialCommentContent: createSimpleMessageContent("test1"),
                        initialCommentFileIds: [],
                    },
                ],
            },
        );

        expect(updatedCommentThreads.length).toEqual(0);
    });

    test("can resolve comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        const {updatedCommentThreads} = await document.update(
            session,
            [
                new RemoveAllMarksStep(
                    schema.marks.comment.create({commentThreadId: commentThread.id}),
                ),
            ],
            {resolveCommentThreadIds: [commentThread.id]},
        );

        expect(updatedCommentThreads.length).toEqual(1);
        expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
        expect(updatedCommentThreads[0]).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: expect.any(Object),
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
    });

    test("can double resolve comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );

            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [{...range, isNode: false}],
            });
        }

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );

            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [{...range, isNode: false}],
            });
        }
    });

    test("can’t resolve comment thread which doesn’t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        await document.type(session, "Hello");
        await document.type(session, ", world!");

        const fakeCommentThreadId = generateId<DocumentCommentThreadId>();

        expect((await document.get()).version).toEqual(2);

        await expect(
            document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: fakeCommentThreadId}),
                    ),
                ],
                {resolveCommentThreadIds: [fakeCommentThreadId]},
            ),
        ).rejects.toThrow(NotFoundError);

        expect((await document.get()).version).toEqual(2);
    });

    test("can’t resolve comment thread if there are no other steps", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await expect(
            document.update(session, [], {resolveCommentThreadIds: [commentThread.id]}),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can’t resolve comment thread if there isn’t a `removeAllMarks` step", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await expect(
            document.update(
                session,
                [
                    new RemoveMarkStep(
                        range.from,
                        range.to,
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            ),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can’t resolve comment thread if there is a `removeAllMarks` step for a different comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await expect(
            document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: generateId()}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            ),
        ).rejects.toThrow(InvalidArgumentError);
    });

    test("can’t resolve comment thread if there is another step alongside a `removeAllMarks` step", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range: range1} = await document.type(session, "Hello");
        const {range: range2} = await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range2, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await expect(
            document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                    new ReplaceStep(range1.from, range1.to, textSlice("Hellloooooo")),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            ),
        ).rejects.toThrow(
            new InvalidArgumentError(
                "When resolving a comment thread only `removeAllMarks` steps can be used",
            ),
        );
    });

    test("can resolve multiple comment threads at once", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const document = await TestDocument.create(session1);
        await document.access.grantDefault(session1, "Manage");

        const {range: range1} = await document.type(session1, "Hello");
        await document.type(session1, " ");
        const {range: range2} = await document.type(session1, "wonderful");
        await document.type(session1, " ");
        const {range: range3} = await document.type(session1, "world");
        await document.type(session1, "!");

        const commentThread1 = await document.createCommentThread(session1, range1, "test1");
        const commentThread2 = await document.createCommentThread(session2, range2, "test2");
        const commentThread3 = await document.createCommentThread(session1, range3, "test3");

        expect(await commentThread1.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread1.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );
        expect(await commentThread2.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread2.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session2.get(),
            }),
        );
        expect(await commentThread3.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread3.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );

        const {updatedCommentThreads} = await document.update(
            session1,
            [
                new RemoveAllMarksStep(
                    schema.marks.comment.create({commentThreadId: commentThread2.id}),
                ),
                new RemoveAllMarksStep(
                    schema.marks.comment.create({commentThreadId: commentThread1.id}),
                ),
                new RemoveAllMarksStep(
                    schema.marks.comment.create({commentThreadId: commentThread3.id}),
                ),
            ],
            {resolveCommentThreadIds: [commentThread1.id, commentThread2.id, commentThread3.id]},
        );

        expect(updatedCommentThreads.length).toEqual(3);
        expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
            await commentThread1.get(),
        );
        expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
            await commentThread2.get(),
        );
        expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
            await commentThread3.get(),
        );
        expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread1.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text("Hello", [
                                    schema2.mark("comment", {commentThreadId: commentThread1.id}),
                                ]),
                                schema2.text(" wonderful world!"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );
        expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread2.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text("Hello "),
                                schema2.text("wonderful", [
                                    schema2.mark("comment", {commentThreadId: commentThread2.id}),
                                ]),
                                schema2.text(" world!"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session2.get(),
            }),
        );
        expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread3.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text("Hello wonderful "),
                                schema2.text("world", [
                                    schema2.mark("comment", {commentThreadId: commentThread3.id}),
                                ]),
                                schema2.text("!"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );
    });

    test("can unresolve comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [{...range, isNode: false}],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }
    });

    test("can double unresolve comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
            session.action(),
            {
                documentId: document.id,
                commentThreadId: commentThread.id,
            },
        );

        expect(resolvedCommentThreadRanges).toEqual({
            version: 4,
            ranges: [{...range, isNode: false}],
        });

        {
            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }
    });

    test("can unresolve comment thread when there are no ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(", world!"),
                    ]),
                ])
                .toJSON(),
        );

        await document.update(session, [new ReplaceStep(range.from, range.to, textSlice(""))]);

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text(", world!")]),
                ])
                .toJSON(),
        );

        await commentThread.resolve(session);

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text(", world!")]),
                ])
                .toJSON(),
        );

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 5,
                ranges: [],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 3,
                    fallbackContentSnippet: {
                        doc: assertDocumentWithOptionalTitleContent(
                            schema2.node("doc", {}, [
                                schema2.node("title"),
                                schema2.node("paragraph", {}, [
                                    schema2.text("Hello", [
                                        schema2.mark("comment", {
                                            commentThreadId: commentThread.id,
                                        }),
                                    ]),
                                    schema2.text(", world!"),
                                ]),
                            ]),
                        ),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text(", world!")]),
                ])
                .toJSON(),
        );
    });

    test("can unresolve comment thread when there are multiple ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range: range1} = await document.type(session, "Hello");
        await document.type(session, " ");
        const {range: range2} = await document.type(session, "wonderful");
        await document.type(session, " ");
        const {range: range3} = await document.type(session, "world");
        await document.type(session, "!");

        const commentThread = await document.createCommentThread(session, range1, "test1");

        await document.update(session, [
            new AddMarkStep(
                range2.from,
                range2.to,
                schema.mark("comment", {commentThreadId: commentThread.id}),
            ),
            new AddMarkStep(
                range3.from,
                range3.to,
                schema.mark("comment", {commentThreadId: commentThread.id}),
            ),
        ]);

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(" "),
                        schema.text("wonderful", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(" "),
                        schema.text("world", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        );

        await commentThread.resolve(session);

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hello wonderful world!")]),
                ])
                .toJSON(),
        );

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 10,
                ranges: [
                    {...range1, isNode: false},
                    {...range2, isNode: false},
                    {...range3, isNode: false},
                ],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: {
                        doc: assertDocumentWithOptionalTitleContent(
                            schema2.node("doc", {}, [
                                schema2.node("title"),
                                schema2.node("paragraph", {}, [
                                    schema2.text("Hello", [
                                        schema2.mark("comment", {
                                            commentThreadId: commentThread.id,
                                        }),
                                    ]),
                                    schema2.text(" "),
                                    schema2.text("wonderful", [
                                        schema2.mark("comment", {
                                            commentThreadId: commentThread.id,
                                        }),
                                    ]),
                                    schema2.text(" "),
                                    schema2.text("world", [
                                        schema2.mark("comment", {
                                            commentThreadId: commentThread.id,
                                        }),
                                    ]),
                                    schema2.text("!"),
                                ]),
                            ]),
                        ),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(" "),
                        schema.text("wonderful", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text(" "),
                        schema.text("world", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        );
    });

    test("can’t unresolve comment thread which doesn’t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");
        const fakeCommentThreadId = generateId<DocumentCommentThreadId>();

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [{...range, isNode: false}],
            });

            expect((await document.get()).version).toEqual(4);

            await expect(
                updateDocumentContent(session.action(), {
                    id: document.id,
                    version: resolvedCommentThreadRanges.version,
                    steps: [
                        new AddMarksAfterRemoveAllStep(
                            schema.marks.comment.create({commentThreadId: fakeCommentThreadId}),
                            resolvedCommentThreadRanges.ranges,
                        ),
                    ],
                    unresolveCommentThreadIds: [fakeCommentThreadId],
                    clientId: generateId(),
                }),
            ).rejects.toThrow(NotFoundError);

            expect((await document.get()).version).toEqual(4);
        }
    });

    test("can unresolve comment thread if there’s no `addMarksAfterRemoveAll` step", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [{...range, isNode: false}],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarkStep(
                        range.from,
                        range.to,
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }
    });

    test("can unresolve comment thread if there’s an `addMarksAfterRemoveAll` step for the wrong comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [{...range, isNode: false}],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: generateId()}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }
    });

    test("can unresolve multiple comment threads at once", async () => {
        const space = await TestSpace.create(context);
        const session1 = await space.createSession();
        const session2 = await space.createSession();

        const document = await TestDocument.create(session1);
        await document.access.grantDefault(session1, "Manage");

        const {range: range1} = await document.type(session1, "Hello");
        await document.type(session1, " ");
        const {range: range2} = await document.type(session1, "wonderful");
        await document.type(session1, " ");
        const {range: range3} = await document.type(session1, "world");
        await document.type(session1, "!");

        const commentThread1 = await document.createCommentThread(session1, range1, "test1");
        const commentThread2 = await document.createCommentThread(session2, range2, "test2");
        const commentThread3 = await document.createCommentThread(session1, range3, "test3");

        expect(await commentThread1.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread1.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );
        expect(await commentThread2.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread2.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session2.get(),
            }),
        );
        expect(await commentThread3.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread3.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session1.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session1,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread2.id}),
                    ),
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread1.id}),
                    ),
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread3.id}),
                    ),
                ],
                {
                    resolveCommentThreadIds: [
                        commentThread1.id,
                        commentThread2.id,
                        commentThread3.id,
                    ],
                },
            );

            expect(updatedCommentThreads.length).toEqual(3);
            expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
                await commentThread1.get(),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
                await commentThread2.get(),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
                await commentThread3.get(),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread1.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: {
                        doc: assertDocumentWithOptionalTitleContent(
                            schema2.node("doc", {}, [
                                schema2.node("title"),
                                schema2.node("paragraph", {}, [
                                    schema2.text("Hello", [
                                        schema2.mark("comment", {
                                            commentThreadId: commentThread1.id,
                                        }),
                                    ]),
                                    schema2.text(" wonderful world!"),
                                ]),
                            ]),
                        ),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session1.get(),
                }),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread2.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: {
                        doc: assertDocumentWithOptionalTitleContent(
                            schema2.node("doc", {}, [
                                schema2.node("title"),
                                schema2.node("paragraph", {}, [
                                    schema2.text("Hello "),
                                    schema2.text("wonderful", [
                                        schema2.mark("comment", {
                                            commentThreadId: commentThread2.id,
                                        }),
                                    ]),
                                    schema2.text(" world!"),
                                ]),
                            ]),
                        ),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session2.get(),
                }),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread3.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: {
                        doc: assertDocumentWithOptionalTitleContent(
                            schema2.node("doc", {}, [
                                schema2.node("title"),
                                schema2.node("paragraph", {}, [
                                    schema2.text("Hello wonderful "),
                                    schema2.text("world", [
                                        schema2.mark("comment", {
                                            commentThreadId: commentThread3.id,
                                        }),
                                    ]),
                                    schema2.text("!"),
                                ]),
                            ]),
                        ),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session1.get(),
                }),
            );
        }

        {
            const {updatedCommentThreads} = await updateDocumentContent(session1.action(), {
                id: document.id,
                version: 9,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread1.id}),
                        [{...range1, isNode: false}],
                    ),
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread3.id}),
                        [{...range3, isNode: false}],
                    ),
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread2.id}),
                        [{...range2, isNode: false}],
                    ),
                ],
                unresolveCommentThreadIds: [
                    commentThread1.id,
                    commentThread2.id,
                    commentThread3.id,
                ],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(3);
            expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
                await commentThread1.get(),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
                await commentThread2.get(),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
                await commentThread3.get(),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread1.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread1.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: {
                        doc: assertDocumentWithOptionalTitleContent(
                            schema2.node("doc", {}, [
                                schema2.node("title"),
                                schema2.node("paragraph", {}, [
                                    schema2.text("Hello", [
                                        schema2.mark("comment", {
                                            commentThreadId: commentThread1.id,
                                        }),
                                    ]),
                                    schema2.text(" wonderful world!"),
                                ]),
                            ]),
                        ),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session1.get(),
                }),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread2.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread2.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: {
                        doc: assertDocumentWithOptionalTitleContent(
                            schema2.node("doc", {}, [
                                schema2.node("title"),
                                schema2.node("paragraph", {}, [
                                    schema2.text("Hello "),
                                    schema2.text("wonderful", [
                                        schema2.mark("comment", {
                                            commentThreadId: commentThread2.id,
                                        }),
                                    ]),
                                    schema2.text(" world!"),
                                ]),
                            ]),
                        ),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session2.get(),
                }),
            );
            expect(updatedCommentThreads.find(({id}) => id === commentThread3.id)).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread3.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: {
                        doc: assertDocumentWithOptionalTitleContent(
                            schema2.node("doc", {}, [
                                schema2.node("title"),
                                schema2.node("paragraph", {}, [
                                    schema2.text("Hello wonderful "),
                                    schema2.text("world", [
                                        schema2.mark("comment", {
                                            commentThreadId: commentThread3.id,
                                        }),
                                    ]),
                                    schema2.text("!"),
                                ]),
                            ]),
                        ),
                        references: emptyDocumentContentReferences,
                    },
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session1.get(),
                }),
            );
        }
    });

    test("can resolve then unresolve then resolve again for comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 4,
                ranges: [{...range, isNode: false}],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 3,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 6,
                ranges: [{...range, isNode: false}],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 4,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }
    });

    test("can unresolve comment thread after updates", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range: range1} = await document.type(session, "Hello");
        await document.type(session, " ");
        const {range: range2} = await document.type(session, "wonderful");
        await document.type(session, " ");
        const {range: range3} = await document.type(session, "world");
        await document.type(session, "!");

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hello wonderful world!")]),
                ])
                .toJSON(),
        );

        const commentThread = await document.createCommentThread(session, range3, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hello wonderful "),
                        schema.text("world", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        );

        {
            const {newVersion, updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(newVersion).toEqual(8);
            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hello wonderful world!")]),
                ])
                .toJSON(),
        );

        await document.update(session, [
            new ReplaceStep(range2.from, range2.to, textSlice("wooonderfulll")),
        ]);

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hello wooonderfulll world!")]),
                ])
                .toJSON(),
        );

        await document.update(session, [
            new ReplaceStep(range1.from, range1.to, textSlice("Hellloooo")),
        ]);

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [schema.text("Hellloooo wooonderfulll world!")]),
                ])
                .toJSON(),
        );

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 8,
                ranges: [{isNode: false, from: 19, to: 24}],
            });

            const {newVersion, updatedCommentThreads} = await updateDocumentContent(
                session.action(),
                {
                    id: document.id,
                    version: resolvedCommentThreadRanges.version,
                    steps: [
                        new AddMarksAfterRemoveAllStep(
                            schema.marks.comment.create({commentThreadId: commentThread.id}),
                            resolvedCommentThreadRanges.ranges,
                        ),
                    ],
                    unresolveCommentThreadIds: [commentThread.id],
                    clientId: generateId(),
                },
            );

            expect(newVersion).toEqual(11);
            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect((await document.get()).content.doc.toJSON()).toEqual(
            schema
                .node("doc", {accessPolicy: document.initialAccessPolicy}, [
                    schema.node("title"),
                    schema.node("paragraph", {}, [
                        schema.text("Hellloooo wooonderfulll "),
                        schema.text("world", [
                            schema.mark("comment", {commentThreadId: commentThread.id}),
                        ]),
                        schema.text("!"),
                    ]),
                ])
                .toJSON(),
        );
    });

    test("can create, resolve, and unresolve comment thread on file", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);
        const file = await TestFile.create(session);

        await attachFileAsUploader(
            session.action(),
            space.id,
            file.id,
            FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
        );

        await document.update(session, [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from(
                        schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                    ),
                    0,
                    0,
                ),
            ),
        ]);

        const commentThread = await document.createCommentThread(
            session,
            {isNode: true, pos: 3},
            "test1",
        );

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 3,
                ranges: [{isNode: true, pos: 3}],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }
    });

    test("can create, resolve, and unresolve multiple comment threads on the same file", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);
        const file = await TestFile.create(session);

        await attachFileAsUploader(
            session.action(),
            space.id,
            file.id,
            FileDocumentAuthorizer.bind({type: "Document", documentId: document.id}),
        );

        await document.update(session, [
            new ReplaceStep(
                2,
                4,
                new Slice(
                    Fragment.from(
                        schema.node("fileRow", {}, [schema.node("file", {fileId: file.id})]),
                    ),
                    0,
                    0,
                ),
            ),
        ]);

        const commentThread1 = await document.createCommentThread(
            session,
            {isNode: true, pos: 3},
            "test1",
        );

        const commentThread2 = await document.createCommentThread(
            session,
            {isNode: true, pos: 3},
            "test2",
        );

        const commentThread3 = await document.createCommentThread(
            session,
            {isNode: true, pos: 3},
            "test3",
        );

        expect(await commentThread1.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread1.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        expect(await commentThread2.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread2.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        expect(await commentThread3.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread3.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread2.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread2.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread2.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread2.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect(await commentThread1.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread1.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        expect(await commentThread2.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread2.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: expect.any(Object),
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        expect(await commentThread3.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread3.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const {updatedCommentThreads} = await document.update(
                session,
                [
                    new RemoveAllMarksStep(
                        schema.marks.comment.create({commentThreadId: commentThread1.id}),
                    ),
                ],
                {resolveCommentThreadIds: [commentThread1.id]},
            );

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread1.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread1.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 1,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: true,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect(await commentThread1.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread1.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: expect.any(Object),
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        expect(await commentThread2.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread2.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: expect.any(Object),
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        expect(await commentThread3.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread3.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        {
            const resolvedCommentThreadRanges = await getResolvedDocumentCommentThreadRanges(
                session.action(),
                {
                    documentId: document.id,
                    commentThreadId: commentThread2.id,
                },
            );

            expect(resolvedCommentThreadRanges).toEqual({
                version: 5,
                ranges: [{isNode: true, pos: 3}],
            });

            const {updatedCommentThreads} = await updateDocumentContent(session.action(), {
                id: document.id,
                version: resolvedCommentThreadRanges.version,
                steps: [
                    new AddMarksAfterRemoveAllStep(
                        schema.marks.comment.create({commentThreadId: commentThread2.id}),
                        resolvedCommentThreadRanges.ranges,
                    ),
                ],
                unresolveCommentThreadIds: [commentThread2.id],
                clientId: generateId(),
            });

            expect(updatedCommentThreads.length).toEqual(1);
            expect(updatedCommentThreads[0]).toEqual(await commentThread2.get());
            expect(updatedCommentThreads[0]).toEqual(
                new DocumentCommentThreadModel({
                    id: commentThread2.id,
                    documentId: document.id,
                    createdTime: expect.any(Date),
                    version: 2,
                    fallbackContentSnippet: expect.any(Object),
                    isResolved: false,
                    commentCount: 1,
                    lastCommentChangeTime: null,
                    firstCommentAuthor: await session.get(),
                }),
            );
        }

        expect(await commentThread1.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread1.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: expect.any(Object),
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        expect(await commentThread2.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread2.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 2,
                fallbackContentSnippet: expect.any(Object),
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        expect(await commentThread3.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread3.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
    });

    test("can resolve comment thread where content snippet doesn’t include title", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session, {
            content: assertDocumentContent(
                schema.node("doc", {}, [
                    schema.node("title", {}, [schema.text("Test Document")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 1.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 2.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 3.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 4.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 5.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 6.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 7.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 8.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 9.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 10.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 11.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 12.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 13.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 14.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 15.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 16.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 17.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 18.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 19.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 20.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 21.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 22.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 23.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 24.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 25.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 26.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 27.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 28.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 29.")]),
                    schema.node("paragraph", {}, [schema.text("Test paragraph 30.")]),
                ]),
            ),
        });

        const commentThread = await document.createCommentThread(
            session,
            {from: 232, to: 244},
            "test1",
        );

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        const {updatedCommentThreads} = await document.update(
            session,
            [
                new RemoveAllMarksStep(
                    schema.marks.comment.create({commentThreadId: commentThread.id}),
                ),
            ],
            {resolveCommentThreadIds: [commentThread.id]},
        );

        expect(updatedCommentThreads.length).toEqual(1);
        expect(updatedCommentThreads[0]).toEqual(await commentThread.get());
        expect(updatedCommentThreads[0]).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 9.")]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 10.")]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 11.")]),
                            schema2.node("paragraph", {}, [
                                schema2.text("Test "),
                                schema2.text("paragraph 12", [
                                    schema2.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema2.text("."),
                            ]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 13.")]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 14.")]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 15.")]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 16.")]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 17.")]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 18.")]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 19.")]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 20.")]),
                            schema2.node("paragraph", {}, [schema2.text("Test paragraph 21.")]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
            }),
        );
    });

    test("can’t get comment thread if you don’t have access to the space", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession();

        const document = await TestDocument.create(session);
        await document.access.grantDefault(session, "Manage");

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await expect(
            getDocumentCommentThread(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).resolves.not.toBeNull();
        await expect(
            getDocumentCommentThread(otherSession.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can’t get comment thread for a comment which doesn’t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        await document.createCommentThread(session, range, "test1");

        await expect(
            getDocumentCommentThread(session.action(), {
                documentId: document.id,
                commentThreadId: generateId(),
            }),
        ).rejects.toThrow(NotFoundError);
    });

    test("can get comment thread", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(
            await getDocumentCommentThread(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
    });

    test("can get resolved comment thread ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await commentThread.resolve(session);

        expect(
            await getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual({
            version: 4,
            ranges: [{...range, isNode: false}],
        });
    });

    test("can’t get resolved comment thread ranges if comment thread is not resolved", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await expect(
            getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow(FailedPreconditionError);

        await commentThread.resolve(session);

        expect(
            await getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual({
            version: 4,
            ranges: [{...range, isNode: false}],
        });

        await commentThread.unresolve(session);

        await expect(
            getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow(FailedPreconditionError);
    });

    test("can’t get resolved comment thread ranges if you don’t have access to the space", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const otherSpace = await TestSpace.create(context);
        const otherSession = await otherSpace.createSession();

        const document = await TestDocument.create(session);
        await document.access.grantDefault(session, "Manage");

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await commentThread.resolve(session);

        expect(
            await getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual({
            version: 5,
            ranges: [{...range, isNode: false}],
        });

        await expect(
            getResolvedDocumentCommentThreadRanges(otherSession.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("can’t get resolved comment thread ranges for a comment which doesn’t exist", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await commentThread.resolve(session);

        await expect(
            getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: generateId(),
            }),
        ).rejects.toThrow(NotFoundError);
    });

    test("can get resolved comment thread ranges if there are no ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        await document.update(session, [new ReplaceStep(range.from, range.to, textSlice(""))]);

        await commentThread.resolve(session);

        expect(
            await getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual({
            version: 5,
            ranges: [],
        });
    });

    test("can get resolved comment thread ranges if there are many ranges", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range: range1} = await document.type(session, "Hello");
        await document.type(session, " ");
        const {range: range2} = await document.type(session, "wonderful");
        await document.type(session, " ");
        const {range: range3} = await document.type(session, "world");
        await document.type(session, "!");

        const commentThread = await document.createCommentThread(session, range1, "test1");

        await document.update(session, [
            new AddMarkStep(
                range2.from,
                range2.to,
                schema.mark("comment", {commentThreadId: commentThread.id}),
            ),
            new AddMarkStep(
                range3.from,
                range3.to,
                schema.mark("comment", {commentThreadId: commentThread.id}),
            ),
        ]);

        await commentThread.resolve(session);

        expect(
            await getResolvedDocumentCommentThreadRanges(session.action(), {
                documentId: document.id,
                commentThreadId: commentThread.id,
            }),
        ).toEqual({
            version: 10,
            ranges: [
                {...range1, isNode: false},
                {...range2, isNode: false},
                {...range3, isNode: false},
            ],
        });
    });

    test("saves fallback snippet if comment is removed from document not through resolving", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [new ReplaceStep(range.from, range.to, textSlice(""))]);

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text("Hello", [
                                    schema2.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema2.text(", world!"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [
            new ReplaceStep(
                range.from,
                range.from,
                textSlice("Helloooo", [
                    schema.mark("comment", {commentThreadId: commentThread.id}),
                ]),
            ),
        ]);

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text("Hello", [
                                    schema2.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema2.text(", world!"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [new ReplaceStep(range.from, range.to + 3, textSlice(""))]);

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 2,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text("Helloooo", [
                                    schema2.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema2.text(", world!"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
    });

    test("saves fallback snippet if comment is completely removed from document not through resolving", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range: range1} = await document.type(session, "Hello");
        await document.type(session, ", ");
        const {range: range2} = await document.type(session, "world");
        await document.type(session, "!");

        const commentThread = await document.createCommentThread(session, range1, "test1");

        await document.update(session, [
            new AddMarkStep(
                range2.from,
                range2.to,
                schema.mark("comment", {commentThreadId: commentThread.id}),
            ),
        ]);

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [new ReplaceStep(range1.from, range1.to, textSlice(""))]);

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [
            new ReplaceStep(range2.from - 5, range2.to - 5, textSlice("")),
        ]);

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text(", "),
                                schema2.text("world", [
                                    schema2.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema2.text("!"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [
            new ReplaceStep(
                range1.from,
                range1.from,
                textSlice("Helloooo", [
                    schema.mark("comment", {commentThreadId: commentThread.id}),
                ]),
            ),
        ]);

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text(", "),
                                schema2.text("world", [
                                    schema2.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema2.text("!"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [
            new ReplaceStep(range1.from, range1.to + 3, textSlice("")),
        ]);

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 2,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text("Helloooo", [
                                    schema2.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema2.text(", !"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
    });

    test("saves fallback snippet if comment is removed from document through resolving", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();

        const document = await TestDocument.create(session);

        const {range} = await document.type(session, "Hello");
        await document.type(session, ", world!");

        const commentThread = await document.createCommentThread(session, range, "test1");

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 0,
                fallbackContentSnippet: null,
                isResolved: false,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(
            session,
            [new RemoveAllMarksStep(schema.mark("comment", {commentThreadId: commentThread.id}))],
            {resolveCommentThreadIds: [commentThread.id]},
        );

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text("Hello", [
                                    schema2.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema2.text(", world!"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );

        await document.update(session, [
            new ReplaceStep(
                range.from,
                range.to,
                textSlice("Helloooo", [
                    schema.mark("comment", {commentThreadId: commentThread.id}),
                ]),
            ),
        ]);

        expect(await commentThread.get()).toEqual(
            new DocumentCommentThreadModel({
                id: commentThread.id,
                documentId: document.id,
                createdTime: expect.any(Date),
                version: 1,
                fallbackContentSnippet: {
                    doc: assertDocumentWithOptionalTitleContent(
                        schema2.node("doc", {}, [
                            schema2.node("title"),
                            schema2.node("paragraph", {}, [
                                schema2.text("Hello", [
                                    schema2.mark("comment", {commentThreadId: commentThread.id}),
                                ]),
                                schema2.text(", world!"),
                            ]),
                        ]),
                    ),
                    references: emptyDocumentContentReferences,
                },
                isResolved: true,
                commentCount: 1,
                lastCommentChangeTime: null,
                firstCommentAuthor: await session.get(),
            }),
        );
    });
});

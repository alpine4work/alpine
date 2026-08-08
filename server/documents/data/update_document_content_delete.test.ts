import {DocAttrStep} from "prosemirror-transform";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {
    authorizeDocumentAccess,
    authorizeDocumentAccessIfPossible,
    getDocument,
    getDocumentContent,
    getDocumentContentPreviewIfPossible,
    getDocumentPreviewIfExists,
    getDocumentPreviewIfPossible,
    getDocumentTitleIfExists,
    getDocumentsTableForTest,
    updateDocumentContent,
} from "~/server/documents/data/documents_actions.js";
import {documentsInjection} from "~/server/documents/data/documents_injection.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext({documentsInjection});

test("soft deletes a document via doc attr step", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test"});

    await document.delete(session);

    const DocumentsTable = getDocumentsTableForTest();
    const item = await DocumentsTable.getItem(context, {
        partitionType: "Document",
        sortRangeType: "Attributes",
        documentId: document.id,
    });

    expect(item.deleted?.time).toBeInstanceOf(Date);
});

test("soft delete sets deletor from context actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test"});

    await document.delete(session);

    const DocumentsTable = getDocumentsTableForTest();
    const item = await DocumentsTable.getItem(context, {
        partitionType: "Document",
        sortRangeType: "Attributes",
        documentId: document.id,
    });
    expect(item.deleted?.deletor).toMatchObject({id: session.account.id, from: null});
});

test("soft delete sets deletor from bot actor", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Admin"});
    const botAccount = await TestBot.createAndInstantiate(session);
    const document = await TestDocument.create(session, {title: "Test"});

    const deletedTime = new Date();
    await updateDocumentContent(botAccount.action({type: "Document", documentId: document.id}), {
        id: document.id,
        version: await document.getVersion(),
        steps: [new DocAttrStep("deletedTime", deletedTime)],
        clientId: generateId(),
        intentionallyUpdateDeletedTime: {deletedTime},
    });

    const DocumentsTable = getDocumentsTableForTest();
    const item = await DocumentsTable.getItem(context, {
        partitionType: "Document",
        sortRangeType: "Attributes",
        documentId: document.id,
    });
    expect(item.deleted?.deletor).toEqual({
        id: botAccount.id,
        from: {type: "Bot", accountId: botAccount.id},
    });
});

test("deleted document is not accessible via getDocument", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test"});

    await document.delete(session);

    await expect(getDocument(session.action(), document.id)).rejects.toThrow(
        "Document was deleted",
    );
});

test("deleted document is not accessible via getDocumentContent", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test"});

    await document.delete(session);

    await expect(getDocumentContent(session.action(), document.id)).rejects.toThrow(
        "Document was deleted",
    );
});

test("other user with access cannot access deleted document via getDocument", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Secret Title"});
    await document.access.grantDefault(session1);

    await document.delete(session1);

    await expect(getDocument(session2.action(), document.id)).rejects.toThrow(
        "Document was deleted",
    );
});

test("user without view access cannot access deleted document via getDocument", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Secret Title"});

    await document.delete(session1);

    await expect(getDocument(session2.action(), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `View` access level",
    );
});

test("user without view access cannot access deleted document via getDocumentContent", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Secret Title"});

    await document.delete(session1);

    await expect(getDocumentContent(session2.action(), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `View` access level",
    );
});

test("getDocumentContent returns content for a non-deleted document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Visible Title"});

    const result = await getDocumentContent(session.action(), document.id);

    expect(result.spaceId).toBe(space.id);
});

test("getDocumentContent throws for a non-existent document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(getDocumentContent(session.action(), generateId<DocumentId>())).rejects.toThrow(
        "Document not found",
    );
});

test("document authorization returns deleted error for deleted document with view access", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test"});

    await document.delete(session);

    const result = await authorizeDocumentAccessIfPossible(session.action(), document.id, "View");

    expect(result.ok === false && result.error.message).toBe("Document was deleted");
});

test("document authorization returns view error for deleted document without view access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Secret Title"});

    await document.delete(session1);

    const result = await authorizeDocumentAccessIfPossible(session2.action(), document.id, "View");

    expect(result.ok === false && result.error.message).toBe(
        "Actor doesn\u2019t have `View` access level",
    );
});

test("other user cannot access deleted document preview", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Secret Title"});
    await document.access.grantDefault(session1);

    await document.delete(session1);

    const result = await getDocumentPreviewIfPossible(session2.action(), document.id);
    expect(result).toMatchObject({ok: false});
    expect(result!.ok === false && result!.error.message).toBe("Document was deleted");
});

test("other user cannot access deleted document content preview", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Secret Title"});
    await document.access.grantDefault(session1);

    await document.delete(session1);

    const result = await getDocumentContentPreviewIfPossible(session2.action(), document.id);
    expect(result).toMatchObject({ok: false});
    expect(result!.ok === false && result!.error.message).toBe("Document was deleted");
});

test("dangerouslyAllowDeleted lets actors with access read deleted document metadata", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Deleted Title"});
    await document.access.grantDefault(session1, "Comment");

    await document.delete(session1);

    await expect(
        authorizeDocumentAccess(session2.action(), document.id, "View", {
            dangerouslyAllowDeleted: true,
        }),
    ).resolves.toMatchObject({spaceId: space.id});
    await expect(
        getDocumentTitleIfExists(session2.action(), document.id, {
            dangerouslyAllowDeleted: true,
        }),
    ).resolves.toMatchObject({title: "Deleted Title", isDeleted: true});
});

test("dangerouslyAllowDeleted only authorizes view access for deleted documents", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Deleted Title"});
    await document.access.grantDefault(session1, "View");

    await document.delete(session1);

    await expect(
        authorizeDocumentAccess(session2.action(), document.id, "View", {
            dangerouslyAllowDeleted: true,
        }),
    ).resolves.toMatchObject({spaceId: space.id});
    await expect(
        authorizeDocumentAccess(session2.action(), document.id, "Edit", {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("Document was deleted");
});

test("getDocumentContent with dangerouslyAllowDeleted returns deleted document content", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {
        title: "Deleted Title",
        body: "Deleted body",
    });
    await document.access.grantDefault(session1, "View");

    await document.delete(session1);

    const result = await getDocumentContent(session2.action(), document.id, {
        dangerouslyAllowDeleted: true,
    });

    expect({
        deletedTime: result.deleted?.time,
        contentDeletedTime: result.content.attrs.deletedTime,
        contentJson: result.content.toJSON(),
    }).toMatchObject({
        deletedTime: expect.any(Date),
        contentDeletedTime: result.deleted?.time,
        contentJson: {
            content: [
                {type: "title", content: [{type: "text", text: "Deleted Title"}]},
                {type: "paragraph", content: [{type: "text", text: "Deleted body"}]},
            ],
        },
    });
});

test("getDocumentContent with dangerouslyAllowDeleted does not bypass active document access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Visible Title"});
    await document.access.grantDefault(session1, "View");

    await expect(
        getDocumentContent(session2.action(), document.id, {dangerouslyAllowDeleted: true}),
    ).rejects.toThrow("Actor doesn\u2019t have `Comment` access level");
});

test("dangerouslyAllowDeleted does not let actors without view access read deleted documents", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Deleted Title"});

    await document.delete(session1);

    await expect(
        authorizeDocumentAccess(session2.action(), document.id, "View", {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("Actor doesn\u2019t have `View` access level");
    await expect(
        getDocumentTitleIfExists(session2.action(), document.id, {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("Actor doesn\u2019t have `View` access level");
    await expect(
        getDocumentContent(session2.action(), document.id, {dangerouslyAllowDeleted: true}),
    ).rejects.toThrow("Actor doesn\u2019t have `View` access level");
});

test("dangerouslyAllowDeleted does not let anonymous actors read URL-granted deleted documents", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {
        title: "Deleted Title",
        access: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        },
    });

    await document.delete(session);

    await expect(
        authorizeDocumentAccess(context.anonymousAction(), document.id, "View", {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("Document was deleted");
    await expect(
        getDocumentTitleIfExists(context.anonymousAction(), document.id, {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("Document was deleted");
    await expect(
        getDocumentContent(context.anonymousAction(), document.id, {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("Document was deleted");
});

test("dangerouslyAllowDeleted does not let URL-granted actors outside the space read deleted documents", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const otherSession = await otherSpace.createSession();
    const document = await TestDocument.create(session, {
        title: "Deleted Title",
        access: {
            type: "Local",
            accountGrantById: new Map([[session.account.id, {level: "Manage", generation: 0}]]),
            defaultGrant: null,
            urlGrant: {level: "View"},
        },
    });

    await document.delete(session);

    await expect(
        authorizeDocumentAccess(otherSession.action(), document.id, "View", {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("Document was deleted");
    await expect(
        getDocumentTitleIfExists(otherSession.action(), document.id, {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("Document was deleted");
    await expect(
        getDocumentContent(otherSession.action(), document.id, {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("Document was deleted");
});

test("dangerouslyAllowDeleted does not let another space system actor read deleted documents", async () => {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "System Deleted Title"});

    await document.delete(session);

    await expect(
        authorizeDocumentAccess(otherSpace.systemAction(), document.id, "View", {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("System actor doesn\u2019t have access to space");
    await expect(
        getDocumentTitleIfExists(otherSpace.systemAction(), document.id, {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("System actor doesn\u2019t have access to space");
    await expect(
        getDocumentContent(otherSpace.systemAction(), document.id, {
            dangerouslyAllowDeleted: true,
        }),
    ).rejects.toThrow("System actor doesn\u2019t have access to space");
});

test("getDocumentTitleIfExists returns the correct isDeleted value", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const activeDocument = await TestDocument.create(session, {title: "Active Title"});
    const deletedDocument = await TestDocument.create(session, {title: "Deleted Title"});

    await deletedDocument.delete(session);

    expect(await getDocumentTitleIfExists(session.action(), activeDocument.id)).toMatchObject({
        title: "Active Title",
        isDeleted: false,
    });
    expect(
        await getDocumentTitleIfExists(space.systemAction(), deletedDocument.id, {
            dangerouslyAllowDeleted: true,
        }),
    ).toMatchObject({title: "Deleted Title", isDeleted: true});
});

test("deleted document title is not leaked to other users", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Secret Title"});
    await document.access.grantDefault(session1);

    await document.delete(session1);

    await expect(getDocumentTitleIfExists(session2.action(), document.id)).rejects.toThrow(
        "Document was deleted",
    );
});

test("deleted document title requires view access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Secret Title"});

    await document.delete(session1);

    await expect(getDocumentTitleIfExists(session2.action(), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `View` access level",
    );
});

test("getDocumentTitleIfExists returns title for a non-deleted document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Visible Title"});

    await expect(getDocumentTitleIfExists(session.action(), document.id)).resolves.toMatchObject({
        title: "Visible Title",
    });
});

test("getDocumentTitleIfExists throws for a private non-deleted document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {title: "Secret Title"});

    await expect(getDocumentTitleIfExists(session2.action(), document.id)).rejects.toThrow(
        "Actor doesn\u2019t have `View` access level",
    );
});

test("getDocumentTitleIfExists returns null for a non-existent document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();

    await expect(
        getDocumentTitleIfExists(session.action(), generateId<DocumentId>()),
    ).resolves.toBeNull();
});

test("getDocumentTitleIfExists throws for deleted document", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test"});

    await document.delete(session);

    await expect(getDocumentTitleIfExists(session.action(), document.id)).rejects.toThrow(
        "Document was deleted",
    );
});

test("deleted document preview if possible returns error", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test"});

    await document.delete(session);

    const result = await getDocumentPreviewIfPossible(session.action(), document.id);
    expect(result).toMatchObject({ok: false});
    expect(result!.ok === false && result!.error.message).toBe("Document was deleted");
});

test("deleted document preview if exists throws", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test"});

    await document.delete(session);

    await expect(getDocumentPreviewIfExists(session.action(), document.id)).rejects.toThrow(
        "Document was deleted",
    );
});

test("deleted document content preview returns error with deleted message", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test"});

    await document.delete(session);

    const result = await getDocumentContentPreviewIfPossible(session.action(), document.id);
    expect(result).toMatchObject({ok: false});
    expect(result).not.toBeNull();
    expect(result!.ok === false && result!.error.message).toBe("Document was deleted");
});

test("updating deleted time without intentionallyUpdateDeletedTime throws", async () => {
    const space = await TestSpace.create(context);
    const session = await space.createSession();
    const document = await TestDocument.create(session, {title: "Test"});

    await expect(
        document.update(session, [new DocAttrStep("deletedTime", new Date())]),
    ).rejects.toThrow(
        "Can\u2019t update the document\u2019s deleted time unless `intentionallyUpdateDeletedTime` is provided",
    );
});

test("deleting a document requires Manage access", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {
        title: "Test",
        access: {
            type: "Local",
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Edit"}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await expect(document.delete(session2)).rejects.toThrow("Manage");
});

test("user with Manage access can delete a document", async () => {
    const space = await TestSpace.create(context);
    const [session1, session2] = await space.createSessions(2);
    const document = await TestDocument.create(session1, {
        title: "Test",
        access: {
            type: "Local",
            accountGrantById: new Map([
                [session1.account.id, {level: "Manage", generation: 0}],
                [session2.account.id, {level: "Manage", generation: 1}],
            ]),
            defaultGrant: null,
            urlGrant: null,
        },
    });

    await document.delete(session2);

    const DocumentsTable = getDocumentsTableForTest();
    const item = await DocumentsTable.getItem(context, {
        partitionType: "Document",
        sortRangeType: "Attributes",
        documentId: document.id,
    });
    expect(item.deleted).toMatchObject({
        time: expect.any(Date),
        deletor: {id: session2.account.id, from: null},
    });
});

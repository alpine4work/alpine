import {getDocumentsTableForTest} from "~/server/documents/data/documents_actions.js";
import {DocumentsTable} from "~/server/documents/data/internal/documents_table.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {DynamoTableItemType} from "~/server/dynamo/core/dynamo_table_schema.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";

type PartialDocumentAttributesItem = Partial<
    DynamoTableItemType<typeof DocumentsTable, "Document", "Attributes">
>;

const context = createTestContext({});

async function assertDocumentAttributesMigration({
    documentId,
    spaceId,
    partialRawValue,
    migratedDocument,
}: {
    documentId: DocumentId;
    spaceId: SpaceId;
    partialRawValue: Record<string, unknown>;
    migratedDocument: PartialDocumentAttributesItem;
}) {
    const DocumentsTable = getDocumentsTableForTest();

    const partitionKey = `Document#${documentId}`;
    const sortKey = "a0#Attributes";

    const oldFormatItem = {
        partitionKey,
        sortKey,
        createdTime: new Date().toISOString(),
        spaceId,
        version: 1,
        titleWithoutFallback: "Test Document",
        ...partialRawValue,
    };

    // @ts-expect-error Pull the dynamo client out of context so we can directly put data in.
    const dynamoClient = context.dynamo._client;
    await dynamoClient.putItem(context, {
        tableName: "Documents",
        key: {partitionKey, sortKey},
        item: oldFormatItem,
        debugItemType: {
            tableName: "Documents",
            partitionType: "Document",
            sortRangeType: "Attributes",
        },
    });

    const migratedItem = await DocumentsTable.getItemIfExists(context, {
        partitionType: "Document",
        sortRangeType: "Attributes",
        documentId,
    });

    expect(migratedItem).not.toBeNull();
    expect(migratedItem).toMatchObject(migratedDocument);
}

describe("documents table schema migration", () => {
    test("migrates existing fromBotAccountId to creator.from", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const document = await TestDocument.create(session);
        const fromBotAccountId = generateId<AccountId>();

        const partialRawValue = {
            ownerId: session.account.id,
            creator: {
                fromBotAccountId,
            },
        };

        const migratedDocument: PartialDocumentAttributesItem = {
            documentId: document.id,
            creator: {
                id: session.account.id,
                from: {
                    type: "Bot",
                    accountId: fromBotAccountId,
                },
            },
        };

        await assertDocumentAttributesMigration({
            documentId: document.id,
            spaceId: space.id,
            partialRawValue,
            migratedDocument,
        });
    });

    test("migrates null fromBotAccountId to creator.from", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const document = await TestDocument.create(session);

        const partialRawValue = {
            ownerId: session.account.id,
            creator: {
                fromBotAccountId: null,
            },
        };

        const migratedDocument: PartialDocumentAttributesItem = {
            documentId: document.id,
            creator: {
                id: session.account.id,
                from: null,
            },
        };

        await assertDocumentAttributesMigration({
            documentId: document.id,
            spaceId: space.id,
            partialRawValue,
            migratedDocument,
        });
    });
});

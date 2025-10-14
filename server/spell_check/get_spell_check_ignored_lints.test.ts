import {createDocument} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {
    createEmptySpellCheckIgnoredLintsForNewEntity,
    getSpellCheckIgnoredLints,
} from "~/server/spell_check/get_spell_check_ignored_lints.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

describe("getSpellCheckIgnoredLints", () => {
    test("returns ignored lints for document entity", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const id = generateId<DocumentId>();

        await createDocument(session.action(), {
            id,
            spaceId: space.id,
        });

        const result = await getSpellCheckIgnoredLints(session.action(), `Document:${id}`);
        expect(result.items).toEqual([]);
    });

    test("returns ignored lints for document entity for view only", async () => {
        const space1 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const session2 = await space1.createSession();

        const document = await TestDocument.create(session1, {
            access: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "View", generation: 0}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        const result = await getSpellCheckIgnoredLints(
            session2.action(),
            `Document:${document.id}`,
        );
        expect(result.items).toEqual([]);
    });

    test("returns ignored lints for document entity for comment only", async () => {
        const space1 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const session2 = await space1.createSession();

        const document = await TestDocument.create(session1, {
            access: {
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Comment", generation: 0}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        const result = await getSpellCheckIgnoredLints(
            session2.action(),
            `Document:${document.id}`,
        );
        expect(result.items).toEqual([]);
    });

    test("throws error for unauthorized access", async () => {
        const space1 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const space2 = await TestSpace.create(context);
        const session2 = await space2.createSession();
        const id = generateId<DocumentId>();

        await createDocument(session1.action(), {
            id,
            spaceId: space1.id,
        });

        await expect(
            getSpellCheckIgnoredLints(session2.action(), `Document:${id}`),
        ).rejects.toThrow(PermissionDeniedError);
    });
});

describe("createEmptySpellCheckIgnoredLintsForNewEntity", () => {
    test("creates empty result for document entity", () => {
        const documentId = generateId<DocumentId>();

        const result = createEmptySpellCheckIgnoredLintsForNewEntity(`Document:${documentId}`);

        expect(result.items).toEqual([]);
    });
});

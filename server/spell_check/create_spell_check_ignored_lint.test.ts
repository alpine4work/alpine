import {createDocument} from "~/server/documents/data/documents_actions.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {createSpellCheckIgnoredLint} from "~/server/spell_check/create_spell_check_ignored_lint.js";
import {getSpellCheckIgnoredLints} from "~/server/spell_check/get_spell_check_ignored_lints.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext();

describe("createSpellCheckIgnoredLint", () => {
    test("creates ignored lint for document entity", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const id = generateId<DocumentId>();
        const key = "test-word";
        const kind = "spelling";

        await createDocument(session.action(), {
            id,
            spaceId: space.id,
        });

        await createSpellCheckIgnoredLint(session.action(), `Document:${id}`, key, kind);

        const result = await getSpellCheckIgnoredLints(session.action(), `Document:${id}`);
        const item = assertExists(result.items[0]);

        expect(result.items).toHaveLength(1);
        expect(item.model.key).toBe(key);
        expect(item.model.kind).toBe(kind);
        expect(item.model.creatorId).toBe(session.account.id);
    });

    test("throws error for unauthorized access for view access", async () => {
        const space1 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const session2 = await space1.createSession();
        const key = "test-word";
        const kind = "spelling";

        const document = await TestDocument.create(session1, {
            access: {
                type: "Local",
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "View", generation: 0}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        await expect(
            createSpellCheckIgnoredLint(session2.action(), `Document:${document.id}`, key, kind),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("throws error for unauthorized access for comment access", async () => {
        const space1 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const session2 = await space1.createSession();
        const key = "test-word";
        const kind = "spelling";

        const document = await TestDocument.create(session1, {
            access: {
                type: "Local",
                accountGrantById: new Map([
                    [session1.account.id, {level: "Manage", generation: 0}],
                    [session2.account.id, {level: "Comment", generation: 0}],
                ]),
                defaultGrant: null,
                urlGrant: null,
            },
        });

        await expect(
            createSpellCheckIgnoredLint(session2.action(), `Document:${document.id}`, key, kind),
        ).rejects.toThrow(PermissionDeniedError);
    });

    test("throws error for unauthorized access in other space", async () => {
        const space1 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const space2 = await TestSpace.create(context);
        const session2 = await space2.createSession();
        const id = generateId<DocumentId>();
        const key = "test-word";
        const kind = "spelling";

        await createDocument(session1.action(), {
            id,
            spaceId: space1.id,
        });

        await expect(
            createSpellCheckIgnoredLint(session2.action(), `Document:${id}`, key, kind),
        ).rejects.toThrow(PermissionDeniedError);
    });
});

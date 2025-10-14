import {createDocument} from "~/server/documents/data/documents_actions.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {backfillSpellCheckIgnoredLints} from "~/server/spell_check/backfill_spell_check_ignored_lints.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

describe("backfillSpellCheckIgnoredLints", () => {
    test("backfills ignored lints for document entity", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const id = generateId<DocumentId>();
        const readTime = new Date();

        await createDocument(session.action(), {
            id,
            spaceId: space.id,
        });

        const result = await backfillSpellCheckIgnoredLints(session.action(), {
            entityId: `Document:${id}`,
            readTime,
        });

        assert(result.type === "Available");
        expect(result.eventTransaction).toEqual([]);
    });

    test("throws error for unauthorized access", async () => {
        const space1 = await TestSpace.create(context);
        const session1 = await space1.createSession();
        const space2 = await TestSpace.create(context);
        const session2 = await space2.createSession();
        const id = generateId<DocumentId>();
        const readTime = new Date();

        await createDocument(session1.action(), {
            id,
            spaceId: space1.id,
        });

        await expect(
            backfillSpellCheckIgnoredLints(session2.action(), {
                entityId: `Document:${id}`,
                readTime,
            }),
        ).rejects.toThrow(PermissionDeniedError);
    });
});

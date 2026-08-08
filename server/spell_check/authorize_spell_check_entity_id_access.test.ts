import {createDocument} from "~/server/documents/data/documents_actions.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {authorizeSpellCheckEntityIdAccess} from "~/server/spell_check/authorize_spell_check_entity_id_access.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {DocumentId} from "~/shared/id/types/id_types.open_source.js";

const context = createTestContext();

describe("authorizeSpellCheckEntityIdAccess", () => {
    test("authorizes view access for document entity", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const id = generateId<DocumentId>();

        await createDocument(session.action(), {
            id,
            spaceId: space.id,
        });

        await expect(
            authorizeSpellCheckEntityIdAccess(session.action(), `Document:${id}`, "View"),
        ).resolves.not.toThrow();
    });

    test("authorizes edit access for document entity", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession();
        const id = generateId<DocumentId>();

        await createDocument(session.action(), {
            id,
            spaceId: space.id,
        });

        await expect(
            authorizeSpellCheckEntityIdAccess(session.action(), `Document:${id}`, "Edit"),
        ).resolves.not.toThrow();
    });

    test("throws error for unauthorized document access", async () => {
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
            authorizeSpellCheckEntityIdAccess(session2.action(), `Document:${id}`, "View"),
        ).rejects.toThrow(PermissionDeniedError);
    });
});
